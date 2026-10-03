-- 0011_job_rpcs: schedule_job and set_job_status (spec §4.5, §4.6).

create or replace function private.job_status_label(p public.job_status) returns text
language sql immutable set search_path = '' as $$
  select case p when 'pending_schedule' then 'Pending schedule' when 'scheduled' then 'Scheduled'
                when 'in_progress' then 'In progress' when 'on_hold' then 'On hold'
                when 'completed' then 'Completed' else 'Cancelled' end
$$;
revoke execute on function private.job_status_label(public.job_status) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- schedule_job (staff): dates, one all-day job_work appointment per selected day and
-- assignee, crew assignments, and the move to `scheduled`, in one transaction.
-- Calling it again replaces the work days that have not happened yet.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_job(
  p_job_id uuid, p_start date, p_end date, p_days date[], p_assignees uuid[]
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j record;
  v_tz text;
  v_today date;
  v_days date[];
  v_assignees uuid[];
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, job_number, status, opportunity_id, title into j from public.jobs where id = p_job_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Job not found');
  end if;
  if j.status in ('completed', 'cancelled') then
    return jsonb_build_object('ok', false, 'code', 'invalid_status',
      'message', 'A ' || lower(private.job_status_label(j.status)) || ' job cannot be scheduled');
  end if;

  select array_agg(distinct d order by d) into v_days from unnest(coalesce(p_days, '{}')) d where d is not null;
  select array_agg(distinct u) into v_assignees from unnest(coalesce(p_assignees, '{}')) u where u is not null;
  if p_start is null or p_end is null or p_end < p_start then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The end date must be on or after the start date');
  end if;
  if v_days is null or exists (select 1 from unnest(v_days) d where d < p_start or d > p_end) then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Choose at least one work day between the start and end dates');
  end if;
  if array_length(v_days, 1) > 60 then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Choose 60 work days or fewer');
  end if;
  if v_assignees is null
     or (select count(*) from public.profiles where id = any (v_assignees) and is_active) <> array_length(v_assignees, 1) then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Choose the crew from active users');
  end if;

  select timezone into v_tz from public.company_settings;
  v_tz := coalesce(v_tz, 'America/New_York');
  v_today := (now() at time zone v_tz)::date;

  -- Work days from today on that are no longer wanted are cancelled; past days are history.
  update public.appointments a
     set status = 'cancelled'
   where a.job_id = p_job_id and a.type = 'job_work' and a.status = 'scheduled'
     and (a.starts_at at time zone v_tz)::date >= v_today
     and not ((a.starts_at at time zone v_tz)::date = any (v_days) and a.assigned_to = any (v_assignees));

  -- fill_appointment_parent_ids supplies the deal, customer, and property from the job.
  insert into public.appointments (type, title, job_id, opportunity_id, assigned_to, starts_at, ends_at, all_day, created_by)
  select 'job_work', 'J-' || j.job_number || ': ' || j.title, p_job_id, j.opportunity_id, u,
         d::timestamp at time zone v_tz, (d + 1)::timestamp at time zone v_tz, true, auth.uid()
    from unnest(v_days) d cross join unnest(v_assignees) u
   where not exists (
     select 1 from public.appointments a
      where a.job_id = p_job_id and a.type = 'job_work' and a.status in ('scheduled', 'completed')
        and a.assigned_to = u and (a.starts_at at time zone v_tz)::date = d);

  insert into public.job_assignments (job_id, user_id)
  select p_job_id, u from unnest(v_assignees) u
  on conflict do nothing;

  update public.jobs
     set scheduled_start = p_start, scheduled_end = p_end,
         status = case when status = 'in_progress' then status else 'scheduled' end
   where id = p_job_id;

  perform private.complete_auto_task(j.opportunity_id, 'schedule_job');
  perform private.log_activity('job_status_changed', j.opportunity_id, p_job_id,
    'Job J-' || j.job_number || case when j.status = 'pending_schedule' then ' scheduled' else ' rescheduled' end
      || ' for ' || to_char(p_start, 'Mon FMDD')
      || case when p_end > p_start then ' – ' || to_char(p_end, 'Mon FMDD') else '' end,
    jsonb_build_object('from', j.status, 'to', case when j.status = 'in_progress' then 'in_progress' else 'scheduled' end,
                       'scheduled_start', p_start, 'scheduled_end', p_end, 'days', to_jsonb(v_days),
                       'assignees', to_jsonb(v_assignees)));

  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- set_job_status: staff, or an assigned field user for in_progress / completed.
--   in_progress  from pending_schedule, scheduled; from on_hold by staff only
--   completed    from in_progress
--   on_hold      from any state that is not completed or cancelled       (staff)
--   cancelled    from any state that is not completed                    (staff)
--   scheduled / pending_schedule: resume a job on hold                   (staff)
-- ---------------------------------------------------------------------------
create or replace function public.set_job_status(p_job_id uuid, p_status public.job_status) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j record;
  v_staff boolean := coalesce(private.is_staff(), false);
  v_tz text;
  v_allowed boolean;
  v_summary text;
begin
  if private.auth_role() is null then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, job_number, status, opportunity_id, scheduled_start, started_at, warranty_years into j
    from public.jobs where id = p_job_id for update;
  -- Same answer for a missing job and one the caller is not assigned to, so ids cannot be probed.
  if not found or not (v_staff or exists (
       select 1 from public.job_assignments ja where ja.job_id = p_job_id and ja.user_id = auth.uid())) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  -- Field users may only start and complete. A job staff put on hold stays on hold until staff resume it.
  if not v_staff and (p_status not in ('in_progress', 'completed') or j.status = 'on_hold') then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if j.status = p_status then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  v_allowed := case p_status
    when 'in_progress' then j.status in ('pending_schedule', 'scheduled', 'on_hold')
    when 'completed' then j.status = 'in_progress'
    when 'on_hold' then j.status not in ('completed', 'cancelled')
    when 'cancelled' then j.status <> 'completed'
    when 'scheduled' then j.status = 'on_hold' and j.scheduled_start is not null
    when 'pending_schedule' then j.status = 'on_hold' and j.scheduled_start is null
    else false end;
  if not v_allowed then
    return jsonb_build_object('ok', false, 'code', 'invalid_transition',
      'message', 'A job that is ' || lower(private.job_status_label(j.status)) || ' cannot be set to '
                 || lower(private.job_status_label(p_status)));
  end if;

  select timezone into v_tz from public.company_settings;
  v_tz := coalesce(v_tz, 'America/New_York');

  update public.jobs
     set status = p_status,
         started_at = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
         completed_at = case when p_status = 'completed' then now() else completed_at end,
         warranty_expires_on = case when p_status = 'completed' and warranty_years is not null
                                    then ((now() at time zone v_tz)::date + make_interval(years => warranty_years))::date
                                    else warranty_expires_on end
   where id = p_job_id;

  if p_status = 'completed' then
    perform private.create_auto_task(j.opportunity_id, p_job_id, 'final_invoice', 'Send final invoice',
      now() + interval '1 day',
      (select id from public.profiles where role = 'admin' and is_active order by created_at limit 1));
    perform private.create_auto_task(j.opportunity_id, p_job_id, 'completion_photos', 'Confirm completion photos uploaded',
      now() + interval '1 day');
  elsif p_status = 'cancelled' then
    update public.appointments
       set status = 'cancelled'
     where job_id = p_job_id and type = 'job_work' and status = 'scheduled' and ends_at > now();
    update public.tasks set status = 'cancelled' where job_id = p_job_id and status = 'open';
  end if;

  v_summary := 'Job J-' || j.job_number || case p_status
    when 'in_progress' then case when j.status = 'on_hold' then ' resumed' else ' started' end
    when 'completed' then ' completed'
    when 'on_hold' then ' put on hold'
    when 'cancelled' then ' cancelled'
    else ' resumed' end;
  perform private.log_activity('job_status_changed', j.opportunity_id, p_job_id, v_summary,
    jsonb_build_object('from', j.status, 'to', p_status));

  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.schedule_job(uuid, date, date, date[], uuid[]),
  public.set_job_status(uuid, public.job_status) from public, anon, authenticated;
grant execute on function public.schedule_job(uuid, date, date, date[], uuid[]),
  public.set_job_status(uuid, public.job_status) to authenticated, service_role;
