---
name: branch-clean
description: Use when マージ済みの不要ブランチを一括削除したいとき。「ブランチ整理」「マージ済み削除」「branch 掃除」「ブランチ一覧きれいにして」など、ブランチの整理に関わる場面で使用すること
---

## Overview

main にマージ済みのローカル・リモートブランチを検出し、一括削除する。

## When to Use

- マージ済みブランチが溜まってきたとき
- `git branch` の一覧を整理したいとき

## Instructions

### 1. マージ済みブランチを検出

```bash
# main にマージ済みのローカルブランチを一覧（main 自体は除外）
git branch --merged main | grep -v '^\*' | grep -v 'main'
```

### 2. リモートのマージ済みブランチも検出

```bash
git fetch --prune
git branch -r --merged main | grep -v 'HEAD' | grep -v 'main'
```

### 3. 検出結果をユーザーに表示

削除対象のブランチ一覧を表示し、実行確認を取る。

### 4. 削除実行

```bash
# ローカルブランチ削除
git branch -d <branch>

# リモートブランチ削除
git push origin --delete <branch>
```

### 5. 結果報告

削除したブランチ数とブランチ名の一覧を表示する。

## Rules

- **main ブランチには絶対に触れない**
- **未マージのブランチは対象外**（`git branch --merged` のみ使用）
- 削除前に必ず対象一覧をユーザーに提示し、確認を取る
- アクティブ worktree に紐づくブランチは削除しない
