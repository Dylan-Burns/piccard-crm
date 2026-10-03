-- 0001_foundation: extensions, private schema, default-deny privileges, every enum,
-- users, settings, role helpers, profile RLS and grants.
-- Source: docs/spec.md §2.1, §2.2, §2.9, §2.10, §3.2, §3.3.

-- ---------------------------------------------------------------------------
-- Extensions (Supabase convention: schema `extensions`, on the migration search_path)
-- ---------------------------------------------------------------------------
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Private schema: triggers and policy helpers. Not exposed by the Data API.
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Default-deny (§2.1, §2.10)
-- PUBLIC's EXECUTE on new functions is a global default; a per-schema revoke cannot remove it.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema public  revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public  revoke all on sequences from anon, authenticated;
-- service_role (server-side only) gets full access to everything created from here on.
-- Current Supabase versions no longer grant this automatically.
alter default privileges for role postgres in schema public  grant all on tables    to service_role;
alter default privileges for role postgres in schema public  grant all on sequences to service_role;
alter default privileges for role postgres in schema public  grant execute on functions to service_role;
alter default privileges for role postgres in schema private grant execute on functions to service_role;

-- ---------------------------------------------------------------------------
-- Enums (all of them, so later migrations never alter types)
-- ---------------------------------------------------------------------------
create type public.user_role            as enum ('admin','sales','field');
create type public.opportunity_stage    as enum ('new','contacted','qualified','inspection_scheduled',
                                                 'estimate_sent','negotiation','won','lost');
create type public.work_type            as enum ('roof_replacement','roof_repair','renovation','gutters','siding','other');
create type public.lost_reason          as enum ('price','competitor','no_response','not_qualified',
                                                 'insurance_denied','timing','duplicate','other');
create type public.job_status           as enum ('pending_schedule','scheduled','in_progress','on_hold','completed','cancelled');
create type public.permit_status        as enum ('not_required','needed','applied','approved','closed');
create type public.appointment_type     as enum ('inspection','estimate_presentation','job_work','other');
create type public.appointment_status   as enum ('scheduled','completed','cancelled','no_show');
create type public.estimate_status      as enum ('draft','sent','viewed','accepted','declined','expired','void');
create type public.invoice_kind         as enum ('deposit','final');
create type public.invoice_status       as enum ('draft','sent','partially_paid','paid','void');
create type public.file_category        as enum ('photo','measurement_report','estimate','contract','permit','insurance','invoice','other');
create type public.task_status          as enum ('open','done','cancelled');
create type public.sync_status          as enum ('not_synced','pending','synced','error');
create type public.integration_provider as enum ('google_calendar','quickbooks');
create type public.outbox_status        as enum ('pending','processing','done','failed');
create type public.lead_channel         as enum ('website','google_ads','manual','import');
create type public.lead_submission_status as enum ('received','created','merged_duplicate','rejected','error');
create type public.email_status         as enum ('pending','sent','failed');
create type public.activity_type        as enum (
  'lead_received','duplicate_inquiry','call','email','sms','note_added',
  'stage_changed','owner_changed','deal_won','deal_lost','deal_reopened',
  'appointment_scheduled','appointment_rescheduled','appointment_completed','appointment_cancelled',
  'files_uploaded',
  'estimate_created','estimate_sent','estimate_viewed','estimate_accepted','estimate_declined','estimate_expired',
  'job_created','job_status_changed',
  'invoice_created','invoice_synced','payment_received',
  'task_completed','system');

create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;
revoke execute on function private.set_updated_at() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Users and settings (§2.2)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       extensions.citext not null unique,
  phone       text,
  role        public.user_role not null default 'field',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

create table public.company_settings (
  id                      boolean primary key default true check (id),   -- singleton row
  company_name            text not null default 'Roofing Company',
  address_line1           text, city text, state text, postal_code text,
  phone                   text,
  email                   text,
  license_number          text,
  logo_path               text,
  timezone                text not null default 'America/New_York',
  default_tax_rate        numeric(6,5) not null default 0 check (default_tax_rate >= 0 and default_tax_rate < 1),
  default_deposit_percent integer not null default 30 check (default_deposit_percent between 0 and 100),
  estimate_valid_days     integer not null default 30,
  estimate_terms          text not null default '',
  default_warranty_years  integer not null default 5,
  default_lead_owner_id   uuid references public.profiles(id) on delete set null,
  send_inspection_confirmation boolean not null default true,
  updated_at              timestamptz not null default now()
);
create trigger company_settings_set_updated_at before update on public.company_settings
  for each row execute function private.set_updated_at();
insert into public.company_settings default values;

-- ---------------------------------------------------------------------------
-- Role helpers (§3.2). Security definer so policies on profiles do not recurse.
-- ---------------------------------------------------------------------------
create or replace function private.auth_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.auth_role() = 'admin', false)
$$;

create or replace function private.is_staff() returns boolean          -- admin or sales
language sql stable security definer set search_path = '' as $$
  select coalesce(private.auth_role() in ('admin','sales'), false)
$$;

revoke execute on function private.auth_role(), private.is_admin(), private.is_staff() from public, anon, authenticated;
-- Policies execute as the caller, so authenticated needs execute.
grant  execute on function private.auth_role(), private.is_admin(), private.is_staff() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Triggers (§2.9)
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)));
  return new;
end $$;
revoke execute on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Only admins (or the service role, where auth.uid() is null) may change role or is_active.
-- `not is_admin()` rather than `auth_role() <> 'admin'`: the latter is null for a deactivated user.
create or replace function private.guard_profile_privileges() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and auth.uid() is not null and not private.is_admin() then
    raise exception 'Only admins can change role or active status'
      using errcode = 'insufficient_privilege';
  end if;
  return new;
end $$;
revoke execute on function private.guard_profile_privileges() from public, anon, authenticated;

create trigger profiles_guard_privileges before update on public.profiles
  for each row execute function private.guard_profile_privileges();

-- ---------------------------------------------------------------------------
-- RLS (§3.3)
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.company_settings enable row level security;

-- Everyone signed in can see names (assignee pickers). Own row is always visible,
-- so the app can tell a deactivated user from a missing profile.
create policy profiles_select on public.profiles for select to authenticated
  using ((select private.auth_role()) is not null or id = auth.uid());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or (select private.is_admin())) with check (id = auth.uid() or (select private.is_admin()));
-- no insert/delete policy: rows come from the auth trigger.

create policy settings_select on public.company_settings for select to authenticated
  using ((select private.auth_role()) is not null);
create policy settings_update on public.company_settings for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- ---------------------------------------------------------------------------
-- Grants (§2.10). anon gets nothing; authenticated gets select plus listed columns.
-- ---------------------------------------------------------------------------
revoke all on public.profiles, public.company_settings from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (full_name, phone, role, is_active) on public.profiles to authenticated;

grant select on public.company_settings to authenticated;
grant update (company_name, address_line1, city, state, postal_code, phone, email, license_number,
              logo_path, timezone, default_tax_rate, default_deposit_percent, estimate_valid_days,
              estimate_terms, default_warranty_years, default_lead_owner_id, send_inspection_confirmation)
  on public.company_settings to authenticated;
