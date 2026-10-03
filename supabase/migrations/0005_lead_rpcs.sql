-- 0005_lead_rpcs: note sharing, automation helpers, and the lead / contact / owner / task RPCs.
-- Source: docs/spec.md §4.1, §4.6, §6.5, §2.6 (shared_with_crew).

-- ---------------------------------------------------------------------------
-- Notes: staff notes are private to staff unless shared with the crew.
-- ---------------------------------------------------------------------------
alter table public.notes add column shared_with_crew boolean not null default false;
grant insert (shared_with_crew), update (shared_with_crew) on public.notes to authenticated;

-- Notes written by field users are always visible to the crew.
create or replace function private.note_defaults() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.profiles where id = new.author_id and role = 'field') then
    new.shared_with_crew := true;
  end if;
  return new;
end $$;
revoke execute on function private.note_defaults() from public, anon, authenticated;
create trigger notes_defaults before insert or update on public.notes
  for each row execute function private.note_defaults();

drop policy notes_select on public.notes;
create policy notes_select on public.notes for select to authenticated
  using ((select private.is_staff())
         or (opportunity_id is not null and shared_with_crew
             and private.field_can_access_opportunity(opportunity_id)));

-- A note with no author is a customer's message from a lead form.
create or replace function private.note_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select full_name into v_name from public.profiles where id = new.author_id;
  insert into public.activities (type, customer_id, opportunity_id, job_id, actor_id, summary, metadata)
  values ('note_added', new.customer_id, new.opportunity_id, new.job_id, new.author_id,
          case when new.author_id is null then 'Customer message added'
               else coalesce(v_name, 'Someone') || ' added a note' end,
          jsonb_build_object('note_id', new.id));
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Internal helpers (schema private; not callable over the API)
-- ---------------------------------------------------------------------------
create or replace function private.is_service_role() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select auth.role()) = 'service_role', false)
$$;

create or replace function private.work_type_label(p public.work_type) returns text
language sql immutable set search_path = '' as $$
  select case p
    when 'roof_replacement' then 'Roof Replacement'
    when 'roof_repair' then 'Roof Repair'
    when 'renovation' then 'Renovation'
    when 'gutters' then 'Gutters'
    when 'siding' then 'Siding'
    when 'other' then 'Other'
  end
$$;

-- Owner of the deal, else the longest-standing active admin.
create or replace function private.default_assignee(p_opportunity_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select o.owner_id from public.opportunities o
       join public.profiles p on p.id = o.owner_id and p.is_active
      where o.id = p_opportunity_id),
    (select id from public.profiles where role = 'admin' and is_active order by created_at limit 1))
$$;

create or replace function private.log_activity(
  p_type public.activity_type, p_opportunity_id uuid, p_job_id uuid, p_summary text,
  p_metadata jsonb default '{}'::jsonb, p_customer_id uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  -- fill_parent_ids supplies customer_id from the opportunity or job.
  insert into public.activities (type, customer_id, opportunity_id, job_id, actor_id, summary, metadata)
  values (p_type, p_customer_id, p_opportunity_id, p_job_id, auth.uid(), p_summary, coalesce(p_metadata, '{}'::jsonb));
end $$;

-- Idempotent: an open task with the same auto_key on the same deal is left alone.
create or replace function private.create_auto_task(
  p_opportunity_id uuid, p_job_id uuid, p_auto_key text, p_title text, p_due_at timestamptz,
  p_assignee uuid default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_assignee uuid := coalesce(p_assignee, private.default_assignee(p_opportunity_id));
begin
  if v_assignee is null then return; end if;   -- no active admin exists; nothing sensible to assign to
  insert into public.tasks (title, due_at, opportunity_id, job_id, assigned_to, created_by, auto_key)
  values (p_title, p_due_at, p_opportunity_id, p_job_id, v_assignee, null, p_auto_key)
  on conflict (opportunity_id, auto_key) where status = 'open' and auto_key is not null do nothing;
end $$;

create or replace function private.complete_auto_task(p_opportunity_id uuid, p_auto_key text) returns void
language sql security definer set search_path = '' as $$
  update public.tasks
     set status = 'done', completed_at = now(), completed_by = auth.uid()
   where opportunity_id = p_opportunity_id and auto_key = p_auto_key and status = 'open'
$$;

-- Next business-time 9:00 on the following day.
create or replace function private.tomorrow_9am() returns timestamptz
language sql stable security definer set search_path = '' as $$
  select ((date_trunc('day', now() at time zone s.timezone) + interval '1 day 9 hours') at time zone s.timezone)
  from public.company_settings s
$$;

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
    if o.owner_id is null then missing := missing || 'owner'; end if;                      -- G1
  end if;
  if p_to_stage in ('qualified','inspection_scheduled','estimate_sent','negotiation','won') then      -- G2
    if o.work_type is null then missing := missing || 'work_type'; end if;
    if o.property_id is null then missing := missing || 'property'; end if;
    if coalesce(nullif(trim(o.phone), ''), nullif(trim(o.email::text), '')) is null then missing := missing || 'contact'; end if;
  end if;
  if p_to_stage = 'inspection_scheduled' then
    if not exists (select 1 from public.appointments a
                    where a.opportunity_id = p_opportunity_id and a.type = 'inspection'
                      and a.status in ('scheduled','completed')) then
      missing := missing || 'inspection';
    end if;
  end if;
  if p_to_stage in ('estimate_sent','negotiation') then
    if not exists (select 1 from public.estimates e
                    where e.opportunity_id = p_opportunity_id and e.status in ('sent','viewed')) then
      missing := missing || 'estimate';
    end if;
  end if;
  return missing;
end $$;

-- What happens when a deal enters a stage (§4.1 "Automation on entry").
create or replace function private.run_stage_entry_automation(p_opportunity_id uuid, p_stage public.opportunity_stage)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select trim(c.first_name || ' ' || c.last_name) into v_name
    from public.opportunities o join public.customers c on c.id = o.customer_id
   where o.id = p_opportunity_id;

  if p_stage = 'new' then
    perform private.create_auto_task(p_opportunity_id, null, 'first_contact', 'Call new lead: ' || v_name, now() + interval '1 hour');
  elsif p_stage = 'contacted' then
    update public.opportunities set first_contacted_at = coalesce(first_contacted_at, now()) where id = p_opportunity_id;
    perform private.complete_auto_task(p_opportunity_id, 'first_contact');
    perform private.complete_auto_task(p_opportunity_id, 'retry_contact');
    perform private.create_auto_task(p_opportunity_id, null, 'qualify', 'Qualify and book inspection', now() + interval '1 day');
  elsif p_stage = 'qualified' then
    perform private.complete_auto_task(p_opportunity_id, 'qualify');
    perform private.create_auto_task(p_opportunity_id, null, 'schedule_inspection', 'Schedule inspection', now() + interval '1 day');
  elsif p_stage = 'inspection_scheduled' then
    perform private.complete_auto_task(p_opportunity_id, 'schedule_inspection');
  elsif p_stage = 'estimate_sent' then
    perform private.complete_auto_task(p_opportunity_id, 'send_estimate');
    perform private.create_auto_task(p_opportunity_id, null, 'estimate_followup', 'Follow up on estimate', now() + interval '3 days');
  elsif p_stage = 'negotiation' then
    if not exists (select 1 from public.tasks where opportunity_id = p_opportunity_id and status = 'open') then
      perform private.create_auto_task(p_opportunity_id, null, 'negotiation_followup', 'Follow up', now() + interval '3 days');
    end if;
  end if;
end $$;

-- Moves a deal between open stages and runs entry automation. Callers check the gate first.
create or replace function private.apply_stage_change(p_opportunity_id uuid, p_to_stage public.opportunity_stage)
returns void
language plpgsql security definer set search_path = '' as $$
declare v_from public.opportunity_stage;
begin
  select stage into v_from from public.opportunities where id = p_opportunity_id for update;
  if v_from = p_to_stage then return; end if;
  update public.opportunities set stage = p_to_stage where id = p_opportunity_id;
  perform private.run_stage_entry_automation(p_opportunity_id, p_to_stage);
  perform private.log_activity('stage_changed', p_opportunity_id, null,
    'Stage changed', jsonb_build_object('from', v_from, 'to', p_to_stage));
end $$;

revoke execute on function
  private.is_service_role(), private.work_type_label(public.work_type), private.default_assignee(uuid),
  private.log_activity(public.activity_type, uuid, uuid, text, jsonb, uuid),
  private.create_auto_task(uuid, uuid, text, text, timestamptz, uuid),
  private.complete_auto_task(uuid, text), private.tomorrow_9am(),
  private.check_stage_gate(uuid, public.opportunity_stage),
  private.run_stage_entry_automation(uuid, public.opportunity_stage),
  private.apply_stage_change(uuid, public.opportunity_stage)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_lead (§6.5)
-- ---------------------------------------------------------------------------
create or replace function public.create_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_channel      public.lead_channel := coalesce(nullif(p->>'channel', ''), 'manual')::public.lead_channel;
  v_service      boolean := private.is_service_role();
  v_first        text := nullif(trim(p->>'first_name'), '');
  v_last         text := coalesce(nullif(trim(p->>'last_name'), ''), '');
  v_phone        text := nullif(trim(p->>'phone'), '');
  v_phone_e164   text := nullif(trim(p->>'phone_e164'), '');
  v_email        text := nullif(lower(trim(p->>'email')), '');
  v_address      text := nullif(trim(p->>'address_line1'), '');
  v_postal       text := nullif(trim(p->>'postal_code'), '');
  v_message      text := nullif(trim(p->>'message'), '');
  v_work_type    public.work_type := nullif(p->>'work_type', '')::public.work_type;
  v_import_stage public.opportunity_stage := nullif(p->>'import_stage', '')::public.opportunity_stage;
  v_customer     uuid := nullif(p->>'customer_id', '')::uuid;
  v_property     uuid := nullif(p->>'property_id', '')::uuid;
  v_is_new       boolean := false;
  v_key          text;
  v_target       uuid;
  v_open_count   integer;
  v_possible_dup uuid;
  v_source       uuid;
  v_source_name  text;
  v_owner        uuid;
  v_opp          uuid;
  v_title        text;
begin
  if not (private.is_staff() or v_service) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if (v_channel = 'import' or v_import_stage is not null) and not v_service then
    raise exception 'import is service-role only' using errcode = 'insufficient_privilege';
  end if;
  if v_import_stage in ('won', 'lost') then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Only open stages can be imported');
  end if;

  -- 1. Customer: explicit id (manual "use this customer"), else match on phone, then email.
  if v_customer is not null then
    if not exists (select 1 from public.customers where id = v_customer) then
      return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Customer not found');
    end if;
  else
    if v_first is null then
      return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'First name is required');
    end if;
    if v_phone is null and v_email is null then
      return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'A phone number or email is required');
    end if;
    if v_phone_e164 is not null then
      select id into v_customer from public.customers
       where phone_e164 = v_phone_e164 and archived_at is null order by created_at limit 1;
    end if;
    if v_customer is null and v_email is not null then
      select id into v_customer from public.customers
       where email = v_email::extensions.citext and archived_at is null order by created_at limit 1;
    end if;
    if v_customer is null then
      insert into public.customers (first_name, last_name, email, phone, phone_e164, created_by)
      values (v_first, v_last, v_email, v_phone, v_phone_e164, auth.uid())
      returning id into v_customer;
      v_is_new := true;
    end if;
  end if;

  -- 2. Property: explicit id, else the customer's property with the same address key.
  if v_property is not null then
    if not exists (select 1 from public.properties where id = v_property and customer_id = v_customer) then
      return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Property does not belong to this customer');
    end if;
  elsif v_address is not null then
    v_key := lower(regexp_replace(v_address || ' ' || coalesce(v_postal, ''), '[^a-zA-Z0-9]', '', 'g'));
    select id into v_property from public.properties
     where customer_id = v_customer and address_key = v_key order by created_at limit 1;
  end if;

  -- 3. Merge target: one open deal on the same property, or (no address given) the customer's only open deal.
  if not v_is_new then
    if v_property is not null then
      select count(*), (array_agg(id))[1] into v_open_count, v_target from public.opportunities
       where customer_id = v_customer and property_id = v_property and stage not in ('won', 'lost');
    elsif v_address is null then
      select count(*), (array_agg(id))[1] into v_open_count, v_target from public.opportunities
       where customer_id = v_customer and stage not in ('won', 'lost');
    end if;
    if coalesce(v_open_count, 0) <> 1 then v_target := null; end if;
  end if;

  -- Imports never merge: an existing open deal on the same property means "skip this row".
  if v_channel = 'import' and v_property is not null and exists (
       select 1 from public.opportunities
        where customer_id = v_customer and property_id = v_property and stage not in ('won', 'lost')) then
    return jsonb_build_object('ok', true, 'status', 'skipped', 'customer_id', v_customer, 'is_new_customer', false);
  end if;

  -- 4. Merge (never for manual entry or import).
  if v_target is not null and v_channel not in ('manual', 'import') then
    perform private.log_activity('duplicate_inquiry', v_target, null, 'Customer contacted us again',
      jsonb_build_object('channel', v_channel));
    if v_message is not null then
      insert into public.notes (body, opportunity_id, author_id) values (v_message, v_target, null);
    end if;
    perform private.create_auto_task(v_target, null, 'duplicate_inquiry', 'Customer contacted us again — call',
      now() + interval '1 hour');
    return jsonb_build_object('ok', true, 'status', 'merged_duplicate', 'customer_id', v_customer,
      'opportunity_id', v_target, 'is_new_customer', false);
  end if;

  -- 5. New deal. Flag it when the customer already has another open deal.
  if not v_is_new then
    select id into v_possible_dup from public.opportunities
     where customer_id = v_customer and stage not in ('won', 'lost') order by created_at desc limit 1;
  end if;

  if v_property is null and v_address is not null then
    insert into public.properties (customer_id, address_line1, address_line2, city, state, postal_code, is_primary)
    values (v_customer, v_address, nullif(trim(p->>'address_line2'), ''), nullif(trim(p->>'city'), ''),
            nullif(trim(p->>'state'), ''), v_postal,
            not exists (select 1 from public.properties where customer_id = v_customer))
    returning id into v_property;
  end if;

  if nullif(p->>'source_id', '') is not null then
    select id, name into v_source, v_source_name from public.lead_sources where id = (p->>'source_id')::uuid;
  elsif nullif(trim(p->>'source_name'), '') is not null then
    select id, name into v_source, v_source_name from public.lead_sources where name = trim(p->>'source_name');
  end if;

  -- Owner: the one given, else the configured default; either must be an active admin or sales user.
  select id into v_owner from public.profiles
   where id = coalesce(nullif(p->>'owner_id', '')::uuid, (select default_lead_owner_id from public.company_settings))
     and is_active and role in ('admin', 'sales');

  select coalesce(private.work_type_label(v_work_type), 'New inquiry') || ' — ' ||
         coalesce((select address_line1 from public.properties where id = v_property),
                  (select nullif(trim(last_name), '') from public.customers where id = v_customer),
                  (select first_name from public.customers where id = v_customer))
    into v_title;

  insert into public.opportunities (customer_id, property_id, title, work_type, description, stage, owner_id,
    source_id, source_detail, utm_source, utm_medium, utm_campaign, gclid, estimated_value_cents,
    possible_duplicate_of, created_by)
  values (v_customer, v_property, v_title, v_work_type, v_message, coalesce(v_import_stage, 'new'), v_owner,
    v_source, nullif(trim(p->>'source_detail'), ''), nullif(p->>'utm_source', ''), nullif(p->>'utm_medium', ''),
    nullif(p->>'utm_campaign', ''), nullif(p->>'gclid', ''), nullif(p->>'estimated_value_cents', '')::integer,
    v_possible_dup, auth.uid())
  returning id into v_opp;

  perform private.log_activity('lead_received', v_opp, null,
    case when v_channel = 'import' then 'Deal imported'
         else 'Lead received' || coalesce(' from ' || v_source_name, '') end,
    jsonb_build_object('channel', v_channel));

  if v_channel = 'import' then
    perform private.create_auto_task(v_opp, null, 'imported_review', 'Imported deal — confirm stage and next step',
      now() + interval '1 day');
  else
    perform private.run_stage_entry_automation(v_opp, 'new');
  end if;

  if v_possible_dup is not null then
    perform private.log_activity('system', v_opp, null, 'Possible duplicate of another open deal — merge or keep both',
      jsonb_build_object('possible_duplicate_of', v_possible_dup));
  end if;

  return jsonb_build_object('ok', true, 'status', 'created', 'customer_id', v_customer, 'opportunity_id', v_opp,
    'is_new_customer', v_is_new, 'possible_duplicate_of', v_possible_dup, 'owner_id', v_owner);
end $$;

-- ---------------------------------------------------------------------------
-- log_contact (§4.1 events)
-- ---------------------------------------------------------------------------
create or replace function public.log_contact(
  p_opportunity_id uuid, p_type text, p_outcome text, p_summary text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  o record;
  v_actor text;
  v_text text;
  v_advanced boolean := false;
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_type not in ('call', 'email', 'sms')
     or p_outcome not in ('connected', 'left_voicemail', 'no_answer', 'sent') then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Unknown contact type or outcome');
  end if;

  select id, stage, owner_id into o from public.opportunities where id = p_opportunity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Deal not found');
  end if;

  select full_name into v_actor from public.profiles where id = auth.uid();
  v_text := v_actor || case p_type when 'call' then ' called' when 'email' then ' emailed' else ' texted' end
            || case p_outcome when 'connected' then ' — connected' when 'left_voicemail' then ' — left voicemail'
                              when 'no_answer' then ' — no answer' else '' end;
  perform private.log_activity(p_type::public.activity_type, p_opportunity_id, null, v_text,
    jsonb_build_object('outcome', p_outcome, 'notes', nullif(trim(p_summary), '')));

  -- Speed-to-lead measures the first attempt of any outcome.
  update public.opportunities
     set first_contact_attempted_at = now(), first_contact_attempted_by = auth.uid()
   where id = p_opportunity_id and first_contact_attempted_at is null;

  if o.stage = 'new' then
    if p_outcome = 'connected' then
      -- Whoever reaches an unowned lead takes it, so the contacted gate (owner set) passes.
      if o.owner_id is null then
        update public.opportunities set owner_id = auth.uid() where id = p_opportunity_id;
        update public.tasks set assigned_to = auth.uid()
         where opportunity_id = p_opportunity_id and status = 'open' and auto_key is not null;
      end if;
      perform private.apply_stage_change(p_opportunity_id, 'contacted');
      v_advanced := true;
    else
      perform private.complete_auto_task(p_opportunity_id, 'first_contact');
      perform private.complete_auto_task(p_opportunity_id, 'retry_contact');
      perform private.create_auto_task(p_opportunity_id, null, 'retry_contact',
        'Call again: ' || (select trim(c.first_name || ' ' || c.last_name) from public.customers c
                             join public.opportunities x on x.customer_id = c.id where x.id = p_opportunity_id),
        private.tomorrow_9am());
    end if;
  end if;

  return jsonb_build_object('ok', true, 'advanced', v_advanced);
end $$;

-- ---------------------------------------------------------------------------
-- assign_owner
-- ---------------------------------------------------------------------------
create or replace function public.assign_owner(p_opportunity_id uuid, p_owner_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old uuid;
  v_name text;
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select full_name into v_name from public.profiles
   where id = p_owner_id and is_active and role in ('admin', 'sales');
  if v_name is null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Owner must be an active admin or sales user');
  end if;
  select owner_id into v_old from public.opportunities where id = p_opportunity_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Deal not found');
  end if;
  if v_old is not distinct from p_owner_id then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.opportunities set owner_id = p_owner_id where id = p_opportunity_id;
  update public.tasks set assigned_to = p_owner_id
   where opportunity_id = p_opportunity_id and status = 'open' and auto_key is not null;
  perform private.log_activity('owner_changed', p_opportunity_id, null, 'Owner changed to ' || v_name,
    jsonb_build_object('from', v_old, 'to', p_owner_id));
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

-- ---------------------------------------------------------------------------
-- set_task_status
-- ---------------------------------------------------------------------------
create or replace function public.set_task_status(p_task_id uuid, p_status public.task_status) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  if private.auth_role() is null then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, title, status, assigned_to, opportunity_id, job_id into t from public.tasks where id = p_task_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Task not found');
  end if;
  -- Staff may set any status on any task; others may only complete their own.
  if not private.is_staff() and not (t.assigned_to = auth.uid() and p_status = 'done') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if t.status = p_status then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;

  update public.tasks
     set status = p_status,
         completed_at = case when p_status = 'done' then now() else null end,
         completed_by = case when p_status = 'done' then auth.uid() else null end
   where id = p_task_id;

  if p_status = 'done' and t.opportunity_id is not null then
    perform private.log_activity('task_completed', t.opportunity_id, t.job_id, 'Task completed: ' || t.title,
      jsonb_build_object('task_id', t.id));
  end if;
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

revoke execute on function public.create_lead(jsonb), public.log_contact(uuid, text, text, text),
  public.assign_owner(uuid, uuid), public.set_task_status(uuid, public.task_status)
  from public, anon, authenticated;
grant execute on function public.create_lead(jsonb), public.log_contact(uuid, text, text, text),
  public.assign_owner(uuid, uuid), public.set_task_status(uuid, public.task_status)
  to authenticated, service_role;
