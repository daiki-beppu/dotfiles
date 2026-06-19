#!/bin/bash
# PreToolUse hook: block grep in Bash commands, suggest rg instead

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

if [ "$TOOL" != "Bash" ]; then
  exit 0
fi

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Match standalone grep command (not inside rg, not part of another word)
if echo "$CMD" | rg -q '(^|[;&|() ])grep(\s|$)'; then
  echo '{"decision":"block","reason":"grep は禁止。rg (ripgrep) を使ってください"}' >&2
  exit 2
fi

exit 0
