#!/bin/bash
# PreToolUse(Bash) hook: CI やファイルの出現を待つコマンドを、フォアグラウンドで流させない。
#
# `gh pr checks --watch` や `until [ -e <file> ]; do sleep …; done` をフォアグラウンドで流すと、
# 待っている間は会話が止まり、ユーザーには何をしているのか見えない（CI の待ちで 15 分止まった）。
# run_in_background: true で流せば、終わったときに通知が来て、その間も会話を続けられる。
#
# 判定:
#   - tool_input.run_in_background が true なら何もしない
#   - コマンドに `gh pr checks … --watch`、`gh run watch`、`until …; do … sleep` のどれかがあれば拒否する
#   - 引用符の中は区別しない（echo の文字列に書いただけでも拒否される。その場合は書き方を変える）
#
# jq が無いときは何も出力せずに通す。

input=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

[ "$(jq -r '.tool_input.run_in_background // false' <<<"$input" 2>/dev/null)" = true ] && exit 0
cmd=$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

flat=${cmd//$'\n'/ }
if [[ "$flat" =~ gh[[:space:]]+pr[[:space:]]+checks[^\;\&\|]*--watch ]] ||
  [[ "$flat" =~ gh[[:space:]]+run[[:space:]]+watch ]] ||
  [[ "$flat" =~ (^|[\;\&\|\(\{[:space:]])until[[:space:]].*do[[:space:]].*sleep ]]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "CI やファイルの出現を待つコマンドは、run_in_background: true で流してください。終わると通知が来るので、その間も会話を続けられます。待つ間は、ユーザーに何を待っているかを一言伝えてください。"
    }
  }'
fi
exit 0
