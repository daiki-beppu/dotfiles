---
name: pr
description: |
  品質チェックから PR 作成までを一気通貫で実行するパイプラインスキル。
  review スキルで品質チェック → コミット＆プッシュ → PR 作成の順で実行する。
  「PR 作って」「プルリク出して」「レビューに出したい」「マージリクエスト」「/pr」で発動。
  実装が完了してレビューに出す段階で使うこと。PR の作成・提出に関わるあらゆる表現で発動する。
  注意: PR の閲覧・レビュー・マージは対象外。新規 PR 作成のみ。
  品質チェックだけ実行したい場合は /review を使うこと。
---

# pr — 品質チェック & PR 作成パイプライン

## Overview

実装完了後に品質チェックを順番に実行し、最終的に PR を作成するオーケストレータースキル。
品質チェックは review スキルに委譲し、その後コミット＆プッシュ → PR 作成を実行する。

## When to Use

- 実装が完了して PR を出したいとき
- `/pr` コマンドを実行したとき
- 「PR 作って」「プルリク出して」「レビューに出したい」と言われたとき

## パイプライン

### Step 1: 品質チェック

`/skills review` を Skill ツールで呼び出す。

simplify → security-review → CLAUDE.md 同期を順番に実行する。
問題があれば自動修正され、修正内容が報告される。

### Step 2: コミット & プッシュ

**条件**: `git status --short` で未コミットの変更があるか確認する。

変更がある場合（Step 1 の修正分）: `/skills cp` を Skill ツールで呼び出す。
変更がない場合: リモートとの同期状況を確認し、プッシュ済みならスキップ。

```bash
git status --short                               # 未コミット変更の確認
git rev-list HEAD...origin/$(git branch --show-current) --count 2>/dev/null  # 未プッシュコミット数
```

未プッシュコミットがある場合は `git push` を実行する。

### Step 3: PR 作成

`git log main..HEAD` の全コミットを分析して PR タイトル・本文を生成する。

**PR 作成前の確認**:

```bash
gh pr list --head "$(git branch --show-current)" --json number,url --jq '.[0].url'
```

既に PR が存在する場合は URL を表示し、更新するか新規作成するか確認する。

**issue リンクの検出**:

ブランチ名から issue 番号を抽出する（例: `feat/14-add-auth` → `14`）。
番号が見つかったら `gh issue view <番号> --json state -q .state` で issue が open か確認し、
有効なら PR 本文に closing keyword を含める。

- バグ修正（`fix/`）→ `Fixes #14`
- それ以外 → `Closes #14`

**PR タイトル**: commit-convention のタイプを含む日本語（70 文字以内）

**PR 本文テンプレート**:

ブランチのタイプに応じて、対応するテンプレートを Read ツールで読み込んで使用する。

| ブランチプレフィックス | テンプレート |
|----------------------|-------------|
| `feat/` | `references/pr-template-feat.md` |
| `fix/` | `references/pr-template-fix.md` |
| その他（`chore/` 等） | `references/pr-template-feat.md` をベースに簡略化 |

テンプレートのパスはこのスキルファイルからの相対パス。
テンプレートに含まれる closing keyword（`Closes #番号` / `Fixes #番号`）は、
issue リンク検出で取得した番号で置き換える。issue がない場合はその行を省略する。

PR 作成後、URL を表示する。

## エラーハンドリング

| 状況 | 対応 |
|------|------|
| `gh` 認証エラー | `gh auth login` を案内 |
| PR が既に存在 | URL 表示、更新するか確認 |
| リモートブランチなし | cp スキルが `-u origin` で自動作成 |

## Rules

- 各ステップは必ず順番に実行する（並列実行しない）
- 問題を発見したら自動修正し、修正内容をユーザーに報告する
- PR タイトルは日本語で 70 文字以内
- PR 本文はブランチタイプに対応する references/ のテンプレートに従う
- ユーザーの承認なしに PR を作成しない — Step 3 で内容をプレビュー表示し確認を取る
