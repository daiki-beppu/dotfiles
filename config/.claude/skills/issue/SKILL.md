---
name: issue
description: |
  GitHub issue を会話コンテキストから新規作成するスキル（閲覧・検索・クローズ・コメント追加は対象外）。
  「issue にして」「issue 作って」「バグ報告して」など issue 起票の意図が読み取れる発話で発動する。
  ユーザーが問題・改善案・TODO を GitHub issue 化したい場面で使う。詳細な発動パターンは本文参照。
---

# issue

## Overview

会話コンテキストから GitHub issue を自動生成するスキル。会話の流れから適切なタイトル・本文・ラベルを推測し、ユーザー確認後に `gh issue create` で作成する。ラベル選定はリポジトリ固有の運用パターン（過去 issue から学習）と既存ラベルの description マッチングを組み合わせる。

## When to Use

- ユーザーが issue 作成を依頼したとき
- `/issue` コマンドを実行したとき
- バグ報告、機能リクエスト、TODO の issue 化を依頼されたとき

## 発動パターン

以下のような発話で発動する。「issue」という単語が含まれていなくても、起票の意図が読み取れれば発動する。

- 明示的な依頼: 「issue にして」「issue 作って」「これ issue に」「issue 立てて」「issue にまとめて」「追跡用に issue」
- 意図ベース: 「バグ報告して」「機能リクエスト出して」「TODO を issue に」
- 暗黙的な依頼: 「これバグ報告しといて」「追跡用にチケット切って」

閲覧・検索・クローズ・コメント追加は対象外（新規作成専用）。

## Context を収集

以下のコマンドで現在の状態と運用パターンを取得する：

```bash
gh repo view --json nameWithOwner                                # リポジトリ名
git branch --show-current                                        # 現在のブランチ
gh label list --json name,description,color                      # 既存ラベル一覧（description を含める）
gh issue list --limit 30 --state all --json number,title,labels  # 過去 issue のラベル運用
```

過去 issue が 0 件のリポジトリ初期状態でも `[]` が返るだけで害は無い。

## Task

1. **コンテキスト収集**: 上記コマンドを実行し、リポジトリ情報・既存ラベル・過去 issue を取得する

2. **issue 内容を生成**: 会話の文脈から以下を生成する
   - **タイトル**: 簡潔で具体的な日本語タイトル（50 文字以内目安）
   - **本文**: 背景・現状・期待する動作を構造化して記述
   - **ラベル**: 下の Step A → B → C の順で選定する

3. **ラベル選定**: 以下の 3 ステップで候補を絞り込む

   **Step A: 共通ラベル検出**（過去 issue から運用パターン学習）
   - `gh issue list` の結果からラベル別の出現頻度を計算する。例:
     ```bash
     gh issue list --limit 30 --state all --json labels \
       | jq -r '[.[].labels[].name] | group_by(.) | map({label: .[0], count: length}) | sort_by(.count) | reverse'
     ```
   - 出現率 80% 以上のラベル = リポジトリの共通運用ラベル → 必ず候補に含める
   - 過去 issue が 0 件ならばこのステップはスキップ

   **Step B: 内容マッチング**（description を活用）
   - 既存ラベルの `name` だけでなく `description` も読み、issue 内容のキーワード/セマンティクスと照合する
   - 例: 「動かない」「エラー」「失敗」→ `bug`（description: "Something isn't working"）
   - 例: 「追加したい」「機能」→ `enhancement`（description: "New feature or request"）
   - 例: 「README」「説明」「ドキュメント」→ `documentation`

   **Step C: 不足時の新規ラベル提案**
   - Step A + B で候補が 1 つも無い場合のみ発動
   - 候補プール（内容に合うものを最大 3 つまで提示する）：

     | name | description | color |
     | --- | --- | --- |
     | `bug` | 不具合報告 | `d73a4a` |
     | `enhancement` | 機能追加・改善 | `a2eeef` |
     | `documentation` | ドキュメント変更 | `0075ca` |
     | `chore` | 雑務系タスク（依存更新・設定変更など） | `cfd3d7` |
     | `refactor` | リファクタリング | `fbca04` |

   - ユーザーが承認したラベルのみ `gh label create --name "name" --description "desc" --color "xxxxxx"` で作成 → そのラベルを issue に付ける
   - ユーザーが拒否したらラベルなしで作成（fallback）

4. **プレビュー表示**: 生成内容を以下のフォーマットで表示する。各ラベルには選定理由を 1 行で添える

   ```
   ## Issue プレビュー

   **リポジトリ**: owner/repo
   **タイトル**: ここにタイトル
   **ラベル**:
     - documentation （過去 issue 92% に付与: リポジトリ共通ラベル）
     - bug （description: "Something isn't working" にマッチ）

   **本文**:
   ここに本文
   ```

   Step C の新規提案がある場合は別ブロックで表示する：

   ```
   **新規ラベル候補**（既存に該当なし、作成しますか？）:
     - chore (NEW): 雑務系タスク
     - refactor (NEW): リファクタリング
   ```

5. **ユーザー確認**: 「この内容で作成しますか？修正があれば教えてください」と確認する。修正指示があれば反映してから再度プレビューする。新規ラベル候補は個別に承認/拒否を確認する

6. **issue 作成**: 承認後、必要に応じて `gh label create` を実行してから `gh issue create` で作成する

   ```bash
   gh issue create --title "タイトル" --body "本文" --label "label1,label2"
   ```

7. **URL を表示**: 作成された issue の URL を表示する

## Rules

- 過去 issue を 30 件サンプリングして共通ラベル（出現率 80% 以上）を検出し、必ず候補に含める
- ラベル選定時は `name` だけでなく `description` も照合材料に使う
- 既存ラベルにマッチが無い場合のみ、新規ラベル候補を最大 3 つ提案する
- ユーザー承認なしに `gh label create` を実行しない
- 新規ラベル提案をユーザーが拒否した場合はラベルなしで作成（fallback）
- ユーザーの承認なしに `gh issue create` を実行しない
- 本文は日本語で書く（技術用語・コード・識別子はそのまま）
- 会話中のコードスニペットやエラーメッセージは本文にコードブロックとして含める
- 引数でタイトルや内容が直接指定された場合は、それを優先する
- 本文テンプレートは固定せず、内容に応じて最適な構造を使う（バグならば再現手順、機能リクエストならばモチベーションと提案など）
