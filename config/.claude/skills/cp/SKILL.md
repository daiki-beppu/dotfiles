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

   **issue リンク検出**（必須ステップ）:

   - **ブランチ名から抽出**: `feat/14-add-auth` / `fix/332-auth-loop` のようなパターンから番号を取得
   - **ブランチ名に番号が無い場合**: 差分の文脈（修正対象ファイル / 機能名 / commit 履歴）と open issue を照合して候補を絞り、ユーザーに確認:

     ```bash
     gh issue list --state open --limit 20 --json number,title,labels
     ```

   - 検出した番号は open であることを確認:

     ```bash
     gh issue view <番号> --json state -q .state
     ```

   - open なら commit body に `Closes #<番号>`（バグ修正系は `Fixes #<番号>`）を **必ず含める**
   - 該当 issue が明確に無いと判断できる場合（純粋な内部リファクタなど）のみ Closes を省略してよい

4. **コミット実行**: `git commit` を実行
5. **プッシュ**: `git push` を実行（リモートブランチがなければ `-u origin <branch>` で設定）

## Rules

- コミットメッセージは必ず日本語
- タイプ（feat, fix, chore 等）を必ず含める
- 破壊的変更がある場合は `!` を付ける
- プッシュ前にリモートブランチの存在を確認
- **issue を解決するコミットは body に `Closes #N` / `Fixes #N` を必須**。件名末尾の `(#N)` だけでは GitHub の自動クローズが発火しないため、両者を併用すること
- 該当 issue が無いと明確に判断できる場合のみ Closes を省略可（その判断はユーザーに確認）
