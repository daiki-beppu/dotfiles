---
name: clean-branch
description: >-
  マージ済み・不要になったローカル/リモートブランチと worktree 残骸を一括削除する。
  「ブランチ整理」「branch 掃除」で発動。--dry-run で分類一覧の提示のみ。
---

## Overview

不要になったローカル・リモートブランチを検出し、一括削除する。

**重要**: マージ判定は `git branch --merged` ではなく **PR の state** を真実とする。GitHub が squash / rebase マージを使う場合、マージ済みブランチでも `git branch --merged` には現れない（tip コミットが main から到達不能なため）。`--merged` だけに頼ると **squash マージ済みブランチを「未マージ＝作業中」と誤判定**して取りこぼす。

## Invocation variants

- Bare invocation → Step 1〜6 を通す（調査 → 対象一覧 → 承認 → 削除 → 検証・報告）。
- `--dry-run` → Step 4 の分類別一覧までを出して**停止する**。何も削除しない。
- `--local` / `--remote` → 削除対象をローカルブランチのみ / リモートブランチのみに絞る。
- `--worktrees` → Step 3 で調査し、Step 4〜6 で承認・削除・報告する。**ブランチは 1 本も消さない**。
- `--merged-only` → 削除対象を MERGED 分類だけに限定する。
- `--include-no-pr` → 既定では個別確認止まりの NO_PR も削除候補に含める。

`--local` / `--remote` / `--merged-only` / `--include-no-pr` は併用できる。`--dry-run` は全変種に優先し、調査と一覧提示まで。参照・worktree の prune、remove、branch 削除、push は実行しない。

## 実行スタイル

- **調査は自分で行う**: ブランチと PR の突き合わせを subagent に委任しない。`git` / `gh` 数回で終わる範囲であり、削除承認を取る主体を分けない
- **進め方**: 調査と一覧作成は自律的に進める。対象一覧への承認が既にあれば再確認せず実行し、変更・追加された対象だけ確認する。進捗は新たな判断材料が出たときに短く伝える
- **スコープを広げない**: ブランチと worktree の削除だけを行う。tag / stash / reflog の整理や、残ったブランチの rebase には踏み込まない

## Instructions

### 1. ブランチと PR を取得して突き合わせる

```bash
git fetch origin --no-prune
# デフォルトブランチを解決（master / develop 等のリポジトリでも安全に動くように）
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)
DEFAULT_BRANCH=${DEFAULT_BRANCH#origin/}
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH=main
# PR をまとめて取得。上限に達した場合は対象ブランチ別に補完する
gh pr list --state all --limit 800 --json number,state,headRefName,mergedAt > /tmp/all_prs.json
# 対象ブランチ（local + remote, デフォルトブランチ/HEAD 除外）
{ git branch --format='%(refname:short)'
  git branch -r --format='%(refname:short)' | sed 's#^origin/##'; } \
  | grep -vE "^(origin/?|${DEFAULT_BRANCH}|HEAD)$" | grep -v ' -> ' | sort -u > /tmp/branches.txt
```

各ブランチを `headRefName` で PR に紐づける。OPEN があれば削除対象外。名前が再利用されている場合は現在の tip と PR の対応を調べ、過去の MERGED だけで削除可としない。取得上限・照会失敗で未確認のものを NO_PR と断定しない。

| 分類 | 意味 | 安全性 |
|---|---|---|
| **MERGED** | 対応する PR がマージ済み（squash 含む） | マージ後の追加作業がないことも確認 |
| **CLOSED** | PR が未マージで close | 概ね安全（人間が意図的に close。GitHub PR ページから復元可） |
| **OPEN** | PR がオープン中 | **削除しない**（レビュー中） |
| **NO_PR** | 紐づく PR が無い | **要個別調査**（一度もレビューされていない。ローカルのみなら復元は reflog ~90日） |

### 2. NO_PR / CLOSED は中身を確認する

`--merged` で「未マージ」に見えても実体はマージ済みのことが多い。NO_PR・CLOSED は誤削除を避けるため個別に確認:

```bash
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)
DEFAULT_BRANCH=${DEFAULT_BRANCH#origin/}
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH=main
# デフォルトブランチより先行しているユニークコミットと最終更新日
git log --oneline "${DEFAULT_BRANCH}..<branch>"
git log -1 --format='%ci %s' <branch>
# 紐づく issue の open/closed
gh issue view <N> --json state,title
```

- ユニークコミットが既に別 PR で main 入り済み（重複）→ 削除可
- issue が closed / 別 PR に統合済み → 削除可
- ユニークな未マージ作業が残っている NO_PR → ユーザー判断を仰ぐ

### 3. worktree 紐づき・残骸を調査

```bash
git worktree list                 # prunable 表示と各ブランチの checkout 先を確認
git worktree prune --dry-run -v   # 消える登録を確認するだけ
```

- **worktree に checkout 中のブランチは `git branch -d` できない**。先に `git worktree remove <path>` する
- 未コミット変更がある場合は失われる内容を対象一覧に含める。`--force` を含む実削除は Step 5 で承認後に行う

**`.claude/worktrees/` 配下は特に溜まる。** `--worktree` / EnterWorktree で作った worktree は `cleanupPeriodDays` の自動スイープ対象外（スイープされるのは subagent / background セッション由来のみ）。セッション終了時に「保持」を選ぶと、削除するまで永久に残る。

各 worktree の未コミット変更・未追跡ファイル・main に無いコミットを確認し、失われる作業を一覧にする:

```bash
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)
DEFAULT_BRANCH=${DEFAULT_BRANCH#origin/}
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH=main
git worktree list --porcelain | rg '^worktree ' | sed 's/^worktree //' | rg '\.claude/worktrees/' \
| while read -r w; do
    echo "===== $w"
    git -C "$w" status --porcelain --untracked-files=all   # 未コミット変更・未追跡ファイル
    git -C "$w" log --oneline "${DEFAULT_BRANCH}..HEAD"      # デフォルトブランチに無いコミット
  done
```

> zsh では `for w in $(cmd)` が単語分割されないため、上記のように `while read -r` で受ける。

### 4. 検出結果をユーザーに表示し確認を取る

分類（MERGED / CLOSED / NO_PR）ごとに件数と一覧を提示し、**スコープを確認**してから削除する。リスクの低い MERGED と、復元しにくい NO_PR は分けて確認するとよい。

`--local` / `--remote` / `--merged-only` で対象を絞った場合も、分類（Step 1〜2）は全ブランチに対して行い、絞って外れた分は「対象外」として件数だけ一覧に添える。何が残っているかが見えないと、次に何を消すべきか判断できないため。

### 5. 削除実行

承認された worktree を `git worktree remove <path>` で先に削除する。失われる変更も承認された場合のみ `--force` を使う。prunable 登録の掃除も承認対象に含め、`git worktree prune -v` はその後に実行する。

```bash
# ローカル: MERGED でも squash の場合 -d は「未マージ」と拒否するため -D を使う
git branch -D <branch>

# リモート: 複数を 1 コマンドで一括削除できる
git push origin --delete <branch1> <branch2> <branch3> ...
```

### 6. 結果報告と復元手段の案内

削除後にブランチ一覧と `git worktree list` を確認し、承認対象が消えたことと対象外が残ったことを確かめる。成功・失敗・未実行の件数と残件、必要な復元方法を報告する。dry-run は計画として報告する。
- **CLOSED PR のブランチ**: GitHub の PR ページ「Restore branch」
- **NO_PR のローカルブランチ**: `git reflog` から約 90 日間（削除時 SHA はログに残る）

## Rules

- **デフォルトブランチ（main / master 等、origin/HEAD が指す先）には絶対に触れない**
- **マージ判定は PR state を真実とする**（`git branch --merged` は squash マージを取りこぼすため補助的にしか使わない）
- **OPEN PR のブランチは削除しない**
- NO_PR のローカル専用ブランチはユニークコミットの有無を確認してから削除（復元は reflog のみ）。`--include-no-pr` を付けても Step 2 の確認は省略しない
- 削除前に分類別の対象一覧への承認を得る（同じ対象への既存承認は有効）。スコープを絞るフラグ（`--local` / `--remote` / `--merged-only` / `--include-no-pr` / `--worktrees`）はこの承認を免除しない
- worktree に checkout 中のブランチは先に `git worktree remove` してから削除する

## Gotchas

- **zsh の落とし穴**: `mapfile` は使えない（bash 専用）。配列は `arr=("${(@f)$(cmd)}")` で行分割、要素は `"${arr[@]}"` で展開。`for x in $var` は zsh では単語分割されない（`"${(@f)var}"` か配列を使う）
