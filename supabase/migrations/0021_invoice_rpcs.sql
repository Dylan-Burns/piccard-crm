-- 0021_invoice_rpcs: invoice lifecycle (spec §4.6, §6.3, §7.5).
-- Admin: regenerate_job_invoices, void_invoice, queue_invoice_sync, record_invoice_manually.
-- Service role (the QuickBooks worker): complete_invoice_sync, apply_invoice_payment.
-- Invoice amounts are never edited by hand: they come from the accepted estimate.

create or replace function private.invoice_label(p_number bigint) returns text
language sql immutable set search_path = '' as $$ select 'INV-' || p_number $$;
revoke execute on function private.invoice_label(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- regenerate_job_invoices (admin): void the job's drafts and recreate them from the accepted
-- estimate. Refuses once any invoice has been sent.
-- ---------------------------------------------------------------------------
create or replace function public.regenerate_job_invoices(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare j record;
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, accepted_estimate_id, opportunity_id into j from public.jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Job not found');
  end if;
  if j.accepted_estimate_id is null then
    return jsonb_build_object('ok', false, 'code', 'no_estimate', 'message', 'This job has no accepted estimate to build invoices from');
  end if;
  if exists (select 1 from public.invoices where job_id = p_job_id and status in ('sent', 'partially_paid', 'paid')) then
    return jsonb_build_object('ok', false, 'code', 'already_sent', 'message', 'An invoice has already been sent. Correct it in your accounting system instead.');
  end if;
  if exists (select 1 from public.invoices where job_id = p_job_id and status = 'draft' and qbo_sync_status = 'pending') then
    return jsonb_build_object('ok', false, 'code', 'sync_pending', 'message', 'An invoice is on its way to QuickBooks. Try again in a minute.');
  end if;

  update public.invoices set status = 'void' where job_id = p_job_id and status = 'draft';
  perform private.create_job_invoices(p_job_id, j.accepted_estimate_id);
  perform private.log_activity('invoice_created', j.opportunity_id, p_job_id, 'Draft invoices regenerated from the accepted estimate', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- void_invoice (admin): drafts only.
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare i record;
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, status, qbo_sync_status into i from public.invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Invoice not found');
  end if;
  if i.status = 'void' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if i.status <> 'draft' or i.qbo_sync_status = 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_draft', 'message', 'Only a draft invoice can be voided');
  end if;
  update public.invoices set status = 'void' where id = p_invoice_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- queue_invoice_sync (admin): "Send to QuickBooks". Draft invoices only, and only when QuickBooks
-- is connected and configured. The worker does the push; a second click queues nothing new.
-- ---------------------------------------------------------------------------
create or replace function public.queue_invoice_sync(p_invoice_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i record;
  c record;
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, status, qbo_sync_status, total_cents into i from public.invoices where id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Invoice not found');
  end if;
  if i.qbo_sync_status = 'pending' then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if i.status <> 'draft' or i.qbo_sync_status not in ('not_synced', 'error') then
    return jsonb_build_object('ok', false, 'code', 'not_draft', 'message', 'Only a draft invoice can be sent to QuickBooks');
  end if;
  if i.total_cents <= 0 then
    return jsonb_build_object('ok', false, 'code', 'empty', 'message', 'This invoice has no amount');
  end if;
  select status, config into c from public.integration_connections where provider = 'quickbooks';
  if not found or c.status <> 'connected' then
    return jsonb_build_object('ok', false, 'code', 'not_connected', 'message', 'QuickBooks is not connected');
  end if;
  if coalesce(c.config->>'item_id', '') = '' then
    return jsonb_build_object('ok', false, 'code', 'not_configured', 'message', 'Choose the QuickBooks income item in Settings first');
  end if;

  update public.invoices set qbo_sync_status = 'pending', qbo_sync_error = null where id = p_invoice_id;
  insert into public.sync_outbox (provider, entity_type, entity_id) values ('quickbooks', 'invoice', p_invoice_id)
  on conflict do nothing;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- record_invoice_manually (admin): for when QuickBooks is not used for this invoice.
--   p_status 'sent' → marks a draft as sent (issued today).
--   p_amount_paid_cents → the total paid so far; sets partially_paid or paid.
-- Refused for an invoice that QuickBooks manages (it owns the invoice once it is there).
-- ---------------------------------------------------------------------------
create or replace function public.record_invoice_manually(
  p_invoice_id uuid, p_status public.invoice_status default null, p_amount_paid_cents integer default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  i record;
  v_opp uuid;
  v_status public.invoice_status;
begin
  if not private.is_admin() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select inv.id, inv.status, inv.invoice_number, inv.total_cents, inv.amount_paid_cents, inv.qbo_invoice_id, inv.qbo_sync_status, inv.job_id
    into i from public.invoices inv where inv.id = p_invoice_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Invoice not found');
  end if;
  if i.qbo_invoice_id is not null or i.qbo_sync_status = 'pending' then
    return jsonb_build_object('ok', false, 'code', 'managed_by_quickbooks', 'message', 'This invoice is in QuickBooks. Record changes there.');
  end if;
  if i.status = 'void' then
    return jsonb_build_object('ok', false, 'code', 'void', 'message', 'A void invoice cannot be changed');
  end if;
  select opportunity_id into v_opp from public.jobs where id = i.job_id;

  if p_amount_paid_cents is null then
    if p_status is distinct from 'sent' then
      return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Choose Mark sent, or enter the amount paid');
    end if;
    if i.status <> 'draft' then
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    update public.invoices
       set status = 'sent', issued_on = (now() at time zone coalesce((select timezone from public.company_settings), 'America/New_York'))::date
     where id = p_invoice_id;
    perform private.log_activity('invoice_created', v_opp, i.job_id, 'Invoice ' || private.invoice_label(i.invoice_number) || ' marked sent', jsonb_build_object('invoice_id', i.id));
    return jsonb_build_object('ok', true, 'status', 'sent');
  end if;

  if p_amount_paid_cents < 0 or p_amount_paid_cents > i.total_cents then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The amount paid must be between zero and the invoice total');
  end if;
  v_status := case when p_amount_paid_cents >= i.total_cents then 'paid' when p_amount_paid_cents > 0 then 'partially_paid' else 'sent' end;
  update public.invoices
     set status = v_status, amount_paid_cents = p_amount_paid_cents,
         issued_on = coalesce(issued_on, (now() at time zone coalesce((select timezone from public.company_settings), 'America/New_York'))::date),
         paid_at = case when v_status = 'paid' then coalesce(paid_at, now()) else null end
   where id = p_invoice_id;
  if p_amount_paid_cents > i.amount_paid_cents then
    -- No amount in the summary (rule 13); it is in the metadata.
    perform private.log_activity('payment_received', v_opp, i.job_id,
      'Payment recorded on invoice ' || private.invoice_label(i.invoice_number),
      jsonb_build_object('invoice_id', i.id, 'amount_cents', p_amount_paid_cents - i.amount_paid_cents, 'paid_to_date_cents', p_amount_paid_cents, 'source', 'manual'));
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- ---------------------------------------------------------------------------
-- complete_invoice_sync (service role): QuickBooks accepted the invoice. From here QuickBooks
-- owns it. p_warning carries a total mismatch, shown on the invoice without retrying.
-- ---------------------------------------------------------------------------
create or replace function public.complete_invoice_sync(
  p_invoice_id uuid, p_qbo_invoice_id text, p_doc_number text, p_qbo_customer_id text default null, p_warning text default null
) returns void
language plpgsql security definer set search_path = '' as $$
declare i record;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select inv.id, inv.invoice_number, inv.customer_id, inv.job_id, inv.status into i from public.invoices inv where inv.id = p_invoice_id for update;
  if not found then return; end if;
  if p_qbo_customer_id is not null then
    update public.customers set qbo_customer_id = p_qbo_customer_id where id = i.customer_id and qbo_customer_id is null;
  end if;
  update public.invoices
     set qbo_invoice_id = p_qbo_invoice_id, qbo_doc_number = p_doc_number, qbo_sync_status = 'synced', qbo_synced_at = now(),
         qbo_sync_error = p_warning,
         status = case when status = 'draft' then 'sent' else status end,
         issued_on = coalesce(issued_on, (now() at time zone coalesce((select timezone from public.company_settings), 'America/New_York'))::date)
   where id = p_invoice_id;
  if i.status = 'draft' then
    perform private.log_activity('invoice_synced', (select opportunity_id from public.jobs where id = i.job_id), i.job_id,
      'Invoice ' || private.invoice_label(i.invoice_number) || ' sent to QuickBooks', jsonb_build_object('invoice_id', i.id, 'qbo_invoice_id', p_qbo_invoice_id));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- apply_invoice_payment (service role): what the hourly payment check found in QuickBooks.
-- p_missing → the invoice was deleted or voided there. Logs one payment_received per increase.
-- ---------------------------------------------------------------------------
create or replace function public.apply_invoice_payment(p_invoice_id uuid, p_amount_paid_cents integer, p_missing boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  i record;
  v_paid integer;
  v_status public.invoice_status;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select inv.id, inv.invoice_number, inv.status, inv.total_cents, inv.amount_paid_cents, inv.job_id into i
    from public.invoices inv where inv.id = p_invoice_id for update;
  if not found or i.status not in ('sent', 'partially_paid') then
    return 'ignored';
  end if;
  if p_missing then
    update public.invoices set status = 'void', qbo_sync_error = 'Deleted or voided in QuickBooks' where id = p_invoice_id;
    return 'void';
  end if;
  v_paid := greatest(0, least(coalesce(p_amount_paid_cents, 0), i.total_cents));
  v_status := case when v_paid >= i.total_cents then 'paid' when v_paid > 0 then 'partially_paid' else 'sent' end;
  if v_paid = i.amount_paid_cents and v_status = i.status then
    return 'unchanged';
  end if;
  update public.invoices
     set amount_paid_cents = v_paid, status = v_status, paid_at = case when v_status = 'paid' then coalesce(paid_at, now()) else null end
   where id = p_invoice_id;
  if v_paid > i.amount_paid_cents then
    perform private.log_activity('payment_received', (select opportunity_id from public.jobs where id = i.job_id), i.job_id,
      'Payment received on invoice ' || private.invoice_label(i.invoice_number),
      jsonb_build_object('invoice_id', i.id, 'amount_cents', v_paid - i.amount_paid_cents, 'paid_to_date_cents', v_paid, 'source', 'quickbooks'));
  end if;
  return v_status::text;
end $$;

revoke execute on function public.regenerate_job_invoices(uuid), public.void_invoice(uuid), public.queue_invoice_sync(uuid),
  public.record_invoice_manually(uuid, public.invoice_status, integer),
  public.complete_invoice_sync(uuid, text, text, text, text), public.apply_invoice_payment(uuid, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.regenerate_job_invoices(uuid), public.void_invoice(uuid), public.queue_invoice_sync(uuid),
  public.record_invoice_manually(uuid, public.invoice_status, integer) to authenticated;
grant execute on function public.complete_invoice_sync(uuid, text, text, text, text), public.apply_invoice_payment(uuid, integer, boolean) to service_role;

-- ---------------------------------------------------------------------------
-- fail_outbox gains p_fatal: a validation error from QuickBooks will not fix itself, so the row
-- fails at once and the message goes onto the invoice, instead of retrying eight times.
-- ---------------------------------------------------------------------------
drop function public.fail_outbox(uuid, text, boolean);

create or replace function public.fail_outbox(p_id uuid, p_error text, p_hold boolean default false, p_fatal boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare
  o record;
  v_error text := left(coalesce(p_error, 'Unknown error'), 500);
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select * into o from public.sync_outbox where id = p_id for update;
  if not found or o.status <> 'processing' then
    return 'ignored';
  end if;

  if exists (select 1 from public.sync_outbox n
              where n.provider = o.provider and n.entity_type = o.entity_type and n.entity_id = o.entity_id
                and n.status = 'pending' and n.id <> o.id) then
    update public.sync_outbox set status = 'done', processed_at = now(), locked_at = null, last_error = v_error where id = p_id;
    return 'superseded';
  end if;

  if p_hold then
    update public.sync_outbox
       set status = 'pending', attempts = greatest(o.attempts - 1, 0), locked_at = null, last_error = v_error,
           next_attempt_at = now() + interval '15 minutes'
     where id = p_id;
    return 'held';
  end if;

  if o.attempts < 8 and not p_fatal then
    update public.sync_outbox
       set status = 'pending', locked_at = null, last_error = v_error,
           next_attempt_at = now() + make_interval(mins => (2 ^ o.attempts)::integer)
     where id = p_id;
    return 'retry';
  end if;

  update public.sync_outbox set status = 'failed', locked_at = null, last_error = v_error, processed_at = now() where id = p_id;
  if o.entity_type = 'appointment' then
    update public.appointments set google_sync_status = 'error', google_sync_error = v_error where id = o.entity_id;
  elsif o.entity_type = 'invoice' then
    update public.invoices set qbo_sync_status = 'error', qbo_sync_error = v_error where id = o.entity_id;
  end if;
  return 'failed';
end $$;
revoke execute on function public.fail_outbox(uuid, text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.fail_outbox(uuid, text, boolean, boolean) to service_role;
