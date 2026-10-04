-- 0018_outbox_rpcs: the sync outbox worker's functions (spec §6.1). Service role only.

-- ---------------------------------------------------------------------------
-- claim_outbox_batch: take up to p_limit rows that are due, mark them processing.
-- Rows stuck in `processing` for more than 10 minutes (a worker died) are taken again.
-- `skip locked` lets two workers run at once without taking the same row.
-- ---------------------------------------------------------------------------
create or replace function public.claim_outbox_batch(p_limit integer default 20)
returns setof public.sync_outbox
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return query
  with due as (
    select id from public.sync_outbox
     where (status = 'pending' and next_attempt_at <= now())
        or (status = 'processing' and locked_at < now() - interval '10 minutes')
     order by next_attempt_at
     limit greatest(1, least(coalesce(p_limit, 20), 100))
     for update skip locked
  )
  update public.sync_outbox o
     set status = 'processing', attempts = o.attempts + 1, locked_at = now()
    from due
   where o.id = due.id
  returning o.*;
end $$;

-- ---------------------------------------------------------------------------
-- complete_outbox: the entity is in sync.
-- ---------------------------------------------------------------------------
create or replace function public.complete_outbox(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.sync_outbox
     set status = 'done', processed_at = now(), locked_at = null, last_error = null
   where id = p_id and status = 'processing';
end $$;

-- ---------------------------------------------------------------------------
-- fail_outbox: an attempt failed.
--   A newer pending row exists for the same entity → this one is done (the newer one will sync).
--   Fewer than 8 attempts → pending again after 2^attempts minutes.
--   Otherwise → failed, and the error is written onto the entity's own sync columns so the UI shows it.
-- p_hold keeps the row pending without counting against it (the connection itself is down).
-- ---------------------------------------------------------------------------
create or replace function public.fail_outbox(p_id uuid, p_error text, p_hold boolean default false) returns text
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
    -- The connection is broken, not this row: wait without using up its attempts.
    update public.sync_outbox
       set status = 'pending', attempts = greatest(o.attempts - 1, 0), locked_at = null, last_error = v_error,
           next_attempt_at = now() + interval '15 minutes'
     where id = p_id;
    return 'held';
  end if;

  if o.attempts < 8 then
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

-- ---------------------------------------------------------------------------
-- lock_integration: lets exactly one worker refresh a provider's token at a time (QuickBooks
-- rotates refresh tokens; two concurrent refreshes would break the connection).
--
-- The refresh itself is an HTTP call made by the application, so it cannot sit inside one database
-- transaction. The advisory transaction lock serializes callers of this function; the winner takes
-- a 30-second lease recorded on the connection row. A caller that gets `false` waits briefly and
-- re-reads the tokens, which the winner will have saved. unlock_integration releases the lease early.
-- ---------------------------------------------------------------------------
create or replace function public.lock_integration(p_provider public.integration_provider) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_taken boolean;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  perform pg_advisory_xact_lock(hashtext('integration:' || p_provider::text));
  update public.integration_connections
     set config = config || jsonb_build_object('refresh_lease_until', now() + interval '30 seconds')
   where provider = p_provider
     and coalesce((config->>'refresh_lease_until')::timestamptz, 'epoch'::timestamptz) < now()
  returning true into v_taken;
  return coalesce(v_taken, false);
end $$;

create or replace function public.unlock_integration(p_provider public.integration_provider) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  update public.integration_connections set config = config - 'refresh_lease_until' where provider = p_provider;
end $$;

-- ---------------------------------------------------------------------------
-- enqueue_appointment_syncs: queue scheduled appointments that start from now on.
--   p_days null → all of them (Backfill, and draining after a reconnect)
--   p_days n    → those starting within n days (the nightly re-assert)
-- p_ids, when given, queues exactly those appointments instead (Retry).
-- One pending row per appointment is kept by the outbox's partial unique index.
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_appointment_syncs(p_days integer default null, p_ids uuid[] default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  with queued as (
    insert into public.sync_outbox (provider, entity_type, entity_id)
    select 'google_calendar', 'appointment', a.id
      from public.appointments a
     where case when p_ids is not null then a.id = any (p_ids)
                else a.status = 'scheduled' and a.starts_at >= now()
                     and (p_days is null or a.starts_at < now() + make_interval(days => p_days)) end
    on conflict do nothing
    returning entity_id
  )
  select count(*) into v_count from queued;
  update public.appointments set google_sync_status = 'pending', google_sync_error = null
   where id in (select entity_id from public.sync_outbox where provider = 'google_calendar' and entity_type = 'appointment' and status = 'pending')
     and google_sync_status <> 'pending';
  return v_count;
end $$;

revoke execute on function public.claim_outbox_batch(integer), public.complete_outbox(uuid), public.fail_outbox(uuid, text, boolean),
  public.lock_integration(public.integration_provider), public.unlock_integration(public.integration_provider),
  public.enqueue_appointment_syncs(integer, uuid[])
  from public, anon, authenticated;
grant execute on function public.claim_outbox_batch(integer), public.complete_outbox(uuid), public.fail_outbox(uuid, text, boolean),
  public.lock_integration(public.integration_provider), public.unlock_integration(public.integration_provider),
  public.enqueue_appointment_syncs(integer, uuid[])
  to service_role;
