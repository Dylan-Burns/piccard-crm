#!/usr/bin/env bash
# The standard gate (docs/spec.md §9). Prints one line per step; exits non-zero on the first failure.
set -uo pipefail
cd "$(dirname "$0")/.."
step() { local name="$1"; shift; if out=$("$@" 2>&1); then echo "ok   $name"; else echo "FAIL $name"; echo "$out" | tail -40; exit 1; fi; }
step "db reset"  supabase db reset
step "seed"      pnpm -s seed
step "db types"  pnpm -s db:types
step "lint"      pnpm -s lint
step "typecheck" pnpm -s typecheck
step "tests"     pnpm -s test
step "build"     pnpm -s build
step "e2e"       pnpm -s e2e
step "tests (repeat, after e2e)" pnpm -s test
git diff --quiet src/types/database.ts || echo "note: src/types/database.ts changed; commit it"
