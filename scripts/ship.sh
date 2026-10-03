#!/usr/bin/env bash
# Ships the current (already committed, gate-passing) phase branch:
# push → migrations to staging → merge to main → push → migrations to production.
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH=$(git branch --show-current)
[ "$BRANCH" != "main" ] || { echo "run from a phase branch" >&2; exit 2; }
[ -z "$(git status --porcelain)" ] || { echo "uncommitted changes" >&2; exit 2; }
git push -q -u origin "$BRANCH"
echo "staging:";    scripts/db-push.sh staging
git checkout -q main
git merge -q --ff-only "$BRANCH"
git push -q origin main
echo "production:"; scripts/db-push.sh production
echo "shipped $BRANCH at $(git log --oneline -1)"
