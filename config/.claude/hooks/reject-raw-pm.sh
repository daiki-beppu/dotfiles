#!/bin/bash
# PreToolUse hook: block raw npm/yarn/pnpm/npx, require ni equivalents

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

if [ "$TOOL" != "Bash" ]; then
  exit 0
fi

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# 引用文字列の中身は実行されないコマンドなのでマッチ対象から除外する
# （エスケープされた引用符などの完全な構文解析はしない — soft guardrail で十分）
STRIPPED=$(printf '%s' "$CMD" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

# Match standalone npm/yarn/pnpm/npx (not inside another word)
if echo "$STRIPPED" | rg -q '(^|[;&|() ])npm(\s|$)'; then
  echo "npm は禁止。ni を使ってください（npm install → ni, npm run → nr）" >&2
  exit 2
fi

if echo "$STRIPPED" | rg -q '(^|[;&|() ])yarn(\s|$)'; then
  echo "yarn は禁止。ni を使ってください" >&2
  exit 2
fi

if echo "$STRIPPED" | rg -q '(^|[;&|() ])pnpm(\s|$)'; then
  echo "pnpm は禁止。ni を使ってください" >&2
  exit 2
fi

if echo "$STRIPPED" | rg -q '(^|[;&|() ])npx(\s|$)'; then
  echo "npx は禁止。nlx を使ってください" >&2
  exit 2
fi

if echo "$STRIPPED" | rg -q '(^|[;&|() ])bun(x?)(\s|$)'; then
  echo "bun/bunx は禁止。ni / nlx を使ってください" >&2
  exit 2
fi

exit 0
