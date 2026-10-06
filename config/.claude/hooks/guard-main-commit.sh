#!/bin/bash
# PreToolUse(Bash) hook: main / master ブランチ上での git commit と、メインチェックアウトの HEAD を
# 動かす操作を拒否する。
#
# 規約「開発作業は必ず worktree 上で行う」を機械的に強制する。手動 `git worktree add` で
# worktree を作るとセッションの cwd はメインチェックアウトのまま残り、`cd` を付け忘れた
# `git add -A && git commit` が main 上で実行されてしまう。これを実行前に止める。
#
# 判定:
#   - コマンドを && / || / ; / | / 改行で区切り、先頭から順に読む
#   - `cd <path>` があれば以降の実行ディレクトリをそこへ移す（起点は hook 入力の cwd）
#   - `git [-C <path>]... commit` を見つけたら、そのディレクトリの現在ブランチを調べ、
#     main / master なら deny する
#   - `git checkout` / `git switch` / `git reset --hard` は、そのディレクトリがメインチェックアウト
#     （linked worktree ではない）なら deny する。メインチェックアウトは並行する他のセッションも
#     使うので、HEAD を動かしたり変更を捨てたりすると相手の作業が壊れる。`git checkout main` /
#     `git switch main`（master も）だけは、main へ戻す操作として通す
#
# 判定できないとき（cwd 不明・cd 先が存在しない・git リポジトリでない・detached HEAD 等）は
# 何も出力せずに通す。誤検知で作業を止めないため。

input=$(cat)
command -v jq >/dev/null 2>&1 || exit 0

cmd=$(jq -r '.tool_input.command // empty' <<<"$input" 2>/dev/null) || exit 0
dir=$(jq -r '.cwd // empty' <<<"$input" 2>/dev/null) || exit 0
[ -n "$cmd" ] || exit 0

# 相対パス・~ をディレクトリ $1 起点で解決して絶対パスを出す。解決できなければ失敗
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

# 区切り記号を改行へ（|| と && を先に置換してから単独の | を置換する）
segments=${cmd//&&/$'\n'}
segments=${segments//||/$'\n'}
segments=${segments//;/$'\n'}
segments=${segments//|/$'\n'}

while IFS= read -r seg; do
  read -r -a words <<<"$seg"
  i=0
  # 先頭の ( や VAR=value を読み飛ばす
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
    git)
      gdir="$dir"
      j=$((i + 1))
      sub=""
      while [ "$j" -lt "${#words[@]}" ]; do
        w="${words[$j]}"
        case "$w" in
          -C)
            j=$((j + 1))
            if [ -n "$gdir" ] || [ "${words[$j]:-}" != "${words[$j]#/}" ]; then
              gdir=$(resolve_dir "$gdir" "${words[$j]:-}") || gdir=""
            fi
            ;;
          -c) j=$((j + 1)) ;;
          -*) ;;
          *) sub="$w"; break ;;
        esac
        j=$((j + 1))
      done
      [ -n "$gdir" ] || continue
      args=("${words[@]:$((j + 1))}")
      case "$sub" in
        commit)
          branch=$(git -C "$gdir" symbolic-ref --short -q HEAD 2>/dev/null) || continue
          case "$branch" in
            main | master)
              deny "$gdir の現在ブランチは $branch です。$branch へ直接 commit せず、worktree で作業してください（\$REPO_ROOT/.claude/worktrees/<slug>/ に feature ブランチの worktree を作り、\`cd <worktree> && git commit\` か \`git -C <worktree> commit\` で実行する）。"
              ;;
          esac
          ;;
        checkout | switch | reset)
          if [ "$sub" = reset ]; then
            case " ${args[*]} " in *" --hard "*) ;; *) continue ;; esac
          elif [ "${#args[@]}" -eq 1 ]; then
            case "${args[0]}" in main | master) continue ;; esac
          fi
          paths=$(git -C "$gdir" rev-parse --path-format=absolute --git-dir --git-common-dir 2>/dev/null) || continue
          [ "$(sed -n 1p <<<"$paths")" = "$(sed -n 2p <<<"$paths")" ] || continue
          deny "$gdir はメインチェックアウトです。並行する他のセッションも使うので、git $sub で HEAD を動かしたり変更を捨てたりしないでください。main の内容を見るだけなら \`git show origin/main:<path>\`、別のブランチで作業するなら Orca の worktree（\`orca worktree create --repo name:<repo> --name <slug> --base-branch origin/main\`）を使う。"
          ;;
      esac
      ;;
  esac
done <<<"$segments"

exit 0
