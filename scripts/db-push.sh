#!/usr/bin/env bash
# Applies pending migrations to a hosted Supabase project.
#   scripts/db-push.sh staging      (from a phase branch)
#   scripts/db-push.sh production   (only after merge to main)
# Reads database passwords from the gitignored .env file. Re-links the CLI each time,
# because it stays linked to whichever project was pushed last.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
case "${1:-}" in
  staging)    REF=cltuqlfxzoatzbaecckr; export SUPABASE_DB_PASSWORD="$SUPABASE_STAGING_DATABASE_PASSWORD" ;;
  production) REF=ctfjdfjltggamujrvjdc; export SUPABASE_DB_PASSWORD="$SUPABASE_DATABASE_PASSWORD" ;;
  *) echo "usage: $0 staging|production" >&2; exit 2 ;;
esac
supabase link --project-ref "$REF" >/dev/null 2>&1
# The CLI prints a harmless pgdelta certificate error after applying; filter it out.
supabase db push --yes 2>&1 | grep -iE "Applying|ERROR:|up to date" | grep -v certificate || true
supabase migration list 2>&1 | grep -o '"local":"[0-9]*","remote":"[0-9]*"' | tail -1
