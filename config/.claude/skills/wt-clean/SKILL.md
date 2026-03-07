---
name: wt-clean
description: Use when 孤立した worktree ブランチの一括クリーンアップが必要なとき。「ブランチ整理」「古いブランチ削除」「worktree 掃除」など、不要ブランチの整理に関わる場面で使用すること
---

## Overview

worktree 実体のない孤立 `worktree-*` ブランチを検出し、一括クリーンアップする。

## When to Use

- `git branch` に不要な `worktree-*` ブランチが溜まっているとき
- worktree を手動削除した後のブランチ残骸を掃除したいとき

## Instructions

### 1. 孤立ブランチを検出

```bash
# アクティブ worktree のブランチ一覧を取得
ACTIVE_BRANCHES=$(git worktree list --porcelain | grep '^branch ' | sed 's|branch refs/heads/||')

# worktree-* パターンのローカルブランチから、アクティブなものを除外
for branch in $(git branch --format='%(refname:short)' | grep '^worktree-'); do
  if echo "$ACTIVE_BRANCHES" | grep -qx "$branch"; then
    echo "[ACTIVE] $branch（スキップ）"
  else
    echo "[ORPHAN] $branch"
  fi
done
```

### 2. 未マージコミットを確認

各孤立ブランチについて main との差分を確認:

```bash
git log --oneline main..<branch>
```

- **差分なし**: 安全に削除可能
- **差分あり**: ユーザーに差分を表示し、削除/スキップを確認する

### 3. 削除実行

```bash
# ローカルブランチ削除（マージ済み: -d、未マージで承認済み: -D）
git branch -d <branch>

# リモートにも同名ブランチがあれば削除
git push origin --delete <branch> 2>/dev/null
```

### 4. 結果報告

削除したブランチとスキップしたブランチの一覧を表示する。

## Rules

- **アクティブ worktree に紐づくブランチは絶対に削除しない**
- `worktree-*` パターン以外のブランチには触れない
- 未マージコミットがあるブランチは必ずユーザーに確認してから削除する
- main ブランチには絶対に触れない
