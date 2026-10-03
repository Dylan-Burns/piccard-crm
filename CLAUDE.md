@AGENTS.md

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
14. **Field users must never receive prices.** They have no access to opportunities, estimates, invoices, or activities. Field screens read only jobs, appointments, customers, properties, notes, files, tasks. Staff notes are hidden from field unless `shared_with_crew` is set.
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
