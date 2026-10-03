-- 0006_pipeline_rpcs: stage changes, Won → job (+ invoices), Lost, reopen.
-- Source: docs/spec.md §4.1–§4.3, §4.6, §7.5.

-- ---------------------------------------------------------------------------
-- Fix for 0005: `text[] || 'literal'` is read as an array literal and fails at run time whenever
-- something is missing. Use array_append.
-- ---------------------------------------------------------------------------
-- Entry gate for a stage (§4.1). Returns the names of what is missing; empty array = pass.
create or replace function private.check_stage_gate(p_opportunity_id uuid, p_to_stage public.opportunity_stage)
returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  o record;
  missing text[] := '{}';
begin
  select opp.owner_id, opp.work_type, opp.property_id, c.phone, c.email
    into o
    from public.opportunities opp join public.customers c on c.id = opp.customer_id
   where opp.id = p_opportunity_id;

  if p_to_stage in ('contacted','qualified','inspection_scheduled','estimate_sent','negotiation','won') then
    if o.owner_id is null then missing := array_append(missing, 'owner'); end if;                      -- G1
  end if;
  if p_to_stage in ('qualified','inspection_scheduled','estimate_sent','negotiation','won') then      -- G2
    if o.work_type is null then missing := array_append(missing, 'work_type'); end if;
    if o.property_id is null then missing := array_append(missing, 'property'); end if;
    if coalesce(nullif(trim(o.phone), ''), nullif(trim(o.email::text), '')) is null then missing := array_append(missing, 'contact'); end if;
  end if;
  if p_to_stage = 'inspection_scheduled' then
    if not exists (select 1 from public.appointments a
                    where a.opportunity_id = p_opportunity_id and a.type = 'inspection'
                      and a.status in ('scheduled','completed')) then
      missing := array_append(missing, 'inspection');
    end if;
  end if;
  if p_to_stage in ('estimate_sent','negotiation') then
    if not exists (select 1 from public.estimates e
                    where e.opportunity_id = p_opportunity_id and e.status in ('sent','viewed')) then
      missing := array_append(missing, 'estimate');
    end if;
  end if;
  return missing;
end $$;


-- ---------------------------------------------------------------------------
-- change_opportunity_stage
-- p_fill lets the board's gate dialog supply the missing data and move in one transaction:
--   owner_id, work_type, phone, email, address_line1, city, state, postal_code
-- ---------------------------------------------------------------------------
create or replace function public.change_opportunity_stage(
  p_opportunity_id uuid, p_to_stage public.opportunity_stage, p_fill jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o record;
  v_missing text[];
  v_owner uuid := nullif(p_fill->>'owner_id', '')::uuid;
  v_address text := nullif(trim(p_fill->>'address_line1'), '');
  v_phone text := nullif(trim(p_fill->>'phone'), '');
  v_email text := nullif(lower(trim(p_fill->>'email')), '');
  v_property uuid;
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_to_stage in ('won', 'lost') then
    return jsonb_build_object('ok', false, 'code', 'use_dedicated_action', 'message', 'Use Mark Won or Mark Lost');
  end if;

  select id, stage, customer_id, property_id, owner_id into o
    from public.opportunities where id = p_opportunity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Deal not found');
  end if;
  if o.stage in ('won', 'lost') then
    return jsonb_build_object('ok', false, 'code', 'closed', 'message', 'This deal is closed');
  end if;

  -- Apply any data supplied by the gate dialog.
  if v_owner is not null and o.owner_id is distinct from v_owner then
    if not exists (select 1 from public.profiles where id = v_owner and is_active and role in ('admin', 'sales')) then
      return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Owner must be an active admin or sales user');
    end if;
    update public.opportunities set owner_id = v_owner where id = p_opportunity_id;
    update public.tasks set assigned_to = v_owner
     where opportunity_id = p_opportunity_id and status = 'open' and auto_key is not null;
  end if;
  if nullif(p_fill->>'work_type', '') is not null then
    update public.opportunities set work_type = (p_fill->>'work_type')::public.work_type where id = p_opportunity_id;
  end if;
  if v_address is not null and o.property_id is null then
    insert into public.properties (customer_id, address_line1, city, state, postal_code, is_primary)
    values (o.customer_id, v_address, nullif(trim(p_fill->>'city'), ''), nullif(trim(p_fill->>'state'), ''),
            nullif(trim(p_fill->>'postal_code'), ''),
            not exists (select 1 from public.properties where customer_id = o.customer_id))
    returning id into v_property;
    update public.opportunities set property_id = v_property where id = p_opportunity_id;
  end if;
  if v_phone is not null or v_email is not null then
    update public.customers
       set phone = coalesce(v_phone, phone),
           phone_e164 = coalesce(nullif(p_fill->>'phone_e164', ''), phone_e164),
           email = coalesce(v_email::extensions.citext, email)
     where id = o.customer_id;
  end if;

  v_missing := private.check_stage_gate(p_opportunity_id, p_to_stage);
  if array_length(v_missing, 1) > 0 then
    -- The fills above are kept on purpose: what the user typed is valid on its own even if
    -- another item (an inspection, an estimate) is still missing.
    return jsonb_build_object('ok', false, 'code', 'missing_requirements',
      'message', 'More information is needed before this deal can move', 'missing', to_jsonb(v_missing));
  end if;

  perform private.apply_stage_change(p_opportunity_id, p_to_stage);
  return jsonb_build_object('ok', true, 'stage', p_to_stage);
end $$;

-- ---------------------------------------------------------------------------
-- Draft invoices from an accepted estimate (§7.5). Deposit + final always sum to the estimate.
-- ---------------------------------------------------------------------------
create or replace function private.create_job_invoices(p_job_id uuid, p_estimate_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  e record;
  v_customer uuid;
  v_label text;
  v_dep_tax integer;
  v_invoice uuid;
begin
  select id, title, estimate_number, version, total_cents, tax_cents, deposit_cents, deposit_percent
    into e from public.estimates where id = p_estimate_id;
  select customer_id into v_customer from public.jobs where id = p_job_id;
  v_label := e.title || ' (E-' || e.estimate_number || case when e.version > 1 then '-v' || e.version else '' end || ')';

  if e.deposit_percent > 0 and e.deposit_cents > 0 and e.deposit_cents < e.total_cents then
    v_dep_tax := round(e.tax_cents::numeric * e.deposit_cents / e.total_cents)::integer;

    insert into public.invoices (job_id, customer_id, estimate_id, kind, subtotal_cents, tax_cents, total_cents)
    values (p_job_id, v_customer, e.id, 'deposit', e.deposit_cents - v_dep_tax, v_dep_tax, e.deposit_cents)
    returning id into v_invoice;
    insert into public.invoice_line_items (invoice_id, description, amount_cents)
    values (v_invoice, 'Deposit (' || e.deposit_percent || '%) — ' || v_label, e.deposit_cents - v_dep_tax);

    insert into public.invoices (job_id, customer_id, estimate_id, kind, subtotal_cents, tax_cents, total_cents)
    values (p_job_id, v_customer, e.id, 'final',
            (e.total_cents - e.deposit_cents) - (e.tax_cents - v_dep_tax), e.tax_cents - v_dep_tax,
            e.total_cents - e.deposit_cents)
    returning id into v_invoice;
    insert into public.invoice_line_items (invoice_id, description, amount_cents)
    values (v_invoice, 'Balance — ' || v_label, (e.total_cents - e.deposit_cents) - (e.tax_cents - v_dep_tax));
  else
    insert into public.invoices (job_id, customer_id, estimate_id, kind, subtotal_cents, tax_cents, total_cents)
    values (p_job_id, v_customer, e.id, 'final', e.total_cents - e.tax_cents, e.tax_cents, e.total_cents)
    returning id into v_invoice;
    insert into public.invoice_line_items (invoice_id, description, amount_cents)
    values (v_invoice, 'Balance — ' || v_label, e.total_cents - e.tax_cents);
  end if;
end $$;
revoke execute on function private.create_job_invoices(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- mark_opportunity_won (§4.2)
-- ---------------------------------------------------------------------------
create or replace function public.mark_opportunity_won(
  p_opportunity_id uuid, p_estimate_id uuid default null, p_amount_cents integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o record;
  e record;
  j record;
  v_missing text[];
  v_amount integer;
  v_scope text;
  v_job uuid;
  v_job_number bigint;
begin
  if not (private.is_staff() or private.is_service_role()) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;

  -- 1. Lock; idempotent if the job already exists.
  select id, stage, customer_id, property_id, owner_id, title, work_type, description into o
    from public.opportunities where id = p_opportunity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Deal not found');
  end if;
  select id, job_number into j from public.jobs where opportunity_id = p_opportunity_id;
  if found then
    return jsonb_build_object('ok', true, 'job_id', j.id, 'job_number', j.job_number, 'already', true);
  end if;

  -- 2. Gates.
  if o.stage = 'lost' then
    return jsonb_build_object('ok', false, 'code', 'is_lost', 'message', 'Reopen the deal before marking it won');
  end if;
  v_missing := private.check_stage_gate(p_opportunity_id, 'won');
  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object('ok', false, 'code', 'missing_requirements',
      'message', 'More information is needed before this deal can be won', 'missing', to_jsonb(v_missing));
  end if;

  -- 3. Amount.
  if p_estimate_id is not null then
    select id, status, total_cents into e from public.estimates
     where id = p_estimate_id and opportunity_id = p_opportunity_id;
    if not found or e.status not in ('sent', 'viewed', 'accepted') then
      return jsonb_build_object('ok', false, 'code', 'invalid_estimate', 'message', 'That estimate cannot be accepted');
    end if;
    v_amount := e.total_cents;
  elsif exists (select 1 from public.estimates
                 where opportunity_id = p_opportunity_id and status in ('sent', 'viewed')) then
    return jsonb_build_object('ok', false, 'code', 'choose_estimate', 'message', 'Choose which estimate was accepted');
  elsif coalesce(p_amount_cents, 0) > 0 then
    v_amount := p_amount_cents;
  else
    return jsonb_build_object('ok', false, 'code', 'amount_required', 'message', 'Enter the contract amount');
  end if;

  -- 4. Accept the estimate; void the others.
  if p_estimate_id is not null then
    update public.estimates set status = 'accepted', accepted_at = coalesce(accepted_at, now())
     where id = p_estimate_id and status <> 'accepted';
    update public.estimates set status = 'void'
     where opportunity_id = p_opportunity_id and id <> p_estimate_id and status in ('draft', 'sent', 'viewed');
  end if;

  -- 5. The deal.
  update public.opportunities
     set stage = 'won', won_at = now(), amount_cents = v_amount, estimated_value_cents = v_amount,
         closed_owner_id = owner_id, closed_by = auth.uid()
   where id = p_opportunity_id;

  -- 6. The job. scope_summary is price-free: it is what the crew sees.
  if p_estimate_id is not null then
    select string_agg(
             trim(trailing '.' from trim(trailing '0' from l.quantity::text)) || ' ' || l.unit || '  ' || l.name,
             E'\n' order by l.sort_order, l.created_at)
      into v_scope from public.estimate_line_items l where l.estimate_id = p_estimate_id;
  end if;
  insert into public.jobs (opportunity_id, customer_id, property_id, accepted_estimate_id, title, work_type,
                           status, warranty_years, scope_summary)
  values (p_opportunity_id, o.customer_id, o.property_id, p_estimate_id, o.title, o.work_type, 'pending_schedule',
          (select default_warranty_years from public.company_settings), coalesce(v_scope, o.description))
  returning id, job_number into v_job, v_job_number;

  -- 7. Sales follow-ups no longer apply.
  update public.tasks set status = 'cancelled'
   where opportunity_id = p_opportunity_id and status = 'open' and auto_key is not null;

  -- 8. Job tasks.
  perform private.create_auto_task(p_opportunity_id, v_job, 'schedule_job', 'Schedule job J-' || v_job_number, now() + interval '2 days');
  if not exists (select 1 from public.files where opportunity_id = p_opportunity_id and category = 'contract') then
    perform private.create_auto_task(p_opportunity_id, v_job, 'collect_contract', 'Get signed contract uploaded', now() + interval '1 day');
  end if;
  perform private.create_auto_task(p_opportunity_id, v_job, 'order_materials', 'Order materials', now() + interval '3 days');
  perform private.create_auto_task(p_opportunity_id, v_job, 'permit', 'Confirm permit requirements', now() + interval '2 days');

  -- 9. Draft invoices.
  if p_estimate_id is not null then
    perform private.create_job_invoices(v_job, p_estimate_id);
  end if;

  -- 10. Timeline. Amounts go in metadata, never in the summary.
  perform private.log_activity('deal_won', p_opportunity_id, null, 'Deal won',
    jsonb_build_object('amount_cents', v_amount, 'estimate_id', p_estimate_id));
  perform private.log_activity('job_created', p_opportunity_id, v_job, 'Job J-' || v_job_number || ' created', '{}'::jsonb);

  return jsonb_build_object('ok', true, 'job_id', v_job, 'job_number', v_job_number);
end $$;

-- ---------------------------------------------------------------------------
-- mark_opportunity_lost (§4.3)
-- ---------------------------------------------------------------------------
create or replace function public.mark_opportunity_lost(
  p_opportunity_id uuid, p_reason public.lost_reason, p_notes text default null, p_competitor text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare o record;
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, stage into o from public.opportunities where id = p_opportunity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Deal not found');
  end if;
  if o.stage = 'won' then
    return jsonb_build_object('ok', false, 'code', 'is_won', 'message', 'A won deal cannot be marked lost');
  end if;
  if o.stage = 'lost' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if p_reason is null then
    return jsonb_build_object('ok', false, 'code', 'reason_required', 'message', 'Choose a reason');
  end if;
  if p_reason = 'other' and nullif(trim(p_notes), '') is null then
    return jsonb_build_object('ok', false, 'code', 'notes_required', 'message', 'Add a note explaining the reason');
  end if;

  update public.opportunities
     set stage = 'lost', lost_at = now(), lost_reason = p_reason, lost_notes = nullif(trim(p_notes), ''),
         lost_competitor = nullif(trim(p_competitor), ''), closed_owner_id = owner_id, closed_by = auth.uid()
   where id = p_opportunity_id;
  update public.appointments set status = 'cancelled' where opportunity_id = p_opportunity_id and status = 'scheduled';
  update public.tasks set status = 'cancelled' where opportunity_id = p_opportunity_id and status = 'open';
  update public.estimates set status = 'void'
   where opportunity_id = p_opportunity_id and status in ('draft', 'sent', 'viewed');

  perform private.log_activity('deal_lost', p_opportunity_id, null, 'Deal lost',
    jsonb_build_object('reason', p_reason, 'competitor', nullif(trim(p_competitor), ''), 'from_stage', o.stage));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- reopen_opportunity (§4.3)
-- ---------------------------------------------------------------------------
create or replace function public.reopen_opportunity(p_opportunity_id uuid, p_to_stage public.opportunity_stage)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o record;
  v_missing text[];
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_to_stage in ('won', 'lost') then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Choose an open stage');
  end if;
  select id, stage into o from public.opportunities where id = p_opportunity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Deal not found');
  end if;
  if o.stage <> 'lost' then
    return jsonb_build_object('ok', false, 'code', 'not_lost', 'message', 'Only a lost deal can be reopened');
  end if;
  v_missing := private.check_stage_gate(p_opportunity_id, p_to_stage);
  if array_length(v_missing, 1) > 0 then
    return jsonb_build_object('ok', false, 'code', 'missing_requirements',
      'message', 'That stage needs more information; reopen to an earlier stage', 'missing', to_jsonb(v_missing));
  end if;

  update public.opportunities
     set stage = p_to_stage, lost_at = null, lost_reason = null, lost_notes = null, lost_competitor = null,
         closed_owner_id = null, closed_by = null
   where id = p_opportunity_id;
  perform private.log_activity('deal_reopened', p_opportunity_id, null, 'Deal reopened',
    jsonb_build_object('to', p_to_stage));
  perform private.create_auto_task(p_opportunity_id, null, 'reopened_followup', 'Follow up on reopened deal',
    now() + interval '1 day');
  return jsonb_build_object('ok', true, 'stage', p_to_stage);
end $$;

revoke execute on function
  public.change_opportunity_stage(uuid, public.opportunity_stage, jsonb),
  public.mark_opportunity_won(uuid, uuid, integer),
  public.mark_opportunity_lost(uuid, public.lost_reason, text, text),
  public.reopen_opportunity(uuid, public.opportunity_stage)
  from public, anon, authenticated;
grant execute on function
  public.change_opportunity_stage(uuid, public.opportunity_stage, jsonb),
  public.mark_opportunity_won(uuid, uuid, integer),
  public.mark_opportunity_lost(uuid, public.lost_reason, text, text),
  public.reopen_opportunity(uuid, public.opportunity_stage)
  to authenticated, service_role;
