---
name: wt-merge
description: Use when worktree での作業が完了し、main ブランチへのマージとクリーンアップが必要なとき。「マージして」「メインに反映」「worktree 完了」など、worktree ブランチの統合に関わる場面で使用すること
---

## Overview

Git worktree ブランチを main にマージし、リモートにプッシュする。
worktree やブランチの削除は行わない（`/wt-clean` で別途実施）。

## Prerequisites

- 変更がすべてコミット・プッシュ済みであること（`/cp` 実行済み）

## Bash コール 1: 状態確認

以下を**そのまま**1回の Bash コールで実行する:

```bash
git status --short && echo "---" && git branch --show-current && echo "---" && git log --oneline -3 && echo "---" && git worktree list
```

出力から以下を確認:
- 未コミットの変更がないこと
- ブランチ名を把握（コミットメッセージ作成に使用）

## コミットメッセージを作成

Bash を実行せず、commit-convention に従いマージコミットメッセージを日本語で作成する。

## Bash コール 2: マージ → プッシュ

以下のテンプレートの `<commit-message>` 部分だけを置き換え、**1回の Bash コール**で実行する。
何も分割しない。何も追加しない。

```bash
MAIN_REPO=$(git worktree list | head -1 | awk '{print $1}') &&
BRANCH=$(git branch --show-current) &&
cd "$MAIN_REPO" &&
git merge "$BRANCH" --no-ff -m "$(cat <<'EOF'
<commit-message>

Co-Authored-By: Claude <noreply@anthropic.com>
EOF
)" &&
git push origin main
```

IMPORTANT: このテンプレートを分割・改変してはならない。`<commit-message>` の置換のみ行うこと。

## Troubleshooting

**マージコンフリクト**: `&&` チェーンで自動停止する。worktree はまだ存在するので、別 Bash コールで解決後、Bash コール 2 を再実行する。

## Rules

- **スコープ**: 現在セッションの worktree ブランチのみ対象。他の worktree や古いブランチには触れない
- worktree 削除・ブランチ削除は行わない
- メインリポジトリのパスは `git worktree list` から動的に取得（ハードコード禁止）
- コミットメッセージは commit-convention に従い日本語で記述
