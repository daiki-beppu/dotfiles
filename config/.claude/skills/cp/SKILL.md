---
name: cp
description: Use when you want to commit and push changes with a Japanese commit message following commit-convention
---

# cp (Commit & Push)

## Overview

変更をコミットしてプッシュする一連のフローを実行するスキル。commit-convention に従った日本語コミットメッセージを作成する。

## When to Use

- 変更をコミットしてプッシュしたいとき
- `/cp` コマンドを実行したとき

## Context を収集

以下のコマンドで現在の状態を確認：

```bash
git branch --show-current     # 現在のブランチ
git status --short            # ステータス
git diff --cached             # ステージ済みの変更
git diff                      # 未ステージの変更
git log --oneline -5          # 直近のコミット（スタイル参考）
```

## Commit Convention

**REQUIRED:** `/skills commit-convention` を参照してコミットメッセージを作成すること。

## Task

1. **差分確認**: 上記コマンドで変更内容を確認
2. **ステージング**: 未ステージの変更があれば `git add` で追加
3. **コミットメッセージ作成**: commit-convention に従い日本語でメッセージを作成
4. **コミット実行**: `git commit` を実行
5. **プッシュ**: `git push` を実行（リモートブランチがなければ `-u origin <branch>` で設定）

## Rules

- コミットメッセージは必ず日本語
- タイプ（feat, fix, chore 等）を必ず含める
- 破壊的変更がある場合は `!` を付ける
- プッシュ前にリモートブランチの存在を確認
