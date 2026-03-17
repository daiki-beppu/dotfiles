# Release スキル再設計

## 背景

現行の release スキルは `git push origin main` で直接 main にプッシュするが、ブランチ保護ルール（PR 必須 + CI required）があるリポジトリでは失敗する。リリース PR 経由のフローに変更する。

併せて、リリースノート生成を `--generate-notes` に簡素化する（従来の手動カテゴリ分け + ユーザー承認は過剰だったため）。

## 対象リポジトリ

- specv（`package.json` あり、Publish ワークフロー整備済み）

## 設計方針

- `/release` 1 コマンドの状態分岐型
- リポジトリの状態を自動判定し、前半（prepare）or 後半（publish）を実行
- 2 ステップに分かれるが、コマンドは 1 つ

## 状態判定ロジック

`/release` が呼ばれたら以下の順で判定する：

1. main ブランチ以外 → エラー停止（main に切り替えるか確認）。ただし後半フロー（publish）は `gh release create --target main` で実行するため、main 上でなくても `git switch main && git pull` を自動実行してから進める。
2. マージ済みリリース PR を検索:
   ```bash
   # 最新リリースの公開日時を取得
   gh release list --limit 1 --json publishedAt -q '.[0].publishedAt'
   # その日時以降にマージされたリリース PR を検索
   gh pr list --state merged --head "release/*" --base main --json mergedAt,title,number \
     | jq '[.[] | select(.mergedAt > "<publishedAt>")]'
   ```
   → マージ済みリリース PR あり → **後半フロー（publish）**
3. `gh pr list --state open --head "release/*" --base main` → オープンなリリース PR あり → PR URL を表示し「まだマージされていません」で終了
4. 上記いずれでもない → **前半フロー（prepare）**

初回リリース（タグが存在しない場合）は全コミットをリリース対象として前半フローに進む。

## 前半フロー（prepare）

### Step 1: コンテキスト収集

```bash
gh release list --limit 1                    # 最新リリースタグ取得
git log <last-tag>..HEAD --oneline           # 前回以降のコミット一覧
```

差分がない場合は「リリースする変更がありません」と表示して終了。

### Step 2: バージョン自動判定

前回リリース以降のコミットメッセージを分析し、セマンティックバージョニングで決定する。

| コミットタイプ | バージョン変更 |
|---------------|--------------|
| `!` 付き（破壊的変更） | **major** バンプ |
| `feat` あり | **minor** バンプ |
| `fix` / `chore` のみ | **patch** バンプ |

判定結果をユーザーに表示する（例: `v0.4.2 → v0.5.0 (minor: feat コミットあり)`）。ユーザーが別のバージョンを指定した場合はそちらを採用する。

### Step 3: リリースブランチ作成 & version bump

1. `git pull origin main`（ローカル main を最新に同期）
2. `git switch -c release/v<version>`
3. `package.json` の `version` フィールドを更新
4. `/skills commit-convention` に従いコミット（例: `release: v0.5.0`）
5. `git push -u origin release/v<version>`

### Step 4: PR 作成

```bash
gh pr create --base main --head release/v<version> --title "release: v<version>" --generate-notes
```

- 品質チェック（review スキル）は呼ばない（変更が version bump のみのため）
- PR テンプレートは使わず `--generate-notes` に任せる
- PR URL を表示して終了

## 後半フロー（publish）

### Step 1: マージ済みリリース PR から情報取得

- PR タイトルからバージョン番号を抽出（`"release: v0.5.0"` → `v0.5.0`）
- 同じタグが既に存在しないか確認（`gh release view v<version> 2>/dev/null`）
  - 存在する場合はエラー表示して終了

### Step 2: GitHub Release 作成

```bash
gh release create v<version> --target main --generate-notes
```

- リリース URL を表示
- 「Publish ワークフローが自動で npm publish を実行します」と案内

### Step 3: リリースブランチの削除

```bash
git branch -d release/v<version> 2>/dev/null      # ローカル（存在しなくても OK）
git push origin --delete release/v<version> 2>/dev/null  # リモート（自動削除済みでも OK）
```

自動で削除する（確認不要）。ローカル・リモートいずれも存在しない場合はエラーを無視する（別マシンからの実行や GitHub の自動ブランチ削除設定に対応）。

## エラーハンドリング

| 状況 | 対応 |
|------|------|
| main 以外のブランチ | 停止し、main への切り替えを確認 |
| 前回リリースからの差分なし | 「リリースする変更がありません」で終了 |
| オープンなリリース PR あり | PR URL を表示し「まだマージされていません」で終了 |
| 同じタグが既に存在 | エラー表示し、バージョンの再指定を促す |
| リリースブランチが存在しない（削除時） | エラーを無視して続行 |
| `gh` 認証エラー | `gh auth login` を案内 |

## ルール

- `/release` 1 コマンドで状態に応じたフローを自動実行
- リリースノートは `--generate-notes` で GitHub に任せる
- バージョン更新は `package.json` のみ
- コミットメッセージは commit-convention に従う（タイプ: `release`）
- バージョン判定はユーザーが上書き可能
- リリースブランチの命名: `release/v<version>`
