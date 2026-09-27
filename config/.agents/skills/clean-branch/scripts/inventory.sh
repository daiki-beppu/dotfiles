#!/usr/bin/env bash
# ブランチ・worktree・PR の対応を TSV で出す。削除はしない。
#
# Usage: inventory.sh [remote]   (remote の既定は origin。事前に fetch しておく。prune は不要)
#
# 列: branch  tip  ahead  upstream  unpushed  pr  pr_state  tip_match  worktree  dirty
#   ahead      デフォルトブランチに無いコミット数（squash マージ後も 0 にならない）
#   upstream   追跡先。消えていれば gone、無ければ -。gone は ls-remote で実在を照合する
#              ので、prune していない古い追跡参照も gone になる
#   pr         headRefName が一致する最新の PR。gh が失敗したら ?（未確認）
#   tip_match  現在の tip が その PR の head と一致するか
#   dirty      worktree の未コミット・未追跡ファイル数
# リモートにだけ残るブランチは branch 列が <remote>/<name> になる。その upstream 列は
# 実在すれば -、古い追跡参照だけなら gone（リモート削除は不要）。
set -euo pipefail

remote="${1:-origin}"
default="$(git symbolic-ref --short "refs/remotes/$remote/HEAD" 2>/dev/null || echo "$remote/main")"
default_name="${default#"$remote"/}"

prs="$(gh pr list --state all --limit 1000 --json number,state,headRefName,headRefOid 2>/dev/null)" || prs=""

live="$(git ls-remote --heads "$remote" 2>/dev/null)" || live="?"
gone_on_remote() { # name -> リモートに実在しなければ成功（ls-remote 失敗時は判定しない）
  [ "$live" != "?" ] && ! awk -v r="refs/heads/$1" '$2 == r {f=1} END {exit !f}' <<<"$live"
}

worktrees="$(git worktree list --porcelain)"
worktree_of() { # branch -> path（無ければ -）
  awk -v ref="refs/heads/$1" '/^worktree /{p=substr($0,10)} $0=="branch " ref{print p; f=1} END{if(!f) print "-"}' <<<"$worktrees"
}

pr_fields() { # branch tip -> "pr<TAB>state<TAB>tip_match"
  if [ -z "$prs" ]; then printf '?\t?\t?'; return; fi
  jq -r --arg b "$1" --arg tip "$2" '
    [.[] | select(.headRefName == $b)] | max_by(.number)
    | if . == null then "-\tNO_PR\t-"
      else "#\(.number)\t\(.state)\t\(.headRefOid == $tip)" end' <<<"$prs"
}

printf 'branch\ttip\tahead\tupstream\tunpushed\tpr\tpr_state\ttip_match\tworktree\tdirty\n'

git for-each-ref --format='%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%(upstream:track)' refs/heads |
while IFS=$'\t' read -r b tip up track; do
  [ "$b" = "$default_name" ] && continue
  ahead="$(git rev-list --count "$default..$b")"
  unpushed=-
  if [ "$track" = "[gone]" ] || { [ "${up%%/*}" = "$remote" ] && gone_on_remote "${up#"$remote"/}"; }; then up=gone
  elif [ -n "$up" ]; then unpushed="$(git rev-list --count "$up..$b")"
  else up=-; fi
  wt="$(worktree_of "$b")" dirty=-
  [ "$wt" != - ] && dirty="$(git -C "$wt" status --porcelain | wc -l | tr -d ' ')"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$b" "$tip" "$ahead" "$up" "$unpushed" \
    "$(pr_fields "$b" "$(git rev-parse "$b")")" "$wt" "$dirty"
done

git for-each-ref --format='%(refname:short)%09%(objectname:short)' "refs/remotes/$remote" |
while IFS=$'\t' read -r rb tip; do
  name="${rb#"$remote"/}"
  case "$name" in HEAD|"$remote"|"$default_name") continue ;; esac
  git show-ref --quiet --verify "refs/heads/$name" && continue
  ahead="$(git rev-list --count "$default..$rb")" up=-
  gone_on_remote "$name" && up=gone
  printf '%s\t%s\t%s\t%s\t-\t%s\t-\t-\n' "$rb" "$tip" "$ahead" "$up" "$(pr_fields "$name" "$(git rev-parse "$rb")")"
done

# ブランチを持たない worktree（detached HEAD など）
awk '/^worktree /{p=substr($0,10)} /^detached/{print p}' <<<"$worktrees" |
while IFS= read -r p; do
  printf '(detached)\t%s\t-\t-\t-\t-\t-\t-\t%s\t%s\n' \
    "$(git -C "$p" rev-parse --short HEAD)" "$p" "$(git -C "$p" status --porcelain | wc -l | tr -d ' ')"
done
