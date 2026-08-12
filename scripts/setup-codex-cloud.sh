#!/usr/bin/env bash
# Codex Cloud の setup script から呼ぶ dotfiles 共通 bootstrap。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$REPO_ROOT/scripts/sync-agent-skills.sh" \
  --manifest "$REPO_ROOT/config/codex-cloud/skills.txt"

command -v gh >/dev/null 2>&1 || {
  echo "ERROR: GitHub CLI (gh) is required" >&2
  exit 1
}

if ! gh stack --version >/dev/null 2>&1; then
  gh extension install github/gh-stack
fi

git config --global rerere.enabled true

echo "[setup-codex-cloud] skills and gh-stack are ready" >&2
