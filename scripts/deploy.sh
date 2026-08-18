#!/usr/bin/env bash
#
# SameDay Backend — EC2 deploy script (also embedded in the GitHub Action).
#
# Force-syncs the checkout to origin/main via `git reset --hard` so a deploy can
# never abort on "untracked working tree files would be overwritten by merge".
#
# It deliberately does NOT run `git clean`, so gitignored files that live only on
# the server (.env, ecosystem config, uploads) are preserved.
#
# The repo directory is auto-detected (the running pm2 app's cwd, then a scan of
# $HOME skipping disabled/old clones). Override with DEPLOY_REPO_DIR if needed.

set -euo pipefail

PM2_APP="${PM2_APP:-sameday-backend}"
BRANCH="${BRANCH:-main}"
REPO_DIR="${DEPLOY_REPO_DIR:-${REPO_DIR:-}}"

# --- locate the ACTIVE backend repo -----------------------------------------
if [ -z "$REPO_DIR" ] && command -v pm2 >/dev/null 2>&1 && command -v node >/dev/null 2>&1; then
  CWD="$(pm2 jlist 2>/dev/null | PM2_APP="$PM2_APP" node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const p=JSON.parse(d).find(x=>x.name===process.env.PM2_APP);if(p&&p.pm2_env&&p.pm2_env.pm_cwd)process.stdout.write(p.pm2_env.pm_cwd)}catch(e){}})' 2>/dev/null || true)"
  if [ -n "${CWD:-}" ] && [ -d "$CWD/.git" ]; then REPO_DIR="$CWD"; fi
fi

if [ -z "$REPO_DIR" ]; then
  for gd in $(find "$HOME" -maxdepth 3 -type d -name .git 2>/dev/null); do
    d="$(dirname "$gd")"
    case "$d" in *DISABLED*|*oldcode*|*_old*|*backup*) continue;; esac
    if [ -f "$d/DO_NOT_START_README.txt" ]; then continue; fi
    if [ ! -f "$d/package.json" ]; then continue; fi
    if git -C "$d" remote -v 2>/dev/null | grep -q "same_day_Solution_1"; then REPO_DIR="$d"; break; fi
  done
fi

if [ -z "$REPO_DIR" ] || [ ! -d "$REPO_DIR/.git" ]; then
  echo "ERROR: could not locate the backend repo. Set DEPLOY_REPO_DIR." >&2
  exit 1
fi
# ----------------------------------------------------------------------------

echo "=== SameDay Backend Deploy ==="
echo "REPO_DIR=$REPO_DIR"
cd "$REPO_DIR"

echo "[1/5] Force-syncing to origin/${BRANCH} (reset --hard, no clean)..."
git fetch origin "$BRANCH"
git reset --hard "origin/${BRANCH}"

echo "[2/6] Installing dependencies..."
npm ci

echo "[3/6] Applying DB migrations (db/migrations)..."
npm run migrate:deploy

echo "[4/6] Building..."
npm run build

echo "[5/6] Restarting PM2 process '${PM2_APP}'..."
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 reload "$PM2_APP" --update-env
else
  pm2 start npm --name "$PM2_APP" -- start
fi

echo "[6/6] Persisting PM2 process list..."
pm2 save

echo "=== Deploy complete ==="
