# Piccard Roofing CRM — v1 Specification and Build Plan

## Context

Dylan is building a custom CRM for a small roofing and renovation company. Pipedrive is the workflow reference (pipeline-first, deal-centric, activity-driven) but the product must be much simpler and shaped around the real roofing flow: lead → call → on-site inspection → estimate → won/lost → job.

**Repo state found:** `/Users/dylanburns/piccard-crm` (remote `github.com/Dylan-Burns/piccard-crm`, branch `main`) holds three commits of an earlier FastAPI + Vite prototype ("Ridge Roofing CRM", multi-tenant, SQLAlchemy, float money, JSON line items). Every tracked file is deleted in the working tree, so this is a clean rewrite on the new stack. Nothing from the prototype is reused; it stays in git history only. Local tooling present: Node 22.23, pnpm 11, Supabase CLI 2.109, Docker 29.

**Outcome wanted:** a buildable v1 spec plus a phased plan, granular enough for a less capable model (Opus 5.5) to execute without re-deciding anything.

**Revision 2 (2026-10-03).** Revised after an external review (Codex) and the first Phase 1 implementation pass. Changes: database privilege lockdown (private helper schema, empty `search_path`, default-deny function grants, column-level grants so lifecycle columns change only through RPCs — §2.10, §3); narrower lead dedupe (§6.5); store-first webhooks with server-side secrets and early rate limiting (§6.5); retryable email log (§2.7, §6.4); a staging Supabase project for previews (§1.5); progress invoices cut (§7.5); speed-to-lead and rep attribution columns (§2.4, §8); additional atomic RPCs (§4.6); client-side estimate view tracking (§7.4); owner decision gates before Phases 9, 12, 13 (§11); phases defined by acceptance criteria rather than session count (§9). **Revision 2.1** (final pass): global default-privilege revoke for `PUBLIC`; line items saved through `save_estimate_lines`; `possible_duplicate_of` moved to the opportunity; lead and email retries moved to TypeScript cron routes; import stage rules; sent-estimate lock covers inserts; OAuth on production and localhost only; Vercel deployment protection and `RedirectTo`-based auth email links.

**How this plan is used**
1. This file lives in the repo as `docs/spec.md`; §10 is `CLAUDE.md`.
2. Each phase in §9 is started with its kickoff prompt. A phase is defined by its acceptance criteria, not by a session count: it may take several sessions, with checkpoint commits, but its scope never grows. Phases reference spec sections by number (for example "spec §2.4"), so section numbers are stable identifiers and must not be renumbered.
3. Every phase is built on a branch `phase-NN-<slug>`, verified on its Vercel preview deployment (which uses the **staging** Supabase project, §1.5), then merged to `main`.

**Rules for the executing model (apply to every phase)**
- Do not re-decide anything in this spec. If the spec is silent, pick the simplest option consistent with §10 and record it in `docs/decisions.md` (one line each).
- If a spec instruction is impossible as written (an API changed, a column is missing), stop and report the conflict instead of improvising a schema or lifecycle change.
- Framework APIs move: before using a Next.js, Supabase SSR, Tailwind, or shadcn API, check the installed package's docs or types rather than memory.
- A phase is finished only when every acceptance criterion passes and the listed commands exit 0.

---

## 1. Critique of the original plan

### 1.1 The entity chain is wrong as a chain

`Lead → Customer → Property → Opportunity → Job → Appointment → Estimate → Invoice` reads as a linear pipeline, but only part of it is linear. Corrected shape:

```
Customer 1─N Property
Customer 1─N Opportunity (each points at one Property)
Opportunity 1─N Estimate (versions; at most one accepted)
Opportunity 1─N Appointment (inspection, estimate presentation)
Opportunity 1─0..1 Job (created when Won)
Job 1─N Appointment (job work days)
Job 1─N Invoice (deposit, final)
Notes / Files / Activities / Tasks hang off Customer, Opportunity, Job
```

Specific problems in the original chain and the decision for each:

| Issue | Decision |
|---|---|
| **Lead and Opportunity as separate tables** | **One table, `opportunities`.** A "lead" is an opportunity in stage `new` or `contacted`. The Leads screen is a filtered inbox over the same rows as the Pipeline board. Separate tables force a "convert" step that duplicates fields, breaks source attribution at the join, and makes every funnel report a two-table union. Raw inbound payloads are kept in `lead_submissions` for audit, idempotency, and dedupe, which is the only thing a separate lead table was ever good for. |
| **Customer with several properties or repeat jobs** | `properties` is a child of `customers`. Each opportunity references `customer_id` and `property_id`, with a composite foreign key so a deal cannot point at another customer's property. A repeat job is a new opportunity on the existing customer. Landlords and property managers work without special handling. |
| **Estimate after Job in the chain** | Estimates attach to the **opportunity**, because they exist before any job does. The job stores `accepted_estimate_id`. |
| **Appointment after Job** | Appointments attach to the opportunity always, and additionally to the job for work days. Inspections happen before a job exists. |
| **Invoice at the end of the chain** | Invoices attach to the **job**, and are created from the accepted estimate. |
| **Follow-ups as their own concept** | Follow-ups are `tasks` with a due time. There is no `next_follow_up_at` column on the deal. "Next step" is always derived from open tasks and future appointments, so it can never disagree with them. |
| **Polymorphic attachments** | No `entity_type` / `entity_id` pairs. See §2.6. |

### 1.2 Over-scoped for v1 — cut or narrow

| Item | Decision | Reason |
|---|---|---|
| Two-way Google Calendar sync | **One-way push, CRM → one shared company calendar.** | Two-way sync is where drift comes from (edits on phones, recurring events, deletions). CRM is the source of truth; a nightly job re-asserts CRM state. |
| QuickBooks "sync" | **One-way push of customer + invoice on an explicit admin click; hourly poll for payment status.** No estimate sync, no item/product mapping, no webhooks. | This is the integration most likely to eat the schedule (§6.6). |
| Google Ads API integration | **Not built.** Google Ads lead-form extensions post to a webhook; ad clicks that land on the website are attributed by `gclid` / UTM captured by the website form. | The Ads API requires a developer token and approval and gives nothing v1 needs. |
| S3 | **Cut. Supabase Storage only.** | One storage system, one auth model. |
| Twilio SMS | Deferred (already planned). SMS is logged manually as an activity. | |
| Separate "Documents" and "Job Record" modules | **Not modules.** They are the Files and Timeline panels on the customer, deal, and job screens. | A global documents area is how photos end up on the wrong job. Uploads only start from inside a record. |
| "Accounting" module | **Not a module.** An Invoices panel on the job plus the QuickBooks push. | |
| Reports as a builder | **Five fixed reports** backed by SQL functions (§8). | |
| Multi-tenancy (the prototype had `org_id`) | **Cut. Single company, no `org_id` anywhere.** | One business. Tenant columns would add a predicate to every policy and query for no benefit. |
| Realtime board updates | Deferred. Refresh after each action and on window focus. | |
| Offline mode | Deferred. Photo uploads get an in-memory retry queue only. | |
| E-signature | **Online estimate approval** on a public estimate link (typed name, timestamp, IP). This approves the estimate; it is **not** a substitute for the signed home-improvement contract the business uses, which is uploaded as a `contract` file (the `collect_contract` task enforces this). A real e-sign provider is deferred. | Many states require specific written contract terms for home improvement work. |
| Payment collection | Deferred. Payments are recorded in QuickBooks and polled back. | |
| Progress invoices | **Cut.** v1 bills a deposit invoice and a final invoice only, generated from the accepted estimate and always summing to it. | Change orders are out of v1, so arbitrary progress invoices could only over-bill the contract. |

### 1.3 Missing from the original plan — added

- **Duplicate-lead handling** as a first-class ingestion rule (§6.5), not a cleanup chore.
- **Stage history table**, without which close rate and time-in-stage cannot be computed correctly after a deal moves backwards.
- **"No deal without a next step" invariant**: every open deal always has an open task or a future appointment; a nightly job creates one if missing (§4.4).
- **Speed-to-lead**: `first_contact_attempted_at` (any call, voicemail, or message) on the deal, reported per rep; `first_contacted_at` separately records the first successful connection.
- **Rep attribution at close**: `closed_owner_id` snapshots the owner when a deal is won or lost, so reps covering each other's deals do not rewrite history.
- **Outbox table** for integration writes, so a failed Google or QuickBooks call never loses work and never blocks a user action.
- **Price book** so estimates are built from saved line items instead of retyped.
- **Company settings singleton**: timezone, tax rate, deposit percent, estimate terms, default lead owner.
- **Field "Today" screen**: the phone home screen for field users.
- **Public estimate page** with accept/decline, which is what makes "Awaiting Signature" a real status.

### 1.4 Roofing-specific needs

| Need | v1? | How |
|---|---|---|
| Insurance claim jobs | **Yes, light** | Columns on the deal: `is_insurance_claim`, carrier, claim number, adjuster name and phone, deductible. Lost reason `insurance_denied`. No supplement tracking. |
| Measurement reports (EagleView, Hover) | **Yes, as a file category** | `file_category = 'measurement_report'`. No API integration. |
| Permits | **Yes, light** | Job columns `permit_status`, `permit_number`; file category `permit`. |
| Warranty | **Yes, light** | Job columns `warranty_years`, `warranty_expires_on` (set on completion). |
| Material orders | **No** | An automatic "Order materials" task on Won. Supplier ordering is deferred. |
| Crew scheduling / production board | **No** | Jobs have assigned users and work-day appointments on the calendar. |
| Job costing, commissions, change orders | **No** | Invoices are generated from the accepted estimate; amounts are not hand-edited (§7.5). |

### 1.5 Stack decisions (firm)

- **Next.js (current major, App Router) + TypeScript strict + Tailwind v4 + shadcn/ui**, on Vercel, Node runtime everywhere (no Edge runtime).
- **Supabase** for Postgres, Auth (email + password, invite-only, public signup disabled), and Storage. "PostgreSQL + Supabase" in the original list is one thing, not two.
- **No ORM.** `supabase-js` with generated types. Schema lives in `supabase/migrations/*.sql`.
- **Multi-step writes are Postgres functions (RPC)**, because `supabase-js` has no client-side transactions and the lifecycle rules must be atomic. TypeScript server actions validate input, call one RPC, and revalidate.
- **The database is the authorization layer, in three parts** (§2.10, §3): Row Level Security decides which rows a role can touch; column-level privileges decide which columns can be written directly; lifecycle columns (stages, statuses, won/lost fields, totals) are writable only through `security definer` RPCs. A user calling the Supabase API directly must not be able to do anything the UI cannot. The service-role key is used only in webhooks, cron routes, integration workers, the public estimate page, storage URL signing, user administration (invite, deactivate), and admin-gated integration settings.
- **Function security** (Supabase guidance): internal helpers live in a `private` schema that the Data API does not expose; every `security definer` function uses `set search_path = ''` and schema-qualifies every object (`public.profiles`, `auth.uid()`); `execute` on functions is revoked from `public`, `anon`, and `authenticated` by default and granted explicitly per callable RPC.
- **Environments**: two Supabase projects. `piccard-crm` (production) backs the Vercel Production environment; `piccard-crm-staging` backs every Vercel Preview deployment. Migrations are applied to staging from the phase branch and to production only after merge to `main`. Production data is never used for testing. OAuth callbacks (Phases 12–13) are registered for exactly two origins: the production domain and `http://localhost:3000`. Integrations are developed and tested locally (Google test account, Intuit sandbox) and verified once in production; they are not exercised on preview URLs, which change per branch.
- **Money is integer cents.** The prototype used floats; that is the first thing to not repeat.
- **PDFs** with `@react-pdf/renderer` in a Node route handler. **Email** with Resend + React Email. **Drag and drop** with `@dnd-kit`. **Validation** with zod. **Phone parsing** with `libphonenumber-js`. **Dates** with `date-fns` + `date-fns-tz`.
- **Background work**: Vercel Cron hitting `/api/cron/*` routes guarded by `CRON_SECRET`, plus `after()` from `next/server` to process the outbox right after a user action. Sub-daily cron and commercial use require the Vercel Pro plan; until Pro is enabled, `after()` is the primary trigger and every cron route must also be safely callable by hand.
- **Package manager** pnpm. **Tests**: Vitest (unit + RLS integration against local Supabase), Playwright (smoke e2e).

---

## 2. Final data model

All tables are in schema `public`; triggers and policy helpers are in schema `private` (§3.2). Primary keys are `uuid default gen_random_uuid()`. Every table has `created_at timestamptz not null default now()`; mutable tables also have `updated_at` maintained by the `set_updated_at` trigger. Money columns end in `_cents` and are `integer`. Migration file names are given in §9; the DDL below is the complete target schema.

### 2.1 Extensions, enums, shared trigger functions

```sql
-- Supabase convention: extensions live in schema `extensions`, which is on the default
-- search_path for migrations. Inside functions with search_path = '' qualify them (extensions.citext).
create extension if not exists citext with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- Internal helpers. Not an exposed Data API schema, so nothing here is callable over HTTP.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- Default-deny: functions created by the migration role are executable by nobody until granted.
-- PUBLIC's EXECUTE on new functions is a *global* default: a per-schema revoke does not remove it,
-- so it is revoked globally for the migration role. Supabase's own per-schema grants to the API
-- roles are then revoked per schema.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public  revoke execute on functions from anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from anon, authenticated;
-- Belt and braces: every function definition in a migration is still followed by an explicit
-- `revoke execute on function … from public, anon, authenticated;` before its grants.

create type user_role            as enum ('admin','sales','field');
create type opportunity_stage    as enum ('new','contacted','qualified','inspection_scheduled',
                                          'estimate_sent','negotiation','won','lost');
create type work_type            as enum ('roof_replacement','roof_repair','renovation','gutters','siding','other');
create type lost_reason          as enum ('price','competitor','no_response','not_qualified',
                                          'insurance_denied','timing','duplicate','other');
create type job_status           as enum ('pending_schedule','scheduled','in_progress','on_hold','completed','cancelled');
create type permit_status        as enum ('not_required','needed','applied','approved','closed');
create type appointment_type     as enum ('inspection','estimate_presentation','job_work','other');
create type appointment_status   as enum ('scheduled','completed','cancelled','no_show');
create type estimate_status      as enum ('draft','sent','viewed','accepted','declined','expired','void');
create type invoice_kind         as enum ('deposit','final');
create type invoice_status       as enum ('draft','sent','partially_paid','paid','void');
create type file_category        as enum ('photo','measurement_report','estimate','contract','permit','insurance','invoice','other');
create type task_status          as enum ('open','done','cancelled');
create type sync_status          as enum ('not_synced','pending','synced','error');
create type integration_provider as enum ('google_calendar','quickbooks');
create type outbox_status        as enum ('pending','processing','done','failed');
create type lead_channel         as enum ('website','google_ads','manual','import');
create type lead_submission_status as enum ('received','created','merged_duplicate','rejected','error');
create type email_status         as enum ('pending','sent','failed');
create type activity_type        as enum (
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
```

**Function conventions** (apply to every function in this spec; Supabase security guidance):
- Triggers and policy helpers live in `private`. RPCs the app calls live in `public`, the only schema the Data API exposes.
- Every function declares `set search_path = ''` and schema-qualifies every object it touches: `public.profiles`, `private.is_staff()`, `auth.uid()`, `extensions.citext`. Built-ins in `pg_catalog` (`now()`, `gen_random_uuid()`, `coalesce`) need no prefix.
- Because of the default privileges above, a new function is executable only by its owner and roles with explicit grants. Each callable RPC is followed by `grant execute on function public.<name>(<arg types>) to authenticated;` (or `to service_role;` for service-only RPCs). Policy helpers in `private` are granted to `authenticated` because policies execute as the caller. Trigger functions are granted to nobody (triggers do not need execute privilege).
- Where DDL below shows an unqualified name inside a function body, the implementation qualifies it. The DDL is written for readability; the conventions win.

### 2.2 Users and settings

```sql
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null,
  email       citext not null unique,
  phone       text,
  role        user_role not null default 'field',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table company_settings (
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
  default_lead_owner_id   uuid references profiles(id) on delete set null,
  send_inspection_confirmation boolean not null default true,
  updated_at              timestamptz not null default now()
);
insert into company_settings default values;

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
```

- `profiles.role` defaults to `field`, the least-privileged role, so a profile created by the auth trigger can never start with more access than intended. The invite action sets the real role afterwards with the service client.
- Lead sources are a table, not an enum, because the owner will add sources ("Home Show 2027") without a migration. The webhook code looks sources up **by name** (`'Website'`, `'Google Ads'`), so those two rows must not be renamed; the settings UI disables renaming them.

### 2.3 Customers and properties

```sql
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
```

- Phone and email indexes are **not unique**. Spouses share phones and landlords share emails; uniqueness would block legitimate records. Dedupe is a rule in `create_lead` (§6.5), not a constraint.
- `unique (id, customer_id)` exists only so child tables can use a composite foreign key that guarantees the property belongs to the same customer.

### 2.4 Opportunities (leads and deals)

```sql
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
```

- There is no manual sort order within a Kanban column. Cards sort by `stage_entered_at desc`. Manual ordering adds a write on every drag and nobody maintains it.
- `lead_submissions` is written **before** any processing (status `received`) so a lead is never lost once the webhook has answered 200; processing then moves it to `created`, `merged_duplicate`, `rejected`, or `error`. Rows left in `received`/`error` are retried by the outbox cron (§6.5).
- `closed_owner_id` is what rep reports attribute wins and losses to (§8), so reassigning a closed deal later does not rewrite history.
- `estimated_value_cents` is the open-pipeline number (typed by the rep, then overwritten by the latest sent estimate total). `amount_cents` is the contract value and is only set by `mark_opportunity_won`. Reports never mix them.
- Money lives on the opportunity, **not on the job**, so field users can read their jobs without seeing prices (§3).
- A trigger writes `opportunity_stage_history` on insert and on every `stage` change, and sets `stage_entered_at = now()` (§2.9).

### 2.5 Estimates, jobs, appointments, invoices

```sql
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
```

- Revisions keep the same `estimate_number` and increment `version`. Displayed as `E-1001` for version 1 and `E-1001-v2` afterwards. The partial unique index guarantees one accepted estimate per deal at the database level.
- `jobs.opportunity_id` is `unique not null`: every job comes from exactly one won deal, and `mark_opportunity_won` is idempotent because of it. A walk-in job is created as an opportunity and immediately marked won.
- `appointments.opportunity_id` is `not null` even for job work days (the trigger copies it from the job). This gives every appointment one path to the customer and one predicate for field-user access.
- Invoice lines hold a single `amount_cents` rather than quantity × price: v1 invoices are deposit / balance splits of an accepted estimate, not itemized re-statements (§7.5). Invoice amounts are written only by `mark_opportunity_won` and `regenerate_job_invoices`; column privileges (§2.10) prevent editing them directly, so deposit + final always equals the accepted estimate.

### 2.6 Notes, files, activities, tasks (the "polymorphic" attachments)

```sql
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
```

**How the attachments are modeled, and why.** Each attachment table has three real, nullable-or-required foreign keys (`customer_id`, `opportunity_id`, `job_id`) instead of an `entity_type` + `entity_id` pair. The rule is **"populate every ancestor"**: a row attached to a job also carries that job's `opportunity_id` and `customer_id`; a row attached to a deal also carries its `customer_id`. The `fill_parent_ids` trigger (§2.9) does this, so application code only supplies the most specific id.

Reasons: real foreign keys give referential integrity and cascade deletes, which `entity_id` cannot; the customer timeline is a single indexed query (`where customer_id = $1`) with no unions; and RLS policies can test `opportunity_id` directly. The cost is three columns instead of two, which is cheap for a fixed set of three parents.

- `activities` is append-only (no update or delete policy). It is the timeline. `summary` must never contain money, because summaries are rendered in places where role checks are easy to forget; amounts go in `metadata`.
- `tasks_auto_open_uidx` makes automation idempotent: creating the same automatic task twice for a deal is a no-op (`on conflict do nothing`).

### 2.7 Integration plumbing

```sql
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
```

- `email_log` is a small email outbox. Only status `sent` suppresses a send for a `dedupe_key`; `pending` and `failed` rows are retried (§6.4).
- The outbox is **state-based, not event-based**: a row means "this entity needs syncing", with no payload. The worker loads the entity's current state when it runs and decides create, update, or delete. Ten rapid edits collapse into one pending row (the partial unique index), and replays are harmless.

### 2.8 Table inventory (23 tables)

`profiles, company_settings, lead_sources, customers, properties, opportunities, opportunity_stage_history, lead_submissions, price_book_items, estimates, estimate_line_items, jobs, job_assignments, appointments, invoices, invoice_line_items, notes, files, activities, tasks, integration_connections, sync_outbox, email_log`.

Foreign-key creation order that satisfies every reference: profiles → company_settings, lead_sources → customers → properties → opportunities → opportunity_stage_history, lead_submissions → price_book_items, estimates → estimate_line_items → jobs → job_assignments → appointments → invoices → invoice_line_items → notes, files, activities, tasks → integration_connections, sync_outbox, email_log.

### 2.9 Triggers

All trigger functions are in schema `private` and follow the function conventions in §2.1 (`set search_path = ''`, schema-qualified names). Those marked security definer need it because they write rows the caller cannot write directly.

| Trigger | Tables | Behavior |
|---|---|---|
| `set_updated_at` (before update) | every table with `updated_at` | Sets `updated_at = now()`. |
| `handle_new_user` (after insert on `auth.users`, security definer) | — | Inserts `profiles (id, email, full_name)` with `full_name = coalesce(raw_user_meta_data->>'full_name', split_part(email,'@',1))` and the default role `field`. |
| `guard_profile_privileges` (before update on `profiles`) | profiles | If `role` or `is_active` changed and `auth.uid()` is not null and `not private.is_admin()`, raise `insufficient_privilege`. (`not is_admin()` is used rather than `auth_role() <> 'admin'` because the latter is null — not true — for a deactivated user. A null `auth.uid()` means service role, which is allowed.) |
| `fill_parent_ids` (before insert or update, security definer) | notes, files, activities, tasks, appointments | If `job_id` is set, copy `opportunity_id`, `customer_id` (and `property_id` for appointments) from the job. Else if `opportunity_id` is set, copy `customer_id` (and `property_id` for appointments, only when null) from the opportunity. For notes, files, activities, appointments: raise if `customer_id` is still null. |
| `track_stage_change` (before insert or update of `stage` on `opportunities`) + `log_stage_history` (after insert or update of `stage`, security definer) | opportunities | Before: on update where stage changed, set `stage_entered_at = now()`. After: write `opportunity_stage_history` — `(null → stage)` on insert, `(old → new, auth.uid())` on change. |
| `recalc_estimate_totals` (after insert, update, delete on `estimate_line_items`; after update of `discount_cents, tax_rate, deposit_percent` on `estimates`; security definer, because users cannot write total columns) | estimates | Recomputes totals per §7.2. Guard against recursion with `pg_trigger_depth()`. |
| `lock_sent_estimate` (before insert, update, or delete on `estimate_line_items`; before update on `estimates`) | estimates | If the estimate's status is not `draft`, reject changes to line items and to `title, scope_notes, terms, discount_cents, tax_rate, deposit_percent, valid_until`. Status and timestamp columns remain updatable. |
| `note_activity` (after insert on `notes`, security definer) | notes | Inserts an activity `note_added` with summary `'<author name> added a note'` and `metadata.note_id`. (Activities have no insert privilege for users; only definer code writes them.) |
| `mark_calendar_pending` (before insert or update of `starts_at, ends_at, status, assigned_to, title, notes, all_day` on `appointments`) + `enqueue_calendar_sync` (after, same columns, security definer) | appointments | Only when a `google_calendar` connection with status `connected` exists. Before: set `new.google_sync_status = 'pending'`. After: `insert into public.sync_outbox (provider, entity_type, entity_id) values ('google_calendar','appointment',new.id) on conflict do nothing`. (Setting the status in a before trigger avoids an after trigger updating its own row.) |

### 2.10 Privileges (column-level grants)

RLS decides **which rows** a role may touch; these grants decide **which columns** anyone may write directly. Together they make lifecycle rules unbypassable: stages, statuses, won/lost fields, totals, invoice amounts, and sync columns are not writable by `authenticated` at all, so they change only inside the RPCs of §4.6.

```sql
-- In 0001, before any table exists: new tables grant nothing to API roles by default.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
-- service_role is not granted anything automatically on current Supabase versions; grant it explicitly.
alter default privileges for role postgres in schema public  grant all on tables    to service_role;
alter default privileges for role postgres in schema public  grant all on sequences to service_role;
alter default privileges for role postgres in schema public  grant execute on functions to service_role;
alter default privileges for role postgres in schema private grant execute on functions to service_role;

-- Ownership defaults so users never supply these columns (and cannot spoof them).
alter table customers alter column created_by set default auth.uid();
alter table notes     alter column author_id  set default auth.uid();
alter table tasks     alter column created_by set default auth.uid();
```

`anon` gets nothing on any table. `service_role` gets full access through the default privileges above (it is used only on the server, §1.5). For `authenticated`:

| Table | select | insert (columns) | update (columns) | delete | Everything else goes through |
|---|---|---|---|---|---|
| profiles | ✓ | — | full_name, phone, role, is_active | — | role / is_active also guarded by trigger (§2.9) |
| company_settings | ✓ | — | every column except id, updated_at | — | |
| lead_sources | ✓ | name, sort_order | name, is_active, sort_order | ✓ | |
| customers | ✓ | first_name, last_name, company_name, email, phone, phone_e164, secondary_phone, preferred_contact, billing_* | same as insert + archived_at | ✓ | |
| properties | ✓ | customer_id, label, address_line1, address_line2, city, state, postal_code, roof_type, stories, access_notes, is_primary | same as insert minus customer_id | ✓ | |
| opportunities | ✓ | — | title, work_type, description, property_id, source_id, source_detail, estimated_value_cents, is_insurance_claim, insurance_carrier, claim_number, adjuster_name, adjuster_phone, deductible_cents, possible_duplicate_of | ✓ | `create_lead`, `change_opportunity_stage`, `assign_owner`, `log_contact`, `mark_opportunity_won/lost`, `reopen_opportunity` |
| opportunity_stage_history | ✓ | — | — | — | triggers |
| lead_submissions | ✓ | — | — | — | webhooks (service role) |
| price_book_items | ✓ | name, description, unit, unit_price_cents, is_taxable | same + is_active | ✓ | |
| estimates | ✓ | — | title, scope_notes, terms, discount_cents, tax_rate, deposit_percent, valid_until | ✓ | `create_estimate`, `mark_estimate_sent`, `revise_estimate`, `void_estimate`, public-page RPCs |
| estimate_line_items | ✓ | — | — | — | `save_estimate_lines` (PostgREST upsert would need insert on `id` and update on `estimate_id`; one RPC is also atomic and recalculates totals once) |
| jobs | ✓ | — | title, permit_status, permit_number, warranty_years, scope_summary | ✓ | `mark_opportunity_won`, `schedule_job`, `set_job_status` |
| job_assignments | ✓ | job_id, user_id | — | ✓ | |
| appointments | ✓ | — | title, notes | ✓ | `schedule_appointment`, `reschedule_appointment`, `cancel_appointment`, `complete_appointment`, `schedule_job` |
| invoices | ✓ | — | due_on | — | `mark_opportunity_won`, `regenerate_job_invoices`, `void_invoice`, `queue_invoice_sync`, `record_invoice_manually`, workers |
| invoice_line_items | ✓ | — | — | — | same as invoices |
| notes | ✓ | body, customer_id, opportunity_id, job_id, is_pinned | body, is_pinned | ✓ | |
| files | ✓ | — | category, caption | ✓ | `register_files` |
| activities | ✓ | — | — | — | RPCs and triggers only (no forged `deal_won` entries) |
| tasks | ✓ | title, description, due_at, customer_id, opportunity_id, job_id, assigned_to | title, description, due_at, assigned_to | ✓ | `set_task_status` (complete / cancel / reopen) |
| integration_connections, sync_outbox, email_log | — | — | — | — | service role only |

Rules for applying the table:
- `delete` is granted where shown; RLS (§3.3) then limits it (usually to admins).
- A ✓ in select still means RLS filters the rows.
- Columns not listed under update (ids, foreign keys to parents, `created_*`, `updated_at`, every lifecycle, total, and sync column) are never written directly by users.
- Sequences are used only inside `security definer` RPCs, so `authenticated` needs no sequence privileges.
- Phase 2 adds a test per table asserting a direct write to one forbidden column fails with `permission denied`.

---

## 3. Roles and permissions

### 3.1 What each role can do

Ownership (`owner_id`) is for accountability and reporting, **not** access control. In a company this size, reps cover each other's calls, and hiding deals from colleagues is what creates duplicate leads.

| Area | Admin | Sales | Field |
|---|---|---|---|
| Customers, properties | Full; delete | Create, read, update all | Read only those tied to their assigned appointments or jobs |
| Opportunities (leads, pipeline) | Full; delete | Create (via `create_lead`), read, edit descriptive fields; move stages, reassign owner, mark won/lost (via RPCs) | **No access** (prices and sales notes live here) |
| Estimates, line items | Full | Create, read, edit drafts, send, revise, void (status changes via RPCs) | No access |
| Price book | Full | Read | No access |
| Jobs | Full | Read, edit permit/warranty/scope, assign users, schedule (via `schedule_job`), change status | Read assigned jobs (no money columns exist on jobs); start/complete only via `set_job_status` |
| Appointments | Full | Create, reschedule, cancel (via RPCs), read and edit title/notes on all | Read own; complete or mark no-show only via `complete_appointment` |
| Invoices | Read; set due date; regenerate/void drafts; send to QuickBooks; record manually (via RPCs) | Read | No access |
| Notes | Full | Create, read all; edit/delete own | Read and create on deals they can access; edit/delete own |
| Files | Full; delete | Upload, read all | Read `photo`, `measurement_report`, `permit`, `other` on deals they can access; upload via `register_files` |
| Activities (timeline) | Read; log calls/emails/SMS via `log_contact` | Same as admin | No access |
| Tasks | Full | Create, read, edit all; complete/cancel via `set_task_status` | Read their own; complete via `set_task_status` |
| Dashboard | Company-wide | Own numbers (owner filter) | Redirected to `/today` |
| Reports | Yes | No | No |
| Settings: company, users, lead sources, price book, integrations | Yes | No | No |
| Own profile (name, phone, password) | Yes | Yes | Yes |

"Deals a field user can access" means: a deal with an appointment assigned to them, or a deal whose job they are assigned to. Field users never query `opportunities` directly; their screens read `jobs`, `appointments`, `customers`, `properties`, `notes`, `files`, `tasks`.

### 3.2 Helper functions

All live in schema `private`, are `stable`, `security definer`, and `set search_path = ''`, so they can read `profiles`, `appointments`, and `job_assignments` without recursing into those tables' own policies, and cannot be hijacked by objects in another schema. Policies call them as `(select private.fn())` so Postgres evaluates them once per statement. `private` is not exposed by the Data API, so these are not callable over HTTP.

```sql
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

-- Default privileges already revoked execute (§2.1); policies run as the caller, so grant to authenticated.
grant execute on function private.auth_role(), private.is_admin(), private.is_staff(),
  private.field_can_access_opportunity(uuid), private.field_can_access_customer(uuid)
  to authenticated, service_role;
```

A deactivated user (`is_active = false`) gets `private.auth_role() = null`, so every policy below evaluates false for them.

### 3.3 Policies

```sql
-- Enable RLS on every table.
alter table profiles enable row level security;
alter table company_settings enable row level security;
alter table lead_sources enable row level security;
alter table customers enable row level security;
alter table properties enable row level security;
alter table opportunities enable row level security;
alter table opportunity_stage_history enable row level security;
alter table lead_submissions enable row level security;
alter table price_book_items enable row level security;
alter table estimates enable row level security;
alter table estimate_line_items enable row level security;
alter table jobs enable row level security;
alter table job_assignments enable row level security;
alter table appointments enable row level security;
alter table invoices enable row level security;
alter table invoice_line_items enable row level security;
alter table notes enable row level security;
alter table files enable row level security;
alter table activities enable row level security;
alter table tasks enable row level security;
alter table integration_connections enable row level security;   -- no policies: service role only
alter table sync_outbox enable row level security;               -- no policies: service role only
alter table email_log enable row level security;                 -- no policies: service role only

-- profiles: everyone signed in can see names (needed for assignee pickers).
-- Own row is always visible, so the app can tell a deactivated user from a missing profile.
create policy profiles_select on profiles for select to authenticated
  using ((select private.auth_role()) is not null or id = auth.uid());
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid() or (select private.is_admin())) with check (id = auth.uid() or (select private.is_admin()));
-- no insert/delete policy: rows come from the auth trigger; role changes are guarded by guard_profile_privileges.

-- company_settings
create policy settings_select on company_settings for select to authenticated using ((select private.auth_role()) is not null);
create policy settings_update on company_settings for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- lead_sources
create policy lead_sources_select on lead_sources for select to authenticated using ((select private.is_staff()));
create policy lead_sources_write  on lead_sources for all    to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- customers
create policy customers_select on customers for select to authenticated
  using ((select private.is_staff()) or private.field_can_access_customer(id));
create policy customers_insert on customers for insert to authenticated with check ((select private.is_staff()));
create policy customers_update on customers for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy customers_delete on customers for delete to authenticated using ((select private.is_admin()));

-- properties
create policy properties_select on properties for select to authenticated
  using ((select private.is_staff()) or private.field_can_access_customer(customer_id));
create policy properties_insert on properties for insert to authenticated with check ((select private.is_staff()));
create policy properties_update on properties for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy properties_delete on properties for delete to authenticated using ((select private.is_admin()));

-- opportunities (field: nothing)
create policy opps_select on opportunities for select to authenticated using ((select private.is_staff()));
create policy opps_update on opportunities for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy opps_delete on opportunities for delete to authenticated using ((select private.is_admin()));

-- stage history and lead submissions: read-only to staff; written by triggers / service role.
create policy stage_history_select on opportunity_stage_history for select to authenticated using ((select private.is_staff()));
create policy lead_submissions_select on lead_submissions for select to authenticated using ((select private.is_staff()));

-- price book
create policy price_book_select on price_book_items for select to authenticated using ((select private.is_staff()));
create policy price_book_write  on price_book_items for all    to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));

-- estimates + lines
create policy estimates_select on estimates for select to authenticated using ((select private.is_staff()));
create policy estimates_update on estimates for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
-- inserts: create_estimate / revise_estimate (security definer)
create policy estimates_delete on estimates for delete to authenticated using ((select private.is_admin()) and status = 'draft');
create policy estimate_lines_select on estimate_line_items for select to authenticated using ((select private.is_staff()));
-- writes: save_estimate_lines (security definer)

-- jobs
create policy jobs_select on jobs for select to authenticated
  using ((select private.is_staff()) or exists (select 1 from job_assignments ja where ja.job_id = jobs.id and ja.user_id = auth.uid()));
create policy jobs_update on jobs for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy jobs_delete on jobs for delete to authenticated using ((select private.is_admin()));
-- no insert policy: jobs are created only by mark_opportunity_won (security definer).

-- job_assignments
create policy job_assign_select on job_assignments for select to authenticated using ((select private.is_staff()) or user_id = auth.uid());
create policy job_assign_write  on job_assignments for all    to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));

-- appointments
create policy appts_select on appointments for select to authenticated using ((select private.is_staff()) or assigned_to = auth.uid());
create policy appts_update on appointments for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy appts_delete on appointments for delete to authenticated using ((select private.is_admin()));
-- inserts and time/assignee/status changes go through schedule_appointment, reschedule_appointment,
-- cancel_appointment, complete_appointment (security definer). Column grants allow only title/notes here.

-- invoices + lines
create policy invoices_select on invoices for select to authenticated using ((select private.is_staff()));
create policy invoices_update on invoices for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy invoice_lines_select on invoice_line_items for select to authenticated using ((select private.is_staff()));
-- all other invoice writes: invoice RPCs (§4.6), admin-guarded.

-- notes
create policy notes_select on notes for select to authenticated
  using ((select private.is_staff()) or (opportunity_id is not null and private.field_can_access_opportunity(opportunity_id)));
create policy notes_insert on notes for insert to authenticated
  with check (author_id = auth.uid() and
              ((select private.is_staff()) or (opportunity_id is not null and private.field_can_access_opportunity(opportunity_id))));
create policy notes_update on notes for update to authenticated
  using (author_id = auth.uid() or (select private.is_admin())) with check (author_id = auth.uid() or (select private.is_admin()));
create policy notes_delete on notes for delete to authenticated using (author_id = auth.uid() or (select private.is_admin()));

-- files (rows are inserted by register_files, security definer; staff may also insert directly)
create policy files_select on files for select to authenticated
  using ((select private.is_staff())
         or (opportunity_id is not null
             and category in ('photo','measurement_report','permit','other')
             and private.field_can_access_opportunity(opportunity_id)));
create policy files_update on files for update to authenticated using ((select private.is_staff())) with check ((select private.is_staff()));
create policy files_delete on files for delete to authenticated using ((select private.is_admin()));

-- activities: append-only, written only by RPCs and triggers.
create policy activities_select on activities for select to authenticated using ((select private.is_staff()));

-- tasks
create policy tasks_select on tasks for select to authenticated using ((select private.is_staff()) or assigned_to = auth.uid());
create policy tasks_insert on tasks for insert to authenticated with check ((select private.is_staff()));
create policy tasks_update on tasks for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
-- field users complete their tasks only through set_task_status.
create policy tasks_delete on tasks for delete to authenticated using ((select private.is_admin()));
```

Notes on the policies:
- `notes_insert` is evaluated **after** the `fill_parent_ids` before-trigger, so a field user who inserts a note with only `job_id` passes the check once the trigger has filled `opportunity_id`.
- Field users have no update policy on `appointments`, `jobs`, or `tasks`. Their write paths are a direct `notes` insert and four security-definer RPCs that check assignment and touch only the allowed columns: `complete_appointment`, `set_job_status`, `register_files`, `set_task_status`. This prevents a field user from rescheduling a visit, moving a due date, or editing a job through the API.
- Policies and column grants (§2.10) work together: a policy that allows an update does not let anyone write a column that is not granted.
- `anon` has no policy and no grant on any table. The public estimate page and webhooks use the service client on the server.

### 3.4 Storage

Bucket `crm-files`, **private**, 25 MB file limit. There are **no policies on `storage.objects`** for `authenticated`. All access is through short-lived signed URLs minted on the server with the service client:
- **Download / thumbnail:** the server selects the `files` row with the *user's* client (so RLS decides), then signs the path for 1 hour.
- **Upload:** server action `createUploadUrls` checks access to the target deal (staff, or `field_can_access_opportunity`), then returns signed upload URLs for paths it generates. After upload the client calls `register_files`.

Path convention: `{customer_id}/{opportunity_id or '_'}/{file_id}.{ext}`. The path is generated on the server; the client never chooses it. This design has one place where access is decided (the `files` table policies) and nothing to misconfigure in Storage.

### 3.5 RPC authorization

Every RPC in §4.6 is `security definer`, lives in `public`, follows the §2.1 function conventions, and starts with an explicit guard that raises `insufficient_privilege` when it fails. After each RPC's definition the migration grants execute explicitly: `to authenticated` for user-facing RPCs, `to service_role` only for webhook, public-page, cron, and worker RPCs. "Service role" is detected inside a function with `(select auth.role()) = 'service_role'`. Phase 2 adds a test asserting that `anon` cannot execute any function in `public` and that `authenticated` cannot execute any service-only RPC.

---

## 4. Pipeline and lifecycle rules

### 4.1 Stage table

"Entry gate" is what must be true for a deal to be **in** the stage; it is checked by `change_opportunity_stage` whenever the deal moves to that stage from anywhere. "Required to leave" restates the next stage's gate from the user's point of view. Skipping forward is allowed when the destination's gate passes. Moving backward among open stages is always allowed.

| Stage | How a deal gets here | Entry gate (data required) | Required to leave (forward) | Automation on entry |
|---|---|---|---|---|
| **new** | `create_lead` (webhook or manual entry) | Customer with first name and (phone or email) | Owner assigned | Activity `lead_received`. Owner = given owner, else `default_lead_owner_id`, else null. Task `first_contact` "Call new lead: {name}" due in 1 hour, assigned to owner (or first active admin if no owner). Email "New lead" to the assignee. |
| **contacted** | Automatically when `log_contact` records a `connected` call; or manual move | G1: `owner_id` set | Work type, property address, phone or email | Sets `first_contacted_at` if null. Completes task `first_contact` and any `retry_contact`. Creates task `qualify` "Qualify and book inspection" due +1 day. |
| **qualified** | Manual move | G1 + G2: `work_type` set; `property_id` set; customer has `phone` or `email` | A scheduled inspection | Completes `qualify`. Creates task `schedule_inspection` "Schedule inspection" due +1 day. |
| **inspection_scheduled** | Automatically when `schedule_appointment` creates an `inspection`; or manual move | G1 + G2 + an appointment of type `inspection` with status `scheduled` or `completed` | An estimate that has been sent | Completes `schedule_inspection`. Appointment is queued for Google Calendar. Confirmation email to the customer if they have an email and `send_inspection_confirmation` is on. |
| **estimate_sent** | Automatically when `mark_estimate_sent` runs; or manual move | G1 + G2 + an estimate with status `sent` or `viewed` | Nothing | Sets `estimated_value_cents` = estimate total. Completes `send_estimate`. Creates task `estimate_followup` "Follow up on estimate E-####" due +3 days. |
| **negotiation** | Manual move; or automatically when an estimate revision (version > 1) is sent | Same as `estimate_sent` | Nothing | Creates task `negotiation_followup` "Follow up" due +3 days if the deal has no open task. |
| **won** | Only via `mark_opportunity_won` (called by staff, or by `accept_estimate` from the public page) | G1 + G2 + (an estimate to accept, or an explicit amount > 0) | Terminal in v1 | See §4.2. |
| **lost** | Only via `mark_opportunity_lost` | `lost_reason`; `lost_notes` when reason is `other`; `lost_competitor` optional | `reopen_opportunity` (staff) | See §4.3. |

Events inside a stage that fire automation:

| Event | Automation |
|---|---|
| `log_contact`, any outcome | If `first_contact_attempted_at` is null, set it to `now()` and `first_contact_attempted_by` to the caller. (This is what speed-to-lead measures, §8.) |
| `log_contact` with outcome `no_answer` or `left_voicemail` while stage is `new` | Activity logged. Completes `first_contact`. Creates task `retry_contact` "Call again: {name}" due next day 9:00 business time. Stage stays `new`. |
| Inspection appointment completed | Activity `appointment_completed`. Creates task `send_estimate` "Prepare and send estimate" due +2 days, assigned to the deal owner. |
| Inspection appointment cancelled or no-show | Activity `appointment_cancelled`. If the deal has no other scheduled inspection and stage is `inspection_scheduled`, move the deal back to `qualified` (which recreates `schedule_inspection`). |
| Estimate first viewed on the public page | Estimate status `viewed`, `viewed_at` set, activity `estimate_viewed`. |
| Estimate declined on the public page | Estimate status `declined`, activity `estimate_declined`, task `declined_followup` "Customer declined estimate — call" due +1 hour. The deal is **not** auto-lost; the rep decides. |
| Estimate passes `valid_until` (nightly) | Status `expired`, activity `estimate_expired`, task `estimate_expired` "Estimate expired — revise or close" due now. |
| Owner changed (`assign_owner`) | Activity `owner_changed`; open automatic tasks on the deal are reassigned to the new owner. |
| Appointment rescheduled (`reschedule_appointment`) | Activity `appointment_rescheduled` with old and new times in `metadata`; calendar sync queued by trigger; inspection confirmation email re-sent (new dedupe key includes `starts_at`). |

Task-creation rules shared by all automation: `auto_key` is the name shown in backticks above; tasks are assigned to the deal owner, falling back to the first active admin; insertion uses `on conflict do nothing` against `tasks_auto_open_uidx`; "completes X" means `update tasks set status='done', completed_at=now() where opportunity_id = … and auto_key = X and status = 'open'`. Due times given as "+N days" are computed from `now()`.

### 4.2 Won → Job conversion (`mark_opportunity_won`)

Signature: `mark_opportunity_won(p_opportunity_id uuid, p_estimate_id uuid default null, p_amount_cents integer default null) returns jsonb`. Guard: `private.is_staff()` or service role. Runs in one transaction, in this order:

1. Lock the opportunity row `for update`. If a job already exists for it, return `{ok:true, job_id, already:true}` (idempotent).
2. If stage is `lost`, return `{ok:false, code:'is_lost'}`. Check gates G1 and G2; if missing, return `{ok:false, code:'missing_requirements', missing:[…]}`.
3. Determine the amount. If `p_estimate_id` is given: it must belong to this deal and be in `sent`, `viewed`, or `accepted`; amount = its `total_cents`. Else if the deal has any estimate in `sent`/`viewed`, return `{ok:false, code:'choose_estimate'}`. Else require `p_amount_cents > 0`.
4. If an estimate is used and not already `accepted`: set `status='accepted'`, `accepted_at=now()` (the public flow has already set name and IP). Set every other estimate on the deal in `draft`, `sent`, or `viewed` to `void`.
5. Update the opportunity: `stage='won'`, `won_at=now()`, `amount_cents=amount`, `estimated_value_cents=amount`, `closed_owner_id=owner_id`, `closed_by=auth.uid()` (null when called by the public page).
6. Insert the job: `opportunity_id`, `customer_id`, `property_id`, `accepted_estimate_id`, `title` = opportunity title, `work_type`, `status='pending_schedule'`, `warranty_years` = `company_settings.default_warranty_years`, `scope_summary` = the accepted estimate's line names joined by newlines with quantities and units and **no prices** (or the opportunity description if there is no estimate).
7. Mark all open automatic tasks on the deal `cancelled`.
8. Create tasks on the job (with `job_id` set): `schedule_job` "Schedule job J-####" due +2 days; `collect_contract` "Get signed contract uploaded" due +1 day, only if the deal has no file with category `contract`; `order_materials` "Order materials" due +3 days; `permit` "Confirm permit requirements" due +2 days.
9. If an estimate was used, create draft invoices per §7.5.
10. Insert activities `deal_won` and `job_created`.
11. Return `{ok:true, job_id, job_number}`.

After the RPC returns, the server action sends the "Deal won" email to admins and revalidates. Nothing is sent to QuickBooks at this point.

### 4.3 Lost (`mark_opportunity_lost`)

Signature: `mark_opportunity_lost(p_opportunity_id uuid, p_reason lost_reason, p_notes text default null, p_competitor text default null) returns jsonb`. Guard: `private.is_staff()`.

1. Reject if stage is `won` (`code:'is_won'`). Require `p_notes` when reason is `other`.
2. Set `stage='lost'`, `lost_at=now()`, `lost_reason`, `lost_notes`, `lost_competitor`, `closed_owner_id=owner_id`, `closed_by=auth.uid()`.
3. Set every `scheduled` appointment on the deal to `cancelled` (the trigger queues the calendar removal).
4. Set every `open` task on the deal to `cancelled`.
5. Set estimates in `draft`, `sent`, or `viewed` to `void`.
6. Insert activity `deal_lost` with `metadata = {reason, competitor}`.

Captured on loss: reason (required enum), free-text notes, competitor name, timestamp, and the stage the deal was lost from (available from `opportunity_stage_history`). Reason `duplicate` excludes the deal from every conversion metric (§8).

`reopen_opportunity(p_opportunity_id, p_to_stage)` (staff): allowed only from `lost`, only to an open stage whose gate passes; clears `lost_*`, `closed_owner_id`, and `closed_by`, logs `deal_reopened`, creates task `reopened_followup` due +1 day. Voided estimates stay void; the rep revises to create a new version.

### 4.4 The "next step" invariant

Every deal in an open stage must have at least one open task or one future scheduled appointment. The nightly cron (§6.7) finds violators and creates task `stale_deal` "No next step set — decide what happens next" due now, assigned to the owner. The board shows a warning icon on any card violating the invariant, and a red dot when the earliest open task is overdue. This is the mechanism that prevents missed follow-ups.

### 4.5 Job lifecycle

`pending_schedule → scheduled → in_progress → completed`, with `on_hold` and `cancelled` reachable from any non-completed state.

| Transition | Trigger | Automation |
|---|---|---|
| → `scheduled` | `schedule_job` (staff): sets `scheduled_start` / `scheduled_end`, creates one `job_work` appointment per selected day and assignee, upserts `job_assignments`, all in one transaction | Completes `schedule_job` task. Activity `job_status_changed`. Calling it again on a scheduled job replaces future `job_work` appointments (cancelling removed days). |
| → `in_progress` | `set_job_status` (staff, or an assigned field user) | Sets `started_at`. Activity. |
| → `completed` | `set_job_status` (staff, or an assigned field user) | Sets `completed_at`; `warranty_expires_on = completed date + warranty_years`. Creates task `final_invoice` "Send final invoice" due +1 day for the first active admin, and task `completion_photos` "Confirm completion photos uploaded" due +1 day for the deal owner. Activity. |
| → `on_hold`, `cancelled` | `set_job_status` (staff only) | `cancelled` also cancels future `job_work` appointments and open job tasks. Activity. |

### 4.6 RPC catalog

All return `jsonb` shaped `{ok:true, …}` or `{ok:false, code, message, missing?}`. Business-rule failures are returned, never raised, so the UI can open the right dialog. Only authorization failures raise.

| Function | Guard | Purpose |
|---|---|---|
| `create_lead(p jsonb)` | staff or service role | Dedupe + create customer / property / opportunity (§6.5). For `channel = 'manual'` it never auto-merges. |
| `process_lead_submission(p_submission_id uuid, p_lead jsonb)` | service role only | `p_lead` is the `LeadInput` normalized in TypeScript. Calls `create_lead`, then records the outcome (`status`, ids, `processed_at`, `attempts + 1`) on the submission (§6.5). Idempotent: a submission not in `received`/`error` is returned as-is. |
| `log_contact(p_opportunity_id, p_type, p_outcome, p_summary)` | staff | `p_type` ∈ call, email, sms; `p_outcome` ∈ connected, left_voicemail, no_answer, sent. Writes the activity and applies §4.1 automation. |
| `assign_owner(p_opportunity_id, p_owner_id)` | staff | New owner must be an active admin or sales user. Updates `owner_id`, reassigns open automatic tasks, logs `owner_changed`. |
| `change_opportunity_stage(p_opportunity_id, p_to_stage)` | staff | Open stages only; rejects `won`/`lost` with `code:'use_dedicated_action'`. Checks the entry gate, updates, runs entry automation, logs `stage_changed`. |
| `mark_opportunity_won`, `mark_opportunity_lost`, `reopen_opportunity` | see above | §4.2, §4.3. |
| `schedule_appointment(p jsonb)` | staff | Inserts the appointment; for `inspection`, moves the deal to `inspection_scheduled` if its stage is `new`, `contacted`, or `qualified` and the gate passes (if G1/G2 fail it returns `missing_requirements` and inserts nothing). Logs `appointment_scheduled`. |
| `reschedule_appointment(p_appointment_id, p_starts_at, p_ends_at, p_assigned_to)` | staff | Only `scheduled` appointments. Updates times and assignee, logs `appointment_rescheduled`. |
| `cancel_appointment(p_appointment_id, p_reason)` | staff | Sets `cancelled`, logs `appointment_cancelled`, applies the §4.1 inspection-cancelled rule. |
| `complete_appointment(p_appointment_id, p_status, p_outcome_notes)` | staff, or `assigned_to = auth.uid()` | `p_status` ∈ completed, no_show. Applies §4.1 automation. |
| `schedule_job(p_job_id, p_start date, p_end date, p_days date[], p_assignees uuid[])` | staff | §4.5. |
| `set_job_status(p_job_id, p_status)` | staff; or assigned field user for `in_progress` / `completed` | §4.5. |
| `set_task_status(p_task_id, p_status)` | staff for any task; any user for tasks assigned to them, and then only `done` | `p_status` ∈ open, done, cancelled. Sets `completed_at`/`completed_by` on done, logs `task_completed` when the task has a deal. |
| `register_files(p jsonb)` | staff, or `private.field_can_access_opportunity` | Inserts N `files` rows and **one** activity `files_uploaded` ("12 photos uploaded"). |
| `create_estimate(p_opportunity_id, p_title)` | staff | Inserts a draft with tax rate, deposit percent, terms, and valid-until copied from `company_settings`; logs `estimate_created`. |
| `mark_estimate_sent(p_estimate_id, p_email, p_pdf_path)` | staff | §7.4. |
| `save_estimate_lines(p_estimate_id, p_lines jsonb)` | staff | Draft estimates only. Replaces the estimate's lines with `p_lines` (name, description, quantity, unit, unit_price_cents, is_taxable; order = array order) in one transaction; totals recalculate by trigger. |
| `revise_estimate(p_estimate_id)` | staff | Clones into a new draft with `version + 1`. |
| `void_estimate(p_estimate_id)` | staff | Only `draft`, `sent`, `viewed`, `expired`. |
| `record_estimate_view(p_token)`, `accept_estimate(p_token, p_name, p_ip)`, `decline_estimate(p_token, p_reason)` | service role only | Public page actions (§7.4). `accept_estimate` sets name/IP/status then calls `mark_opportunity_won`. |
| `regenerate_job_invoices(p_job_id)` | admin | Voids the job's `draft` invoices and recreates them from the accepted estimate (§7.5). Refuses if any invoice is already `sent` or later. |
| `void_invoice(p_invoice_id)` | admin | Only `draft`. |
| `queue_invoice_sync(p_invoice_id)` | admin | Only `draft` with `qbo_sync_status` in (`not_synced`, `error`). Sets `pending`, enqueues the outbox row. |
| `record_invoice_manually(p_invoice_id, p_status, p_amount_paid_cents)` | admin | Fallback when QuickBooks is not connected (§6.6 item 7): mark `sent`, or record the paid amount (→ `partially_paid` / `paid`). Logs `payment_received` on payment. |
| `claim_outbox_batch(p_limit)`, `complete_outbox(p_id)`, `fail_outbox(p_id, p_error)`, `lock_integration(p_provider)` | service role only | §6.1. |
| `run_nightly_maintenance()` | service role only | Expire estimates, enforce §4.4. (Lead-submission and email retries need TypeScript — phone parsing, Resend — so the cron *routes* do them, not this function.) |

---

## 5. Application structure

### 5.1 Route map (App Router)

```
src/app/
  (auth)/login/page.tsx                    email + password sign-in
  (auth)/set-password/page.tsx             landing for invite and reset links
  auth/confirm/route.ts                    exchanges the email token_hash for a session, redirects
  (app)/layout.tsx                         auth gate + app shell (sidebar desktop, bottom tabs mobile)
  (app)/dashboard/page.tsx                 admin: company; sales: own numbers
  (app)/today/page.tsx                     field home: today's appointments, my jobs, my tasks
  (app)/leads/page.tsx                     inbox: deals in stage new + contacted
  (app)/leads/new/page.tsx                 manual lead entry with live duplicate check
  (app)/pipeline/page.tsx                  Kanban board
  (app)/opportunities/[id]/page.tsx        deal detail
  (app)/opportunities/[id]/estimates/[estimateId]/page.tsx   estimate builder / viewer
  (app)/customers/page.tsx                 searchable list
  (app)/customers/[id]/page.tsx            customer detail (benchmark screen)
  (app)/jobs/page.tsx                      list with status filter
  (app)/jobs/[id]/page.tsx                 job record
  (app)/calendar/page.tsx                  agenda (mobile) / week + month (desktop)
  (app)/tasks/page.tsx                     my tasks: overdue, today, upcoming
  (app)/reports/page.tsx                   admin only
  (app)/settings/company/page.tsx          admin only (all settings pages)
  (app)/settings/users/page.tsx
  (app)/settings/lead-sources/page.tsx
  (app)/settings/price-book/page.tsx
  (app)/settings/integrations/page.tsx
  (app)/settings/profile/page.tsx          any role
  e/[token]/page.tsx                       PUBLIC estimate page: view, accept, decline
  api/webhooks/leads/website/route.ts      POST
  api/webhooks/leads/google-ads/route.ts   POST
  api/estimates/[id]/pdf/route.ts          GET, staff; streams the PDF
  api/public/estimates/[token]/pdf/route.ts GET, public; redirects to a signed URL of the stored PDF
  api/public/estimates/[token]/view/route.ts POST, public; called by the estimate page's client script (§7.4)
  api/integrations/google/connect/route.ts + callback/route.ts
  api/integrations/quickbooks/connect/route.ts + callback/route.ts
  api/cron/process-outbox/route.ts         every 5 minutes
  api/cron/nightly/route.ts                daily 03:00 business time
  api/cron/qbo-payments/route.ts           hourly
  api/cron/task-digest/route.ts            daily 07:00 business time
```

Navigation: Dashboard · Leads · Pipeline · Jobs · Calendar · Customers · Reports (admin only), plus Tasks and Settings in the user menu. Mobile bottom tabs for admin/sales: Leads · Pipeline · Calendar · Tasks · More. For field: Today · Jobs · Calendar · Tasks. Role-based redirect after login: admin and sales → `/dashboard`; field → `/today`. Field users requesting a staff-only route are redirected to `/today`.

### 5.2 Folder structure

```
src/
  app/                      routes only: pages compose feature components and call feature queries
  components/ui/            shadcn primitives (generated, not hand-edited)
  components/shell/         AppShell, Sidebar, BottomTabs, PageHeader, RoleGate
  components/shared/        Timeline, FileGrid, FileUploader, NoteComposer, TaskList, DealSummaryCard,
                            StageBadge, MoneyText, EmptyState, ConfirmDialog
  features/
    leads/        actions.ts  queries.ts  schemas.ts  components/
    pipeline/     …           (board, card, move sheet, gate dialog, won/lost dialogs)
    customers/    …
    opportunities/…
    appointments/ …
    tasks/        …
    files/        …
    jobs/         …
    estimates/    …           (builder, totals, pdf/EstimateDocument.tsx)
    invoices/     …
    reports/      …
    settings/     …
  lib/
    supabase/server.ts      user-scoped server client (cookies)
    supabase/client.ts      browser client
    supabase/admin.ts       service-role client; imports 'server-only'
    supabase/proxy.ts       session refresh helper used by src/proxy.ts
    auth.ts                 getSessionProfile(), requireRole(...roles)
    result.ts               ActionResult<T> type and ok()/fail() helpers
    money.ts  dates.ts  phone.ts  deal-status.ts  env.ts
    integrations/crypto.ts  outbox.ts  google-calendar.ts  quickbooks.ts  resend.ts
  emails/                   React Email templates
  types/database.ts         generated by `supabase gen types` — never hand-edited
  proxy.ts                  request proxy (the Next.js 16 name for middleware): refresh session, redirect unauthenticated
supabase/
  migrations/               numbered SQL files, one per phase (names in §9)
  seed.sql                  local dev data
tests/
  unit/                     money, phone, dates, deal-status, estimate totals
  rls/                      per-role access tests against local Supabase
e2e/                        Playwright smoke tests
docs/spec.md  docs/decisions.md  CLAUDE.md
```

### 5.3 Server actions and route handlers

Convention for every server action: `"use server"`; parse input with the zod schema from the feature's `schemas.ts`; call `requireRole(...)`; perform **one** RPC or one simple table write (only to columns granted in §2.10) with the user-scoped client; `revalidatePath` the affected routes; return `ActionResult<T>` (`{ok:true,data}` or `{ok:false,error:{code,message,fields?}}`). Actions never throw for expected failures.

| Feature | Actions |
|---|---|
| leads | `createLead` (→ `create_lead`), `checkDuplicates(phone, email, address)`, `assignOwner` (→ `assign_owner`) |
| pipeline | `moveStage` (→ `change_opportunity_stage`), `markWon`, `markLost`, `reopenDeal` |
| opportunities | `updateOpportunity` (granted columns only), `logContact` (→ `log_contact`) |
| customers | `createCustomer`, `updateCustomer`, `addProperty`, `updateProperty`, `archiveCustomer` |
| notes | `addNote`, `updateNote`, `deleteNote`, `togglePin` |
| tasks | `createTask`, `updateTask` (title, description, due date, assignee), `setTaskStatus` (→ `set_task_status`) |
| appointments | `scheduleAppointment`, `rescheduleAppointment`, `cancelAppointment`, `completeAppointment` (each → its RPC), `updateAppointmentNotes` |
| files | `createUploadUrls`, `registerFiles` (→ RPC), `getSignedUrls`, `updateFile` (category, caption), `deleteFile` |
| jobs | `updateJob` (granted columns), `scheduleJob` (→ `schedule_job`), `setJobStatus` (→ RPC), `assignUsers` |
| estimates | `createEstimate` (→ RPC), `updateEstimate`, `saveEstimateLines` (→ `save_estimate_lines`), `sendEstimate`, `reviseEstimate`, `voidEstimate` (→ RPCs) |
| invoices | `updateInvoiceDueDate`, `regenerateInvoices`, `voidInvoice`, `sendInvoiceToQuickBooks` (→ `queue_invoice_sync`), `recordInvoiceManually` |
| settings | `updateCompany`, `inviteUser`, `updateUserRole`, `setUserActive`, lead-source and price-book CRUD, `disconnectIntegration`, `retrySync` |
| public (service client, no session) | `acceptEstimate(token, name)`, `declineEstimate(token, reason)` |

Reads are plain async functions in `queries.ts` called from Server Components. Lists are paginated at 50 rows with `range()`.

### 5.4 Customer detail screen — `/customers/[id]`

This is the benchmark screen. One server query loads: customer, properties, opportunities (with latest estimate, next scheduled appointment, job), the 30 most recent activities, files, open tasks.

Desktop layout (two columns, 2/3 + 1/3):

- **Header** (full width): name in 20px semibold; primary property address beneath; action buttons Call (`tel:`), Text (`sms:`), Email (`mailto:`), Add note, New deal. Phone shown formatted.
- **Left column**
  1. **Deal summary cards**, one per opportunity, open deals first, then won, then lost (lost collapsed). Each `DealSummaryCard` renders exactly the benchmark block:
     ```
     Roof Replacement · $24,800                     [stage badge]
     123 Main Street
     Inspection: Oct 7, 10:00 AM
     Estimate: Sent (E-1001)
     Status: Awaiting Signature
     ```
     The title row links to `/opportunities/[id]`. "Inspection" shows the next scheduled inspection, or the last completed one. "Estimate" shows the latest non-void estimate status. "Status" is the derived line from `lib/deal-status.ts` (table below).
  2. **Timeline**: activities across all of the customer's deals, newest first, each with icon, summary, actor, relative time, and a small deal label when the customer has more than one deal. A compact horizontal "milestone strip" above it shows the benchmark's `Lead received → Called → Inspection → Photos uploaded → Estimate sent` as filled or hollow dots for the most recent open deal.
  3. **Note composer** pinned above the timeline.
- **Right column**
  1. **Next steps**: open tasks with complete checkboxes; "Add task".
  2. **Files**, grouped by category in this order: Photos (thumbnail grid, 6 shown + "View all"), Measurement Report, Estimate, Contract, Permit, Insurance, Other. Upload button requires picking the deal first when the customer has more than one.
  3. **Properties**: list with add / edit.
  4. **Contact details**: emails, phones, preferred contact, billing address.

Mobile layout (single column): sticky header with name, address, and a row of three large icon buttons (Call, Text, Navigate — the last opens the maps app at the address). Below it the deal summary card(s), then a segmented control `Timeline | Files | Tasks | Details` that swaps one panel at a time. A floating action button opens a sheet: Add note, Add photos, Log call, Add task. All tap targets are at least 44px.

Derived status line (`dealStatus(opportunity, latestEstimate, nextAppointment, job)`), first match wins:

| Condition | Status text |
|---|---|
| stage `lost` | Lost — {reason label} |
| job exists | Job {status label} |
| estimate `accepted` | Accepted |
| estimate `sent` or `viewed` | Awaiting Signature |
| estimate `declined` | Estimate Declined |
| estimate `expired` | Estimate Expired |
| estimate `draft` | Estimate In Progress |
| completed inspection, no estimate | Estimate Needed |
| scheduled inspection | Inspection Scheduled |
| stage `qualified` | Needs Inspection |
| stage `contacted` | Qualifying |
| otherwise | Needs First Contact |

The deal detail page `/opportunities/[id]` reuses `DealSummaryCard`, `Timeline`, `FileGrid`, and `TaskList` scoped to one deal, and adds: a stage stepper with a "Move to…" control, Won and Lost buttons, deal fields (work type, value, source, owner, insurance section shown when `is_insurance_claim`), Appointments panel, Estimates panel, and (when won) a link to the job.

### 5.5 Pipeline board — `/pipeline`

Data: one query for all deals in open stages plus deals won or lost in the last 30 days, each with customer name, property city, owner initials, value, `stage_entered_at`, earliest open task due time, and next appointment time. Filters in the header: owner (default "All" for admin, "Mine" for sales), work type, source, text search.

**Desktop:** six columns for the open stages, horizontally scrollable, each with a header showing stage name, count, and summed value. Won and Lost are two narrow drop zones pinned at the right edge, each showing the last-30-day count. Cards are dragged with `@dnd-kit` (pointer sensor with an 8px activation distance so clicks still open the card).

**Card contents:** customer name (semibold); work type and city; value right-aligned; a footer with owner initials, days in stage, and the next-step indicator — red dot and "Overdue" when the earliest open task is past due, amber when due today, a grey calendar chip when the next step is an appointment, and a warning triangle with "No next step" when the §4.4 invariant is violated. Insurance deals show a small "INS" chip.

**Move behavior:** dropping a card calls `moveStage` with an optimistic update (`useOptimistic`).
- Result `ok` → keep.
- `missing_requirements` → revert the card and open the **Gate dialog**, a form containing only the missing fields (owner, work type, property address, phone/email); saving retries the move.
- Dropped on `inspection_scheduled` without an inspection → open the Schedule Inspection dialog; saving creates the appointment, which moves the deal.
- Dropped on `estimate_sent` or `negotiation` without a sent estimate → revert and show a toast with a "Create estimate" link.
- Dropped on Won → Won dialog (choose the estimate to accept, or type an amount when there is none). Dropped on Lost → Lost dialog (reason required, notes, competitor).

**Mobile:** no drag and drop. A horizontally scrollable stage selector (chips with counts) sits under the header; the selected stage's cards fill the screen as a vertical list. Swiping left or right changes stage. Tapping a card opens the deal. Each card has a "Move" button opening a bottom sheet listing the stages plus Won and Lost; the same gate dialogs apply as full-screen sheets.

### 5.6 Other screens (build notes)

- **Leads inbox** `/leads`: table on desktop, cards on mobile; columns name, phone (tap to call), source, age ("12 min"), owner, next task. Row actions: Log call, Assign, Open. Unassigned leads are highlighted. Sorted newest first.
- **New lead** `/leads/new`: first name, last name, phone, email, address, work type, source, owner, message. As phone, email, or address is typed (debounced 400 ms) `checkDuplicates` shows a "Possible existing customer" panel with "Use this customer" buttons.
- **Today** `/today` (field): today's appointments in time order as large cards (time, customer, address with Navigate, access notes, Call button, "Add photos", "Mark complete"); then "My jobs" in progress; then my open tasks.
- **Job record** `/jobs/[id]`: header with job number, status control, customer and address; panels for Scope (price-free `scope_summary`), Schedule (dates + work-day appointments), Crew (assignments), Permit and Warranty fields, Files, Notes, and — staff only — Timeline, contract amount, and Invoices.
- **Calendar** `/calendar`: mobile shows an agenda list grouped by day with a date strip; desktop adds week and month grids (built with CSS grid; no calendar library). Filters by assignee and type. Staff can create and drag-reschedule on desktop; mobile reschedules through the edit sheet.
- **Tasks** `/tasks`: sections Overdue, Today, Upcoming; one-tap complete; staff can switch to "All users".

### 5.7 Visual system

Slate neutrals on white. Inter via `next/font`. One accent, `blue-600`, for primary buttons, active navigation, and the current stage. Status colors are semantic and limited: green (won, completed, paid), red (lost, overdue, error), amber (due today, pending). Base text 14px, table rows 40px, card padding 12px, 6px radius, 1px slate-200 borders, no shadows except overlays. Numbers use tabular figures. Every interactive element on a field-facing screen is at least 44×44px and reachable in the bottom two-thirds of the screen.

---

## 6. Integrations

### 6.1 Shared mechanics

- **Secrets:** OAuth tokens are encrypted with AES-256-GCM (`lib/integrations/crypto.ts`, key from `INTEGRATION_ENCRYPTION_KEY`, 32 bytes base64) before being stored in `integration_connections`. That table has no RLS policies; only the service client reads it.
- **OAuth `state`:** a random value stored in an HttpOnly, SameSite=Lax cookie and compared in the callback. Connect routes require `requireRole('admin')`.
- **Token refresh:** `getValidAccessToken(provider)` refreshes when fewer than 5 minutes remain. It first takes `pg_advisory_xact_lock(hashtext(provider))` through an RPC so two concurrent workers cannot both refresh (QuickBooks rotates refresh tokens; a lost race invalidates the connection). The **newly returned refresh token is always persisted**.
- **Outbox worker** (`lib/integrations/outbox.ts`): `claim_outbox_batch(20)` selects pending rows due now `for update skip locked`, marks them `processing`, increments `attempts`, sets `locked_at`. It also reclaims rows stuck in `processing` for more than 10 minutes. Success → `complete_outbox`. Failure → `fail_outbox`: if a newer pending row exists for the same entity, mark this one `done`; else if `attempts < 8`, set `pending` with `next_attempt_at = now() + (2 ^ attempts) minutes`; else set `failed` and write the error onto the entity's sync columns. Failed rows are listed under Settings → Integrations → "Sync issues" with a Retry button.
- **Triggering:** user actions call `after(() => processOutbox())` so syncs normally complete within seconds; the 5-minute cron is the safety net.
- **Cron auth:** every `/api/cron/*` route rejects requests without `Authorization: Bearer ${CRON_SECRET}`.

### 6.2 Google Calendar

| | |
|---|---|
| Direction | **One-way, CRM → Google.** CRM is the source of truth. |
| Auth | One connection made by an admin: OAuth 2.0 authorization code, `access_type=offline`, `prompt=consent`, scope `https://www.googleapis.com/auth/calendar`. On connect the app creates a secondary calendar named "{Company} CRM" and stores its id in `config.calendar_id`. |
| Who sees events | The assignee's email is added as an attendee (`sendUpdates: 'none'`), so the event appears on their own Google calendar. The admin can also share the CRM calendar with staff. The customer is **never** an attendee; customer emails come from Resend. |
| Writes | Outbox entity `appointment`. Worker loads the appointment: status `scheduled` → upsert; `completed` → upsert with a "✓ " title prefix; `cancelled` / `no_show` → delete. |
| Duplicates | The Google event id is supplied by the CRM: the appointment UUID with dashes removed (valid under Google's base32hex id rule). Insert returning 409 means it already exists → switch to `patch`. A retry can never create a second event. |
| Event body | `summary` "{Type}: {Customer} — {Work type}"; `location` property address; `description` access notes, appointment notes, CRM link, and the line "Managed by the CRM. Changes made in Google Calendar will be overwritten."; `start`/`end` with the company timezone (or `date` values when `all_day`); `extendedProperties.private.crm_appointment_id`. |
| Drift | The nightly cron re-asserts every appointment starting in the next 60 days: `patch` with the full body and `status: 'confirmed'` (which also revives an event someone deleted); on 404, insert. Edits made in Google are overwritten within 24 hours by design. |
| Failures | 401/invalid_grant → connection status `error`, banner for admins, outbox rows stay pending. 403 rate limit / 5xx → retry with backoff. 404/410 on delete → treat as success. |
| No webhook | No push channels and no polling of Google for changes in v1. |

Setup gotcha to state in the settings page: a Google OAuth app in "Testing" status issues refresh tokens that expire after 7 days. The consent screen must be **Internal** (if the company uses Google Workspace) or published **In production** (personal Gmail; the unverified-app warning is acceptable for a single admin).

### 6.3 QuickBooks Online

| | |
|---|---|
| Direction | **Push** customer and invoice (CRM → QBO) on an explicit admin click. **Pull** payment status (QBO → CRM) hourly. |
| Source of truth | CRM owns customer identity, deals, estimates, and the invoice **until it is sent**. After it is sent, QuickBooks owns the invoice: it is read-only in the CRM, and corrections are made in QuickBooks. QuickBooks owns payments, tax filings, and everything else in accounting. |
| Auth | Intuit OAuth 2.0 authorization code, scope `com.intuit.quickbooks.accounting`. Store `realmId` in `external_account_id` and `environment` (`sandbox` / `production`) in `config`. Base URL chosen from environment. |
| Configuration | After connecting, the admin picks from live lists: the income **Item** used for all invoice lines (`config.item_id`, default name "Roofing Services") and, only if the company charges sales tax, a **TaxCode** (`config.tax_code_id`). |
| Customer push | If `customers.qbo_customer_id` is null: query QBO by `PrimaryEmailAddr`, then by exact `DisplayName`; link if found, else create with `DisplayName` "{First} {Last}". On duplicate-name error (code 6240) retry once with "{First} {Last} — {address_line1}". Save the id. |
| Invoice push | Outbox entity `invoice`. `POST /v3/company/{realmId}/invoice?requestid={invoice.id}` — the `requestid` makes the create idempotent on Intuit's side. One `SalesItemLineDetail` line per `invoice_line_items` row with `ItemRef = config.item_id`, `Amount = amount_cents / 100`. `CustomerRef`, `DueDate`, `PrivateNote` "CRM invoice INV-#### / job J-####". Tax per §7.5. On success store `qbo_invoice_id`, `qbo_doc_number`, set `qbo_sync_status='synced'`, `status='sent'`, `issued_on`. |
| Total check | After create, compare QBO `TotalAmt` with `total_cents`. On mismatch set `qbo_sync_error = 'Total differs in QuickBooks: …'` and show a warning; do not retry. |
| Payment pull | Hourly cron: for invoices with a `qbo_invoice_id` and status `sent` or `partially_paid`, query `select Id, Balance, TotalAmt from Invoice where Id in (…)` in batches of 30. `amount_paid = TotalAmt − Balance`. Balance 0 → `paid` + `paid_at`; between → `partially_paid`; when the paid amount increases, insert activity `payment_received`. An invoice missing in QBO (deleted or voided) → `void`. |
| Failures | Any 401 after one refresh attempt, or `invalid_grant` → connection `error` + admin banner + stop processing QBO rows. 429 / 5xx → backoff. Validation errors (4xx) → `failed` immediately with Intuit's message shown on the invoice. |
| Not built | Webhooks, estimates in QBO, item mapping per line, payments entry, credit memos, two-way customer sync. |

### 6.4 Resend

API key in `RESEND_API_KEY`; sender `EMAIL_FROM` on a domain verified in Resend. Templates are React Email components in `src/emails`. `sendEmail({dedupeKey, template, to, subject, props, opportunityId})`:
1. `insert into email_log (…, status 'pending') on conflict (dedupe_key) do nothing`, then select the row.
2. If the row's status is `sent`, return (already delivered). `pending` and `failed` proceed.
3. Increment `attempts`, set `last_attempt_at`, render the template from `props`, and send with Resend's `Idempotency-Key` header = `dedupe_key` (so a retry after a timeout cannot double-send).
4. On success set `status='sent'`, `sent_at`, `resend_id`. On failure set `status='failed'` and `error`.

The nightly cron (and the outbox cron, if Pro) retries `failed` rows with `attempts < 5` and `pending` rows older than 10 minutes, using the stored `props`. Email failures never fail the user action; they surface as a toast and in the log. Until a sending domain is verified in Resend, only the account owner's address can receive email (`docs/decisions.md`).

| Email | To | Trigger | Dedupe key |
|---|---|---|---|
| New lead | assignee | `create_lead` created a deal | `new_lead:{opportunity_id}` |
| Duplicate inquiry | deal owner | `create_lead` merged | `dup:{lead_submission_id}` |
| Inspection confirmation | customer | inspection scheduled or rescheduled | `inspection:{appointment_id}:{starts_at}` |
| Estimate | customer | `sendEstimate` | `estimate:{estimate_id}:{version}:{sent_at}` |
| Estimate accepted / declined | deal owner | public page action | `est_decision:{estimate_id}` |
| Deal won | admins | `mark_opportunity_won` | `won:{opportunity_id}` |
| Daily task digest | each user with overdue or due-today tasks | 07:00 cron | `digest:{user_id}:{date}` |

Bounce webhooks are deferred.

### 6.5 Lead ingestion

**Durability rule: store first, then process.** Each webhook, in this order:
1. Authenticate (constant-time secret comparison) → `401` on failure.
2. Rate limit: if `lead_submissions` has 10 or more rows from the same `source_ip` in the last minute → `429`.
3. Parse JSON → `400` if unparseable.
4. Insert the raw body into `lead_submissions` (status `received`, `source_ip`, `external_id`, `on conflict (channel, external_id) do nothing`). **If this insert fails (database down), respond `503`** so the sender retries. A conflict means a duplicate delivery → respond `200`.
5. Respond `200 {ok:true}` — the lead is now durable.
6. In `after()`: normalize, then call `process_lead_submission(id, lead)`, then send notification emails. Failures set the submission to `error` with the message and are retried by the cron routes, which re-normalize the stored raw payload in TypeScript (up to 5 attempts), and appear in Settings → Integrations → "Lead ingestion issues".

**Secrets never reach a browser.** `LEAD_WEBHOOK_SECRET` is used only server-to-server. The website form must post to the website's own backend (a server route, a WordPress form plugin's webhook feature, or a Zapier/Make step), which forwards to the CRM with the header. Settings → Integrations shows server-side setup instructions only; it never offers browser `fetch` code containing the secret.

**Normalized input** (`LeadInput`): `channel, external_id, first_name, last_name, phone, phone_e164, email, address_line1, city, state, postal_code, work_type, message, source_name, source_detail, utm_source, utm_medium, utm_campaign, gclid, owner_id`. TypeScript does the normalization: split a single `name` at the first space; parse phone with `libphonenumber-js` (default region US) into E.164 or null; lowercase and trim email.

**Website form** — `POST /api/webhooks/leads/website`, header `X-Webhook-Secret` = `LEAD_WEBHOOK_SECRET`, JSON body with the fields above plus `website` (honeypot) and optional `submission_id`. Rejected (status `rejected`, 200 returned) when the honeypot is filled or when both phone and email are missing. Source: "Google Ads" when `gclid` is present or `utm_medium` is `cpc`/`ppc`; otherwise "Website". When `submission_id` is absent, `external_id` = SHA-256 of the raw request body plus the UTC date (computed before any parsing, so it never fails), which absorbs a double-click submit.

**Google Ads lead form extension** — `POST /api/webhooks/leads/google-ads`. Google sends JSON containing `google_key`, `lead_id`, `user_column_data[]` (`column_id` values such as `FULL_NAME`, `FIRST_NAME`, `LAST_NAME`, `PHONE_NUMBER`, `EMAIL`, `STREET_ADDRESS`, `CITY`, `POSTAL_CODE`), `gcl_id`, `campaign_id`, `form_id`, `is_test`. Verify `google_key === GOOGLE_ADS_WEBHOOK_KEY` (Google sends the key in the body; the Ads server calls us directly, so it is not exposed to browsers). `external_id = lead_id`. Source "Google Ads", `source_detail` = "form {form_id} / campaign {campaign_id}". Test leads (`is_test: true`) are stored as `rejected` and create nothing.

**`create_lead(p jsonb)` — dedupe rules**, in one transaction. The principle: dedupe *deliveries* aggressively (by `external_id`), but dedupe *business opportunities* conservatively, because one customer may legitimately have several open jobs (a landlord's two buildings, a roof and a renovation).
1. Find an existing customer: match on `phone_e164` first, then `email`. (No fuzzy name matching in v1.)
2. **No customer match** → insert customer, insert property if `address_line1` is present, insert opportunity (stage `new`, title "{Work type label or 'New inquiry'} — {address_line1 or last name}"), run the `new` entry automation. Outcome `created`.
3. **Customer match.** Resolve the property: the customer's property whose `address_key` matches the submitted address, or none if no address was submitted or nothing matches. Then pick a merge target:
   - an address was submitted and matches a property with exactly **one** open deal → that deal;
   - no address was submitted and the customer has exactly **one** open deal → that deal;
   - otherwise → no merge target.
4. **Merge target found** (never for `channel = 'manual'`) → create nothing new. Activity `duplicate_inquiry` on that deal; insert the message as a note if present; task `duplicate_inquiry` "Customer contacted us again — call" due in 1 hour for the owner. Outcome `merged_duplicate`.
5. **No merge target** → reuse the customer; reuse the matched property or insert a new one; insert a new opportunity and run the `new` automation. If the customer has any other open deal, set `possible_duplicate_of` on the **new opportunity** to the most recent one and add a `system` activity on the new deal: "Possible duplicate of {title} — merge or keep both". The deal page shows a banner with "Keep both" (dismiss) and "Mark as duplicate" (marks the new deal lost with reason `duplicate`). Outcome `created`. A returning customer keeps the source that brought them this time.
6. Return `{ok:true, status, customer_id, opportunity_id, is_new_customer, possible_duplicate_of}`.

Manual entry calls `create_lead` with `channel = 'manual'` and no `external_id`; it never auto-merges, because the form's live duplicate panel (§5.6) already let the person choose an existing customer or deal.

**Import** (`channel = 'import'`, service role only) differs in three ways: (a) it never auto-merges — a row whose customer and property already have an open deal is **skipped** and reported; (b) `p.import_stage` may name any open stage and is set directly, bypassing entry gates, because historical deals will not have CRM inspections or estimates (`import_stage` is rejected for every other channel); (c) instead of stage automation it creates one task, `imported_review` "Imported deal — confirm stage and next step", due +1 day for the owner, and sends no emails.

Work type and a time window are deliberately **not** part of the merge rule: customer + property is the smallest rule that never merges two real jobs, and anything it misses surfaces as a "possible duplicate" banner for a human to decide.

### 6.6 The integration most likely to consume disproportionate time: QuickBooks

Why: production keys require completing Intuit's app assessment questionnaire; refresh tokens rotate and a single missed write disconnects the company; `DisplayName` must be unique across customers, vendors, and employees; US companies use Automated Sales Tax, which resists externally computed tax; and sandbox behavior differs from production.

Containment, all already reflected above:
1. One-way push, triggered by a human click, one invoice at a time. No background invoice creation.
2. A single configured Item for every line. No product catalog mapping.
3. Payment status by hourly polling. No webhooks.
4. Idempotency through Intuit's `requestid`, so retries are safe.
5. Single-flight token refresh under an advisory lock.
6. It is the **last** integration phase (Phase 13). Everything else, including invoices as CRM records, works without it.
7. Time box: if Phase 13 exceeds two sessions, ship invoices with a "Mark as sent / paid manually" control and defer the push.
8. Start the Intuit developer account and production-key questionnaire during Phase 0, because approval is calendar time, not coding time.

### 6.7 Cron schedule

| Route | Schedule (UTC cron; adjust to business timezone) | Work |
|---|---|---|
| `/api/cron/process-outbox` | `*/5 * * * *` | Drain the outbox. |
| `/api/cron/nightly` | `0 8 * * *` | `run_nightly_maintenance()` (expire estimates, enforce §4.4); retry stuck lead submissions and failed emails; re-assert Google events for the next 60 days. |
| `/api/cron/qbo-payments` | `15 * * * *` | Payment pull. |
| `/api/cron/task-digest` | `0 12 * * *` | Daily digest emails. |

### 6.8 Environment variables

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `LEAD_WEBHOOK_SECRET`, `GOOGLE_ADS_WEBHOOK_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, `INTEGRATION_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_ENVIRONMENT`. All are read through `lib/env.ts` (zod-validated; integration variables optional so the app boots without them). If the Supabase project still issues legacy keys, map the anon key to the publishable variable and the service-role key to the secret variable.

---

## 7. Estimates and PDFs

### 7.1 Line item model

`estimate_line_items` (§2.5): name, optional description, quantity (2 decimals), unit (`sq`, `lf`, `ea`, `hr`, free text), unit price in cents, taxable flag, generated `total_cents`, `sort_order`. Lines are added from the price book (copying values, not referencing them, so later price changes never alter an existing estimate) or typed freehand. No sections, no optional lines, no good/better/best in v1 — a second option is a second estimate.

### 7.2 Pricing and tax

Computed only in the database by `recalc_estimate_totals`, so the builder, the PDF, the public page, and the invoice always agree:

```
subtotal_cents  = sum(line.total_cents)
taxable_cents   = sum(line.total_cents where is_taxable)
discount_cents  = entered flat amount, capped at subtotal_cents
taxable_after   = taxable_cents - round(discount_cents * taxable_cents / nullif(subtotal_cents,0))
tax_cents       = round(taxable_after * tax_rate)
total_cents     = subtotal_cents - discount_cents + tax_cents
deposit_cents   = round(total_cents * deposit_percent / 100.0)
```

`tax_rate`, `deposit_percent`, `terms`, and `valid_until` (today + `estimate_valid_days`) are copied from `company_settings` when the estimate is created and can be edited per estimate. The default tax rate is 0 (§11). The UI shows a live preview computed with the same formula in `features/estimates/totals.ts`; a unit test asserts the TypeScript and SQL results match on a fixture set.

### 7.3 PDF generation

`@react-pdf/renderer`, rendered on the server in the Node runtime. One component, `features/estimates/pdf/EstimateDocument.tsx`, takes a plain data object (company, customer, property, estimate, lines). Layout: letter size; header with logo, company name, license number, contact; estimate number, date, valid-until; customer and property block; scope notes; line table (name + description, qty, unit, unit price, total); totals block (subtotal, discount, tax, **total**, deposit due on acceptance); terms; acceptance block with signature and date lines.

- `GET /api/estimates/[id]/pdf` (staff) renders on demand for preview and download.
- At send time the PDF is rendered once, uploaded to `crm-files` at `{customer_id}/{opportunity_id}/{file_id}.pdf`, registered as a `files` row with category `estimate`, and its path saved in `estimates.pdf_path`. The customer always receives this stored snapshot, never a re-render.

### 7.4 Status lifecycle

```
draft ──send──▶ sent ──first public view──▶ viewed ──accept──▶ accepted
                 │                            │──decline──▶ declined
                 └────────── valid_until passed (nightly) ──▶ expired
draft / sent / viewed ──void (manual, deal lost, superseded, another estimate accepted)──▶ void
```

- **Editing** is allowed only in `draft` (enforced by the `lock_sent_estimate` trigger).
- **Send** (`sendEstimate` action): require at least one line, `total_cents > 0`, and a customer email → render and store the PDF → call `mark_estimate_sent(p_estimate_id, p_email, p_pdf_path)` → send the email containing the link `{APP_URL}/e/{public_token}` → revalidate. `mark_estimate_sent` sets status, `sent_at`, `sent_to_email`, `pdf_path`; voids any other `sent`/`viewed` estimate on the deal; sets the deal's `estimated_value_cents`; moves the deal to `estimate_sent` (or to `negotiation` when `version > 1`) if it is in an earlier open stage; runs that stage's automation; logs `estimate_sent`. If the email fails, the estimate stays `sent` and the UI offers "Resend email" and "Copy link".
- **Revise** (`revise_estimate`): clones the estimate and its lines into a new `draft` with the same `estimate_number`, `version + 1`, and a new `public_token`. The old version is voided when the new one is sent.
- **Public page** `/e/[token]`: server-rendered with the service client; shows the estimate as HTML with company branding, a "Download PDF" link, and Approve / Decline. **Rendering never changes status**, because email security scanners open links before customers do. A small client script posts to `/api/public/estimates/[token]/view` once the page has been visible (`document.visibilityState === 'visible'`) for 2 seconds; that route calls `record_estimate_view`, which only acts on the first view of a `sent` estimate. Approval requires a typed full name and a checkbox "I approve this estimate. I understand a written contract will follow."; the action records the name and the request IP and calls `accept_estimate`, which runs `mark_opportunity_won`. Wording on the page and in emails says **approve**, not **sign**: online approval does not replace the signed contract (§1.2). `void` and `expired` estimates render a "no longer valid — please contact us" page; `accepted` renders a confirmation. Every response from `/e/*` and `/api/public/*` sets `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- **Manual acceptance:** for a customer who signs on paper, staff use the Won dialog, which picks the estimate and calls `mark_opportunity_won` directly.

### 7.5 Accepted estimate → invoice → QuickBooks

When `mark_opportunity_won` runs with an estimate (§4.2 step 9), it creates **draft** invoices on the new job:

- If `deposit_percent > 0`: a `deposit` invoice with `total = deposit_cents`, and a `final` invoice with `total = estimate.total_cents − deposit_cents`.
- If `deposit_percent = 0`: a single `final` invoice for the full total.

Tax is split in proportion so the two invoices sum exactly to the estimate: deposit `tax_cents = round(estimate.tax_cents × deposit_cents / total_cents)`, final `tax_cents = estimate.tax_cents − deposit tax`; each `subtotal_cents = total_cents − tax_cents`. Each invoice gets one line: "Deposit ({percent}%) — {estimate title} (E-####)" or "Balance — {estimate title} (E-####)", with `amount_cents = subtotal_cents`.

Invoice amounts are never edited by hand (column privileges, §2.10), so deposit + final always equals the accepted estimate. Admins can change a draft's due date; if the amounts are wrong (for example the estimate was approved with an error), the fix is `regenerate_job_invoices`, which voids the drafts and recreates them, and refuses once any invoice has been sent. Progress invoices and change orders are not in v1. Clicking **Send to QuickBooks** (`queue_invoice_sync`) sets `qbo_sync_status='pending'` and enqueues the outbox row; the worker pushes the customer (if needed) and then the invoice per §6.3. Tax on the QuickBooks invoice: when `tax_cents = 0`, lines are sent non-taxable with no tax detail. When `tax_cents > 0`, lines carry `config.tax_code_id` and `TxnTaxDetail.TotalTax = tax_cents / 100`; the post-create total check (§6.3) catches any disagreement with QuickBooks' own calculation. The deposit invoice is typically sent on Won; the `final_invoice` task prompts the admin to send the final invoice on job completion.

---

## 8. Reporting

All metrics are SQL functions (`language sql stable security invoker`, so RLS applies). Dates are bucketed in the company timezone. Deals lost with reason `duplicate` are excluded everywhere. Money is returned in cents. `p_owner` null means all owners.

```sql
create or replace function biz_date(ts timestamptz) returns date
language sql stable as $$
  select (ts at time zone (select timezone from company_settings))::date
$$;

-- 8.1 Dashboard tiles
create or replace function report_dashboard(p_from date, p_to date, p_owner uuid default null)
returns table (
  new_leads bigint, won_count bigint, lost_count bigint, close_rate numeric,
  sold_cents bigint, pipeline_cents bigint, active_jobs bigint,
  upcoming_appointments bigint, invoiced_cents bigint, outstanding_cents bigint
) language sql stable security invoker as $$
  -- open work is attributed to the current owner; closed results to the owner at close.
  with o as (
    select * from opportunities
    where (p_owner is null or owner_id = p_owner)
      and lost_reason is distinct from 'duplicate'
  ),
  closed as (
    select * from opportunities
    where (p_owner is null or closed_owner_id = p_owner)
      and lost_reason is distinct from 'duplicate'
  ),
  w as (select count(*) c, coalesce(sum(amount_cents),0) s from closed
        where stage = 'won'  and biz_date(won_at)  between p_from and p_to),
  l as (select count(*) c from closed
        where stage = 'lost' and biz_date(lost_at) between p_from and p_to)
  select
    (select count(*) from o where biz_date(created_at) between p_from and p_to),
    w.c, l.c,
    case when w.c + l.c = 0 then null else round(w.c::numeric / (w.c + l.c), 4) end,
    w.s,
    (select coalesce(sum(estimated_value_cents),0) from o where stage not in ('won','lost')),
    (select count(*) from jobs j join o on o.id = j.opportunity_id
      where j.status in ('pending_schedule','scheduled','in_progress','on_hold')),
    (select count(*) from appointments a join o on o.id = a.opportunity_id
      where a.status = 'scheduled' and a.starts_at >= now() and a.starts_at < now() + interval '7 days'),
    (select coalesce(sum(i.total_cents),0) from invoices i join jobs j on j.id = i.job_id join o on o.id = j.opportunity_id
      where i.status in ('sent','partially_paid','paid') and i.issued_on between p_from and p_to),
    (select coalesce(sum(i.total_cents - i.amount_paid_cents),0) from invoices i join jobs j on j.id = i.job_id join o on o.id = j.opportunity_id
      where i.status in ('sent','partially_paid'))
  from w, l
$$;
```

Definitions the dashboard must label exactly:
- **New leads** — deals created in the period.
- **Revenue (sold)** — sum of `amount_cents` for deals won in the period, by `won_at`. This is the headline "Revenue" tile. **Invoiced** and **Outstanding** are shown beneath it as secondary figures.
- **Conversion rate (close rate)** — won ÷ (won + lost), for deals *closed* in the period. Null (shown as "—") when nothing closed.
- **Active jobs** and **Upcoming appointments** — current counts, not affected by the date range.

```sql
-- 8.2 Leads by source (cohort: deals created in the period)
create or replace function report_leads_by_source(p_from date, p_to date)
returns table (source text, leads bigint, won bigint, lost bigint, open bigint,
               cohort_conversion numeric, sold_cents bigint)
language sql stable security invoker as $$
  select coalesce(s.name, 'Unknown'),
         count(*),
         count(*) filter (where o.stage = 'won'),
         count(*) filter (where o.stage = 'lost'),
         count(*) filter (where o.stage not in ('won','lost')),
         round(count(*) filter (where o.stage = 'won')::numeric / count(*), 4),
         coalesce(sum(o.amount_cents) filter (where o.stage = 'won'), 0)
  from opportunities o left join lead_sources s on s.id = o.source_id
  where biz_date(o.created_at) between p_from and p_to
    and o.lost_reason is distinct from 'duplicate'
  group by 1 order by 2 desc
$$;

-- 8.3 Pipeline dollars by stage (current snapshot)
create or replace function report_pipeline_by_stage(p_owner uuid default null)
returns table (stage opportunity_stage, deals bigint, value_cents bigint, avg_days_in_stage numeric)
language sql stable security invoker as $$
  select o.stage, count(*), coalesce(sum(o.estimated_value_cents),0),
         round(avg(extract(epoch from now() - o.stage_entered_at) / 86400)::numeric, 1)
  from opportunities o
  where o.stage not in ('won','lost') and (p_owner is null or o.owner_id = p_owner)
  group by o.stage order by o.stage
$$;

-- 8.4 Sold revenue by month (last p_months months, by won_at)
create or replace function report_revenue_by_month(p_months integer default 12)
returns table (month date, won_count bigint, sold_cents bigint)
language sql stable security invoker as $$
  select date_trunc('month', biz_date(o.won_at))::date, count(*), coalesce(sum(o.amount_cents),0)
  from opportunities o
  where o.stage = 'won'
    and biz_date(o.won_at) >= (date_trunc('month', biz_date(now())) - make_interval(months => p_months - 1))::date
  group by 1 order by 1
$$;

-- 8.5 Sales rep performance
-- Leads assigned: deals created in the period, by current owner.
-- Won / lost / sold / days to close: deals closed in the period, by closed_owner_id (owner at close).
-- Speed-to-lead: median minutes from creation to first contact ATTEMPT, by who attempted it.
create or replace function report_rep_performance(p_from date, p_to date)
returns table (owner_id uuid, owner_name text, leads_assigned bigint, won bigint, lost bigint,
               close_rate numeric, sold_cents bigint, avg_days_to_close numeric,
               median_minutes_to_first_attempt numeric, overdue_tasks bigint)
language sql stable security invoker as $$
  with reps as (
    select id, full_name from profiles where role in ('admin','sales') and is_active
  ),
  assigned as (
    select owner_id as rep, count(*) n from opportunities
    where biz_date(created_at) between p_from and p_to and lost_reason is distinct from 'duplicate'
    group by owner_id
  ),
  closed as (
    select closed_owner_id as rep,
           count(*) filter (where stage = 'won')  as won,
           count(*) filter (where stage = 'lost') as lost,
           coalesce(sum(amount_cents) filter (where stage = 'won'), 0) as sold,
           avg(extract(epoch from won_at - created_at) / 86400) filter (where stage = 'won') as days
    from opportunities
    where lost_reason is distinct from 'duplicate'
      and ((stage = 'won'  and biz_date(won_at)  between p_from and p_to)
        or (stage = 'lost' and biz_date(lost_at) between p_from and p_to))
    group by closed_owner_id
  ),
  speed as (
    select first_contact_attempted_by as rep,
           percentile_cont(0.5) within group (order by extract(epoch from first_contact_attempted_at - created_at) / 60) as minutes
    from opportunities
    where first_contact_attempted_at is not null and biz_date(created_at) between p_from and p_to
    group by first_contact_attempted_by
  )
  select r.id, r.full_name,
         coalesce(a.n, 0),
         coalesce(c.won, 0),
         coalesce(c.lost, 0),
         round(c.won::numeric / nullif(c.won + c.lost, 0), 4),
         coalesce(c.sold, 0),
         round(c.days::numeric, 1),
         round(s.minutes::numeric, 0),
         (select count(*) from tasks t where t.assigned_to = r.id and t.status = 'open' and t.due_at < now())
  from reps r
  left join assigned a on a.rep = r.id
  left join closed   c on c.rep = r.id
  left join speed    s on s.rep = r.id
  order by 7 desc
$$;

-- 8.6 Lost reasons (deals lost in the period)
create or replace function report_lost_reasons(p_from date, p_to date)
returns table (reason lost_reason, deals bigint, value_cents bigint)
language sql stable security invoker as $$
  select o.lost_reason, count(*), coalesce(sum(o.estimated_value_cents),0)
  from opportunities o
  where o.stage = 'lost' and o.lost_reason <> 'duplicate' and biz_date(o.lost_at) between p_from and p_to
  group by 1 order by 2 desc
$$;
```

The Reports page shows 8.2–8.6 as tables with a date-range picker (This month, Last month, This quarter, Year to date, Custom) and simple CSS bar indicators. No chart library in v1.

---

## 9. Phased build plan

Fifteen phases. A phase is defined by its acceptance criteria, not by a session count: it may take more than one session (commit at checkpoints), but its scope never grows. Each ends deployed on a Vercel preview (backed by the staging Supabase project) and is merged to `main` when its acceptance criteria pass; merging applies its migrations to production.

**Rollout.** After Phase 5 the team runs a **lead intake pilot**: website and Google Ads leads arrive in the CRM, are worked in the pipeline, and existing open deals are imported. Scheduling, files, jobs, and estimates still happen the old way. **Full cutover** happens after Phase 10, when the whole lead → inspection → estimate → job flow works. Integrations come last.

**Gate that closes every phase** (referred to below as "the standard gate"):
```
pnpm lint && pnpm typecheck && pnpm test && pnpm build      # all exit 0
supabase db reset                                           # migrations apply cleanly from zero (local)
pnpm seed                                                   # dev seed succeeds (Phase 2 onward)
```
plus: `supabase db push` to the **staging** project succeeds; the phase's acceptance criteria checked by hand on the preview URL at 390px width and at desktop width; `docs/decisions.md` updated; branch merged; then `supabase db push` to **production**.

**Kickoff prompt preamble** (every prompt below begins with this; it is written once here):
> Read `CLAUDE.md` and `docs/spec.md` fully before writing code. You are implementing one phase of that spec. Do not change the schema, RLS policies, or lifecycle rules; if something in the spec cannot be implemented as written, stop and tell me. Work on a new branch named as given. Follow the phase's numbered steps in order, and finish by running the standard gate from spec §9 and reporting each acceptance criterion as pass or fail with evidence.

---

### Phase 0 — Repository reset and accounts

**Goal:** a clean repo containing the spec, and every external account started.

**Steps (agent)**
1. On branch `phase-00-reset`: `git rm -r` every file from the FastAPI prototype (the working tree already has them deleted; stage the deletions) and commit "Remove FastAPI prototype (kept in history)".
2. Create `docs/spec.md` with the full content of this plan, `CLAUDE.md` with the content of §10, and `docs/decisions.md` containing only a heading.
3. Add `.gitignore` for Node, Next.js, `.env*` (except `.env.example`), `supabase/.temp`, and `.vercel`.
4. Commit and merge to `main`.

**Steps (human, Dylan) — start now, they take calendar time**
- Supabase: create two projects, `piccard-crm` (production) and `piccard-crm-staging`, in the same region; disable public sign-ups on both. Production keys go in Vercel's Production environment, staging keys in Preview.
- Vercel: in the existing `piccard-crm` project set Framework Preset to Next.js and clear the old build settings; set the function region next to the database. Upgrade to Pro before the Phase 5 pilot (commercial use, sub-daily cron).
- Resend: create the account and add the DNS records to verify the sending domain.
- Google Cloud: create a project, enable the Calendar API, configure the OAuth consent screen (Internal if Workspace, otherwise publish to production), create a Web OAuth client.
- Intuit Developer: create an app, note the sandbox keys, and begin the production-key questionnaire.
- Answer or accept the defaults in §11.

**Acceptance:** `git ls-files` shows only `docs/spec.md`, `docs/decisions.md`, `CLAUDE.md`, `.gitignore`; `main` is pushed.

**Kickoff prompt:** *(preamble does not apply — the spec is not in the repo yet)* "Branch `phase-00-reset`. Stage the already-deleted prototype files and commit their removal. Write the approved plan file to `docs/spec.md` verbatim, extract its §10 into `CLAUDE.md`, create `docs/decisions.md`, add a Node/Next.js `.gitignore`, commit, and merge to `main`."

---

### Phase 1 — Scaffold, auth, app shell, first deploy

**Goal:** a deployed Next.js app where an invited user signs in and sees a role-appropriate empty shell.
**Tables:** `profiles`, `company_settings`. **Screens:** login, set-password, app shell, settings/profile, settings/users, settings/company.
**Migration:** `supabase/migrations/0001_foundation.sql`.

**Steps**
1. `pnpm create next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --yes`. Turn on `strict` and `noUncheckedIndexedAccess` in `tsconfig.json`. Add scripts: `typecheck` (`tsc --noEmit`), `test` (`vitest run`), `seed` (`tsx scripts/seed-dev.ts`), `db:types` (`supabase gen types typescript --local > src/types/database.ts`).
2. `pnpm dlx shadcn@latest init` (Radix base, CSS variables). Add components: button, input, label, textarea, select, dialog, sheet, dropdown-menu, tabs, badge, card, table, sonner, field, checkbox, skeleton, avatar, separator, tooltip, popover, calendar, command (`field` replaces the retired `form`). Replace the theme tokens with slate neutrals and a blue-600 primary (§5.7). Load Inter with `next/font`. Base text size 14px is set on `body`, not `html`, so rem-based sizes (and 44px tap targets) are unaffected.
3. Install: `@supabase/supabase-js @supabase/ssr zod react-hook-form @hookform/resolvers date-fns date-fns-tz libphonenumber-js lucide-react server-only`; dev: `vitest tsx @playwright/test`.
4. `supabase init`; in `supabase/config.toml` set `enable_signup = false`, the site URL, and invite/recovery email templates whose link is built from `{{ .RedirectTo }}` (not `{{ .SiteURL }}`), i.e. `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=invite`, where the app passes `redirectTo = <its own origin>/auth/confirm?next=/set-password`. This makes an invite sent from a preview deployment link back to that same deployment. Write `0001_foundation.sql`: both extensions; the `private` schema and the default-privilege revokes for functions **and** tables (§2.1, §2.10); **every enum in §2.1** (all of them, so later migrations never alter types); `private.set_updated_at`; `profiles`; `company_settings` with its seed row; `private.auth_role`, `private.is_admin`, `private.is_staff` from §3.2 with their grants; triggers `handle_new_user` and `guard_profile_privileges` from §2.9; RLS enable + the `profiles` and `company_settings` policies from §3.3; the §2.10 grants for these two tables.
5. `src/lib/env.ts` (zod-validated environment), `src/lib/supabase/{server,client,admin,proxy}.ts` following the current `@supabase/ssr` cookie pattern (`getAll`/`setAll`), and `src/proxy.ts` that refreshes the session and redirects unauthenticated requests to `/login` for everything except `/login`, `/set-password`, `/auth/*`, `/e/*`, `/api/webhooks/*`, `/api/cron/*`, `/api/public/*`.
6. `src/lib/auth.ts`: `getSessionProfile()` (cached per request with React `cache`) and `requireRole(...roles)` which redirects field users to `/today` and others to `/dashboard` when the role is not allowed, and signs out a deactivated user. `src/lib/result.ts`: `ActionResult<T>`, `ok()`, `fail()`. `src/lib/safe-redirect.ts`: `safeRedirectPath(next)` resolves `next` against a fixed origin, rejects anything containing `\` or control characters or resolving to another origin, and returns only path + query + hash; every `next`/redirect parameter goes through it (prevents `/\evil.com` open redirects).
7. Auth screens: `/login` (email + password, error states, "Forgot password" sending a reset email), `/auth/confirm` route exchanging `token_hash` + `type` (and a PKCE `code`, which Supabase's default email templates produce), `/set-password` (only for sessions that came from an invite or reset link; a password session must use Settings → Profile). Sign-out is a server action (POST); `GET /auth/signout` only ends the session of a deactivated user, so another site cannot log a user out with a link.
8. App shell per §5.1 and §5.7: sidebar on `md+`, bottom tabs below `md`, role-filtered nav items, user menu with Profile and Sign out. Create placeholder pages (title + `EmptyState`) for every nav route so navigation works.
9. Settings: `/settings/profile` (name, phone, change password — which requires the current password); `/settings/users` (admin: list, invite with name and role via `auth.admin.generateLink({type:'invite'})`, which creates the user without sending email; the app builds its own `/auth/confirm?token_hash=…&type=invite&next=/set-password` link and shows it to the admin to copy and send (Supabase's built-in email only reaches org members and its templates cannot be customized on the free tier; a branded invite email is added with Resend in Phase 5); then set the role on the profile with the service client; a per-user "Reset link" button does the same with `type:'recovery'`; change role, deactivate/reactivate — deactivation sets `is_active = false` **and** bans the auth user so sessions cannot refresh; admins cannot change or deactivate themselves); `/settings/company` (all `company_settings` fields, timezone select, logo upload deferred to Phase 7).
10. `scripts/seed-dev.ts`: with the service client against **local** Supabase, create `admin@test.local`, `sales@test.local`, `field@test.local` (password `Password123!`), and set their roles. Refuse to run when the URL is not localhost.
11. Tests: unit tests for `result.ts`, `env.ts`, and `safe-redirect.ts` (including `/\evil.com`, `//evil.com`, `https://evil.com`, encoded variants); `tests/rls/profiles.test.ts` proving a sales user cannot change their own role or `email`, an admin can change another user's role, a deactivated user can read only their own profile row, and `anon` cannot execute `private.auth_role()`.
12. Link the Vercel project; Production env vars point at the production Supabase project, Preview env vars at staging. Push migrations to staging (`supabase db push`) and deploy the branch preview. Set each project's Auth site URL and redirect allow-list, and its invite/recovery email templates (same content as `supabase/templates/`). In each project create the first admin: invite the owner from the Supabase dashboard, then `update public.profiles set role = 'admin' where email = '<owner email>'` in the SQL editor. Record all of this in `docs/decisions.md`. **Vercel Deployment Protection:** the project currently requires a Vercel login on every non-custom domain, including production's `.vercel.app` URL, which would block staff, webhooks, and the public estimate page. Set protection to preview deployments only (or attach the custom domain). On protected previews, test webhooks and `/e/*` with a protection-bypass token or locally. Add each project's redirect allow-list: production origin, `http://localhost:3000/**`, and for staging the team's preview pattern `https://*-<team-slug>.vercel.app/**`.

**Acceptance**
- Unauthenticated visit to `/dashboard` redirects to `/login`.
- Admin invites a user and copies the invitation link; the user opens it, sets a password, and lands on the right home (`/dashboard` or `/today`).
- Field user cannot open `/settings/users` (redirected). Sales user sees no Reports or Settings/Users nav item.
- Deactivated user is signed out on next request and cannot sign in.
- `/login?next=/\evil.com` and `/auth/confirm?…&next=//evil.com` land on an app page, never another site.
- Shell is usable at 390px with bottom tabs; no horizontal scroll.
- Standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-01-foundation`. Implement spec §9 Phase 1, steps 1–12. Schema comes from §2.1, §2.2, §2.9, §3.2, §3.3. Verify the current Next.js proxy/middleware file convention and the `@supabase/ssr` API against the installed packages before writing them."

---

### Phase 2 — Complete schema, triggers, RLS, seed

**Goal:** the entire database from §2 and §3 exists, is tested per role, and has realistic seed data. No UI.
**Tables:** all remaining 21. **Migrations:** `0002_schema.sql`, `0003_rls.sql`.

**Steps**
1. `0002_schema.sql`: tables in the order given in §2.8, copied from §2.2–§2.7 exactly, with a `set_updated_at` trigger on each table that has `updated_at`.
2. Same file: `private.field_can_access_opportunity`, `private.field_can_access_customer` (§3.2) and the triggers in §2.9: `fill_parent_ids`, `track_stage_change` + `log_stage_history`, `recalc_estimate_totals` (formula in §7.2), `lock_sent_estimate`, `note_activity`, `mark_calendar_pending` + `enqueue_calendar_sync`. All follow the §2.1 function conventions.
3. `0003_rls.sql`: every statement in §3.3, and every grant in §2.10 (table- and column-level) plus the ownership defaults.
4. Run `supabase db reset` and `pnpm db:types`; commit `src/types/database.ts`.
5. Extend `scripts/seed-dev.ts`: a second field user; 12 customers with properties (one customer with two properties); 20 opportunities spread over all stages with sources and owners; notes; tasks (some overdue); two inspections (one assigned to `field@test.local`); one estimate with four lines; one won deal with a job assigned to `field@test.local`. Insert with the service client in dependency order.
6. `tests/rls/` — one file per role, signing in as the seeded users:
   - **sales:** can select, insert, update customers, opportunities, estimates; cannot delete an opportunity; cannot insert an invoice; cannot update `company_settings`.
   - **field:** selecting `opportunities`, `estimates`, `invoices`, `activities` returns zero rows; sees exactly the customers, jobs, and appointments tied to their assignments; can insert a note on an assigned job and cannot insert one on an unassigned deal; sees a `photo` file but not an `estimate` file on an assigned deal; cannot update an appointment's `starts_at`.
   - **admin:** can delete an opportunity; can update settings.
   - **anon:** every table returns a permission error; executing any function in `public` fails.
   - **lifecycle bypass (column grants):** as sales, a direct `update opportunities set stage = 'won'` fails with `permission denied`; so do direct writes to `estimates.status`, `estimates.total_cents`, `jobs.status`, `appointments.starts_at`, `invoices.total_cents`, `files.storage_path`, `profiles.email`, and any insert into `activities`. As field, a direct `update tasks set due_at = …` on their own task fails.
   - **function privileges:** `authenticated` cannot execute a service-only RPC once Phase 3+ RPCs exist (add the assertion here as a reusable helper).
7. `tests/rls/triggers.test.ts`: `fill_parent_ids` fills ancestors from a job; stage change writes history and resets `stage_entered_at`; estimate totals match the §7.2 formula for a fixture with mixed taxable lines and a discount; editing a line on a `sent` estimate is rejected.

**Acceptance**
- `supabase db reset` applies all three migrations with no error; `pnpm seed` completes.
- Every RLS and trigger test passes.
- Consistency check performed and recorded in `docs/decisions.md`: every foreign key target exists; every policy references existing columns; `select tablename from pg_tables where schemaname='public' and not rowsecurity` returns zero rows; `select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','private') and (p.proconfig is null or not (p.proconfig @> array['search_path=""']))` returns zero rows.
- Standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-02-schema`. Implement spec §9 Phase 2, steps 1–7. Copy DDL from §2 and policies from §3.3 exactly; do not rename anything. The trigger behaviors are specified in §2.9 and the totals formula in §7.2."

---

### Phase 3 — Leads, customers, notes, tasks

**Goal:** staff can enter a lead by hand (with duplicate detection), work the leads inbox, open a customer, add notes, log calls, and manage follow-up tasks.
**Tables used:** customers, properties, opportunities, lead_sources, lead_submissions, notes, activities, tasks. **Migration:** `0004_lead_rpcs.sql`.
**Screens:** `/leads`, `/leads/new`, `/customers`, `/customers/[id]`, `/tasks`, `/settings/lead-sources`.

**Steps**
1. `0004_lead_rpcs.sql` — internal helpers (not granted to `authenticated`): `default_assignee(p_opportunity_id)` (owner, else first active admin by `created_at`); `create_auto_task(p_opportunity_id, p_job_id, p_auto_key, p_title, p_due_at)` with `on conflict do nothing`; `complete_auto_task(p_opportunity_id, p_auto_key)`; `check_stage_gate(p_opportunity_id, p_to_stage) returns text[]` (missing-field names per §4.1); `run_stage_entry_automation(p_opportunity_id, p_stage)`; `log_activity(...)`.
2. Same file: `create_lead(p jsonb)` per §6.5, `log_contact(...)` per §4.1, `assign_owner` and `set_task_status` per §4.6, each with its explicit `grant execute`. Regenerate types.
3. `src/lib/phone.ts` (`toE164`, `formatPhone`), `src/lib/money.ts` (`formatCents`, `parseDollarsToCents`), `src/lib/dates.ts` (format in company timezone, relative time). Unit tests for each.
4. `features/leads`: `schemas.ts` (zod `LeadInput`), `actions.ts` (`createLead`, `checkDuplicates`, `assignOwner`), `queries.ts`. Build `/leads/new` and `/leads` per §5.6. The duplicate panel on `/leads/new` offers "Use this customer" and, when that customer has open deals, "Add note to this deal" for each — the human makes the merge decision.
5. `features/customers`: list page with search (name trigram, phone, email, address) and pagination; detail page per §5.4 with the panels that have data so far: header, `DealSummaryCard`, Timeline, NoteComposer, TaskList, Properties, Contact details. Files and Appointments panels render an `EmptyState` placeholder. Implement `lib/deal-status.ts` with the full table from §5.4 and unit-test every row.
6. Shared components: `Timeline` (icon per `activity_type`), `NoteComposer`, `TaskList`, `LogContactDialog` (type, outcome, summary).
7. `features/tasks`: actions and `/tasks` page per §5.6.
8. `/settings/lead-sources`: add, deactivate, reorder; "Website" and "Google Ads" cannot be renamed.
9. Tests (`tests/rls/leads.test.ts`), using `channel = 'website'` unless noted: new lead creates customer + property + opportunity + `first_contact` task + `lead_received` activity; same phone and same address again merges (no new opportunity, `duplicate_inquiry` activity and task); same phone with a **different** address creates a second open deal with `possible_duplicate_of` set; same phone with no address when the customer has two open deals creates a new deal flagged as possible duplicate; same phone after the deal is lost creates a new opportunity on the same customer; `channel = 'manual'` never merges; `log_contact` with `no_answer` sets `first_contact_attempted_at`/`_by`, creates `retry_contact`, and leaves the stage; `log_contact` connected moves `new → contacted`, sets `first_contacted_at`, completes `first_contact`; a field user completes their own task with `set_task_status` and cannot cancel it.

**Acceptance**
- Creating a lead with a phone that already exists shows the duplicate panel before submit; choosing "Use this customer" attaches the new deal to the existing customer instead of creating a second customer.
- A new lead appears at the top of `/leads` with its age and a `first_contact` task; logging a connected call moves it to Contacted and the task disappears from `/tasks`.
- Customer detail shows the deal card with the correct derived status and a timeline in the right order.
- Everything on `/leads`, `/customers/[id]`, and `/tasks` is operable one-handed at 390px (tap-to-call works, FAB sheet opens).
- Standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-03-leads-customers`. Implement spec §9 Phase 3, steps 1–9. RPC behavior: §4.1, §4.6, §6.5. Screens: §5.4, §5.6. Server action conventions: §5.3."

---

### Phase 4 — Pipeline board, deal detail, Won and Lost

**Goal:** the Kanban board works on desktop and phone, enforces stage gates, and Won creates a job.
**Tables used:** opportunities, opportunity_stage_history, jobs, invoices (written by `mark_opportunity_won`), tasks, activities. **Migration:** `0005_pipeline_rpcs.sql`.
**Screens:** `/pipeline`, `/opportunities/[id]`.

**Steps**
1. `0005_pipeline_rpcs.sql`: `change_opportunity_stage`, `mark_opportunity_won` (all eleven steps of §4.2, including invoice creation per §7.5), `mark_opportunity_lost`, `reopen_opportunity` (§4.3). Regenerate types.
2. Install `@dnd-kit/core @dnd-kit/sortable`. `features/pipeline`: `queries.ts` (board query per §5.5), `actions.ts` (`moveStage`, `markWon`, `markLost`, `reopenDeal`).
3. Components: `Board` (desktop), `StageColumn`, `DealCard`, `MobileBoard` (stage chips + list + swipe), `MoveSheet`, `GateDialog`, `WonDialog`, `LostDialog`, board filters stored in the URL query string.
4. Next-step indicator on cards per §5.5, computed in the board query (earliest open task due, next appointment).
5. `/opportunities/[id]` per §5.4: stage stepper, Won/Lost buttons, editable deal fields (only the §2.10 granted columns), insurance section, owner reassignment (`assign_owner`), the "possible duplicate" banner from §6.5 (Keep both / Mark as duplicate), reused Timeline / TaskList / NoteComposer. Appointments, Estimates, and Files panels are placeholders.
6. Tests (`tests/rls/pipeline.test.ts`): moving to `qualified` without work type returns `missing_requirements` listing it; moving to `won` through `change_opportunity_stage` returns `use_dedicated_action`; `mark_opportunity_won` with an amount creates a job, sets `won_at`, `closed_owner_id`, and `closed_by`, cancels open auto tasks, creates the four job tasks; calling it twice returns the same job (`already:true`); with a seeded sent estimate at 30% deposit it creates deposit and final invoices whose totals and taxes sum exactly to the estimate; `mark_opportunity_lost` without a reason fails, with a reason cancels scheduled appointments and open tasks; reopen restores an open stage.
7. Playwright smoke `e2e/pipeline.spec.ts`: sign in as sales, create a lead, move it to Contacted, mark it Lost with a reason.

**Acceptance**
- Desktop: dragging a card between columns persists after reload; an invalid move reverts and opens the Gate dialog with only the missing fields; completing the dialog completes the move.
- Mobile (390px): stage chips with counts, swipe between stages, "Move" sheet works, no drag required.
- Won dialog creates a job (visible by direct SQL and as a link on the deal); Lost requires a reason.
- Column headers show correct counts and dollar sums; filters work and survive reload.
- Standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-04-pipeline`. Implement spec §9 Phase 4, steps 1–7. Lifecycle rules: §4.1–§4.3 and §4.6. Board and deal screen: §5.4, §5.5. Invoice split math: §7.5."

---

### Phase 5 — Lead ingestion, email, and the lead intake pilot

**Goal:** website and Google Ads leads arrive on their own, durably and deduplicated; the assignee is emailed; existing open deals are imported; the team starts a **lead intake pilot** (leads and pipeline only — scheduling, files, jobs, and estimates stay in the old process until Phase 10).
**Tables used:** lead_submissions, email_log, plus Phase 3 tables. **Migration:** `0006_ingestion.sql` (`process_lead_submission`, service-role grant).
**Routes:** `/api/webhooks/leads/website`, `/api/webhooks/leads/google-ads`, `/api/cron/process-outbox` (lead and email retries for now); Settings → Integrations (lead section).

**Steps**
1. Install `resend @react-email/components`. `src/lib/integrations/resend.ts`: `sendEmail` per §6.4 (pending → sent/failed, idempotency key = dedupe key, never throw, retry from stored props).
2. Email templates: `NewLeadEmail`, `DuplicateInquiryEmail`. Plain, with a button linking to the deal.
3. `features/leads/normalize.ts`: `normalizeWebsiteLead(body)` and `normalizeGoogleAdsLead(body)` returning `LeadInput` (§6.5). Unit tests with fixture payloads, including a Google payload using `FULL_NAME` only and one using `FIRST_NAME`/`LAST_NAME`.
4. The two route handlers following the six-step durability rule in §6.5 exactly: constant-time secret check, per-IP rate limit, parse, **store raw first** (503 if that fails), 200, then process in `after()`.
5. Retry path: `/api/cron/process-outbox` and `/api/cron/nightly` (TypeScript, shared helper `retryLeadSubmissions()`) re-normalize and re-run `process_lead_submission` for rows in `received` older than 2 minutes or `error` with `attempts < 5`, and retry failed emails. Callable by hand with `CRON_SECRET` until Vercel Pro is enabled.
6. Call `sendEmail` for new leads created manually too (from the `createLead` action).
7. `/settings/integrations`: a "Lead sources" card showing both webhook URLs, the Google Ads setup instructions (webhook URL + key), and **server-side** website setup instructions (forward from the website's backend, a WordPress form plugin's webhook, or Zapier/Make — never browser code containing the secret); a "Send test lead" button (server action); and a table of the last 20 submissions with status, error, and a Retry button.
8. **Import script** `scripts/import-csv.ts` (command line, no UI): reads a CSV of customers with optional property and open deal (stage, owner email, value, source), dry-run by default, `--commit` to write; each row goes through `create_lead` with `channel = 'import'` and `import_stage` (rules in §6.5: no auto-merge, gates bypassed, one review task, no emails); prints a summary of created / merged / skipped rows. Run against staging first, then production.
9. Tests: route handler tests for 401 on bad secret, 429 after 10 requests a minute, 503 when the store step fails (mock), 200 + `rejected` on honeypot, 200 + `created`, replay of the same `lead_id` creating nothing, a submission left in `received` being processed by the retry route, and an email that failed once being sent on retry exactly once.
10. Pilot checklist recorded in `docs/decisions.md`: Vercel Pro enabled; secrets set in Vercel; Resend domain verified; website backend forwarding configured; test lead sent to production; import run; real users invited.

**Acceptance**
- `curl` to the website webhook with the right secret creates a lead visible in `/leads` within seconds and the assignee receives the email; the wrong secret returns 401; an 11th request in a minute returns 429.
- With the database stopped, the webhook returns 503 (sender retries); after restart, a retried delivery creates exactly one lead.
- Posting the same Google `lead_id` twice creates one deal.
- A lead whose phone **and address** match an open deal adds a `duplicate_inquiry` entry on that deal and no new deal; the same phone with a different address creates a new deal with the possible-duplicate banner.
- No page or setting exposes `LEAD_WEBHOOK_SECRET` to a browser (search the built client bundles for it).
- The import script's dry run on the owner's CSV reports sensible counts; the committed run produces the expected customers and open deals.
- Standard gate passes. **Lead intake pilot starts: merge, import, invite the team, switch the website's backend to forward to the webhook.**

**Kickoff prompt:** "[preamble] Branch `phase-05-lead-ingestion`. Implement spec §9 Phase 5, steps 1–10. Payload formats, the durability rule, dedupe rules, and response codes: §6.5. Email mechanics: §6.4."

---

### Phase 6 — Appointments, calendar, Today screen, task digest

**Goal:** inspections and other visits are scheduled in the CRM, shown on a calendar, and field users have a phone home screen.
**Tables used:** appointments, tasks, activities. **Migration:** `0007_appointment_rpcs.sql`.
**Screens:** `/calendar`, `/today`, Appointments panel on deal and customer screens; cron `task-digest`.

**Steps**
1. `0007_appointment_rpcs.sql`: `schedule_appointment`, `reschedule_appointment`, `cancel_appointment`, `complete_appointment` per §4.6 and the event table in §4.1 (auto-move to `inspection_scheduled`, `send_estimate` task on completion, fallback to `qualified` on cancel/no-show), each with its explicit grant.
2. `features/appointments`: schemas, actions (`scheduleAppointment`, `rescheduleAppointment`, `cancelAppointment`, `completeAppointment`), queries by date range and assignee.
3. `ScheduleAppointmentDialog`: type, date, start time, duration (default 60 min for inspection), assignee (default deal owner), notes. Times are entered and shown in the company timezone. Used from the deal page, the customer page, the calendar, and the pipeline's drop on `inspection_scheduled` (wire that Phase 4 placeholder).
4. `/calendar` per §5.6: agenda on mobile; week and month CSS-grid views on desktop; assignee and type filters; drag to reschedule on desktop.
5. `/today` per §5.6 for field users, reading only tables the field role can read (§3.1).
6. Email template `InspectionConfirmationEmail`; send after schedule and reschedule when the setting is on and the customer has an email.
7. `/api/cron/task-digest` + `TaskDigestEmail`; add the cron entries for this route to the Vercel config. Guard with `CRON_SECRET`.
8. Tests: scheduling an inspection on a `qualified` deal moves it to `inspection_scheduled` and completes `schedule_inspection`; scheduling on a `new` deal without owner returns `missing_requirements` and inserts nothing; a field user can complete their own appointment and cannot complete someone else's, cannot call `cancel_appointment` or `reschedule_appointment`, and cannot update `starts_at` directly; rescheduling logs `appointment_rescheduled`; completion creates `send_estimate`; cancelling the only inspection moves the deal back to `qualified`.

**Acceptance**
- An inspection scheduled from the deal page appears on `/calendar`, on the customer's deal card ("Inspection: Oct 7, 10:00 AM"), and on the assigned field user's `/today`.
- The field user marks it complete from their phone; the deal owner gets a `send_estimate` task.
- Signed in as field, `/pipeline` and `/leads` redirect to `/today`.
- Calling the digest route with the cron secret emails a user who has an overdue task exactly once per day.
- Standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-06-appointments`. Implement spec §9 Phase 6, steps 1–8. Rules: §4.1 event table, §4.6. Screens: §5.6. Field access limits: §3.1."

---

### Phase 7 — Files and photos

**Goal:** photos and documents are uploaded from inside a deal, job, or appointment — fast on a phone — and always land on the right record.
**Tables used:** files, activities. **Migration:** `0008_files.sql`.
**Screens:** Files panel on customer, deal, and (later) job screens; "Add photos" on `/today` cards.

**Steps**
1. `0008_files.sql`: create the private bucket `crm-files` (25 MB limit, no object policies) and `register_files(p jsonb)` per §4.6.
2. `features/files/actions.ts`: `createUploadUrls({opportunityId | customerId, appointmentId?, files:[{name,type,size}]})` → checks access per §3.4, generates ids and paths, returns signed upload URLs; `registerFiles`; `getSignedUrls(fileIds)`; `updateFile`; `deleteFile` (admin; removes the object then the row).
3. Install `browser-image-compression`. `FileUploader`: accepts camera and library (`accept="image/*,application/pdf"`, `multiple`); compresses images to max 2000px / quality 0.8 in the browser; uploads directly to the signed URLs, three at a time; per-file progress; automatic retry three times with backoff; failed files stay listed with a Retry button; warns before navigating away while uploads are in flight.
4. The uploader **always** receives a target from its context (deal, job, or appointment). On the customer screen with several deals it requires choosing the deal first. There is no global upload entry point.
5. A category picker defaults to `photo` for images and `other` for PDFs; staff can recategorize afterwards.
6. `FileGrid`: grouped by category per §5.4; image thumbnails use Supabase image transformation on signed URLs when available, otherwise the full image with CSS sizing; lightbox with swipe; PDFs open in a new tab.
7. Wire the Files panels on the customer and deal pages and the "Add photos" button on `/today` (passes `appointment_id`). Add company logo upload to `/settings/company`.
8. Tests: a field user gets upload URLs for an assigned deal and is refused for an unassigned one; `register_files` with five files creates five rows and exactly one `files_uploaded` activity; a field user cannot get a signed URL for an `estimate` file.

**Acceptance**
- From a phone, a field user opens today's appointment, takes or selects 10 photos, and all appear under that deal's Photos within one flow; the timeline shows a single "10 photos uploaded" entry.
- Killing the connection mid-upload leaves failed files with a working Retry.
- A sales user uploads a PDF as Measurement Report and it shows in that group on the customer screen.
- Standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-07-files`. Implement spec §9 Phase 7, steps 1–8. Storage model: §3.4. File access by role: §3.1 and the `files` policies in §3.3."

---

### Phase 8 — Jobs

**Goal:** won deals are managed as jobs: scheduled, crewed, tracked to completion.
**Tables used:** jobs, job_assignments, appointments, tasks, files, notes. **Migration:** `0009_job_rpcs.sql`.
**Screens:** `/jobs`, `/jobs/[id]`, "My jobs" on `/today`.

**Steps**
1. `0009_job_rpcs.sql`: `schedule_job` and `set_job_status` per §4.5 and §4.6, with grants.
2. `features/jobs`: queries (list with status filter and search; detail), actions (`updateJob`, `setJobStatus`, `assignUsers`).
3. `/jobs`: table on desktop, cards on mobile; columns job number, customer, address, type, status, scheduled dates, crew.
4. `/jobs/[id]` per §5.6. Staff see contract amount (from the opportunity), Timeline, and an Invoices panel listing the draft invoices created at Won (read-only here; due dates, regenerate, and sending arrive in Phase 13). Field users see Scope, Schedule, Crew, Permit, Files, Notes, and the status control limited to Start and Complete.
5. Scheduling: a "Schedule job" sheet (date range, work days, crew) calls `schedule_job`, which in one transaction sets dates, creates all-day `job_work` appointments for the selected assignees, upserts assignments, and moves the job to `scheduled`.
6. Completion flow on mobile: "Complete job" opens a sheet prompting for completion photos (uploader) and a note, then calls `set_job_status`.
7. Wire the "Open job" link on the won deal, and "My jobs" on `/today`.
8. Tests: an assigned field user can set `in_progress` and `completed` and cannot set `cancelled`; an unassigned field user cannot read the job; completion sets `warranty_expires_on` and creates `final_invoice` and `completion_photos` tasks; cancelling cancels future work-day appointments.

**Acceptance**
- A deal marked Won appears in `/jobs` as Pending schedule with a price-free scope summary.
- Staff schedule it and assign the field user; it appears on that user's `/today` and calendar; the field user never sees a dollar amount anywhere (verify by inspecting network responses).
- Completing the job from a phone sets the warranty date and creates the admin's final-invoice task.
- Standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-08-jobs`. Implement spec §9 Phase 8, steps 1–8. Lifecycle: §4.5. Screen: §5.6. Field visibility: §3.1."

---

### Phase 9 — Estimate builder and PDF

**Goal:** staff build an estimate from the price book and download a professional PDF.
**Tables used:** price_book_items, estimates, estimate_line_items. **Migration:** `0010_estimate_rpcs.sql` (`create_estimate`, `save_estimate_lines`, `void_estimate`).
**Decision gate (before starting):** the owner has confirmed in writing (recorded in `docs/decisions.md`) the tax rule and rate, deposit percent, estimate validity, warranty length, estimate terms text, and how pricing works today (§11 questions 1–4). Do not start the phase on defaults.
**Screens:** `/settings/price-book`, Estimates panel on the deal, `/opportunities/[id]/estimates/[estimateId]`.

**Steps**
1. `/settings/price-book`: CRUD table (name, description, unit, price, taxable, active).
2. `0010_estimate_rpcs.sql` with `create_estimate` (copies tax rate, deposit percent, terms, valid-until from settings; title defaults to the deal title; logs `estimate_created`) , `save_estimate_lines`, and `void_estimate`. `features/estimates`: `createEstimate`, `updateEstimate` (granted columns only), `saveEstimateLines`, `voidEstimate`; queries.
3. `features/estimates/totals.ts` implementing §7.2, with a unit test over fixtures and an integration test asserting the same fixtures produce the same numbers from the database trigger.
4. Builder page: header fields; line list with add-from-price-book (searchable `Command` popover) and add-custom; inline edit of quantity and price; reorder with up/down buttons; live totals panel; read-only rendering when status is not `draft`. On mobile each line is a card and the totals bar is sticky at the bottom.
5. Install `@react-pdf/renderer`. `EstimateDocument.tsx` per §7.3 and `GET /api/estimates/[id]/pdf` (staff only, Node runtime). Display numbers as `E-1001` / `E-1001-v2`.
6. Estimates panel on the deal page: list of versions with status badges, "New estimate", "Preview PDF".

**Acceptance**
- An estimate with five lines (mixed taxable), a discount, and a non-zero tax rate shows identical totals in the builder, the stored row, and the PDF.
- The PDF shows logo, license number, customer and property, lines, totals, deposit, terms, and signature block, and fits cleanly on letter pages.
- Changing a price-book price does not change an existing estimate.
- Standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-09-estimates`. Implement spec §9 Phase 9, steps 1–7. Model, math, and PDF: §7.1–§7.3."

---

### Phase 10 — Sending, public acceptance, nightly maintenance

**Goal:** an estimate is emailed, viewed, and accepted online; acceptance wins the deal and creates the job. Stale deals and expired estimates are caught nightly.
**Tables used:** estimates, files, email_log, opportunities, jobs, invoices, tasks. **Migration:** `0011_estimate_lifecycle.sql`.
**Screens:** `/e/[token]`; send / revise controls in the builder.

**Steps**
1. `0011_estimate_lifecycle.sql`: `mark_estimate_sent`, `revise_estimate`, `record_estimate_view`, `accept_estimate`, `decline_estimate` (§7.4, §4.1 events), and `run_nightly_maintenance` (§4.1 expiry, §4.4 invariant). Public RPCs are executable by `service_role` only.
2. `sendEstimate` action following the exact order in §7.4. `EstimateEmail` template with the public link. "Resend email" and "Copy link" controls.
3. `/e/[token]` per §7.4 using the service client; rendering never changes status; a client script posts to `POST /api/public/estimates/[token]/view` after 2 seconds visible; server actions `acceptEstimate` and `declineEstimate` (no rate limit: they require an unguessable 122-bit token and are idempotent state changes); states for void, expired, accepted, declined; "approve" wording. `GET /api/public/estimates/[token]/pdf` redirecting to a 5-minute signed URL of `pdf_path`. `Cache-Control: no-store` and `X-Robots-Tag: noindex` on every `/e/*` and `/api/public/*` response.
4. Notification emails to the deal owner on accept and decline; "Deal won" email to admins.
5. `/api/cron/nightly` calling `run_nightly_maintenance()`, then `retryLeadSubmissions()` and `retryEmails()`; add its cron entry.
6. Wire the pipeline's Won dialog to list the deal's sent estimates.
7. Tests: sending moves the deal to `estimate_sent`, sets `estimated_value_cents`, creates the PDF `files` row and the follow-up task; sending a revision voids the previous version and moves the deal to `negotiation`; accepting by token sets name and IP, wins the deal, creates the job and the invoices, and voids other estimates; accepting twice is a no-op; a void token cannot be accepted; a server-side GET of `/e/[token]` (no script execution) leaves the estimate `sent`; nightly expires a past-due estimate and creates a `stale_deal` task for an open deal with no next step.
8. Playwright `e2e/estimate.spec.ts`: build, send, open the public link in a fresh context, accept, and assert the job exists.

**Acceptance**
- The customer email arrives with a working link; `curl` of the link leaves the estimate Sent; opening it in a browser flips it to Viewed; the customer screen shows "Status: Awaiting Signature".
- Accepting on a phone shows a confirmation; the deal is Won, a job exists, deposit and final draft invoices exist, and the owner is emailed.
- The benchmark block in the original brief renders correctly for this deal on `/customers/[id]`.
- Standard gate passes. **Full cutover: the whole lead → inspection → estimate → job flow moves into the CRM; the old process is retired.**

**Kickoff prompt:** "[preamble] Branch `phase-10-estimate-acceptance`. Implement spec §9 Phase 10, steps 1–8. Lifecycle: §7.4. Won conversion: §4.2. Invoice creation: §7.5. Invariant: §4.4."

---

### Phase 11 — Dashboard and reports

**Goal:** the owner sees unambiguous numbers.
**Migration:** `0012_reports.sql`. **Screens:** `/dashboard`, `/reports`.

**Steps**
1. `0012_reports.sql`: every function in §8, following the §2.1 function conventions, with `grant execute … to authenticated`.
2. `/dashboard`: date-range selector (default This month); tiles New leads, Revenue (sold) with Invoiced and Outstanding beneath, Conversion rate, Active jobs, Upcoming appointments, Pipeline value; below, "Needs attention" (unassigned leads, overdue tasks, deals with no next step) and the next seven days of appointments. Admin sees company numbers; sales calls the function with `p_owner = self`.
3. `/reports` (admin): the five tables from §8.2–§8.6 with the range picker and CSV download per table.
4. Tests: seed a fixed dataset and assert exact values from each function, including that a `duplicate`-lost deal is excluded, that a deal won at 23:30 company time on the last day of a month counts in that month, that a deal reassigned after it was won still counts for its `closed_owner_id`, and that speed-to-lead uses the first attempt (a no-answer call), not the first connection.

**Acceptance**
- Dashboard numbers equal hand-computed values from the seed data.
- Each tile's label matches the definitions in §8.
- A sales user sees only their own figures and cannot open `/reports`.
- Standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-11-reporting`. Implement spec §9 Phase 11, steps 1–4. SQL and metric definitions: §8, copied exactly."

---

### Phase 12 — Google Calendar sync

**Goal:** every CRM appointment appears on the company Google calendar and stays correct.
**Tables used:** integration_connections, sync_outbox, appointments. **Migration:** `0013_outbox_rpcs.sql`.
**Decision gate (before starting):** the owner has confirmed (in `docs/decisions.md`) which Google account connects, whether it is Google Workspace (Internal consent screen) or Gmail (published app), and who needs events on their calendar (§11 question 8). OAuth redirect URIs are registered for production and `http://localhost:3000` (§1.5).

**Steps**
1. `0013_outbox_rpcs.sql`: `claim_outbox_batch`, `complete_outbox`, `fail_outbox`, and `lock_integration(provider)` (advisory lock) per §6.1; service role only.
2. `lib/integrations/crypto.ts` (AES-256-GCM encrypt/decrypt, unit-tested round trip) and `lib/integrations/outbox.ts` (worker loop with a per-provider handler map).
3. Connect and callback routes per §6.1 and §6.2; on first connect create the secondary calendar and store its id. Disconnect action.
4. `lib/integrations/google-calendar.ts` using `fetch` against the REST API (no SDK): `getValidAccessToken`, `upsertEvent(appointment)`, `deleteEvent(appointment)` with the deterministic event id and the 409 → patch rule; error mapping per §6.2.
5. `/api/cron/process-outbox`; call `after(() => processOutbox())` in the appointment actions; extend `/api/cron/nightly` with the 60-day re-assert.
6. Settings → Integrations: Google card (status, connected account, calendar name, Connect / Disconnect, the Testing-status warning from §6.2), and the "Sync issues" table with Retry. "Backfill" button enqueuing all future scheduled appointments.
7. A small sync-state icon on appointment rows (synced, pending, error with tooltip).
8. Tests with `fetch` mocked: insert → 200 stores `google_event_id`; insert → 409 falls back to patch; delete → 404 counts as success; 500 schedules a retry with backoff; eight failures mark the row `failed` and set `google_sync_error`; ten rapid edits leave one pending outbox row.

**Acceptance**
- After connecting, scheduling an inspection creates a Google event within about a minute, with address, CRM link, and the assignee as attendee.
- Rescheduling moves the event; cancelling removes it; no duplicates after repeated edits.
- Deleting the event in Google and running the nightly route restores it.
- With the connection revoked, appointments still save, an admin banner appears, and reconnecting drains the backlog.
- Standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-12-google-calendar`. Implement spec §9 Phase 12, steps 1–8. Shared mechanics: §6.1. Google rules: §6.2. Use the REST API with `fetch`; do not add the googleapis SDK."

---

### Phase 13 — Invoices and QuickBooks

**Goal:** an admin sends an invoice to QuickBooks with one click and sees payment status in the CRM.
**Tables used:** invoices, invoice_line_items, customers, integration_connections, sync_outbox. **Migration:** `0014_invoice_rpcs.sql` (`regenerate_job_invoices`, `void_invoice`, `queue_invoice_sync`, `record_invoice_manually`). If any other schema change seems needed, stop and report.
**Decision gate (before starting):** the owner and their accountant have confirmed (in `docs/decisions.md`) QuickBooks Online edition, the income item, whether sales tax is charged and how QuickBooks tax is configured, and that admins send invoices by hand (§11 questions 1, 9, 10).
**Time box:** two sessions. If exceeded, apply the fallback in §6.6 item 7.

**Steps**
1. `0014_invoice_rpcs.sql`. Invoices panel on `/jobs/[id]` (staff): list with status and sync badges; admin can change a draft's due date, regenerate drafts from the estimate, and void a draft. Amounts are never edited by hand (§7.5).
2. Connect and callback routes for Intuit; store `realmId` and environment. Configuration step: fetch Items and TaxCodes and save the chosen ids in `config`.
3. `lib/integrations/quickbooks.ts` with `fetch`: token refresh under `lock_integration` persisting the rotated refresh token; `findOrCreateCustomer`; `createInvoice` with `requestid`; total check; error mapping per §6.3.
4. `sendInvoiceToQuickBooks` action (admin): validate the connection and config, call `queue_invoice_sync`, process in `after()`.
5. Register the `invoice` handler in the outbox worker. `/api/cron/qbo-payments` per §6.3 with its cron entry.
6. Settings → Integrations: QuickBooks card (status, company name, environment, item and tax code pickers, Connect / Disconnect); QuickBooks failures appear in "Sync issues".
7. Manual fallback controls on an invoice when QuickBooks is not connected: "Mark sent", "Record payment amount" (both → `record_invoice_manually`).
8. Tests with `fetch` mocked: customer found by email is linked, not created; duplicate-name error retries with the address suffix; invoice create stores ids and flips status to `sent`; a second worker run does not create a second invoice; payment poll moves `sent → partially_paid → paid` and writes one `payment_received` activity per increase; token refresh saves the new refresh token; `invalid_grant` marks the connection `error`.
9. Manual test against the Intuit **sandbox** company, recorded in `docs/decisions.md`.

**Acceptance**
- In the sandbox, sending the deposit invoice creates the customer and the invoice in QuickBooks with the right amount; the CRM shows the QuickBooks number and "Synced".
- Recording a payment in QuickBooks and running the payments route marks the invoice Paid and updates the dashboard's Outstanding figure.
- Clicking Send twice, or a retry after a timeout, never creates two invoices.
- Sales users see invoices read-only; field users see none.
- Standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-13-quickbooks`. Implement spec §9 Phase 13, steps 1–9. Rules: §6.1, §6.3, §6.6, §7.5. Use `fetch`; no Intuit SDK. Respect the two-session time box and the fallback."

---

### Phase 14 — Hardening, import, launch

**Goal:** safe to rely on daily.

**Steps**
1. Import UI (admin, Settings) on top of the Phase 5 import script: upload a CSV, map columns, dry-run preview, commit. Same `create_lead` path and rules as the script.
2. Global search in the header (customers by name, phone, email, address; jobs by number).
3. `error.tsx`, `not-found.tsx`, and `loading.tsx` skeletons for every route group; toast on every failed action.
4. Accessibility and mobile pass on every field-facing screen: 44px targets, focus states, labels, no horizontal scroll at 360px.
5. Security pass: confirm the service client is imported only in the allowed places (§1.5); confirm no table lacks RLS; re-run the Phase 2 privilege checks (no `security definer` function without `search_path=''`, no function executable by `anon`, no lifecycle column writable by `authenticated`); confirm webhooks and cron routes reject missing secrets and rate limits are in force; run the Supabase security advisor and resolve every finding.
6. Performance: confirm the board and customer queries use the indexes in §2 (`explain analyze` on seed data ×50).
7. Playwright suite covering: sign-in per role; lead → contacted → inspection → estimate → accept → job → complete.
8. Operations notes in `docs/runbook.md`: rotating secrets, reconnecting integrations, restoring from Supabase backups, adding a user.

**Acceptance:** the full Playwright flow passes against a preview deployment; the security checks in step 5 are listed with results; the owner has imported existing customers; standard gate passes.

**Kickoff prompt:** "[preamble] Branch `phase-14-hardening`. Implement spec §9 Phase 14, steps 1–8."

---

## 10. Project memory file (`CLAUDE.md`)

````markdown
# Piccard Roofing CRM

Single-company CRM for a roofing and renovation business: lead → call → inspection → estimate → won/lost → job.
The full specification is `docs/spec.md`. It is the source of truth. Read the sections relevant to your task before coding.
Decisions made where the spec was silent are logged, one line each, in `docs/decisions.md`.

## Stack
- Next.js App Router, TypeScript strict, Tailwind v4, shadcn/ui, deployed on Vercel (Node runtime only; never Edge).
- Supabase: Postgres, Auth (invite-only email + password), Storage (private bucket `crm-files`). Two projects: `piccard-crm` (production, Vercel Production env) and `piccard-crm-staging` (Vercel Preview env). Local dev uses `supabase start`.
- supabase-js with generated types. No ORM. pnpm.
- Resend + React Email, @react-pdf/renderer, @dnd-kit, zod, react-hook-form, date-fns(-tz), libphonenumber-js.
- Tests: Vitest (unit + RLS integration against local Supabase), Playwright (e2e smoke).

## Commands
- `supabase start` / `supabase db reset` — local database; reset re-applies all migrations.
- `pnpm seed` — dev users and sample data (local only). Users: admin@test.local, sales@test.local, field@test.local / Password123!
- `pnpm db:types` — regenerate `src/types/database.ts` after every migration. Never edit that file by hand.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — must pass before a phase is done.
- `supabase db push` — apply migrations to the linked remote project: staging from a phase branch, production only after merge to `main`.

## Non-negotiable rules
1. **Do not change the schema, RLS policies, or lifecycle rules** defined in `docs/spec.md` §2–§4. If they cannot be implemented as written, stop and ask.
2. **Migrations are append-only.** New numbered file in `supabase/migrations/`; never edit an applied migration.
3. **The database is the authorization layer.** Every table has RLS enabled (which rows), column-level grants (which columns, spec §2.10), and lifecycle columns are writable only through RPCs. Use the user-scoped client (`lib/supabase/server.ts`) for all user-initiated reads and writes. A direct write that hits `permission denied` means you need the RPC, not a broader grant.
4. **The service-role client (`lib/supabase/admin.ts`) is allowed only in:** webhook routes, cron routes, integration workers, the public estimate page and its actions, storage URL signing, user administration (invite, deactivate), and admin-gated integration settings (connection status, disconnect, retry). It imports `server-only`.
5. **Multi-step writes are Postgres RPCs**, never several sequential supabase-js calls. A server action validates with zod, calls one RPC (or one simple write), revalidates, and returns `ActionResult<T>`.
6. **RPCs return `{ok:false, code, …}` for business-rule failures** and raise only for authorization failures. Function rules (spec §2.1): helpers and triggers in schema `private`, callable RPCs in `public`; every function has `set search_path = ''` and schema-qualifies every name; every `security definer` RPC begins with an authorization guard; execute is default-denied, so each RPC is followed by an explicit `grant execute … to authenticated` (or `service_role`).
7. **Money is integer cents** in columns ending `_cents`. Format only at the edge with `lib/money.ts`. Never use floats for money.
8. **Timestamps are `timestamptz` in UTC.** Display and date-bucketing use the company timezone from `company_settings.timezone` via `lib/dates.ts`.
9. **Estimate totals are computed by the database trigger.** TypeScript totals are a preview only and must match `features/estimates/totals.ts` tests.
10. **A lead is an opportunity** in stage `new` or `contacted`. There is no leads table. All lead creation goes through `create_lead` so dedupe always runs.
11. **Follow-ups are tasks.** Never add a "next follow-up" column. Automatic tasks carry an `auto_key` and are created with `on conflict do nothing`.
12. **Attachments populate every ancestor id** (`customer_id`, `opportunity_id`, `job_id`); the `fill_parent_ids` trigger does this. Pass only the most specific id.
13. **Activity summaries never contain dollar amounts.** Put amounts in `metadata`.
14. **Field users must never receive prices.** They have no access to opportunities, estimates, invoices, or activities. Field screens read only jobs, appointments, customers, properties, notes, files, tasks.
15. **Files are uploaded only from inside a record** (deal, job, appointment). The server generates storage paths. All storage access is by server-signed URL; there are no storage policies.
16. **External calls go through the outbox** (`sync_outbox`) and must be idempotent: Google event id = appointment UUID without dashes; QuickBooks create uses `requestid` = invoice id; emails use `email_log.dedupe_key` and only status `sent` suppresses a retry.
17. **Integration failures never fail a user action.** Save first, sync after. Webhooks store the raw payload before answering 200, and answer 5xx if they cannot store it.
18. **Stages `won` and `lost` are reached only through `mark_opportunity_won` / `mark_opportunity_lost`.**
19. **Secrets never reach the browser.** Webhook secrets are server-to-server only. Every redirect target from user input goes through `lib/safe-redirect.ts`.
20. **Lead dedupe is conservative.** Deliveries dedupe by `external_id`; deals merge only on customer + property (spec §6.5); manual entry never auto-merges.

## Schema summary
- `profiles` (role: admin | sales | field), `company_settings` (singleton), `lead_sources`
- `customers` 1─N `properties`
- `opportunities` (customer + property; stage; owner; source; value; insurance fields; won/lost fields; first-contact attempt/connection; `closed_owner_id` for reporting), `opportunity_stage_history`, `lead_submissions` (raw payload stored first; status received → created / merged_duplicate / rejected / error)
- `estimates` (per opportunity; number + version; one accepted) 1─N `estimate_line_items`; `price_book_items`
- `jobs` (one per won opportunity; no money columns) N─N `profiles` via `job_assignments`
- `appointments` (always has opportunity_id; job_id for work days; Google sync columns)
- `invoices` (per job; deposit | final only; amounts generated from the accepted estimate, never hand-edited; QuickBooks sync columns) 1─N `invoice_line_items`
- `notes`, `files`, `activities` (append-only), `tasks` — each with customer_id / opportunity_id / job_id
- `integration_connections`, `sync_outbox`, `email_log` (pending / sent / failed) — service role only

Stages: new → contacted → qualified → inspection_scheduled → estimate_sent → negotiation → won | lost.

## Code conventions
- Routes in `src/app` compose components and call `features/<domain>/queries.ts`. Mutations live in `features/<domain>/actions.ts`; zod schemas in `schemas.ts`.
- Shared UI in `components/shared`; shadcn primitives in `components/ui` (do not hand-edit).
- Server Components by default; add `"use client"` only for interactivity.
- Route `params` and `searchParams` are async in current Next.js; await them.
- Check installed package docs or types before using a framework API; do not rely on memory.
- No new dependencies beyond those named in the spec without recording the reason in `docs/decisions.md`.
- No Realtime subscriptions, no chart library, no calendar library, no Google or Intuit SDKs in v1.

## UI rules
- Slate and white, Inter, one accent (blue-600) for primary actions and the current stage. Green, red, amber only for status.
- Dense: 14px base text, 40px rows, 12px card padding, 6px radius, borders instead of shadows.
- Every screen must work at 390px. Field-facing screens: 44px minimum targets, primary actions in thumb reach, no drag-only interactions.
- Phone numbers are `tel:` links; addresses offer Navigate.

## Definition of done for any phase
All acceptance criteria in `docs/spec.md` §9 for that phase pass, the standard gate passes, new behavior has tests (including a privilege test for every new RPC and every newly granted column), `docs/decisions.md` is updated, and the work is deployed to a Vercel preview backed by staging. A phase may span several sessions; commit at checkpoints, never widen its scope.
````

---

## 11. Open questions for the business owner

Each has a default so development can proceed, but defaults are for building, not for launching. **Decision gates:** questions 1–4 must be answered by the owner before Phase 9 starts; questions 8, 9, and 10 before Phases 12 and 13; question 15 before the Phase 5 pilot; question 16 before Phase 10. Record each answer in `docs/decisions.md`. Changing an answer later is a settings change unless marked **(schema)**.

| # | Question | Default assumed |
|---|---|---|
| 1 | Is sales tax charged to customers on roofing work, and at what rate? Rules differ by state; many treat installed roofing as a real-property improvement with no tax to the customer. | Tax rate 0. The per-estimate rate and per-line taxable flag exist if needed. Confirm with the accountant before turning it on, especially for the QuickBooks push. |
| 2 | How are estimates priced today: per square, itemized materials and labor, or a lump sum? | Itemized lines from a price book, with per-square (`sq`) as the common unit. A lump sum is one line. |
| 3 | Is a deposit taken on signing, and what percent? | 30%, editable per estimate. |
| 4 | What are the standard estimate terms, validity period, and warranty length? | Empty terms text, 30 days, 5 years. |
| 5 | Should sales reps see each other's deals? | Yes, all staff see and can edit all deals. Restricting this is a policy change, not a schema change. |
| 6 | Who performs inspections: sales reps or separate field staff? | Either; the assignee defaults to the deal owner. |
| 7 | Who gets new leads by default, and is there a rotation? | One default owner in settings; otherwise unassigned and visible to all. Round-robin is deferred. |
| 8 | Does the company use Google Workspace, and who needs events on their calendar? | Unknown. One admin connects; assignees are added as attendees by their profile email. Workspace allows an Internal OAuth app, which avoids token expiry. |
| 9 | QuickBooks Online (not Desktop)? Which income item should invoices post to? Is Automated Sales Tax on? | QuickBooks Online, a single item named "Roofing Services", tax off. QuickBooks Desktop is not supported. |
| 10 | Should deposit invoices go to QuickBooks automatically on Won? | No. An admin clicks Send to QuickBooks. |
| 11 | What share of jobs are insurance claims, and is supplement tracking needed? | A minority. Carrier, claim number, adjuster, and deductible are captured; supplements are deferred. |
| 12 | Which lost reasons matter to the owner? | The eight in the `lost_reason` enum. Adding one is a one-line migration **(schema)**. |
| 13 | What is the business timezone and are there multiple service areas? | `America/New_York`, one area. |
| 14 | What platform is the website on, and does it have a backend (or form plugin) that can forward submissions server-side? | Yes (it is the company's own site). The secret is used only server-side; if the site has no backend, a Zapier or Make step forwards to the webhook. |
| 15 | Is there existing data to import (the Pipedrive account or spreadsheets)? | A command-line CSV import of active customers, properties, and open deals runs as part of the Phase 5 pilot; the import UI comes in Phase 14. No historical activity import. |
| 16 | What written contract does the business use, and is online **estimate approval** plus a separately signed contract acceptable? | Online approval (typed name, timestamp, IP) approves the estimate only; the signed contract is still collected and uploaded (the `collect_contract` task). A dedicated e-sign provider is deferred. Check state home-improvement contract rules. |
| 17 | Should customers get an automatic inspection confirmation email? | Yes, toggle in settings. Reminder emails and SMS are deferred. |
| 18 | Which work types are sold? | Roof replacement, roof repair, renovation, gutters, siding, other. Changing the list is a migration **(schema)**. |

---

## 12. Consistency check (performed on this document)

- **Foreign keys:** every reference in §2 targets a table defined earlier in the §2.8 creation order. `jobs.accepted_estimate_id → estimates`, `files.appointment_id → appointments`, and the composite `(property_id, customer_id) → properties (id, customer_id)` are all satisfied by that order. Attachment tables are created after `jobs`.
- **Stage transitions have their data:** G1 uses `opportunities.owner_id`; G2 uses `work_type`, `property_id`, and `customers.phone` / `email`; the inspection gate reads `appointments`; the estimate gates read `estimates.status`; Won needs `property_id` (guaranteed by G2) to satisfy `jobs.property_id not null`, and sets `won_at` and `amount_cents` to satisfy `won_fields`; Lost sets `lost_at` and `lost_reason` to satisfy `lost_fields`.
- **Roles can do what their screens need:**
  - Field `/today` and job screens read `appointments` (own), `jobs` (assigned), `customers` and `properties` (via `private.field_can_access_customer`), `notes` and `files` (via `private.field_can_access_opportunity`), `tasks` (own), `profiles`, `company_settings` — each has a matching select policy and a select grant. Field writes are a direct `notes` insert (granted columns; policy allows accessible deals) and the RPCs `complete_appointment`, `set_job_status`, `register_files`, `set_task_status`, each granted to `authenticated` and guarded by assignment.
  - Sales screens write customers, properties, notes, tasks, line items, job assignments, and the descriptive columns of opportunities, estimates, jobs, and appointments directly (each column granted in §2.10, rows allowed by §3.3). Every lifecycle change a sales screen makes — creating leads, moving stages, owner changes, won/lost, scheduling, estimates' status, task status — has an RPC in §4.6. Sales cannot write invoices, settings, or the price book.
  - Admin-only writes (settings, price book, lead sources, invoices) are allowed by `private.is_admin()` policies on granted columns, or by admin-guarded RPCs.
  - Jobs, invoices, appointments, files, activities, and estimates have no user insert grant; they are created only by security-definer RPCs, which is intentional.
  - Public estimate actions and webhooks have no session and use service-role RPCs; `anon` has no grant or policy anywhere.
- **Lifecycle rules cannot be bypassed:** every column that a §4 rule sets (stage, stage_entered_at, won_*/lost_*, closed_*, first_contact*, amount_cents, owner_id, estimate status/totals/timestamps, job status/dates, appointment times/status/assignee, invoice amounts/status, task status, sync columns) is absent from the §2.10 update grants.
- **Prices hidden from field:** `jobs` and `appointments` have no money columns; `scope_summary` is price-free; field cannot select `opportunities`, `estimates`, `invoices`, `activities`, or `estimate`/`contract`/`insurance`/`invoice` files.
- **Automation is idempotent:** auto tasks (`tasks_auto_open_uidx`), jobs (`jobs.opportunity_id` unique), accepted estimates (partial unique index), lead deliveries (`lead_submissions_external_uidx`), outbox rows (`sync_outbox_pending_uidx`), emails (`email_log.dedupe_key`, status `sent` only), deposit/final invoices (`invoices_one_per_kind_uidx`), lead processing (`process_lead_submission` returns early unless `received`/`error`).

---

## 13. Verification

How to confirm the work end to end, during and after the build:

1. **Per phase:** the standard gate in §9 plus the phase's acceptance list, checked on the Vercel preview at 390px and desktop widths.
2. **Database:** `supabase db reset && pnpm seed && pnpm test` runs every migration from zero and the RLS, trigger, and RPC suites under `tests/rls/`.
3. **Role walkthrough** after Phases 4, 8, 10: sign in as each seeded user and confirm the §3.1 matrix by hand; as the field user, inspect network responses and confirm no dollar amounts are present.
4. **End-to-end flow** after Phase 10 (also automated in Phase 14): `curl` a website lead → it appears in `/leads` and the assignee is emailed → log a connected call → qualify → schedule an inspection → field user completes it and uploads photos from a phone → build and send an estimate → accept on the public page → job, invoices, and tasks exist → `/customers/[id]` renders the benchmark block exactly.
5. **Integrations:** Phase 12 against a real Google account (create, move, cancel, delete-and-restore); Phase 13 against the Intuit sandbox company (send invoice, record payment, poll).
6. **Reporting:** Phase 11 tests assert exact values on a fixed dataset; spot-check the dashboard against a manual SQL count in production after the first week.

## Next action after approval

Run Phase 0 (stage the prototype deletions, write `docs/spec.md`, `CLAUDE.md`, `docs/decisions.md`, `.gitignore`, merge), then begin Phase 1 on `phase-01-foundation`. Dylan starts the human setup tasks listed in Phase 0 in parallel.
