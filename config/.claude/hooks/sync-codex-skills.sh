#!/bin/bash
# PostToolUse hook: keep ~/.agents/skills/ in sync with dotfiles skill directories
# so Codex picks up newly added/removed skills automatically.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

if [ "$TOOL" != "Write" ] && [ "$TOOL" != "Edit" ]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

case "$FILE_PATH" in
  */.claude/skills/*) ;;
  *) exit 0 ;;
esac

SYNC_SCRIPT="$HOME/ghq/github.com/daiki-beppu/dotfiles/scripts/sync-agent-skills.sh"
[ -x "$SYNC_SCRIPT" ] || exit 0
exec "$SYNC_SCRIPT"
