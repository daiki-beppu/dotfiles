#!/usr/bin/env bash
# takt-worktrees 配下の残骸(full clone / linked worktree)を安全側スイープする。
#
# 削除するのは以下のいずれかを満たすものだけ(すべて fail-closed):
#   1. ブランチの PR が MERGED 済み、かつ dirty なし
#   2. HEAD が origin のデフォルトブランチに含まれる(独自コミットなし)、かつ dirty なし
# それ以外(未コミット変更あり / PR 未マージ / origin なし / 判定不能)は
# 絶対に削除せず [KEEP] として報告のみ行う。
#
# 使い方:
#   sweep.sh [--dry-run] [root ...]
#   root 省略時は $HOME/02-yt/takt-worktrees
set -uo pipefail

# launchd から起動されるため PATH を明示する(nix profile に gh / git がある)
export PATH="/etc/profiles/per-user/$(whoami)/bin:/run/current-system/sw/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"

DRY_RUN=0
ROOTS=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    *) ROOTS+=("$arg") ;;
  esac
done
[ ${#ROOTS[@]} -eq 0 ] && ROOTS=("$HOME/02-yt/takt-worktrees")

DELETE_LABEL="DELETE"
[ "$DRY_RUN" -eq 1 ] && DELETE_LABEL="WOULD-DELETE"

deleted=0
kept=0
freed_kb=0
declare -a prune_repos=()

log() { printf '%s\n' "$*"; }

# origin の HEAD が指すデフォルトブランチ名を返す(取得失敗時は空)
default_branch() {
  git -C "$1" ls-remote --symref origin HEAD 2>/dev/null |
    awk '/^ref:/ { sub("refs/heads/", "", $2); print $2; exit }'
}

# $1=dir $2=reason
keep() {
  log "[KEEP]   $1  ($2)"
  kept=$((kept + 1))
}

# $1=dir $2=reason
remove_dir() {
  local d="$1" reason="$2" size_kb
  size_kb=$(du -sk "$d" 2>/dev/null | awk '{print $1}')
  log "[$DELETE_LABEL] $d  ($reason, $((size_kb / 1024))MB)"
  [ "$DRY_RUN" -eq 1 ] && return 0
  if [ -f "$d/.git" ]; then
    # linked worktree: 親リポジトリ経由で登録ごと削除する
    local common main_repo
    common=$(git -C "$d" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
    main_repo=$(dirname "$common")
    if git -C "$main_repo" worktree remove --force "$d" 2>/dev/null; then
      prune_repos+=("$main_repo")
    else
      rm -rf "$d"
      prune_repos+=("$main_repo")
    fi
  else
    rm -rf "$d"
  fi
  deleted=$((deleted + 1))
  freed_kb=$((freed_kb + size_kb))
}

sweep_one() {
  local d="$1"

  if ! git -C "$d" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    # takt がログ用に再作成する空骨組み(.takt/ のみ等)は失うものがないので消す
    if [ -z "$(find "$d" -type f -print -quit 2>/dev/null)" ]; then
      remove_dir "$d" "git 管理外かつファイルなしの空ディレクトリ"
    else
      keep "$d" "git リポジトリではない(ファイルあり)"
    fi
    return
  fi
  if [ -n "$(git -C "$d" status --porcelain 2>/dev/null)" ]; then
    keep "$d" "未コミット変更あり"
    return
  fi

  local origin_url
  origin_url=$(git -C "$d" remote get-url origin 2>/dev/null || true)
  if [ -z "$origin_url" ]; then
    keep "$d" "origin なし"
    return
  fi

  # github.com の owner/repo を抽出(それ以外のホストは判定不能として残す)
  local slug
  slug=$(printf '%s' "$origin_url" | sed -nE 's#.*github\.com[:/]([^/]+/[^/]+)$#\1#p' | sed 's/\.git$//')
  if [ -z "$slug" ]; then
    keep "$d" "GitHub 以外の origin: $origin_url"
    return
  fi

  local def
  def=$(default_branch "$d")
  if [ -z "$def" ]; then
    keep "$d" "デフォルトブランチ取得失敗(ネットワーク?)"
    return
  fi
  if ! git -C "$d" fetch --quiet origin "$def" 2>/dev/null; then
    keep "$d" "fetch 失敗"
    return
  fi

  local branch
  branch=$(git -C "$d" symbolic-ref --short -q HEAD || echo "")

  # 判定 1: ブランチの PR が MERGED 済み
  if [ -n "$branch" ] && [ "$branch" != "$def" ]; then
    local merged
    merged=$(gh pr list -R "$slug" --head "$branch" --state merged --json number --jq 'length' 2>/dev/null || echo "")
    if [ "${merged:-0}" -ge 1 ] 2>/dev/null; then
      remove_dir "$d" "PR merged: $branch"
      return
    fi
  fi

  # 判定 2: HEAD がデフォルトブランチに含まれる(独自コミットなし)
  if git -C "$d" merge-base --is-ancestor HEAD "origin/$def" 2>/dev/null; then
    remove_dir "$d" "HEAD は origin/$def に含まれる"
    return
  fi

  keep "$d" "未マージコミットあり: ${branch:-detached}"
}

log "=== takt-clean sweep $(date '+%Y-%m-%d %H:%M:%S') (dry-run=$DRY_RUN) ==="
for root in "${ROOTS[@]}"; do
  if [ ! -d "$root" ]; then
    log "--- $root: ディレクトリなし(スキップ)"
    continue
  fi
  log "--- root: $root"
  for d in "$root"/*/; do
    [ -d "$d" ] || continue
    sweep_one "${d%/}"
  done
done

# linked worktree を消したリポジトリの登録残骸を掃除
if [ "$DRY_RUN" -eq 0 ] && [ ${#prune_repos[@]} -gt 0 ]; then
  printf '%s\n' "${prune_repos[@]}" | sort -u | while read -r repo; do
    git -C "$repo" worktree prune 2>/dev/null || true
  done
fi

log "=== 結果: 削除 $deleted 件 / 回復 $((freed_kb / 1024 / 1024))GB($((freed_kb / 1024))MB) / 保持 $kept 件 ==="
[ "$kept" -gt 0 ] && log "保持分は上の [KEEP] 行を確認し、不要なら手動削除か issue/PR 化で解消すること"
exit 0
