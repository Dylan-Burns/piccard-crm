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
