-- 0007_ingestion: process a stored lead submission (spec §6.5). Service role only.

create or replace function public.process_lead_submission(p_submission_id uuid, p_lead jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v jsonb;
  v_status public.lead_submission_status;
begin
  if not private.is_service_role() then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;

  select id, status, customer_id, opportunity_id into s
    from public.lead_submissions where id = p_submission_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'message', 'Submission not found');
  end if;
  -- Idempotent: only unprocessed or failed submissions are processed.
  if s.status not in ('received', 'error') then
    return jsonb_build_object('ok', true, 'already', true, 'status', s.status,
      'customer_id', s.customer_id, 'opportunity_id', s.opportunity_id);
  end if;

  begin
    v := public.create_lead(p_lead);
  exception when others then
    update public.lead_submissions
       set status = 'error', error = sqlerrm, attempts = attempts + 1
     where id = p_submission_id;
    return jsonb_build_object('ok', false, 'code', 'error', 'message', sqlerrm);
  end;

  if not coalesce((v->>'ok')::boolean, false) then
    update public.lead_submissions
       set status = 'rejected', error = v->>'message', attempts = attempts + 1, processed_at = now()
     where id = p_submission_id;
    return v || jsonb_build_object('status', 'rejected');
  end if;

  v_status := case v->>'status' when 'merged_duplicate' then 'merged_duplicate' else 'created' end;
  update public.lead_submissions
     set status = v_status, error = null, attempts = attempts + 1, processed_at = now(),
         customer_id = nullif(v->>'customer_id', '')::uuid,
         opportunity_id = nullif(v->>'opportunity_id', '')::uuid
   where id = p_submission_id;
  return v;
end $$;

revoke execute on function public.process_lead_submission(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.process_lead_submission(uuid, jsonb) to service_role;
