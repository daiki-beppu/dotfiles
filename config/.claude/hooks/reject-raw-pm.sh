#!/bin/bash
# PreToolUse hook: block raw npm/yarn/pnpm/npx, require ni equivalents

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

if [ "$TOOL" != "Bash" ]; then
  exit 0
fi

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Match standalone npm/yarn/pnpm/npx (not inside another word)
if echo "$CMD" | rg -q '(^|[;&|() ])npm(\s|$)'; then
  echo '{"decision":"block","reason":"npm は禁止。ni を使ってください（npm install → ni, npm run → nr）"}' >&2
  exit 2
fi

if echo "$CMD" | rg -q '(^|[;&|() ])yarn(\s|$)'; then
  echo '{"decision":"block","reason":"yarn は禁止。ni を使ってください"}' >&2
  exit 2
fi

if echo "$CMD" | rg -q '(^|[;&|() ])pnpm(\s|$)'; then
  echo '{"decision":"block","reason":"pnpm は禁止。ni を使ってください"}' >&2
  exit 2
fi

if echo "$CMD" | rg -q '(^|[;&|() ])npx(\s|$)'; then
  echo '{"decision":"block","reason":"npx は禁止。nlx を使ってください"}' >&2
  exit 2
fi

if echo "$CMD" | rg -q '(^|[;&|() ])bun(x?)(\s|$)'; then
  echo '{"decision":"block","reason":"bun/bunx は禁止。ni / nlx を使ってください"}' >&2
  exit 2
fi

exit 0
