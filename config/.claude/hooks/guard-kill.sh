#!/bin/bash
# PreToolUse(Bash) hook: `pkill` / `killall` を止めて、自分で起動した PID を `kill` で止めるよう促す。
#
# 名前やパターンで止めると、同じ Mac で動いている利用者のアプリや並行セッションまで巻き込む。
# 2026-10-13 に `pkill -f "node src/server.ts" -P 1` が流れ、macOS（BSD）の pkill がパターンより
# 後ろの `-P 1` もパターンとして読んだため、コマンド行に「1」を含むプロセス（Orca のターミナル
# デーモン・Chrome・1Password など）が一斉に SIGTERM を受けた。
#
# 判定:
#   - 引用符の中を除いてから、コマンドを && / || / ; / | / 改行で区切り、各区切りの先頭のコマンドを読む
#   - 先頭の ( { と環境変数の代入、sudo / command / env / nohup / time / exec / xargs は読み飛ばす
#   - そのコマンドが pkill / killall（/usr/bin/pkill などを含む）なら拒否する
#   - `kill <PID>` は対象外
#
# jq が無いときは何も出力せずに通す。

input=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

cmd=$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null) || exit 0
case "$cmd" in *pkill*|*killall*) ;; *) exit 0 ;; esac

deny() {
  jq -n --arg reason "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
}

reason='pkill / killall は使わず、自分で起動したプロセスの PID を `kill <PID>` で止めてください。名前やパターンで止めると、利用者のアプリや並行セッションのプロセスまで巻き込みます（macOS の pkill はパターンより後ろのフラグもパターンとして読みます）。PID を控えていなければ、`lsof -ti tcp:<port>` や `pgrep -fl <pattern>` で一覧を出し、自分が起動したものだけを確かめてから kill してください。'

# 引用符の中（grep の正規表現やメッセージの文字列）を区切りや pkill と読まないよう、先に Q に置き換える
unquoted=$(printf '%s' "$cmd" | sed -E "s/'[^']*'/Q/g; s/\"([^\"\\\\]|\\\\.)*\"/Q/g")
segments=${unquoted//&&/$'\n'}
segments=${segments//||/$'\n'}
segments=${segments//;/$'\n'}
segments=${segments//|/$'\n'}

while IFS= read -r seg; do
  read -r -a words <<<"$seg"
  i=0
  while [ "$i" -lt "${#words[@]}" ]; do
    w="${words[$i]}"
    case "$w" in
      "(" | "{" | sudo | command | env | nohup | time | exec | xargs) i=$((i + 1)) ;;
      "("*) words[i]="${w#(}" ;;
      [A-Za-z_]*=*) i=$((i + 1)) ;;
      -*) [ "$i" -gt 0 ] && i=$((i + 1)) || break ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "${#words[@]}" ] || continue

  case "${words[$i]}" in
    pkill | */pkill | killall | */killall) deny "$reason" ;;
  esac
done <<<"$segments"

exit 0
