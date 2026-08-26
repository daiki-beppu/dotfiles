---
name: clean-branch
description: >-
  マージ済み・不要になったローカル/リモートブランチと worktree 残骸を一括削除する。
  「ブランチ整理」「branch 掃除」で発動。--dry-run で分類一覧の提示のみ。
---

## Overview

不要になったローカル・リモートブランチを検出し、一括削除する。

**重要**: マージ判定は `git branch --merged` ではなく **PR の state** を真実とする。GitHub が squash / rebase マージを使う場合、マージ済みブランチでも `git branch --merged` には現れない（tip コミットが main から到達不能なため）。`--merged` だけに頼ると **squash マージ済みブランチを「未マージ＝作業中」と誤判定**して取りこぼす。

## When to Use

- マージ済みブランチが溜まってきたとき
- `git branch` の一覧を整理したいとき
- worktree の残骸を片付けたいとき

## Invocation variants

- Bare invocation → Step 1〜6 を通す（突き合わせ → 個別確認 → worktree 処理 → 承認 → 削除 → 報告）。
- `--dry-run` → Step 4 の分類別一覧までを出して**停止する**。何も削除しない。
- `--local` / `--remote` → 削除対象をローカルブランチのみ / リモートブランチのみに絞る。
- `--worktrees` → Step 3 だけを実行し、**ブランチは 1 本も消さない**。
- `--merged-only` → 削除対象を MERGED 分類だけに限定する。
- `--include-no-pr` → 既定では個別確認止まりの NO_PR も削除候補に含める。

`--local` / `--remote` / `--merged-only` / `--include-no-pr` は併用できる。`--dry-run` は任意の変種への修飾子として働く。

## 実行スタイル

- **調査は自分で行う**: ブランチと PR の突き合わせを subagent に委任しない。`git` / `gh` 数回で終わる範囲であり、削除承認を取る主体を分けない
- **実況しない**: 分類が終わるまで進捗を書かず、Step 4 の分類別一覧を最初のまとまった出力にする
- **スコープを広げない**: ブランチと worktree の削除だけを行う。tag / stash / reflog の整理や、残ったブランチの rebase には踏み込まない

## Instructions

### 1. 全ブランチと全 PR を取得して突き合わせる

```bash
git fetch --prune --tags
# デフォルトブランチを解決（master / develop 等のリポジトリでも安全に動くように）
DEFAULT_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)
DEFAULT_BRANCH=${DEFAULT_BRANCH#origin/}
[ -n "$DEFAULT_BRANCH" ] || DEFAULT_BRANCH=main
# 全 PR を 1 回で取得（API 節約）
gh pr list --state all --limit 800 --json number,state,headRefName,mergedAt > /tmp/all_prs.json
# 対象ブランチ（local + remote, デフォルトブランチ/HEAD 除外）
{ git branch --format='%(refname:short)'
  git branch -r --format='%(refname:short)' | sed 's#^origin/##'; } \
  | grep -vE "^(origin/?|${DEFAULT_BRANCH}|HEAD)$" | grep -v ' -> ' | sort -u > /tmp/branches.txt
```

各ブランチを `headRefName` で PR に紐づけ、state で分類する（MERGED > OPEN > CLOSED の優先で代表 state を採用）:

| 分類 | 意味 | 安全性 |
|---|---|---|
| **MERGED** | PR がマージ済み（squash 含む） | 安全（成果は main にある） |
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

### 3. worktree 紐づき・残骸を処理

```bash
git worktree list                 # prunable 表示と各ブランチの checkout 先を確認
git worktree prune -v             # 実体ディレクトリが消えた登録（prunable）を掃除
```

- **worktree に checkout 中のブランチは `git branch -d` できない**。先に `git worktree remove <path>` する
- 未コミット変更がある worktree を消すときは中身を確認してから `git worktree remove --force`

**`.claude/worktrees/` 配下は特に溜まる。** `--worktree` / EnterWorktree で作った worktree は `cleanupPeriodDays` の自動スイープ対象外（スイープされるのは subagent / background セッション由来のみ）。セッション終了時に「保持」を選ぶと、削除するまで永久に残る。

各 worktree が安全に消せるかは 3 点で判定する。すべて空なら失われる作業は無い:

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

```bash
# ローカル: MERGED でも squash の場合 -d は「未マージ」と拒否するため -D を使う
git branch -D <branch>

# リモート: 複数を 1 コマンドで一括削除できる
git push origin --delete <branch1> <branch2> <branch3> ...
```

### 6. 結果報告と復元手段の案内

削除した件数・分類別内訳を表示し、復元方法を添える:
- **CLOSED PR のブランチ**: GitHub の PR ページ「Restore branch」
- **NO_PR のローカルブランチ**: `git reflog` から約 90 日間（削除時 SHA はログに残る）

## Rules

- **デフォルトブランチ（main / master 等、origin/HEAD が指す先）には絶対に触れない**
- **マージ判定は PR state を真実とする**（`git branch --merged` は squash マージを取りこぼすため補助的にしか使わない）
- **OPEN PR のブランチは削除しない**
- NO_PR のローカル専用ブランチはユニークコミットの有無を確認してから削除（復元は reflog のみ）。`--include-no-pr` を付けても Step 2 の確認は省略しない
- 削除前に必ず分類別の対象一覧をユーザーに提示し、確認を取る。スコープを絞るフラグ（`--local` / `--remote` / `--merged-only` / `--include-no-pr` / `--worktrees`）はこの承認を免除しない
- worktree に checkout 中のブランチは先に `git worktree remove` してから削除する

## Gotchas

- **`git branch -d` が拒否する**: squash マージ済みブランチは未マージ扱いなので `-d` が失敗する。PR state で MERGED 確認済みなら `-D` で削除してよい
- **zsh の落とし穴**: `mapfile` は使えない（bash 専用）。配列は `arr=("${(@f)$(cmd)}")` で行分割、要素は `"${arr[@]}"` で展開。`for x in $var` は zsh では単語分割されない（`"${(@f)var}"` か配列を使う）
- **リモートブランチ一括削除**: `git push origin --delete b1 b2 b3` と複数 ref をまとめて渡せる（push 回数を減らせる）
