#!/usr/bin/env bash
#
# Push .env.local to a linked Vercel project.
#
# Beats pasting a dozen values into the dashboard, and keeps the local and
# deployed environments from drifting. Run `vercel link` first.
#
#   ./scripts/setup-vercel-env.sh                  # all three environments
#   ./scripts/setup-vercel-env.sh production       # just one
#
set -euo pipefail

ENV_FILE=".env.local"
TARGETS=("${1:-}")
if [ -z "${1:-}" ]; then TARGETS=(production preview development); fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "The Vercel CLI is not installed:  npm i -g vercel" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "$ENV_FILE not found. Copy .env.example and fill it in." >&2
  exit 1
fi

if [ ! -d ".vercel" ]; then
  echo "This directory is not linked to a Vercel project. Run: vercel link" >&2
  exit 1
fi

# Values that must never be sent to Vercel: placeholders would produce a green
# build and a broken site, which is the exact failure this repo has already hit
# once.
is_placeholder() {
  case "$1" in
    *placeholder*|*PLACEHOLDER*|*your-*|*YOUR-*|"") return 0 ;;
    *) return 1 ;;
  esac
}

pushed=0
skipped=0

while IFS= read -r line || [ -n "$line" ]; do
  # Skip comments and blanks.
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ "$line" =~ ^[[:space:]]*$ ]] && continue
  [[ "$line" != *"="* ]] && continue

  key="${line%%=*}"
  value="${line#*=}"
  key="$(echo "$key" | xargs)"
  # Strip surrounding quotes if present.
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"

  if is_placeholder "$value"; then
    echo "  skip   $key (empty or placeholder)"
    skipped=$((skipped + 1))
    continue
  fi

  for target in "${TARGETS[@]}"; do
    # Remove first so re-running updates rather than erroring on a duplicate.
    vercel env rm "$key" "$target" --yes >/dev/null 2>&1 || true
    printf '%s' "$value" | vercel env add "$key" "$target" >/dev/null 2>&1
  done
  echo "  set    $key  →  ${TARGETS[*]}"
  pushed=$((pushed + 1))
done < "$ENV_FILE"

echo
echo "$pushed variable(s) set, $skipped skipped."
echo "Redeploy for them to take effect:  vercel --prod"
