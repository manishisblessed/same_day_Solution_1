#!/usr/bin/env bash
#
# SameDay Backend — EC2 deploy script.
#
# Install on the server as ~/deploy.sh (the GitHub Action runs `bash ~/deploy.sh`):
#   cp ~/same_day_Solution_1/scripts/deploy.sh ~/deploy.sh && chmod +x ~/deploy.sh
#
# Hardened so a deploy can never abort on "untracked working tree files would be
# overwritten by merge": we force the checkout to exactly match origin/main via
# `git reset --hard` + `git clean -fd` instead of a plain `git pull`/merge.
#
# NOTE: only run this on the deploy box. `reset --hard`/`clean -fd` DISCARD any
# local edits or untracked files in REPO_DIR — never point this at a dev machine.

set -euo pipefail

# --- verify these match your server -----------------------------------------
REPO_DIR="${REPO_DIR:-$HOME/same_day_Solution_1}"  # where the repo is checked out
BRANCH="${BRANCH:-main}"
PM2_APP="${PM2_APP:-sameday-backend}"
# ----------------------------------------------------------------------------

echo "=== SameDay Backend Deploy ==="
cd "$REPO_DIR"

echo "[1/5] Pulling latest code (force-sync to origin/${BRANCH})..."
git fetch origin "$BRANCH"
git reset --hard "origin/${BRANCH}"
git clean -fd                       # remove stray untracked files (old scripts, build junk)

echo "[2/5] Installing dependencies..."
npm ci

echo "[3/5] Building..."
npm run build

echo "[4/5] Restarting PM2 process '${PM2_APP}'..."
if pm2 describe "$PM2_APP" >/dev/null 2>&1; then
  pm2 reload "$PM2_APP" --update-env
else
  # First deploy: start it. Adjust the start command if your app differs.
  pm2 start npm --name "$PM2_APP" -- start
fi

echo "[5/5] Persisting PM2 process list..."
pm2 save

echo "=== Deploy complete ==="
