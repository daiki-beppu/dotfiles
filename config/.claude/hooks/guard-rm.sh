#!/bin/bash
# PreToolUse(Bash) hook: `rm` を止めて、macOS の `trash` でゴミ箱へ移すよう促す。
#
# `rm` を permissions.ask に置くと、画面なしで動くエージェント（takt など）では確認を出せずに
# 拒否扱いになり、生成物の退避のような正当な作業まで止まる。かといって ask を外すと、パスを
# 取り違えたときに追跡外のファイル（.env、録音など）を戻せない。`trash` ならゴミ箱から戻せるので、
# 削除は確認なしで通しつつ、取り返しのつかない消し方だけを塞ぐ。
#
# 判定:
#   - コマンドを && / || / ; / | / 改行で区切り、各区切りの先頭のコマンドを読む
#   - 先頭の ( { と環境変数の代入、sudo / command / env / nohup / time / exec / xargs は読み飛ばす
#   - そのコマンドが rm（/bin/rm を含む）か、find に -delete か -exec rm があれば拒否する
#   - `git rm` は git の追跡下の操作で戻せるので対象外
#
# jq が無いときは何も出力せずに通す。

input=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

cmd=$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null) || exit 0
case "$cmd" in *rm*|*-delete*) ;; *) exit 0 ;; esac

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

reason='rm は使わず、`trash <path>...` でゴミ箱へ移してください（-r / -f は不要で、ディレクトリもそのまま渡せます。Finder のゴミ箱から戻せます）。存在しないパスはエラーになるので、必要なら `[ -e <path> ] && trash <path>` のように書いてください。'

segments=${cmd//&&/$'\n'}
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
    rm | */rm) deny "$reason" ;;
    find)
      case " ${words[*]} " in
        *" -delete "* | *" -exec rm "* | *" -exec /bin/rm "* | *" -execdir rm "*) deny "$reason" ;;
      esac
      ;;
  esac
done <<<"$segments"

exit 0
