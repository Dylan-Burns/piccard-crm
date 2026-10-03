-- 0008_appointment_rpcs: schedule, reschedule, cancel, complete (spec §4.1 events, §4.6).

create or replace function private.appointment_type_label(p public.appointment_type) returns text
language sql immutable set search_path = '' as $$
  select case p when 'inspection' then 'Inspection' when 'estimate_presentation' then 'Estimate review'
                when 'job_work' then 'Job' else 'Appointment' end
$$;

-- An inspection that falls through sends the deal back to Qualified (which recreates the
-- "Schedule inspection" task), unless another inspection is scheduled or already done.
create or replace function private.after_inspection_lost(p_opportunity_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select stage from public.opportunities where id = p_opportunity_id) = 'inspection_scheduled'
     and not exists (select 1 from public.appointments
                      where opportunity_id = p_opportunity_id and type = 'inspection'
                        and status in ('scheduled', 'completed')) then
    perform private.apply_stage_change(p_opportunity_id, 'qualified');
  end if;
end $$;

revoke execute on function private.appointment_type_label(public.appointment_type), private.after_inspection_lost(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- schedule_appointment
-- p: opportunity_id | job_id, type, starts_at, ends_at, assigned_to, [title], [notes], [all_day]
-- ---------------------------------------------------------------------------
create or replace function public.schedule_appointment(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_type public.appointment_type := (p->>'type')::public.appointment_type;
  v_job uuid := nullif(p->>'job_id', '')::uuid;
  v_opp uuid := nullif(p->>'opportunity_id', '')::uuid;
  v_assignee uuid := nullif(p->>'assigned_to', '')::uuid;
  v_starts timestamptz := (p->>'starts_at')::timestamptz;
  v_ends timestamptz := (p->>'ends_at')::timestamptz;
  o record;
  v_missing text[];
  v_name text;
  v_id uuid;
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if v_job is not null then
    select opportunity_id into v_opp from public.jobs where id = v_job;
  end if;
  select opp.id, opp.stage, opp.owner_id, trim(c.first_name || ' ' || c.last_name) as customer_name into o
    from public.opportunities opp join public.customers c on c.id = opp.customer_id
   where opp.id = v_opp for update of opp;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Deal not found');
  end if;
  if v_type = 'job_work' and v_job is null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Job work needs a job');
  end if;
  if v_starts is null or v_ends is null or v_ends <= v_starts then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The end time must be after the start time');
  end if;
  v_assignee := coalesce(v_assignee, o.owner_id);
  select full_name into v_name from public.profiles where id = v_assignee and is_active;
  if v_name is null then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Choose who is going');
  end if;

  -- An inspection on an early-stage deal will move it to Inspection Scheduled, so the deal must
  -- already satisfy that stage's other requirements. Nothing is inserted if it does not.
  if v_type = 'inspection' and o.stage in ('new', 'contacted', 'qualified') then
    v_missing := private.check_stage_gate(v_opp, 'qualified');
    if array_length(v_missing, 1) > 0 then
      return jsonb_build_object('ok', false, 'code', 'missing_requirements',
        'message', 'Fill in the deal''s owner, work type, address, and a phone or email first',
        'missing', to_jsonb(v_missing));
    end if;
  end if;

  insert into public.appointments (type, title, opportunity_id, job_id, assigned_to, starts_at, ends_at, all_day, notes, created_by)
  values (v_type,
          coalesce(nullif(trim(p->>'title'), ''), private.appointment_type_label(v_type) || ': ' || o.customer_name),
          v_opp, v_job, v_assignee, v_starts, v_ends, coalesce((p->>'all_day')::boolean, false),
          nullif(trim(p->>'notes'), ''), auth.uid())
  returning id into v_id;

  perform private.log_activity('appointment_scheduled', v_opp, v_job,
    private.appointment_type_label(v_type) || ' scheduled with ' || v_name,
    jsonb_build_object('appointment_id', v_id, 'starts_at', v_starts));

  if v_type = 'inspection' and o.stage in ('new', 'contacted', 'qualified') then
    perform private.apply_stage_change(v_opp, 'inspection_scheduled');
  end if;

  return jsonb_build_object('ok', true, 'appointment_id', v_id);
end $$;

-- ---------------------------------------------------------------------------
-- reschedule_appointment
-- ---------------------------------------------------------------------------
create or replace function public.reschedule_appointment(
  p_appointment_id uuid, p_starts_at timestamptz, p_ends_at timestamptz, p_assigned_to uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, type, status, opportunity_id, job_id, starts_at, ends_at, assigned_to into a
    from public.appointments where id = p_appointment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Appointment not found');
  end if;
  if a.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'code', 'not_scheduled', 'message', 'Only a scheduled appointment can be moved');
  end if;
  if p_ends_at <= p_starts_at then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'The end time must be after the start time');
  end if;
  if p_assigned_to is not null and not exists (select 1 from public.profiles where id = p_assigned_to and is_active) then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Choose an active user');
  end if;

  update public.appointments
     set starts_at = p_starts_at, ends_at = p_ends_at, assigned_to = coalesce(p_assigned_to, assigned_to)
   where id = p_appointment_id;
  perform private.log_activity('appointment_rescheduled', a.opportunity_id, a.job_id,
    private.appointment_type_label(a.type) || ' rescheduled',
    jsonb_build_object('appointment_id', a.id, 'from', a.starts_at, 'to', p_starts_at));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- cancel_appointment
-- ---------------------------------------------------------------------------
create or replace function public.cancel_appointment(p_appointment_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if not private.is_staff() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, type, status, opportunity_id, job_id into a from public.appointments where id = p_appointment_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Appointment not found');
  end if;
  if a.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'code', 'not_scheduled', 'message', 'Only a scheduled appointment can be cancelled');
  end if;

  update public.appointments set status = 'cancelled', outcome_notes = nullif(trim(p_reason), '') where id = p_appointment_id;
  perform private.log_activity('appointment_cancelled', a.opportunity_id, a.job_id,
    private.appointment_type_label(a.type) || ' cancelled',
    jsonb_build_object('appointment_id', a.id, 'reason', nullif(trim(p_reason), '')));
  if a.type = 'inspection' then perform private.after_inspection_lost(a.opportunity_id); end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- complete_appointment: staff, or the person it is assigned to. completed | no_show.
-- ---------------------------------------------------------------------------
create or replace function public.complete_appointment(
  p_appointment_id uuid, p_status public.appointment_status, p_outcome_notes text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a record;
begin
  if private.auth_role() is null then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  select id, type, status, opportunity_id, job_id, assigned_to into a
    from public.appointments where id = p_appointment_id for update;
  if not found or not (private.is_staff() or a.assigned_to = auth.uid()) then
    -- Same response for "missing" and "not yours", so ids cannot be probed.
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_status not in ('completed', 'no_show') then
    return jsonb_build_object('ok', false, 'code', 'invalid', 'message', 'Choose completed or no-show');
  end if;
  if a.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'code', 'not_scheduled', 'message', 'This appointment is already closed');
  end if;

  update public.appointments
     set status = p_status, outcome_notes = nullif(trim(p_outcome_notes), ''),
         completed_at = case when p_status = 'completed' then now() else null end
   where id = p_appointment_id;

  if p_status = 'completed' then
    perform private.log_activity('appointment_completed', a.opportunity_id, a.job_id,
      private.appointment_type_label(a.type) || ' completed',
      jsonb_build_object('appointment_id', a.id, 'notes', nullif(trim(p_outcome_notes), '')));
    if a.type = 'inspection'
       and (select stage from public.opportunities where id = a.opportunity_id) not in ('won', 'lost') then
      perform private.create_auto_task(a.opportunity_id, null, 'send_estimate', 'Prepare and send estimate',
        now() + interval '2 days');
    end if;
  else
    perform private.log_activity('appointment_cancelled', a.opportunity_id, a.job_id,
      private.appointment_type_label(a.type) || ' — customer was not there',
      jsonb_build_object('appointment_id', a.id, 'no_show', true, 'notes', nullif(trim(p_outcome_notes), '')));
    if a.type = 'inspection' then perform private.after_inspection_lost(a.opportunity_id); end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.schedule_appointment(jsonb),
  public.reschedule_appointment(uuid, timestamptz, timestamptz, uuid),
  public.cancel_appointment(uuid, text),
  public.complete_appointment(uuid, public.appointment_status, text)
  from public, anon, authenticated;
grant execute on function public.schedule_appointment(jsonb),
  public.reschedule_appointment(uuid, timestamptz, timestamptz, uuid),
  public.cancel_appointment(uuid, text),
  public.complete_appointment(uuid, public.appointment_status, text)
  to authenticated, service_role;
