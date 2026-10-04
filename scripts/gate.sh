#!/usr/bin/env bash
# The standard gate (docs/spec.md §9). Prints one line per step; exits non-zero on the first failure.
set -uo pipefail
cd "$(dirname "$0")/.."
step() { local name="$1"; shift; if out=$("$@" 2>&1); then echo "ok   $name"; else echo "FAIL $name"; echo "$out" | tail -40; exit 1; fi; }
step "db reset"  supabase db reset
# The reset restarts the auth service. Seeding before it answers fails with a 502, and the local
# gateway can keep routing to auth's old address, so restart the gateway if auth stays unreachable.
wait_for_auth() {
  local url code; url=$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2- | tr -d '"')
  for i in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$url/auth/v1/health")
    [ "$code" = "200" ] && return 0
    if [ "$i" = "10" ] || [ "$i" = "30" ]; then docker restart supabase_kong_piccard-crm >/dev/null 2>&1 || true; fi
    sleep 2
  done
  echo "auth did not come back after the reset (last status $code)"; return 1
}
step "services" wait_for_auth
step "seed"      pnpm -s seed
step "db types"  pnpm -s db:types
step "lint"      pnpm -s lint
step "typecheck" pnpm -s typecheck
step "tests"     pnpm -s test
# e2e runs before the production build: starting the dev server right after a build cold-compiles
# every route and has caused timeouts.
step "e2e"       pnpm -s e2e
step "tests (repeat, after e2e)" pnpm -s test
step "build"     pnpm -s build
git diff --quiet src/types/database.ts || echo "note: src/types/database.ts changed; commit it"
