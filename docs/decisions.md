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
