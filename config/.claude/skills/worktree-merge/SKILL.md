---
name: worktree-merge
description: Use when worktree での作業が完了し、main ブランチへのマージとクリーンアップが必要なとき。「マージして」「メインに反映」「worktree 完了」など、worktree ブランチの統合に関わる場面で使用すること
---

## Overview

Git worktree で作業したブランチを main にマージし、worktree を削除してクリーンアップする。

## When to Use

- worktree での実装が完了し、main に反映したいとき
- `/cp` でコミット&プッシュ済みの worktree ブランチをマージしたいとき

## Prerequisites

- worktree ブランチの変更がすべてコミット済みであること
- リモートにプッシュ済みであること（`/cp` 実行済み）

## Instructions

### 1. 現在の状態を確認

```bash
git status --short                    # 未コミットの変更がないこと
git branch --show-current             # 現在のブランチ名を確認
git log --oneline -3                  # 直近のコミットを確認
```

### 2. メインリポジトリのパスを特定

```bash
git worktree list                     # メインリポジトリのパスを確認
```

出力例:
```
/Users/mba/01-dev/youtube-channels                              abc1234 [main]
/Users/mba/01-dev/youtube-channels/.claude/worktrees/feature-x  def5678 [worktree-feature-x]
```

1行目がメインリポジトリのパス。

### 3. マージ実行

メインリポジトリに移動してマージする（worktree 内では main を checkout できないため）:

```bash
MAIN_REPO=$(git worktree list | head -1 | awk '{print $1}')
BRANCH=$(git branch --show-current)

cd "$MAIN_REPO" && git merge "$BRANCH" --no-ff -m "$(cat <<EOF
<type>: <説明>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)"
```

- コミットメッセージは commit-convention に従う
- `--no-ff` でマージコミットを作成し、ブランチの履歴を保持する

### 4. リモートにプッシュ

```bash
cd "$MAIN_REPO" && git push
```

### 5. クリーンアップ

```bash
# worktree を削除
WORKTREE_PATH=$(pwd)
cd "$MAIN_REPO"
git worktree remove "$WORKTREE_PATH"

# ローカル・リモートのフィーチャーブランチを削除
git branch -d "$BRANCH"
git push origin --delete "$BRANCH"
```

## Rules

- **スコープ**: 現在セッションで作業中の worktree ブランチのみを対象とする。他の worktree や古い孤立ブランチには一切触れないこと
- マージ前に必ず未コミットの変更がないことを確認する
- メインリポジトリのパスは `git worktree list` から動的に取得する（ハードコード禁止）
- コミットメッセージは commit-convention に従い日本語で記述する
- クリーンアップ（worktree 削除・ブランチ削除）まで実行して完了とする
