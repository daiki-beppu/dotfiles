#!/bin/bash
# PreToolUse hook: block grep in Bash commands, suggest rg instead

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

if [ "$TOOL" != "Bash" ]; then
  exit 0
fi

CMD=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# 引用文字列の中身は実行されないコマンドなのでマッチ対象から除外する
# （エスケープされた引用符などの完全な構文解析はしない — soft guardrail で十分）
STRIPPED=$(printf '%s' "$CMD" | sed -E "s/'[^']*'//g; s/\"[^\"]*\"//g")

# Match standalone grep command (not inside rg, not part of another word)
if echo "$STRIPPED" | rg -q '(^|[;&|() ])grep(\s|$)'; then
  echo "grep は禁止。rg (ripgrep) を使ってください" >&2
  exit 2
fi

exit 0
