-- 0004_policy_hardening: tighten two policies found in review of 0003.

-- 1. Profiles: the policy itself now forbids changing your own role or active flag
--    (previously only the guard_profile_privileges trigger did), and a deactivated
--    user can no longer update their own row. auth_role() reads the pre-update row,
--    so `role = auth_role()` means "unchanged", and is null (false) once deactivated.
drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using ((select private.is_admin()) or (id = auth.uid() and (select private.auth_role()) is not null))
  with check ((select private.is_admin())
              or (id = auth.uid() and is_active and role = (select private.auth_role())));

-- 2. Field access through an appointment ends when that appointment is cancelled or a no-show.
create or replace function private.field_can_access_opportunity(p_opp uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.auth_role() = 'field', false) and (
    exists (select 1 from public.appointments a
             where a.opportunity_id = p_opp and a.assigned_to = auth.uid()
               and a.status in ('scheduled', 'completed'))
    or exists (select 1 from public.jobs j join public.job_assignments ja on ja.job_id = j.id
                where j.opportunity_id = p_opp and ja.user_id = auth.uid())
  )
$$;

create or replace function private.field_can_access_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.auth_role() = 'field', false) and (
    exists (select 1 from public.appointments a
             where a.customer_id = p_customer and a.assigned_to = auth.uid()
               and a.status in ('scheduled', 'completed'))
    or exists (select 1 from public.jobs j join public.job_assignments ja on ja.job_id = j.id
                where j.customer_id = p_customer and ja.user_id = auth.uid())
  )
$$;
