#!/bin/bash
# PreToolUse(Bash) hook: `pkill` / `killall` を止めて、PID を確かめてから `kill <PID>` するよう促す。
#
# パターンや名前で止めると、同じ名前で動くほかのセッションのプロセスや利用者のアプリまで巻き込む。
# 2026-10-13 には `pkill -f "node src/server.ts" -P 1`（macOS の pkill は `-P 1` の後ろを
# もう一つのパターンと読む）が、ほかのセッションのサーバーと利用者の Orca のターミナルを落とした。
# 自分が起こしたプロセスかを確かめてから PID を名指しすれば、止める範囲を取り違えない。
#
# 判定（guard-rm.sh と同じ読み方）:
#   - 引用符の中を除いてから、コマンドを && / || / ; / | / 改行で区切り、各区切りの先頭のコマンドを読む
#   - 先頭の ( { と環境変数の代入、sudo / command / env / nohup / time / exec / xargs は読み飛ばす
#   - そのコマンドが pkill / killall（/usr/bin/pkill などのパスを含む）なら拒否する
#   - `pgrep` と `kill <PID>` は対象外
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

reason='pkill / killall は使わないでください。名前やパターンで止めると、ほかのセッションや利用者のアプリまで落とします（macOS の pkill は `-P 1` のような後ろの引数をもう一つのパターンと読みます）。`pgrep -fl <pattern>` か `ps -o pid,ppid,command -p <PID>` で PID を探し、自分が起こしたプロセスだと確かめてから `kill <PID>...` で名指ししてください。'

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
