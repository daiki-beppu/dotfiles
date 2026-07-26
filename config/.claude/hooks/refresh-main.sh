#!/bin/bash
# SessionStart hook: メインチェックアウトのデフォルトブランチにいるときだけ最新化する。
#
# worktree.baseRef = "head" は「セッションの cwd の HEAD」から分岐する。worktree を切る
# 時点で main が古いと、無用な merge conflict と「すでに main に入っている変更の再実装」を
# 招く。前者は事後の merge で払えるが、後者は書いてしまった時点で回復できない。
#
# 何もせず抜ける条件（作業中の状態に副作用を出さないため）:
#   - git リポジトリでない
#   - worktree 内にいる        … メインチェックアウトのブランチを勝手に動かさない
#   - デフォルトブランチ以外    … 作業中の feature ブランチに触れない
#   - upstream が無い
#   - 未コミット変更がある      … pull を中途半端に失敗させない

git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

# worktree では git-dir が .git/worktrees/<name> を指し common-dir と食い違う
[ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ] || exit 0

DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)
DEFAULT_BRANCH=${DEFAULT_BRANCH#origin/}
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH=main

CURRENT=$(git symbolic-ref --short HEAD 2>/dev/null) || exit 0
[ "$CURRENT" = "$DEFAULT_BRANCH" ] || exit 0

git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1 || exit 0
[ -z "$(git status --porcelain)" ] || exit 0

BEFORE=$(git rev-parse HEAD)

if git pull --ff-only --quiet >/dev/null 2>&1; then
  AFTER=$(git rev-parse HEAD)
  if [ "$BEFORE" != "$AFTER" ]; then
    COUNT=$(git rev-list --count "${BEFORE}..${AFTER}")
    echo "[refresh-main] ${DEFAULT_BRANCH} を ${COUNT} コミット分最新化しました。worktree はこの HEAD から分岐します。"
  fi
else
  AHEAD=$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo '?')
  BEHIND=$(git rev-list --count 'HEAD..@{u}' 2>/dev/null || echo '?')
  echo "[refresh-main] ${DEFAULT_BRANCH} の ff-only 更新に失敗しました (ahead=${AHEAD}, behind=${BEHIND})。worktree を切る前に手動で解消してください。"
fi

exit 0
