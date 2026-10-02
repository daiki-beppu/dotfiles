#!/bin/bash
# PreToolUse(Bash) hook: CI が green でない PR の `gh pr merge` を拒否する。
#
# private リポジトリの Free プランでは branch protection も rulesets も使えず、GitHub 側で
# 「CI green でなければマージ不可」を強制できない。`gh pr checks --watch` は PR 作成直後
# （チェック未登録）だと "no checks reported" で即終了し、`| tail` を挟むと失敗も消える。
# その結果 CI 未完了のままマージが走るので、実行前に止める。
#
# 判定:
#   - コマンドを && / || / ; / | / 改行で区切り、先頭から順に読む
#   - `cd <path>` があれば以降の実行ディレクトリをそこへ移す（起点は hook 入力の cwd）
#   - `gh pr merge` を見つけたら、同じ PR 指定（番号・URL・ブランチ、省略時は現在ブランチ）と
#     -R/--repo で `gh pr checks` を引き、チェックが 1 件以上あり、すべて pass か skipping の
#     ときだけ通す。--auto は GitHub 側がチェックを待つので通す
#
# 判定できないとき（gh や jq が無い）は何も出力せずに通す。

input=$(cat)
command -v jq >/dev/null 2>&1 || exit 0
command -v gh >/dev/null 2>&1 || exit 0

cmd=$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null) || exit 0
dir=$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null) || exit 0
case "$cmd" in *"gh pr merge"*) ;; *) exit 0 ;; esac

resolve_dir() {
  local base="$1" path="$2"
  path="${path%\"}"; path="${path#\"}"
  path="${path%\'}"; path="${path#\'}"
  case "$path" in
    "~") path="$HOME" ;;
    "~/"*) path="$HOME/${path#\~/}" ;;
    /*) ;;
    *)
      [ -n "$base" ] || return 1
      path="$base/$path"
      ;;
  esac
  (cd "$path" 2>/dev/null && pwd -P)
}

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
      "(" | "{") i=$((i + 1)) ;;
      "("*) words[i]="${w#(}"; break ;;
      [A-Za-z_]*=*) i=$((i + 1)) ;;
      *) break ;;
    esac
  done
  [ "$i" -lt "${#words[@]}" ] || continue

  case "${words[$i]}" in
    cd)
      target="${words[$((i + 1))]:-}"
      if [ -z "$target" ] || [ "$target" = "~" ]; then
        dir="$HOME"
      else
        dir=$(resolve_dir "$dir" "$target") || dir=""
      fi
      ;;
    gh)
      [ "${words[$((i + 1))]:-}" = "pr" ] && [ "${words[$((i + 2))]:-}" = "merge" ] || continue
      pr="" repo=() auto=""
      j=$((i + 3))
      while [ "$j" -lt "${#words[@]}" ]; do
        w="${words[$j]}"
        case "$w" in
          --auto) auto=1 ;;
          -R | --repo) j=$((j + 1)); repo=(-R "${words[$j]:-}") ;;
          --repo=*) repo=(-R "${w#--repo=}") ;;
          -b | --body | -F | --body-file | -t | --subject | -A | --author-email | --match-head-commit) j=$((j + 1)) ;;
          -*) ;;
          *) [ -n "$pr" ] || pr="$w" ;;
        esac
        j=$((j + 1))
      done
      [ -z "$auto" ] || continue
      checks=$(cd "${dir:-.}" 2>/dev/null && gh pr checks ${pr:+"$pr"} "${repo[@]}" --json name,bucket 2>&1)
      label="PR ${pr:-（現在のブランチ）}"
      if ! jq -e 'type == "array"' <<<"$checks" >/dev/null 2>&1; then
        deny "$label の CI チェックを取得できません（${checks//$'\n'/ }）。PR 作成直後はチェックが未登録のことがあります。\`gh pr checks\` にチェックが現れ、すべて pass になってからマージしてください。"
      fi
      total=$(jq 'length' <<<"$checks")
      bad=$(jq -r '[.[] | select(.bucket != "pass" and .bucket != "skipping") | "\(.name):\(.bucket)"] | join(", ")' <<<"$checks")
      if [ "$total" -eq 0 ]; then
        deny "$label には CI チェックがまだ 1 件もありません。チェックが現れ、すべて pass になってからマージしてください。"
      fi
      if [ -n "$bad" ]; then
        deny "$label の CI が green ではありません（$bad）。すべて pass になってからマージしてください。"
      fi
      ;;
  esac
done <<<"$segments"

exit 0
