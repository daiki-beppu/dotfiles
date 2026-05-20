# self-review — コード簡素化・セキュリティ点検・CLAUDE.md 同期

takt の auto-commit 済みブランチに対してインラインで self-review を実行する。修正は worktree 上で行うのみで、commit は後段の `finalize_pr` step が一括で行う（このファイルでは `git commit` / `git push` をしない）。

`~/.claude/skills/self-review/SKILL.md` の処理を手で再現する。サブスキルは呼ばず、すべてインラインで実行する。

## 前提

- takt が `takt/<N>/<slug>` ブランチを作り、auto-commit 済みである
- 作業ディレクトリは worktree 内
- `git status --short` で大半のケースは未コミット差分なしの状態

## Step 1: Context 収集

```bash
git branch --show-current
git status --short
git diff --stat main..HEAD
git log main..HEAD --oneline
```

`main` または `master` ブランチ上で動いている場合は **エラー扱いで step を停止** し、`rules.条件: main / master ブランチ上で実行された` で `fix` step に戻す。

## Step 2: コード簡素化レビュー（simplify 相当）

`git diff main..HEAD` の追加行を対象に、以下を機械的にチェックして自動修正する:

- 未使用 import / 未使用変数 / 未使用ヘルパー関数の削除
- 同一ロジックの 3 重複以上を抽出してヘルパー化（ただし 3 重複未満なら触らない — 過抽象化禁止）
- 1 関数 100 行超 → 機能単位で分割
- magic number / magic string → 名前付き定数へ
- 不要なコメント（コードを読めば明らかな WHAT 説明）の削除
- 「`// removed ...`」「`// added for issue #N`」のような履歴コメント削除

修正は worktree 上で行うのみ。`git add` / `git commit` はしない（後段 `finalize_pr` step が一括コミットする）。

## Step 3: セキュリティ点検（インライン）

`git diff main..HEAD -- ':!*.lock' ':!*.snap'` の **追加行（`^+`）** に対して以下を grep し、検出したら CRITICAL / WARNING / INFO に分類する:

- **シークレット**: `AKIA[0-9A-Z]{16}`（AWS）、`xox[baprs]-`（Slack）、`-----BEGIN .* PRIVATE KEY-----`、`password\s*=\s*["'][^"']+["']`、`token\s*=\s*["'][^"']+["']`、`api[_-]?key\s*=\s*["'][^"']+["']`
- **インジェクション**: 文字列連結の SQL、動的 `exec(` / `eval(`、未サニタイズ入力を含むシェル `$(...)`
- **意図せぬ混入**: `.env` / `credentials*` / `*.pem` / `id_rsa*` の追加

CRITICAL（実シークレット / 明らかな脆弱性 / 秘密ファイル混入）は **即修正**: secret はプレースホルダ化、秘密ファイルは `git restore --staged` で unstage、検出された差分はコメントアウトしないで削除。`fixtures/` / `*.test.*` / `*.spec.*` 配下のダミー値や `your-api-key-here` 等のプレースホルダは CRITICAL に上げない。

WARNING / INFO はサマリーに列挙のみ。

## Step 4: CLAUDE.md 同期

`git diff --stat main..HEAD` の出力に `CLAUDE.md`（大小文字無視）が含まれる場合のみ、`claude-md-management:claude-md-improver` の指示書を Read で読み込み、その手順に従って同期。含まれなければスキップ。

## 失敗時の挙動

| 失敗内容 | 次の step |
|----------|-----------|
| main / master ブランチ上で実行 | `fix`（人手で feature ブランチに切り替え） |

self-review 自体が成功すれば（修正の有無を問わず）次は `ci_verify` に進む。

## output_contracts/self-review.md フォーマット

```
# self-review 実行結果

## 修正
- 修正したファイル数: N
- 主な修正内容: <list>

## セキュリティ点検
- CRITICAL=N / WARNING=N / INFO=N
- CRITICAL の即修正内容: <list>

## CLAUDE.md
- 同期実行: yes / no（差分に含まれていなかった場合 no）
```

## Rules

- `git commit` / `git push` をしない（後段 `finalize_pr` step に委譲）
- takt の auto-commit メッセージ（`takt: <slug>`）は書き換えない
- `Skill()` ツールに依存しない（workflow の provider 非対応のため、すべてインラインで実行）
