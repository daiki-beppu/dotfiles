# Release スキル再設計 実装計画

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** release スキルを PR ベースフローに書き換え、ブランチ保護ルールがあるリポジトリで動作するようにする

**Architecture:** 既存の SKILL.md を全面書き換え。状態分岐型で `/release` 1 コマンドが prepare / publish を自動判定する

**Tech Stack:** Claude Code skill (Markdown), gh CLI, git

**Spec:** `docs/superpowers/specs/2026-03-17-release-skill-redesign.md`

---

## Chunk 1: SKILL.md 書き換え

### Task 1: SKILL.md のフロントマターと Overview を更新

**Files:**
- Modify: `config/.claude/skills/release/SKILL.md:1-23`

- [ ] **Step 1: フロントマターの description を更新**

現行の description から「npm パブリッシュを一気通貫で」を削除し、状態分岐型であることを反映する。

```yaml
---
name: release
description: |
  GitHub Release の作成をリリース PR 経由で実行するスキル。
  `/release` 1 コマンドでリポジトリの状態を自動判定し、
  前半（prepare: バージョン判定 → リリースブランチ → PR 作成）または
  後半（publish: GitHub Release 作成 → ブランチ削除）を実行する。
  「リリースして」「リリース作って」「バージョン上げて」「npm に公開して」
  「新しいバージョン出して」「/release」で発動。
  注意: リリースの閲覧・削除は対象外。新規リリース作成のみ。
---
```

- [ ] **Step 2: Overview と When to Use を更新**

```markdown
# release — GitHub Release パイプライン

## Overview

`/release` 1 コマンドでリポジトリの状態を自動判定し、適切なフローを実行する。

- **前半（prepare）**: バージョン自動判定 → `release/v<version>` ブランチ作成 → version bump → PR 作成
- **後半（publish）**: マージ済みリリース PR を検知 → `gh release create` → ブランチ削除

## When to Use

- 新しいバージョンをリリースしたいとき
- `/release` コマンドを実行したとき
- 「リリースして」「リリース作って」「npm に公開して」と言われたとき
```

### Task 2: 状態判定ロジックを記述

**Files:**
- Modify: `config/.claude/skills/release/SKILL.md`（Step 0 を書き換え）

- [ ] **Step 1: 状態判定セクションを記述**

スペックの「状態判定ロジック」セクションをそのまま SKILL.md のパイプラインに落とし込む。

```markdown
## パイプライン

### Step 0: 状態判定

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
```

### Task 3: 前半フロー（prepare）を記述

**Files:**
- Modify: `config/.claude/skills/release/SKILL.md`（Step 1-4 を書き換え）

- [ ] **Step 1: prepare フローを記述**

スペックの「前半フロー」をそのまま SKILL.md に落とし込む。

```markdown
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

- 品質チェック（review スキル）は呼ばない（変更が version bump のみのため）
- PR URL を表示して終了
```

### Task 4: 後半フロー（publish）を記述

**Files:**
- Modify: `config/.claude/skills/release/SKILL.md`

- [ ] **Step 1: publish フローを記述**

```markdown
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
```

### Task 5: エラーハンドリングと Rules を更新

**Files:**
- Modify: `config/.claude/skills/release/SKILL.md`（末尾）

- [ ] **Step 1: エラーハンドリングと Rules を記述**

```markdown
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
- バージョン更新は `package.json` のみ
- コミットメッセージは commit-convention に従う（タイプ: `release`）
- バージョン判定はユーザーが上書き可能
- リリースブランチの命名: `release/v<version>`
```

### Task 6: コミット

- [ ] **Step 1: 変更をコミット**

```bash
git add config/.claude/skills/release/SKILL.md
git commit -m "feat: release スキルを PR ベースフローに再設計"
```

- [ ] **Step 2: プッシュ**

```bash
git push origin main
```
