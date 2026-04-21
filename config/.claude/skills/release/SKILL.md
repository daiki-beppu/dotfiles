---
name: release
description: |
  Node.js / npm リポジトリ向けに GitHub Release の作成をリリース PR 経由で実行するスキル。
  `/release` 1 コマンドでリポジトリの状態を自動判定し、
  前半（prepare: バージョン判定 → リリースブランチ → PR 作成）または
  後半（publish: GitHub Release 作成 → ブランチ削除）を実行する。
  「リリースして」「リリース作って」「バージョン上げて」「npm に公開して」
  「新しいバージョン出して」「/release」で発動。
  注意: リリースの閲覧・削除は対象外。新規リリース作成のみ。
  注意: `package.json` を持たないリポジトリでは起動しない（Cargo.toml / pyproject.toml / go.mod 等は対象外）。
---

# release — GitHub Release パイプライン

## Overview

`/release` 1 コマンドでリポジトリの状態を自動判定し、適切なフローを実行する。

- **前半（prepare）**: バージョン自動判定 → `release/v<version>` ブランチ作成 → version bump → PR 作成
- **後半（publish）**: マージ済みリリース PR を検知 → `gh release create` → ブランチ削除

## When to Use

- `package.json` を持つ Node.js / npm リポジトリで新しいバージョンをリリースしたいとき
- `/release` コマンドを実行したとき
- 「リリースして」「リリース作って」「npm に公開して」と言われたとき

## Prerequisites

- リポジトリ直下に `package.json` が存在し、`version` フィールドが書かれていること
- `gh` が認証済みであること（`gh auth status` で OK）
- main ブランチに push 権限があること

`package.json` がない場合は Node.js / npm 以外のプロジェクト構成と判断し、起動しない（下記 Step 0 を参照）。

## パイプライン

### Step 0: 状態判定

0. **前提チェック**: リポジトリ直下に `package.json` が存在することを確認する。存在しない場合は次のメッセージを表示して終了：

   > release スキルは Node.js / npm リポジトリ向けです。`package.json` が見つからないため終了します。Cargo / pyproject / go.mod 等の他言語プロジェクトには対応していません。

1. main ブランチ以外にいる場合、`git switch main && git pull origin main` を自動実行する。未コミットの変更がある場合はエラー停止。

2. 最新リリースの公開日時を取得:
   ```bash
   gh release list --limit 1 --json tagName,publishedAt -q '.[0]'
   ```
   リリースが 0 件の場合（初回リリース）は全コミットをリリース対象として **前半フロー（prepare）** に進む。

3. マージ済みリリース PR を検索:
   ```bash
   gh pr list --state merged --head "release/*" --base main --json mergedAt,title,number
   ```
   取得した PR のうち `mergedAt` が最新リリースの `publishedAt` より新しいものがあれば → **後半フロー（publish）**

4. オープンなリリース PR を検索:
   ```bash
   gh pr list --state open --head "release/*" --base main --json url -q '.[0].url'
   ```
   → あれば PR URL を表示し「まだマージされていません」で終了

5. 上記いずれでもない → **前半フロー（prepare）**

### 前半フロー（prepare）

#### Step 1: コンテキスト収集

```bash
gh release list --limit 1                    # 最新リリースタグ取得
git log <last-tag>..HEAD --oneline           # 前回以降のコミット一覧
```

差分がない場合は「リリースする変更がありません」と表示して終了。
初回リリースの場合は `git log --oneline` で全コミットを取得。

#### Step 2: バージョン自動判定

前回リリース以降のコミットメッセージを分析し、セマンティックバージョニングで決定する。

| コミットタイプ | バージョン変更 |
|---------------|--------------|
| `!` 付き（破壊的変更） | **major** バンプ |
| `feat` あり | **minor** バンプ |
| `fix` / `chore` のみ | **patch** バンプ |

判定結果をユーザーに表示する（例: `v0.4.2 → v0.5.0 (minor: feat コミットあり)`）。ユーザーが別のバージョンを指定した場合はそちらを採用する。

#### Step 3: リリースブランチ作成 & version bump

1. `git pull origin main`（ローカル main を最新に同期）
2. `git switch -c release/v<version>`
3. `package.json` の `version` フィールドを更新
4. `/skills commit-convention` に従いコミット（例: `release: v0.5.0`）
5. `git push -u origin release/v<version>`

#### Step 4: PR 作成

```bash
gh pr create --base main --head release/v<version> --title "release: v<version>" --body "v<version> リリース"
```

- 品質チェック（self-review スキル）は呼ばない（変更が version bump のみのため）
- PR URL を表示して終了

### 後半フロー（publish）

#### Step 1: マージ済みリリース PR から情報取得

- PR タイトルからバージョン番号を抽出（`"release: v0.5.0"` → `v0.5.0`）
- 同じタグが既に存在しないか確認:
  ```bash
  gh release view v<version> 2>/dev/null
  ```
  存在する場合はエラー表示して終了。

#### Step 2: GitHub Release 作成

```bash
gh release create v<version> --target main --generate-notes
```

- リリース URL を表示
- 「Publish ワークフローが自動で npm publish を実行します」と案内

#### Step 3: リリースブランチの削除

```bash
git branch -d release/v<version> 2>/dev/null      # ローカル（存在しなくても OK）
git push origin --delete release/v<version> 2>/dev/null  # リモート（自動削除済みでも OK）
```

## エラーハンドリング

| 状況 | 対応 |
|------|------|
| main 以外のブランチ | `git switch main && git pull` を自動実行（未コミット変更があればエラー停止） |
| 前回リリースからの差分なし | 「リリースする変更がありません」で終了 |
| オープンなリリース PR あり | PR URL を表示し「まだマージされていません」で終了 |
| 同じタグが既に存在 | エラー表示し、バージョンの再指定を促す |
| リリースブランチが存在しない（削除時） | エラーを無視して続行 |
| `gh` 認証エラー | `gh auth login` を案内 |

## Rules

- `/release` 1 コマンドで状態に応じたフローを自動実行
- リリースノートは `--generate-notes` で GitHub に任せる
- 対応リポジトリは Node.js / npm（`package.json`）に限定。Cargo.toml / pyproject.toml / go.mod 等は対象外
- バージョン更新は `package.json` の `version` フィールドのみ
- コミットメッセージは commit-convention に従う（タイプ: `release`）
- バージョン判定はユーザーが上書き可能
- リリースブランチの命名: `release/v<version>`
