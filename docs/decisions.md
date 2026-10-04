# Decisions

One line per decision made where `docs/spec.md` was silent.

## Phase 0 (2026-10-03)
- Vercel project `piccard-crm` switched to the Next.js preset; build/install/output overrides cleared.
- Deferred account setup: Vercel Pro, Resend domain verification, Google OAuth client, Intuit developer keys. Consequences:
  - Without Vercel Pro, crons run at most once a day (Hobby): Phases 6/10/12/13 must keep cron routes callable manually and treat `after()` as the primary trigger until Pro is enabled. Hobby is also non-commercial; upgrade before go-live (Phase 5).
  - Without a verified Resend domain, email can only go to the account owner's address from `onboarding@resend.dev`; Phase 5 email works for testing only.
  - Google OAuth client is required before Phase 12; Intuit keys before Phase 13.
- Supabase project `piccard-crm`, ref `ctfjdfjltggamujrvjdc`, org `piccard`, region `us-west-2`. Public sign-ups disabled via Management API (`disable_signup = true`).
- Vercel functions default region set to `pdx1` to sit next to the `us-west-2` database.
- Vercel env (Production + Preview): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` (sensitive). New-style `sb_publishable_`/`sb_secret_` keys, not legacy anon/service_role.
- Phase 1 note: `supabase init` writes `enable_signup = true` in `supabase/config.toml`. Set it to `false` there too, and never run `supabase config push` without reviewing the diff, because it would overwrite remote auth settings (including re-enabling sign-ups and resetting site_url).
- Remote Supabase auth `site_url` is still `http://localhost:3000`; set it to the production URL in Phase 1 step 12 so invite and reset links work.

## Spec revisions (2026-10-03)
- Revision 2 and 2.1 applied after an external review; see the note at the top of `docs/spec.md`.
- Staging Supabase project `piccard-crm-staging`, ref `cltuqlfxzoatzbaecckr`, us-west-2, sign-ups disabled. Vercel Preview env points at staging; Production env at production.
- Progress invoices cut from v1 (owner decision).
- OAuth integrations are tested locally and in production only; no long-lived staging branch.

## Phase 1 (2026-10-03)
- Next.js 16.3 uses `src/proxy.ts` (export `proxy`), not middleware.
- shadcn: Radix base, `radix-nova` style; `field` replaces the retired `form` component. Theme tokens replaced with slate + blue-600 in `globals.css`; 14px base text is set on `body`, not `html`.
- `cn` is shadcn's own class-merge package (replaces clsx + tailwind-merge); `shadcn` is a runtime dependency because `globals.css` imports `shadcn/tailwind.css`.
- `pnpm-workspace.yaml` allows esbuild's build script (needed by vitest and tsx).
- Local Supabase ports are 544xx (shifted by 100 from the defaults) in `supabase/config.toml`.
- `supabase/config.toml`: `[auth] enable_signup = false` blocks public sign-ups. `[auth.email] enable_signup` must stay `true`: setting it false disables email logins entirely.
- Current Supabase no longer grants `service_role` table privileges by default; `0001` grants them through default privileges (spec §2.10 updated).
- `typecheck` runs `next typegen` first, because `PageProps`/`LayoutProps` are generated global types.
- Deactivating a user sets `profiles.is_active = false` and bans the auth user (`ban_duration`), so sessions cannot refresh. `requireRole` signs out a user whose profile is inactive.
- Sign-out is a plain `<a href="/auth/signout">` (GET) rather than a `<Link>`, so it is never prefetched.
- Selects on phones use a native `<select>` (`components/shared/native-select.tsx`) rather than the Radix select.
- Extra dev dependency `dotenv` (seed script and vitest load `.env.local`). Test config is `vitest.config.mts`; `server-only` is stubbed in tests.
- Added `pnpm e2e` (Playwright, desktop + 390px mobile projects). The invite flow test reads the email from local Mailpit (port 54424).
- Settings nav shows only Profile, Company, Users for now; lead sources, price book, integrations are added by their phases.
- Invites and admin-issued password resets use `auth.admin.generateLink` and show a copyable link instead of sending email. Reason: on the free tier Supabase rejects custom email templates without custom SMTP, and its built-in email only delivers to org members. Spec Phase 1 steps 7 and 9 updated. Revisit in Phase 5 (Resend): send the link by email and configure Resend SMTP in Supabase Auth so "Forgot password" works for everyone.
- Until SMTP is configured, hosted "Forgot password" emails reach only Supabase org members and use Supabase's default template (handled by the `code` exchange in `/auth/confirm`). Admins can issue a reset link from Settings → Users.
- Security review fixes: sign-out is a server action; `GET /auth/signout` acts only for deactivated users. Changing a password in Settings requires the current password; `/set-password` refuses password-based sessions (checks the JWT `amr` claim).
- `supabase projects api-keys` masks secret keys unless `--reveal` is passed. The Vercel `SUPABASE_SECRET_KEY` values were first stored masked and have been replaced with the real keys (Production and Preview).
- Seed adds `reset@test.local` for the password-reset e2e test and always restores seed passwords.
- `/auth/confirm` is a page with a Continue button (POST), not a GET route: prevents login CSRF and link consumption by email scanners. Invite/reset links take their host from the request only when it matches a known origin (`resolveOrigin` in `lib/env.ts`), otherwise from the configured app URL.
- Phase 1 merged to `main` and deployed. Production: https://piccard-crm.vercel.app (`NEXT_PUBLIC_APP_URL` set for Production). Migration 0001 applied to production. Production auth: site URL and redirect allow-list set to the production origin; sign-ups disabled. Owner admin accounts created on staging and production via one-time invite links.
- `supabase db push` prints a `pgdelta … ca.crt` error after applying; the migration still applies (confirmed with `supabase migration list`). The CLI stays linked to whichever project was pushed last; re-link before each push.

## Phase 2 (2026-10-03)
- `0002_schema.sql` and `0003_rls.sql` are assembled from the SQL blocks in `docs/spec.md` §2.2–§2.7 and §3.3; triggers follow §2.9. All 23 tables have RLS; no function is executable by `anon`; no `security definer` function lacks `search_path = ''` (checks in spec §9 Phase 2 return zero rows).
- `fill_parent_ids` takes an argument: `'required'` (notes, files, activities) raises when no customer resolves, `'optional'` (tasks) does not. Appointments use `fill_appointment_parent_ids`, which also fills `property_id`.
- The sent-estimate lock allows line deletes when the parent estimate row is already gone, so deleting a deal still cascades.
- `calendar_connected()` helper gates the two calendar triggers; with no connection row they do nothing.
- Column grants are role-wide, so some denials come from RLS rather than privileges: a field user's direct `tasks.due_at` update affects zero rows (no error), and a sales insert into `lead_sources` fails the policy check. Both are tested as "data unchanged".
- Generated Insert types require `customer_id` on attachment tables even though the trigger fills it. `src/lib/supabase/inserts.ts` provides `attach<T>()` so callers pass only the most specific parent id.
- PostgREST bulk inserts send null for keys missing from some rows; give every row the same keys (hit in the seed with `is_taxable`).
- Seed data lives in `scripts/seed-data.ts` with named fixtures (`FIXTURES`) that the tests look up. It is not transactional: run `supabase db reset` before reseeding. Added `field2@test.local` (a field user with no assignments).
- The password-reset e2e test uses a unique password per run (Supabase rejects a reset to the current password).
- Running `pnpm e2e` immediately after `pnpm build` once produced timeouts while the dev server cold-started; a rerun passed. If it recurs, start `pnpm dev` first.
- `0004_policy_hardening.sql` (security review of 0003): the profiles update policy itself now forbids self-changes to role/is_active and any self-edit by a deactivated user; field access through an appointment ends when it is cancelled or a no-show. Spec migration numbers from Phase 3 on shifted up by one (`0005_lead_rpcs.sql` … `0015_invoice_rpcs.sql`).
- Open decision for the owner: field users can read every note on a deal they can access, including sales notes that could mention prices. See the question raised on 2026-10-03.

## Phase 3 (2026-10-03)
- Owner decision: notes have a "Share with crew" checkbox (`notes.shared_with_crew`, default off). Field users read only shared notes; notes written by field users are always shared (trigger). Spec §2.6, §2.10, §3.1, §3.3 updated.
- `log_contact` with a connected outcome on an unowned lead makes the caller the owner, so the Contacted gate passes without a separate step.
- `create_lead` accepts `customer_id` / `property_id` so the manual form's "Use this customer" attaches the new deal to an existing customer. It implements the import rules (§6.5) already; the import script itself is Phase 5.
- `private.apply_stage_change` holds the shared "update stage → run entry automation → log" step; Phase 4's `change_opportunity_stage` wraps it with the gate check.
- Deal cards are not links yet: the deal page (`/opportunities/[id]`) is Phase 4. Leads and tasks link to the customer page.
- There is no standalone "create customer" screen or action: customers are created through a lead (so dedupe always runs). Customers can be edited and given properties from the customer page.
- React 19 resets uncontrolled fields after a form action. Longer forms use `useFormAction` (`components/shared/use-form-action.ts`), which submits without the reset so typed input survives a validation error.
- Customer search: each word must match first name, last name, company, or email; a phone-like query matches phone digits; the whole query is also matched against street addresses. Filter terms are stripped of PostgREST filter characters.
- On phones the customer header (name, Call / Text / Navigate) is sticky; the section tabs below it are not.
- RPC results are unwrapped by `lib/rpc.ts` (`unwrapRpc`) into `ActionResult`.

## Phase 4 (2026-10-03)
- `0006` redefines `private.check_stage_gate`: the 0005 version used `text[] || 'literal'`, which Postgres reads as an array literal and fails at run time whenever something is missing. Use `array_append`.
- `change_opportunity_stage` takes `p_fill` so the board's gate dialog saves the missing data and moves the deal in one RPC (keeps the "one RPC per action" rule). Fills are kept even when the gate still fails for something that cannot be typed (an inspection, a sent estimate).
- Board optimism uses `useOptimistic`: the card shows in the new column during the request and falls back to server data when it finishes, which is the revert on failure.
- Board Won/Lost are drop zones with 30-day counts; closed deals are not listed on the board (they are on the customer page).
- Sales reps open the board filtered to their own deals; admins to all owners. Filters are GET parameters.
- Phone board: stage chips with counts, horizontal swipe changes stage, each card has a Move button that opens a sheet. No dragging on touch.
- Deal cards and the leads inbox now link to `/opportunities/[id]`. The deal page has placeholders in code comments for appointments (phase 6), files (phase 7), and estimates (phase 9).
- Radix dialogs set `aria-hidden` on the rest of the page; browser tests must not query the page by role while a dialog is open.

## Phase 5 (2026-10-03)
- Webhooks follow the store-first rule: authenticate → per-IP rate limit (10/minute, counted from `lead_submissions`) → parse → insert the raw payload → 200; 503 if the insert fails. Processing runs in `after()`. Logic is in `features/leads/ingest.ts` so it is testable without an HTTP request.
- The delivery id is the sender's (`submission_id` / Google `lead_id`) or a SHA-256 of the raw body plus the UTC date.
- Normalization (TypeScript) can reject a submission (honeypot, Google test lead, no name, no phone or email); the row is marked `rejected` with the reason.
- `process_lead_submission` (0007) wraps `create_lead`; an exception marks the submission `error` and the retry sweep picks it up (max 5 attempts).
- Email: `lib/integrations/resend.ts` implements the email_log outbox with an injectable sender for tests. With no `RESEND_API_KEY`/`EMAIL_FROM`, sends are recorded as `failed` ("Email is not configured") and retried later. Templates are registered by name in `src/emails/templates.tsx` so retries render from stored props.
- New-lead email goes to the deal owner, else the longest-standing active admin. A manual lead notifies only when the person entering it is not the owner.
- `/api/cron/process-outbox` retries stuck submissions and emails. `vercel.json` schedules it once a day because the Hobby plan rejects more frequent crons; change to `*/5 * * * *` after upgrading to Pro. Admins can also press "Retry failed items" in Settings → Integrations.
- Vercel env: `CRON_SECRET`, `LEAD_WEBHOOK_SECRET`, `GOOGLE_ADS_WEBHOOK_KEY` (readable in the dashboard so they can be copied to the website and Google Ads) and `INTEGRATION_ENCRYPTION_KEY` (sensitive) were generated for Production and Preview. Local test values are in `.env.local`.
- Settings → Integrations never shows a secret; it names the Vercel variable to copy. Website setup instructions are server-side only.
- `scripts/import-csv.ts`: dry run by default, `--commit` to write; targets whichever Supabase URL/secret key are in the environment.
- `@react-email/components` prints a deprecation notice on install (the project is moving to the `react-email` package); it works and is the package the spec names.
- ESLint ignores unused arguments that start with `_` (server actions used with `useActionState` must accept both parameters).

## Phase 6 (2026-10-03)
- `schedule_appointment` checks the Qualified gate before inserting an inspection on an early-stage deal, then moves the deal with `apply_stage_change`. Assignee defaults to the deal owner.
- A cancelled or no-show inspection sends the deal back to Qualified unless another inspection is scheduled or completed (`private.after_inspection_lost`). A completed inspection keeps the deal in Inspection Scheduled and creates the `send_estimate` task.
- `complete_appointment` raises the same "not allowed" for a missing appointment and for one that is not the caller's, so ids cannot be probed.
- Calendar: plain yyyy-MM-dd day strings in the company timezone; day arithmetic in UTC (`lib/dates.ts`). Week view is Sunday–Saturday day columns (not an hour grid); month view is desktop only; phones always show the agenda. Staff drag a scheduled appointment to another day in week view (same local time).
- Dropping a deal on Inspection Scheduled when only the inspection is missing opens the schedule dialog directly.
- Closing an appointment raises its toast from the submit handler, because the row can leave the page (and unmount) before an effect-based toast would run. The same applies to any action that removes its own trigger from the page.
- Draggable wrappers around a button use `role="group"` so buttons do not nest.
- Inspection confirmation email goes to the customer on schedule and reschedule when the setting is on and they have an email (dedupe key includes the start time). Daily task digest: one email per user per business day; cron runs once a day (`vercel.json`).
- `/today` shows the field user's appointments, assigned jobs (scheduled / in progress), and tasks. "Add photos" is disabled until Phase 7; jobs are not links until Phase 8.
- The customer page schedules from each open deal card (next to "Log contact"), since appointments always belong to a deal; the appointment list itself lives on the deal page and the card shows the inspection line.
- Dialogs that take a `trigger` element from a Server Component render it through `components/shared/dialog-trigger-slot.tsx`. The element can arrive as a lazy reference nested two deep, and Radix Slot unwraps only one level ("Primitive.button failed to slot onto its children"), which crashed the customer and Today pages intermittently.

## Phase 7 (2026-10-03)
- `register_files` re-checks everything the server generated: each path must be `{customer}/{deal or _}/{file id}.{ext}` for the target record and the object must already exist in storage, so a caller cannot register (and then read) another record's object. Repeating a call inserts nothing and logs nothing. Field users may register only the categories they can read.
- Upload access for field users is decided in `features/files/storage.ts` by looking for their live appointment or assigned job on the deal (they cannot read `opportunities`); `register_files` is the real gate. Field uploads always need a deal; staff may also upload straight to a customer with no deal (`_` in the path).
- The server logic lives in `features/files/storage.ts` and takes the caller's client and profile, so the RLS tests exercise it without a request; `actions.ts` only validates and revalidates.
- Uploader: images are compressed on the main thread (the library's web worker loads its script from a public CDN); a file that cannot be decoded in the browser is sent as is. Uploads PUT multipart bodies to the signed URLs with XMLHttpRequest for progress; three at a time; three retries with 1 s / 2 s / 4 s backoff. A "duplicate" answer counts as success (an earlier attempt landed). The batch is registered in one call, so ten photos give one timeline entry; files retried later are registered separately.
- Leaving while uploads run: `beforeunload` covers closing and reloading; in-app link clicks ask with a confirm.
- Thumbnails use Supabase image transformation only when `SUPABASE_IMAGE_TRANSFORM=true` (a paid feature); otherwise the grid sizes the full image with CSS. Signed links last an hour; the grid fetches fresh ones once if an image fails to load.
- Photos that are images show in the thumbnail grid and lightbox (arrow keys and swipe); everything else, including a non-image filed under Photos, is a list row that opens in a new tab. Staff edit category and caption; admin delete asks twice in the dialog (no browser prompt).
- Customer screen: one deal → uploads go to it; several → the uploader asks for the deal first; none → the customer. The phone action sheet's "Add photos" uses the same rule.
- Company logo: stored in the same private bucket at `_company/logo-{uuid}.{ext}` (PNG, JPG, WebP up to 2 MB); the previous object is removed when replaced.
- Local development: after `scripts/db-push.sh` links a hosted project, the CLI pins service versions to that project. Run `supabase stop && supabase start` before the next gate, or storage uploads fail with `42P10` (schema newer than the running storage container).

## Hotfix after Phase 7 (2026-10-03)
- Security review of `0009`: `register_files` accepted any `image/*` type the caller declared (SVG included) and did not compare it with the stored object; the bucket accepted any content type. `0010_file_content_types.sql` sets the bucket's allowed types to JPEG, PNG, WebP, GIF, HEIC/HEIF, and PDF, limits `register_files` to the same list (`private.allowed_file_types()`), requires the declared type to equal the stored object's type, and records the size storage reports.
- Migration numbers from here on are one higher than the spec's phase plan (Phase 8's job RPCs are `0011_job_rpcs.sql`).
- Follow-up to the hotfix (shipped with Phase 8): `0012_file_content_cleanup.sql` re-labels any object stored before `0010` with a type outside the allow-list as a plain download (nothing is deleted). `registerFiles` now reads the first bytes of each uploaded object and refuses, and removes, anything whose content is not the declared type; storage itself only checks the declared type. A direct call to the RPC skips that byte check, but can still only record an allow-listed type that matches what storage will serve.

## Phase 8 (2026-10-03)
- `schedule_job` creates one all-day `job_work` appointment per work day and person (midnight to midnight in the company timezone). Calling it again cancels scheduled work days from today on that are no longer wanted, keeps the ones that still apply, and leaves past days alone. Crew assignments are only added by it; removing someone is a separate action. A job already in progress stays in progress when rescheduled. Completed and cancelled jobs cannot be scheduled.
- `set_job_status` transitions: Start from Pending Schedule or Scheduled; Complete only from In Progress; On Hold from anything not finished; Cancel from anything not completed; Resume (staff) returns an on-hold job to In Progress, Scheduled, or Pending Schedule depending on what it had reached. Completed and cancelled are final. Field users can only start and complete, and cannot restart a job staff put on hold.
- The warranty end date counts from the completion date in the company timezone. `final_invoice` goes to the longest-standing active admin; `completion_photos` to the deal owner.
- `/jobs` search filters the fetched page in memory (number, title, customer, address); the status filter runs in the database. Default filter is Open.
- Job page: files and notes shown are the deal's (inspection photos and shared notes are useful to the crew); uploads from the job carry `job_id`. Staff-only data (contract amount, invoices, timeline) is not queried for field users. Field users see only their own crew row and their own work days, because that is what the `job_assignments` and `appointments` policies return.
- Completion: the sheet offers the photo uploader and an optional note; the note is saved first, then `set_job_status` runs.
- `assignUsers` only adds people; `unassignUser` removes one. Each is a single write.

## Hotfix after Phase 8 (2026-10-03)
- Security review of the Phase 8 commit, two findings in `features/files/storage.ts`:
  1. The content check removed any object whose bytes did not match the declared type, and the path came from the caller. Someone allowed to upload to a deal could name an existing file's path with a different type and have its object deleted. The check no longer deletes anything, each path must be exactly `{target prefix}{id}.{extension for the declared type}`, and files that are already registered are not re-judged.
  2. The content check ran only in the server action, so calling `register_files` directly skipped it. `0013_file_verification.sql` adds `mark_files_verified` (service role only), which the server calls after inspecting the bytes; it sets `verified` in storage's own object metadata, which uploaders cannot write. `register_files` now refuses objects without it (`not_verified`). An object that cannot be read fails the check.
- Migration numbers are now two higher than the spec's phase plan (Phase 9's estimate RPCs are `0014_estimate_rpcs.sql`).

## Phase 9 (2026-10-03)
- **Owner decision gate (spec §11, questions 1–4).** Asked on 2026-10-03; the owner answered "use the defaults": (1) no sales tax is charged to customers, tax rate 0; (2) estimates are itemized lines from a price book, with per-square (`sq`) as the common unit, a lump sum being a single line; (3) a 30% deposit on signing, editable per estimate; (4) no standard terms text yet, estimates valid 30 days, 5-year warranty. All four are settings and can be changed in Settings → Company without a migration. The spec advises confirming the tax answer with the accountant before QuickBooks is connected (Phase 13).
- Migration is `0014_estimate_rpcs.sql`. `create_estimate` refuses a won or lost deal (reopen it first). `void_estimate` logs a `system` activity, because the activity types have no "estimate voided". Voiding twice is harmless.
- `save_estimate_lines` validates every line before touching anything (name, quantity above zero with at most two decimals, whole cents, line total within the integer column) and returns the stored totals.
- `features/estimates/totals.ts` uses integer and BigInt arithmetic with half-up rounding, matching Postgres `round(numeric)`. `totals.fixtures.ts` is run through both the TypeScript function and the database trigger; one five-line fixture is also worked by hand in the unit test.
- Builder: one Save stores the header (`updateEstimate`, granted columns) and then the lines (`saveEstimateLines`). While there are unsaved edits the totals panel shows the live preview; once saved it shows the stored numbers. On phones the totals bar is pinned above the tab bar and the discount, tax, and deposit fields sit in the page.
- Price book: admins add, edit, deactivate, and delete; the builder offers active items only and copies their values into the line.
- PDF: `EstimateDocument` uses the built-in Helvetica (no font files). The logo is embedded when it is PNG or JPEG (the renderer cannot read WebP). `GET /api/estimates/[id]/pdf` is staff only and loads the estimate through the user's own client. A database test renders the PDF, extracts its text, and checks it against the stored row.
- Upload verification (follow-up to the Phase 8 hotfix): each object is checked by its exact path and only its first bytes are read, instead of listing the deal's folder (which stopped working past 1,000 objects).

## Deal page tabs (2026-10-03)
- Requested by the owner with Pipedrive's deal page as the reference. Not part of a spec phase; it rearranges the deal page without changing data, RPCs, or permissions.
- Layout: the deal's summary, owner, and fields sit in a left sidebar (below the working area on phones). The working area is a tab bar (Activity, Notes, Appointments, Call, Email, Files, Estimates, Invoices) where each tab holds the form or panel for adding that kind of thing, then **Focus** (open tasks and scheduled appointments), then **History** with filter chips and counts (All, Activities, Notes, Emails, Files, Estimates, Invoices, Changelog).
- Choosing a tab also sets the history filter to match (Notes → notes, Call and Appointments → activities, Email → emails, and so on); the chips can then be changed without leaving the tab. `features/opportunities/history.ts` maps each activity type to one chip; changes to the deal itself (stage, owner, won/lost, lead received, job events) are the Changelog.
- Call and Email tabs are the existing log-contact form fixed to that kind of contact. There is no WhatsApp, meeting scheduler link, or email sync: those are outside the spec's v1 scope. Notes are shown as muted cards rather than yellow, because the UI rules keep amber for status.
- Invoices tab lists the job's invoices read-only (sending and due dates arrive in Phase 13).
- Sidebar (also from the Pipedrive reference): below the summary card, folding sections built on `<details>` (`components/shared/collapsible-section.tsx`): Customer (link, tap-to-call, email, company, preferred contact), Property (address, access notes, Navigate), Overview (deal age, time in stage, last logged contact, open tasks), Source (source, detail, received), Job (once won; replaces the header's "Open job" link), Owner, and Deal details (the edit form, folded by default).
- Left out on purpose: products (estimates cover them), participants and followers, organizations, sequences, Smart Bcc. Labels and an expected close date would need new columns, which needs the owner's approval first (CLAUDE.md rule 1).

## Deal labels and expected close date (2026-10-03)
- **Schema addition approved by the owner on 2026-10-03** (CLAUDE.md rule 1 requires asking before changing the spec's schema). `0015_deal_labels_close_date.sql` adds `opportunities.labels text[] not null default '{}'` and `opportunities.expected_close_on date`, and grants update on both to `authenticated` (rows are still limited to staff by the existing policy). They are descriptive fields, not lifecycle fields, so they are written directly like the deal's other descriptive columns.
- Labels are free text: up to 10 per deal, each trimmed and 1 to 30 characters, no duplicates ignoring case (`private.labels_valid`, used in a check constraint). The editor suggests labels already used on other deals. There is no separate label list or colours.
- Both are edited in place under the deal's summary card and save on change. They are not yet shown on the pipeline board or used in reports.

## Visual structure, stage detail, and clickable cards (2026-10-03)
- Requested by the owner: sections were hard to tell apart. The page background is now light slate and every section is a white, bordered panel with a tinted header band (`panel` and `panel-head` utilities in `globals.css`); bordered containers are white; `--border` and `--input` moved from slate-200 to slate-300 so dividing lines are visible. Still slate and white with borders rather than shadows (spec §5.7).
- Deal stages stay as they are. The owner asked whether to match Pipedrive's default stages; the answer was no, because the existing stages are roofing-specific and each drives gates and automation (spec §4.1). Only the presentation was borrowed: the deal page's stage bar is now arrow-shaped and shows the time in the current stage.
- Timeline text for stage changes, lost deals, and reopened deals is built from the activity's metadata in `lib/activity.ts` ("Stage changed: Qualified → Inspection Scheduled"), and entries show who did them when the summary does not already say. Stored summaries are unchanged, and no amounts are added.
- Pipeline cards: the customer-name link stretches over the whole card, so a click anywhere opens the deal and a drag still moves it. On phones the Move button sits above the link.
- Pipeline board (follow-up): the columns used a light slate fill that disappeared once the page background became slate. Each column is now a white bordered panel with a tinted header band and a lightly tinted card area; the Won and Lost drop zones are white.

## Phase 10 (2026-10-03)
- **Owner decision gate (spec §11, question 16).** Asked on 2026-10-03; the owner answered "use the default": online approval (typed full name, time, IP address) approves the estimate only and does not replace the signed contract, which is still collected and uploaded (the `collect_contract` task). Wording says "approve", never "sign". A dedicated e-signature provider is deferred. The spec advises checking the state's home-improvement contract rules.
- Migration is `0016_estimate_lifecycle.sql`. `mark_estimate_sent` also inserts the PDF's `files` row (category `estimate`) itself, after checking the path is `{customer}/{deal}/{uuid}.pdf` and the stored object is a PDF, so sending is one transaction and adds no separate "file uploaded" timeline entry. It refuses when the deal lacks what the Qualified gate needs, and is harmless to repeat.
- A first version moves the deal to Estimate Sent and a revision to Negotiation, only from an earlier stage. `revise_estimate` works from sent, viewed, declined, expired, or void, returns the existing draft if one is already open, and refuses on a closed deal.
- `accept_estimate` runs `mark_opportunity_won` first and records the name and IP only if that succeeded, so a refused approval writes nothing. An estimate past its valid-until date cannot be approved even before the nightly job marks it expired. An unparsable IP is stored as null.
- Public page `/e/[token]`: service client, keyed by token only; a draft is treated as not existing; unknown, void, and expired links show "no longer valid" with the company phone. The view is reported by a script after two seconds of visibility. `Cache-Control: no-store` and `X-Robots-Tag: noindex` are set in `next.config.ts` and in `proxy.ts`; the dev server overrides the page's cache header, so this was verified against a production build (`no-store`, `noindex` on both the page and the endpoints).
- Emails: the estimate email carries the link and no amounts; decision and deal-won emails carry no amounts either. Deal-won uses one `email_log` row per admin (`won:{deal}:{admin}`), since the log has one recipient per row. A deliberate resend uses a new key so it is not suppressed. Staff marking a deal won also triggers the deal-won email.
- Send controls live in the builder's totals panel: Send (asks once more, showing the address; disabled while there are unsaved edits), then Copy link, Resend email, and Revise.
- `/api/cron/nightly` runs `run_nightly_maintenance`, then retries lead submissions and emails; scheduled daily at 08:00 UTC in `vercel.json`.
- Until `RESEND_API_KEY` and `EMAIL_FROM` are set on a verified sending domain, estimate emails are recorded as failed and the builder says so; the rep copies the link instead. Sending still marks the estimate sent.

## Phase 11 (2026-10-03)
- Migration is `0017_reports.sql`. The functions are the spec's §8 SQL with names schema-qualified and an empty `search_path` (§2.1); `biz_date` lives in `private` and is executable by signed-in users because the report functions run as the caller. Sums are cast to `bigint` and ties in the ordering are broken by name so output is stable.
- The functions are `security invoker`: field users get zeros and empty tables because they cannot read deals. The Reports page and the CSV route are admin only; the dashboard is staff only and passes the signed-in rep's id for sales users.
- Ranges (`features/reports/ranges.ts`): This month, Last month, This quarter, Year to date, Custom. Presets run to the end of their period; an invalid custom range falls back to This month. Days are in the company timezone.
- Dashboard "Needs attention": unassigned leads (New or Contacted with no owner), overdue open tasks (the rep's own for sales), and open deals with no open task and no future scheduled appointment (the §4.4 invariant, checked live rather than waiting for the nightly job). Each list shows five with a link to the rest.
- Reports: one shared definition (`features/reports/csv.ts`) produces both the on-screen table and the CSV, so they cannot disagree. CSV cells starting with `=`, `+`, `-`, or `@` are prefixed with an apostrophe so a spreadsheet does not run them as formulas. Pipeline by stage is a snapshot of now and revenue by month covers the last 12 months, regardless of the chosen range; the page says so.
- Tests use a rep created for the test with deals dated March 2019, so the expected numbers are worked by hand and cannot be disturbed by seed or other test data.

## Linked email accounts (2026-10-03)
- Requested by the owner, with Pipedrive's Email tab as the reference: each staff user links their own mailbox; email to and from a customer appears on that customer's deal (two-way sync); email can be sent from the deal's Email tab. Providers: Google Workspace and Microsoft 365. Built after Phase 12, as agreed.
- **Schema addition approved by the owner on 2026-10-03** (CLAUDE.md rule 1): `email_accounts` and `email_messages`, enums `email_provider` and `email_direction` (`0019_email_linking.sql`). The owner also chose: **all staff can read** a deal's synced email, and the **full text** is stored (attachments are not).
- Only messages to or from an address that matches a customer are stored; the rest of a mailbox is never stored. One row per real email (unique on the Message-ID header), even when two reps' mailboxes both hold it. Messages stay on the deal if the mailbox is unlinked or the rep leaves.
- One mailbox per user. Tokens are encrypted and never granted to the API: a user can read only their own mailbox's status columns (admins can read everyone's). Linking and unlinking go through `save_email_account` and `disconnect_email_account`, which act on the caller's own row. Messages are written only by `record_email_message` (service role), which also adds one `email` timeline entry.
- Field users have no access to email accounts or messages (messages can contain prices).
- The service client is used by the mailbox sync worker and by sending from a deal, because both need the encrypted tokens; this extends CLAUDE.md rule 4's list, which has been updated.
- Sync: Gmail is searched only for mail involving customer addresses (in chunks of 15), so nothing else is fetched. Microsoft Graph cannot filter by a list of correspondents, so message headers since the last sync are listed without bodies, matched against customer addresses in memory, and bodies are fetched only for matches; nothing unmatched is stored. The first sync looks back 30 days; opening a deal's "Check for new email" looks back a year for that one customer. HTML-only messages are reduced to text. Attachments are not stored (a paperclip marks them).
- Sync runs on linking, when a user presses "Check for new email" on a deal, and from the cron routes (`process-outbox` and `nightly`). On the Hobby plan those run once a day; near-real-time background sync needs more frequent cron (Pro) or provider push notifications, which are not built.
- Sending goes out from the rep's own mailbox and is recorded on the deal immediately; when the sync later finds the same message in Sent it is not stored twice (same Message-ID). Subject and recipient are forced onto one line so a line break cannot add headers. Microsoft sends by creating a draft and sending it, which returns the ids the sync will see.
- Token refresh happens inline per mailbox (no shared lock: each mailbox has one owner). Microsoft's newly issued refresh token is always kept. A revoked grant marks the mailbox "needs linking again".
- UI: the mailbox card is on Settings → Profile for admins and sales (not field). The deal's Email tab shows the composer and "Check for new email" when the user's mailbox is linked, otherwise a prompt to link plus the existing "log an email" form; the conversation list is visible to all staff either way. Settings → Integrations has the one-time company setup (redirect addresses, scopes, variables).
- Two-step confirm buttons (Unlink, Disconnect Google, Delete price-book item) now have distinct React keys. Without them React reused one button element, changed it to a submit button during the first click, and the form submitted without the confirmation. Found by the email-linking browser test; the Google and price-book cases were already live.
- Not yet verified against real Google or Microsoft: neither OAuth client exists yet. Both providers are tested with fake APIs. New variables: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, optional `MICROSOFT_TENANT_ID`.
- Whose mail can be pulled (security review, before shipping): any staff user can create a customer with any email address, and stored email is readable by all staff, so the address list is restricted in the database. `private.is_internal_email` treats staff profile addresses, linked mailbox addresses, and the company's own email domain (unless it is a public provider such as gmail.com) as never being a customer's. `mailbox_customer_addresses` (service role) returns, for background sync, only customers on deals **owned by the mailbox's owner**; for "Check for new email" it returns the one requested address if it is a real customer's and not internal. `record_email_message` applies the same internal-address rule, so even a message a provider returned by mistake is not stored. A rep covering a colleague's deal pulls their own mail for it by pressing "Check for new email" on that deal.
