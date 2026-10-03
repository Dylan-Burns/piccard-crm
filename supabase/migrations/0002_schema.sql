-- 0002_schema: every remaining table, indexes, and triggers.
-- Source: docs/spec.md §2.2–§2.7, §2.9, §3.2. DDL copied from the spec.

create table lead_sources (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  is_active  boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
insert into lead_sources (name, sort_order) values
 ('Website',10),('Google Ads',20),('Referral',30),('Repeat Customer',40),
 ('Phone Call',50),('Door Knock',60),('Yard Sign',70),('Other',99);

create table customers (
  id               uuid primary key default gen_random_uuid(),
  first_name       text not null,
  last_name        text not null default '',
  company_name     text,
  email            citext,
  phone            text,           -- as entered, for display
  phone_e164       text,           -- normalized, for dedupe and tel: links
  secondary_phone  text,
  preferred_contact text check (preferred_contact in ('call','text','email')),
  billing_address_line1 text, billing_city text, billing_state text, billing_postal_code text,
  qbo_customer_id  text,
  created_by       uuid references profiles(id) on delete set null,
  archived_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index customers_phone_e164_idx on customers (phone_e164) where phone_e164 is not null;
create index customers_email_idx      on customers (email)      where email is not null;
create index customers_name_trgm_idx  on customers using gin ((first_name || ' ' || last_name) gin_trgm_ops);

create table properties (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references customers(id) on delete cascade,
  label         text,                       -- "Home", "Rental on Oak St"
  address_line1 text not null,
  address_line2 text,
  city          text,
  state         text,
  postal_code   text,
  address_key   text generated always as (
                  lower(regexp_replace(address_line1 || ' ' || coalesce(postal_code,''), '[^a-zA-Z0-9]', '', 'g'))
                ) stored,                   -- for duplicate-address detection
  roof_type     text,
  stories       integer,
  access_notes  text,                       -- gate code, dog, parking
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, customer_id)                  -- target of composite FKs
);
create index properties_customer_idx    on properties (customer_id);
create index properties_address_key_idx on properties (address_key);

create table opportunities (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid not null references customers(id) on delete restrict,
  property_id         uuid,
  title               text not null,                  -- "Roof Replacement — 123 Main St"
  work_type           work_type,
  description         text,                           -- the customer's message / problem statement
  stage               opportunity_stage not null default 'new',
  stage_entered_at    timestamptz not null default now(),
  owner_id            uuid references profiles(id) on delete set null,
  source_id           uuid references lead_sources(id),
  source_detail       text,                           -- referrer name, form name
  utm_source text, utm_medium text, utm_campaign text, gclid text,
  estimated_value_cents integer check (estimated_value_cents >= 0),
  amount_cents        integer check (amount_cents >= 0),   -- contract value, set when won
  is_insurance_claim  boolean not null default false,
  insurance_carrier   text,
  claim_number        text,
  adjuster_name       text,
  adjuster_phone      text,
  deductible_cents    integer,
  first_contact_attempted_at timestamptz,         -- first call/voicemail/message of any outcome (speed-to-lead)
  first_contact_attempted_by uuid references profiles(id) on delete set null,
  first_contacted_at  timestamptz,                -- first successful connection
  won_at              timestamptz,
  lost_at             timestamptz,
  lost_reason         lost_reason,
  lost_competitor     text,
  lost_notes          text,
  closed_owner_id     uuid references profiles(id) on delete set null,  -- owner snapshot at won/lost
  closed_by           uuid references profiles(id) on delete set null,  -- who marked it won/lost (null = customer/system)
  possible_duplicate_of uuid references opportunities(id) on delete set null,  -- set by create_lead; cleared by "Keep both"
  created_by          uuid references profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  foreign key (property_id, customer_id) references properties (id, customer_id) on delete restrict,
  constraint won_fields  check (stage <> 'won'  or (won_at  is not null and amount_cents is not null)),
  constraint lost_fields check (stage <> 'lost' or (lost_at is not null and lost_reason is not null))
);
create index opportunities_stage_idx    on opportunities (stage, stage_entered_at desc);
create index opportunities_owner_idx    on opportunities (owner_id, stage);
create index opportunities_customer_idx on opportunities (customer_id);
create index opportunities_created_idx  on opportunities (created_at);
create index opportunities_won_idx      on opportunities (won_at) where won_at is not null;
create index opportunities_property_open_idx on opportunities (property_id) where stage not in ('won','lost');

create table opportunity_stage_history (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id) on delete cascade,
  from_stage     opportunity_stage,                   -- null on creation
  to_stage       opportunity_stage not null,
  changed_by     uuid references profiles(id) on delete set null,
  changed_at     timestamptz not null default now()
);
create index stage_history_opp_idx on opportunity_stage_history (opportunity_id, changed_at);

create table lead_submissions (
  id             uuid primary key default gen_random_uuid(),
  channel        lead_channel not null,
  external_id    text,                                -- Google lead_id, website submission_id, or derived hash
  payload        jsonb not null,                      -- raw body exactly as received
  status         lead_submission_status not null default 'received',
  source_ip      inet,                                -- for rate limiting (§6.5)
  customer_id    uuid references customers(id) on delete set null,
  opportunity_id uuid references opportunities(id) on delete set null,
  error          text,
  attempts       integer not null default 0,
  received_at    timestamptz not null default now(),
  processed_at   timestamptz
);
create unique index lead_submissions_external_uidx
  on lead_submissions (channel, external_id) where external_id is not null;
create index lead_submissions_unprocessed_idx on lead_submissions (received_at) where status in ('received','error');
create index lead_submissions_ip_idx on lead_submissions (source_ip, received_at) where source_ip is not null;

create sequence estimate_number_seq start 1001;
create sequence job_number_seq      start 1001;
create sequence invoice_number_seq  start 1001;

create table price_book_items (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  description      text,
  unit             text not null default 'ea',        -- sq, lf, ea, hr
  unit_price_cents integer not null check (unit_price_cents >= 0),
  is_taxable       boolean not null default true,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table estimates (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references opportunities(id) on delete cascade,
  estimate_number bigint not null default nextval('estimate_number_seq'),
  version         integer not null default 1,
  status          estimate_status not null default 'draft',
  title           text not null,
  scope_notes     text,                               -- shown above line items
  terms           text not null default '',           -- snapshot of company terms at creation
  subtotal_cents  integer not null default 0,
  discount_cents  integer not null default 0 check (discount_cents >= 0),
  tax_rate        numeric(6,5) not null default 0,
  tax_cents       integer not null default 0,
  total_cents     integer not null default 0,
  deposit_percent integer not null default 0 check (deposit_percent between 0 and 100),
  deposit_cents   integer not null default 0,
  valid_until     date,
  public_token    uuid not null unique default gen_random_uuid(),
  pdf_path        text,                               -- storage path of the PDF snapshot taken at send time
  sent_at         timestamptz,
  sent_to_email   citext,
  viewed_at       timestamptz,
  accepted_at     timestamptz,
  accepted_name   text,
  accepted_ip     inet,
  declined_at     timestamptz,
  decline_reason  text,
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (estimate_number, version)
);
create index estimates_opp_idx on estimates (opportunity_id);
create unique index estimates_one_accepted_uidx on estimates (opportunity_id) where status = 'accepted';

create table estimate_line_items (
  id               uuid primary key default gen_random_uuid(),
  estimate_id      uuid not null references estimates(id) on delete cascade,
  sort_order       integer not null default 0,
  name             text not null,
  description      text,
  quantity         numeric(10,2) not null default 1 check (quantity > 0),
  unit             text not null default 'ea',
  unit_price_cents integer not null check (unit_price_cents >= 0),
  is_taxable       boolean not null default true,
  total_cents      integer generated always as (round(quantity * unit_price_cents)::integer) stored,
  created_at       timestamptz not null default now()
);
create index estimate_lines_estimate_idx on estimate_line_items (estimate_id, sort_order);

create table jobs (
  id                   uuid primary key default gen_random_uuid(),
  job_number           bigint not null unique default nextval('job_number_seq'),
  opportunity_id       uuid not null unique references opportunities(id) on delete restrict,
  customer_id          uuid not null references customers(id) on delete restrict,
  property_id          uuid not null,
  accepted_estimate_id uuid references estimates(id) on delete set null,
  title                text not null,
  work_type            work_type not null,
  status               job_status not null default 'pending_schedule',
  scheduled_start      date,
  scheduled_end        date,
  started_at           timestamptz,
  completed_at         timestamptz,
  permit_status        permit_status not null default 'needed',
  permit_number        text,
  warranty_years       integer,
  warranty_expires_on  date,
  scope_summary        text,                          -- price-free copy of estimate line names for the crew
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  foreign key (property_id, customer_id) references properties (id, customer_id) on delete restrict
);
create index jobs_status_idx   on jobs (status);
create index jobs_customer_idx on jobs (customer_id);

create table job_assignments (
  job_id     uuid not null references jobs(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (job_id, user_id)
);
create index job_assignments_user_idx on job_assignments (user_id);

create table appointments (
  id                uuid primary key default gen_random_uuid(),
  type              appointment_type not null,
  status            appointment_status not null default 'scheduled',
  title             text not null,
  opportunity_id    uuid not null references opportunities(id) on delete cascade,
  job_id            uuid references jobs(id) on delete cascade,
  customer_id       uuid not null references customers(id) on delete cascade,   -- filled by trigger
  property_id       uuid references properties(id) on delete set null,          -- filled by trigger
  assigned_to       uuid not null references profiles(id) on delete restrict,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  all_day           boolean not null default false,
  notes             text,
  outcome_notes     text,
  completed_at      timestamptz,
  google_event_id   text,
  google_sync_status sync_status not null default 'not_synced',
  google_synced_at  timestamptz,
  google_sync_error text,
  created_by        uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ends_at > starts_at),
  check (type <> 'job_work' or job_id is not null)
);
create index appointments_time_idx     on appointments (starts_at);
create index appointments_assignee_idx on appointments (assigned_to, starts_at);
create index appointments_opp_idx      on appointments (opportunity_id);
create index appointments_job_idx      on appointments (job_id) where job_id is not null;

create table invoices (
  id               uuid primary key default gen_random_uuid(),
  invoice_number   bigint not null unique default nextval('invoice_number_seq'),
  job_id           uuid not null references jobs(id) on delete restrict,
  customer_id      uuid not null references customers(id) on delete restrict,
  estimate_id      uuid references estimates(id) on delete set null,
  kind             invoice_kind not null,
  status           invoice_status not null default 'draft',
  subtotal_cents   integer not null default 0,
  tax_cents        integer not null default 0,
  total_cents      integer not null default 0,
  amount_paid_cents integer not null default 0,
  issued_on        date,
  due_on           date,
  paid_at          timestamptz,
  qbo_invoice_id   text,
  qbo_doc_number   text,
  qbo_sync_status  sync_status not null default 'not_synced',
  qbo_synced_at    timestamptz,
  qbo_sync_error   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index invoices_job_idx on invoices (job_id);
create unique index invoices_one_per_kind_uidx
  on invoices (job_id, kind) where status <> 'void';

create table invoice_line_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references invoices(id) on delete cascade,
  sort_order   integer not null default 0,
  description  text not null,
  amount_cents integer not null,
  created_at   timestamptz not null default now()
);
create index invoice_lines_invoice_idx on invoice_line_items (invoice_id, sort_order);

create table notes (
  id             uuid primary key default gen_random_uuid(),
  body           text not null check (length(trim(body)) > 0),
  customer_id    uuid not null references customers(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  job_id         uuid references jobs(id) on delete cascade,
  author_id      uuid references profiles(id) on delete set null,
  is_pinned      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index notes_customer_idx on notes (customer_id, created_at desc);
create index notes_opp_idx      on notes (opportunity_id, created_at desc) where opportunity_id is not null;

create table files (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references customers(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  job_id         uuid references jobs(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  category       file_category not null default 'photo',
  storage_path   text not null unique,       -- path inside bucket 'crm-files'
  file_name      text not null,
  mime_type      text not null,
  size_bytes     bigint not null,
  caption        text,
  uploaded_by    uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index files_customer_idx on files (customer_id, created_at desc);
create index files_opp_idx      on files (opportunity_id, category) where opportunity_id is not null;

create table activities (
  id             uuid primary key default gen_random_uuid(),
  type           activity_type not null,
  customer_id    uuid not null references customers(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  job_id         uuid references jobs(id) on delete cascade,
  actor_id       uuid references profiles(id) on delete set null,   -- null = system / customer
  summary        text not null,              -- human sentence, never contains dollar amounts
  metadata       jsonb not null default '{}',
  occurred_at    timestamptz not null default now(),
  created_at     timestamptz not null default now()
);
create index activities_customer_idx on activities (customer_id, occurred_at desc);
create index activities_opp_idx      on activities (opportunity_id, occurred_at desc) where opportunity_id is not null;

create table tasks (
  id             uuid primary key default gen_random_uuid(),
  title          text not null,
  description    text,
  status         task_status not null default 'open',
  due_at         timestamptz not null,
  customer_id    uuid references customers(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  job_id         uuid references jobs(id) on delete cascade,
  assigned_to    uuid not null references profiles(id) on delete restrict,
  created_by     uuid references profiles(id) on delete set null,   -- null = automation
  auto_key       text,                       -- set for automation-created tasks, e.g. 'first_contact'
  completed_at   timestamptz,
  completed_by   uuid references profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index tasks_assignee_idx on tasks (assigned_to, due_at) where status = 'open';
create index tasks_opp_idx      on tasks (opportunity_id) where status = 'open';
create unique index tasks_auto_open_uidx on tasks (opportunity_id, auto_key)
  where status = 'open' and auto_key is not null;

create table integration_connections (
  provider          integration_provider primary key,
  status            text not null default 'connected' check (status in ('connected','error','disconnected')),
  access_token_enc  text,                    -- AES-256-GCM, key in env INTEGRATION_ENCRYPTION_KEY
  refresh_token_enc text,
  expires_at        timestamptz,
  external_account_id text,                  -- Google account email, or QuickBooks realmId
  config            jsonb not null default '{}',   -- {calendar_id} or {item_id, tax_code_id, environment}
  last_error        text,
  connected_by      uuid references profiles(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table sync_outbox (
  id              uuid primary key default gen_random_uuid(),
  provider        integration_provider not null,
  entity_type     text not null check (entity_type in ('appointment','invoice')),
  entity_id       uuid not null,
  status          outbox_status not null default 'pending',
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at       timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz
);
create unique index sync_outbox_pending_uidx on sync_outbox (provider, entity_type, entity_id) where status = 'pending';
create index sync_outbox_due_idx on sync_outbox (next_attempt_at) where status = 'pending';

create table email_log (
  id              uuid primary key default gen_random_uuid(),
  dedupe_key      text not null unique,      -- e.g. 'estimate:<estimate_id>:<version>:<sent_at epoch>'
  template        text not null,
  to_email        citext not null,
  subject         text not null,
  props           jsonb not null default '{}',   -- template inputs, so a failed email can be retried
  status          email_status not null default 'pending',
  attempts        integer not null default 0,
  last_attempt_at timestamptz,
  resend_id       text,
  error           text,
  opportunity_id  uuid references opportunities(id) on delete set null,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index email_log_retry_idx on email_log (last_attempt_at) where status in ('pending','failed');

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['customers','properties','opportunities','price_book_items','estimates','jobs',
                           'appointments','invoices','notes','tasks','integration_connections']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()',
                   t || '_set_updated_at', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Field-access helpers (§3.2)
-- ---------------------------------------------------------------------------
create or replace function private.field_can_access_opportunity(p_opp uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.auth_role() = 'field', false) and (
    exists (select 1 from public.appointments a
             where a.opportunity_id = p_opp and a.assigned_to = auth.uid())
    or exists (select 1 from public.jobs j join public.job_assignments ja on ja.job_id = j.id
                where j.opportunity_id = p_opp and ja.user_id = auth.uid())
  )
$$;

create or replace function private.field_can_access_customer(p_customer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(private.auth_role() = 'field', false) and (
    exists (select 1 from public.appointments a
             where a.customer_id = p_customer and a.assigned_to = auth.uid())
    or exists (select 1 from public.jobs j join public.job_assignments ja on ja.job_id = j.id
                where j.customer_id = p_customer and ja.user_id = auth.uid())
  )
$$;

revoke execute on function private.field_can_access_opportunity(uuid), private.field_can_access_customer(uuid)
  from public, anon, authenticated;
grant execute on function private.field_can_access_opportunity(uuid), private.field_can_access_customer(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- fill_parent_ids (§2.9): attachments carry every ancestor id.
-- TG_ARGV[0] = 'required' raises when no customer can be resolved; 'optional' (tasks) does not.
-- ---------------------------------------------------------------------------
create or replace function private.fill_parent_ids() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.job_id is not null then
    select j.opportunity_id, j.customer_id into new.opportunity_id, new.customer_id
      from public.jobs j where j.id = new.job_id;
  elsif new.opportunity_id is not null then
    select o.customer_id into new.customer_id
      from public.opportunities o where o.id = new.opportunity_id;
  end if;
  if new.customer_id is null and tg_argv[0] = 'required' then
    raise exception '% row needs a customer, opportunity, or job', tg_table_name using errcode = 'not_null_violation';
  end if;
  return new;
end $$;

create or replace function private.fill_appointment_parent_ids() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_property uuid;
begin
  if new.job_id is not null then
    select j.opportunity_id, j.customer_id, j.property_id into new.opportunity_id, new.customer_id, new.property_id
      from public.jobs j where j.id = new.job_id;
  elsif new.opportunity_id is not null then
    select o.customer_id, o.property_id into new.customer_id, v_property
      from public.opportunities o where o.id = new.opportunity_id;
    if new.property_id is null then new.property_id := v_property; end if;
  end if;
  if new.customer_id is null then
    raise exception 'appointment needs an opportunity or job' using errcode = 'not_null_violation';
  end if;
  return new;
end $$;

revoke execute on function private.fill_parent_ids(), private.fill_appointment_parent_ids() from public, anon, authenticated;

create trigger notes_fill_parent_ids      before insert or update on public.notes
  for each row execute function private.fill_parent_ids('required');
create trigger files_fill_parent_ids      before insert or update on public.files
  for each row execute function private.fill_parent_ids('required');
create trigger activities_fill_parent_ids before insert or update on public.activities
  for each row execute function private.fill_parent_ids('required');
create trigger tasks_fill_parent_ids      before insert or update on public.tasks
  for each row execute function private.fill_parent_ids('optional');
create trigger appointments_fill_parent_ids before insert or update on public.appointments
  for each row execute function private.fill_appointment_parent_ids();

-- ---------------------------------------------------------------------------
-- Stage tracking (§2.9)
-- ---------------------------------------------------------------------------
create or replace function private.track_stage_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stage is distinct from old.stage then
    new.stage_entered_at := now();
  end if;
  return new;
end $$;

create or replace function private.log_stage_history() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by)
    values (new.id, null, new.stage, auth.uid());
  elsif new.stage is distinct from old.stage then
    insert into public.opportunity_stage_history (opportunity_id, from_stage, to_stage, changed_by)
    values (new.id, old.stage, new.stage, auth.uid());
  end if;
  return null;
end $$;

revoke execute on function private.track_stage_change(), private.log_stage_history() from public, anon, authenticated;

create trigger opportunities_track_stage before update of stage on public.opportunities
  for each row execute function private.track_stage_change();
create trigger opportunities_log_stage after insert or update of stage on public.opportunities
  for each row execute function private.log_stage_history();

-- ---------------------------------------------------------------------------
-- Estimate totals (§7.2) and the sent-estimate lock (§2.9)
-- ---------------------------------------------------------------------------
create or replace function private.recalc_estimate(p_estimate_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_subtotal integer;
  v_taxable integer;
  v_discount integer;
  v_taxable_after integer;
  v_tax integer;
  v_total integer;
  e record;
begin
  select discount_cents, tax_rate, deposit_percent into e from public.estimates where id = p_estimate_id;
  if not found then return; end if;

  select coalesce(sum(total_cents), 0), coalesce(sum(total_cents) filter (where is_taxable), 0)
    into v_subtotal, v_taxable
    from public.estimate_line_items where estimate_id = p_estimate_id;

  v_discount := least(e.discount_cents, v_subtotal);
  v_taxable_after := v_taxable - coalesce(round(v_discount::numeric * v_taxable / nullif(v_subtotal, 0)), 0)::integer;
  v_tax := round(v_taxable_after * e.tax_rate)::integer;
  v_total := v_subtotal - v_discount + v_tax;

  update public.estimates
     set subtotal_cents = v_subtotal,
         tax_cents = v_tax,
         total_cents = v_total,
         deposit_cents = round(v_total * e.deposit_percent / 100.0)::integer
   where id = p_estimate_id;
end $$;

create or replace function private.recalc_estimate_from_line() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then perform private.recalc_estimate(old.estimate_id); end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.estimate_id is distinct from old.estimate_id) then
    perform private.recalc_estimate(new.estimate_id);
  end if;
  return null;
end $$;

create or replace function private.recalc_estimate_from_header() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform private.recalc_estimate(new.id);
  return null;
end $$;

-- Content of an estimate is frozen once it leaves draft. Status and timestamp columns stay writable.
create or replace function private.lock_sent_estimate_lines() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status public.estimate_status;
begin
  select status into v_status from public.estimates
   where id = case when tg_op = 'DELETE' then old.estimate_id else new.estimate_id end;
  -- v_status is null when the parent estimate is being deleted (cascade): allow.
  if v_status is not null and v_status <> 'draft' then
    raise exception 'estimate is % and can no longer be edited', v_status using errcode = 'P0001', hint = 'estimate_locked';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function private.lock_sent_estimate() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and (
       new.title is distinct from old.title
    or new.scope_notes is distinct from old.scope_notes
    or new.terms is distinct from old.terms
    or new.discount_cents is distinct from old.discount_cents
    or new.tax_rate is distinct from old.tax_rate
    or new.deposit_percent is distinct from old.deposit_percent
    or new.valid_until is distinct from old.valid_until) then
    raise exception 'estimate is % and can no longer be edited', old.status using errcode = 'P0001', hint = 'estimate_locked';
  end if;
  return new;
end $$;

revoke execute on function private.recalc_estimate(uuid), private.recalc_estimate_from_line(),
  private.recalc_estimate_from_header(), private.lock_sent_estimate_lines(), private.lock_sent_estimate()
  from public, anon, authenticated;

create trigger estimate_lines_lock before insert or update or delete on public.estimate_line_items
  for each row execute function private.lock_sent_estimate_lines();
create trigger estimate_lines_recalc after insert or update or delete on public.estimate_line_items
  for each row execute function private.recalc_estimate_from_line();
create trigger estimates_lock before update on public.estimates
  for each row execute function private.lock_sent_estimate();
create trigger estimates_recalc after update of discount_cents, tax_rate, deposit_percent on public.estimates
  for each row execute function private.recalc_estimate_from_header();

-- ---------------------------------------------------------------------------
-- Note → timeline entry (§2.9)
-- ---------------------------------------------------------------------------
create or replace function private.note_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select full_name into v_name from public.profiles where id = new.author_id;
  insert into public.activities (type, customer_id, opportunity_id, job_id, actor_id, summary, metadata)
  values ('note_added', new.customer_id, new.opportunity_id, new.job_id, new.author_id,
          coalesce(v_name, 'Someone') || ' added a note', jsonb_build_object('note_id', new.id));
  return null;
end $$;
revoke execute on function private.note_activity() from public, anon, authenticated;

create trigger notes_activity after insert on public.notes
  for each row execute function private.note_activity();

-- ---------------------------------------------------------------------------
-- Calendar sync queue (§2.9). Inactive until a google_calendar connection exists (Phase 12).
-- ---------------------------------------------------------------------------
create or replace function private.calendar_connected() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.integration_connections
                  where provider = 'google_calendar' and status = 'connected')
$$;

create or replace function private.mark_calendar_pending() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.calendar_connected() then new.google_sync_status := 'pending'; end if;
  return new;
end $$;

create or replace function private.enqueue_calendar_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if private.calendar_connected() then
    insert into public.sync_outbox (provider, entity_type, entity_id)
    values ('google_calendar', 'appointment', new.id)
    on conflict do nothing;
  end if;
  return null;
end $$;

revoke execute on function private.calendar_connected(), private.mark_calendar_pending(), private.enqueue_calendar_sync()
  from public, anon, authenticated;

create trigger appointments_calendar_pending
  before insert or update of starts_at, ends_at, status, assigned_to, title, notes, all_day on public.appointments
  for each row execute function private.mark_calendar_pending();
create trigger appointments_calendar_enqueue
  after insert or update of starts_at, ends_at, status, assigned_to, title, notes, all_day on public.appointments
  for each row execute function private.enqueue_calendar_sync();
