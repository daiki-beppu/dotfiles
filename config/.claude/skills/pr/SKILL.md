---
name: pr
description: |
  品質チェックから PR 作成までを一気通貫で実行するパイプラインスキル。
  self-review スキルで品質チェック → コミット＆プッシュ → PR 作成の順で実行する。
  「PR 作って」「プルリク出して」「レビューに出したい」「マージリクエスト」「/pr」で発動。
  実装が完了してレビューに出す段階で使うこと。PR の作成・提出に関わるあらゆる表現で発動する。
  注意: PR の閲覧・レビュー・マージは対象外。新規 PR 作成のみ。
  品質チェックだけ実行したい場合は /self-review を使うこと。
---

# pr — 品質チェック & PR 作成パイプライン

## Overview

実装完了後に品質チェックを順番に実行し、最終的に PR を作成するオーケストレータースキル。
品質チェックは self-review スキルに委譲し、その後コミット＆プッシュ → PR 作成を実行する。
承認待ちで止まらない設計（self-review も含め全ステップが非対話）。

## When to Use

- 実装が完了して PR を出したいとき
- `/pr` コマンドを実行したとき
- 「PR 作って」「プルリク出して」「レビューに出したい」と言われたとき

## パイプライン

### Step 1: 品質チェック

`self-review` スキルを Skill ツールで呼び出す（`Skill(skill="self-review")`）。

simplify → インライン・セキュリティ点検 → CLAUDE.md 同期を順番に実行し、
問題があれば自動修正のうえ報告される。

### Step 2: CI チェック（ローカル検証）

PR 作成前にプロジェクトの CI で実行される検証をローカルで再現する。
Step 1 (self-review) で `git diff main..HEAD` 系は取得済み。再取得しない。

**検出の優先順位**:

1. **CI ワークフロー**: `.github/workflows/*.yml` が存在すれば Read ツールで読み、`run:` ステップから実行コマンドを把握する。把握したコマンドをローカルで実行する（`ni` 経由のコマンドは `nr` に変換）
2. **package.json フォールバック**: CI ワークフローがない場合、`package.json` の `scripts` から以下を検出して `nr` で実行する
   - `typecheck` / `type-check` — 型チェック
   - `lint` — リンター
   - `test` — テスト
   - `build` — ビルド
3. **その他のプロジェクト**: `Makefile` → `make check` / `make test`、`Cargo.toml` → `cargo check && cargo test`、`flake.nix` → `nix flake check` など、プロジェクトの種類に応じた検証コマンドを実行する

**検出用 Bash スニペット**（1 回の Bash コールで完結）:

```bash
# 1) CI workflow の有無
ls .github/workflows/*.yml 2>/dev/null | head -1

# 2) package.json の関連スクリプト抽出
jq -r '.scripts | keys[]' package.json 2>/dev/null \
  | grep -E '^(typecheck|type-check|lint|test|build)$'

# 3) プロジェクト型フォールバック
ls Cargo.toml Makefile flake.nix pyproject.toml go.mod 2>/dev/null
```

検出結果（実行予定のコマンド一覧）は **AskUserQuestion で「このコマンドで進めてよいか」を確認してから実行**すること。Claude が勝手に推測したコマンドをそのまま流さない。

**実行ルール**:

- Node.js プロジェクトでは必ず `ni` / `nr` 経由で実行すること
- 全チェックを実行し、結果を報告する
- **1つでも失敗したらパイプラインを停止**し、エラー内容を表示して修正を促す
- 全チェック成功時のみ次のステップへ進む

### Step 3: コミット & プッシュ

**条件**: `git status --short` で未コミットの変更があるか確認する。

変更がある場合（Step 1 の修正分）: `cp` スキルを Skill ツールで呼び出す（`Skill(skill="cp")`）。
変更がない場合: リモートとの同期状況を確認し、プッシュ済みならスキップ。

```bash
git status --short                               # 未コミット変更の確認
git rev-list HEAD...origin/$(git branch --show-current) --count 2>/dev/null  # 未プッシュコミット数
```

未プッシュコミットがある場合は `git push` を実行する。

### Step 4: PR 作成

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
| `chore/` / `docs/` / `refactor/` / `release/` / `perf/` / `style/` / `test/` / `ci/` / その他 | `references/pr-template-feat.md` をベースに簡略化 |

**「簡略化」の具体ルール**:

- 必須: `## Summary` と `## Test plan` の 2 セクションは残す
- 任意: Motivation / Risk / Rollback / Screenshot など feat 固有のセクションは **ブランチタイプに合致しない場合は削除する**
- docs 系（`docs/` / README 変更のみ）では Test plan は「該当なし（ドキュメント変更のみ）」と明記
- release 系では `Summary` にバージョン番号と主要変更点のみ

テンプレートのパスはこのスキルファイルからの相対パス。
テンプレートに含まれる closing keyword（`Closes #番号` / `Fixes #番号`）は、
issue リンク検出で取得した番号で置き換える。issue がない場合はその行を省略する。

PR 作成後、URL を表示する。

## エラーハンドリング

| 状況 | 対応 |
|------|------|
| CI チェック失敗 | エラー内容を表示し、パイプライン停止。修正を促す |
| CI 検出不能 | package.json も CI ワークフローもない場合、警告を表示して続行 |
| `gh` 認証エラー | `gh auth login` を案内 |
| PR が既に存在 | URL 表示、更新するか確認 |
| リモートブランチなし | cp スキルが `-u origin` で自動作成 |

## Rules

- 各ステップは必ず順番に実行する（並列実行しない）
- 問題を発見したら自動修正し、修正内容をユーザーに報告する
- PR タイトルは日本語で 70 文字以内
- PR 本文はブランチタイプに対応する references/ のテンプレートに従う
- ユーザーの承認なしに PR を作成しない — Step 4 で内容をプレビュー表示し確認を取る
- CI チェックが1つでも失敗したらパイプラインを停止する — 強制的にスキップしない
