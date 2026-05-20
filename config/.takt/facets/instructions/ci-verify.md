# ci-verify — CI ローカル検証

PR 作成前にプロジェクトの CI で実行される検証をローカルで再現する。検証のみ行い、コード修正は行わない（修正が必要なら `fix` step に戻す）。

## 前提

- 前段の `self_review` step が完了している（コード簡素化・セキュリティ点検・CLAUDE.md 同期は済んでいる）
- 作業ディレクトリは worktree 内
- `git commit` / `git push` はしない（後段 `finalize_pr` step に委譲）

## Step 1: 検出

```bash
ls .github/workflows/*.yml 2>/dev/null | head -1
jq -r '.scripts | keys[]' package.json 2>/dev/null | grep -E '^(typecheck|type-check|lint|test|build)$'
ls Cargo.toml Makefile flake.nix pyproject.toml go.mod 2>/dev/null
```

## Step 2: 実行コマンド決定

優先順位:

1. **CI ワークフロー**: `.github/workflows/*.yml` を Read で読み、`run:` ステップから検証コマンドを抽出。Node の `npm/yarn/pnpm run X` は `nr X` に、`npx X` は `nlx X` に置換（`ni` ツール経由）
2. **package.json フォールバック**: `typecheck` / `type-check` / `lint` / `test` / `build` のスクリプトを `nr <name>` で実行
3. **その他**: `Makefile` → `make check` / `make test`、`Cargo.toml` → `cargo check && cargo test`、`flake.nix` → `nix flake check`、`pyproject.toml` → `pytest` / `mypy`、`go.mod` → `go test ./...`

## Step 3: 実行と結果判定

検出したコマンドを順次実行し、stdout/stderr を 50 行ずつ要約する。

- **すべて成功** → `finalize_pr` へ
- **1 つでも失敗** → 失敗ログを `output_contracts/ci-verify.md` に転記し、step rule の `1 つ以上失敗` で `fix` step に戻す（再修正ループ）

## 失敗時の挙動

| 失敗内容 | 次の step |
|----------|-----------|
| 検証コマンドが 1 つ以上失敗 | `fix`（再修正ループ） |

## output_contracts/ci-verify.md フォーマット

```
# ci-verify 実行結果

## 検出
- 採用ソース: CI ワークフロー / package.json / その他
- 実行コマンド: <list>

## 結果
- 全コマンド: 成功 / 失敗
- 失敗コマンド（失敗時のみ）:
  - <command>: <ログ抜粋 50 行>
```

## Rules

- 修正は行わない（読み取り＋ Bash 実行のみ）
- `git commit` / `git push` をしない（後段 `finalize_pr` step に委譲）
- Node プロジェクトでは必ず `ni` / `nr` / `nlx` 経由で実行
