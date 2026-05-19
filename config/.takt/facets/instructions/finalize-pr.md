# finalize-pr — 品質チェック付き PR 作成

このファイルは Claude Code の `pr` skill (`~/.claude/skills/pr/SKILL.md`) と同じ動作を takt workflow の最終 step として再現するためのもの。`pr` skill 側を変更したら、こちらも追従させること。

takt の auto-commit 済みブランチに対して **self-review → CI ローカル検証 → 追加 commit + push → `gh pr create`** を順番に実行し、品質チェック付きの PR を自動作成する。

## 前提

- takt が `takt/<N>/<slug>` ブランチを作り、auto-commit 済みである
- 作業ディレクトリは worktree 内
- `git status --short` で大半のケースは未コミット差分なしの状態

## Step 1: self-review（インライン展開）

`~/.claude/skills/self-review/SKILL.md` の処理を手で再現する。サブスキルは呼ばず、すべてインラインで実行する。

### 1-A. Context 収集

```bash
git branch --show-current
git status --short
git diff --stat main..HEAD
git log main..HEAD --oneline
```

`main` または `master` ブランチ上で動いている場合は **エラー扱いで step を停止** し、`rules.条件: 品質チェック失敗` で `fix` step に戻す。

### 1-B. コード簡素化レビュー（simplify 相当）

`git diff main..HEAD` の追加行を対象に、以下を機械的にチェックして自動修正する:

- 未使用 import / 未使用変数 / 未使用ヘルパー関数の削除
- 同一ロジックの 3 重複以上を抽出してヘルパー化（ただし 3 重複未満なら触らない — 過抽象化禁止）
- 1 関数 100 行超 → 機能単位で分割
- magic number / magic string → 名前付き定数へ
- 不要なコメント（コードを読めば明らかな WHAT 説明）の削除
- 「`// removed ...`」「`// added for issue #N`」のような履歴コメント削除

修正は worktree 上で行い、後段 Step 3 で追加コミットする。

### 1-C. セキュリティ点検（インライン）

`git diff main..HEAD -- ':!*.lock' ':!*.snap'` の **追加行（`^+`）** に対して以下を grep し、検出したら CRITICAL / WARNING / INFO に分類する:

- **シークレット**: `AKIA[0-9A-Z]{16}`（AWS）、`xox[baprs]-`（Slack）、`-----BEGIN .* PRIVATE KEY-----`、`password\s*=\s*["'][^"']+["']`、`token\s*=\s*["'][^"']+["']`、`api[_-]?key\s*=\s*["'][^"']+["']`
- **インジェクション**: 文字列連結の SQL、動的 `exec(` / `eval(`、未サニタイズ入力を含むシェル `$(...)`
- **意図せぬ混入**: `.env` / `credentials*` / `*.pem` / `id_rsa*` の追加

CRITICAL（実シークレット / 明らかな脆弱性 / 秘密ファイル混入）は **即修正**: secret はプレースホルダ化、秘密ファイルは `git restore --staged` で unstage、検出された差分はコメントアウトしないで削除。`fixtures/` / `*.test.*` / `*.spec.*` 配下のダミー値や `your-api-key-here` 等のプレースホルダは CRITICAL に上げない。

WARNING / INFO はサマリーに列挙のみ。

### 1-D. CLAUDE.md 同期

`git diff --stat main..HEAD` の出力に `CLAUDE.md`（大小文字無視）が含まれる場合のみ、`claude-md-management:claude-md-improver` の指示書を Read で読み込み、その手順に従って同期。含まれなければスキップ。

## Step 2: CI ローカル検証

PR 作成前にプロジェクトの CI で実行される検証をローカルで再現する。

### 2-A. 検出

```bash
ls .github/workflows/*.yml 2>/dev/null | head -1
jq -r '.scripts | keys[]' package.json 2>/dev/null | grep -E '^(typecheck|type-check|lint|test|build)$'
ls Cargo.toml Makefile flake.nix pyproject.toml go.mod 2>/dev/null
```

### 2-B. 実行コマンド決定

優先順位:

1. **CI ワークフロー**: `.github/workflows/*.yml` を Read で読み、`run:` ステップから検証コマンドを抽出。Node の `npm/yarn/pnpm run X` は `nr X` に、`npx X` は `nlx X` に置換（`ni` ツール経由）
2. **package.json フォールバック**: `typecheck` / `type-check` / `lint` / `test` / `build` のスクリプトを `nr <name>` で実行
3. **その他**: `Makefile` → `make check` / `make test`、`Cargo.toml` → `cargo check && cargo test`、`flake.nix` → `nix flake check`、`pyproject.toml` → `pytest` / `mypy`、`go.mod` → `go test ./...`

### 2-C. 実行と結果判定

検出したコマンドを順次実行し、stdout/stderr を 50 行ずつ要約する。

- **すべて成功** → Step 3 へ
- **1 つでも失敗** → 失敗ログを `output_contracts/finalize-pr.md` に転記し、step rule の `品質チェック失敗` で `fix` step に戻す（再修正ループ）

## Step 3: commit + push

```bash
git status --short
```

Step 1 で修正が発生した場合のみ追加コミット:

```bash
git add -A
git commit -m "chore: self-review fixes"
```

takt の auto-commit を **書き換えない** こと（`git commit --amend` 禁止）。

push:

```bash
BRANCH=$(git branch --show-current)
git push -u origin "$BRANCH"
```

## Step 4: PR 化（新規作成 or 既存 PR 積み上げ）

base branch によって動作を切り替える。

```bash
BRANCH=$(git branch --show-current)
BASE_BRANCH=$(git for-each-ref --format='%(upstream:short)' "$(git symbolic-ref -q HEAD)" 2>/dev/null | sed 's|origin/||')
# fallback: tracking branch がない場合は main を base とみなす
[ -z "$BASE_BRANCH" ] && BASE_BRANCH=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|origin/||' || echo main)
```

判定:

- `BASE_BRANCH` が `main` / `master` → **新規 PR 作成モード（5-A）**: 4-A〜4-F を実行
- それ以外（既存の feature/release/chore ブランチ等） → **既存 PR 積み上げモード（5-B）**: 4-G にジャンプ

### 4-A. issue 番号の抽出

```bash
BRANCH=$(git branch --show-current)            # 例: takt/127/refactor-auth
ISSUE_N=$(echo "$BRANCH" | sed -nE 's|^takt/([0-9]+)/.*|\1|p')
```

`ISSUE_N` が空ならコミットメッセージから抽出を試みる:

```bash
git log main..HEAD --format=%B | grep -oE '#[0-9]+' | head -1 | tr -d '#'
```

それでも見つからない場合は closing keyword なしで PR を作成（人手で後追記）。

### 4-B. ラベルからテンプレート判定

```bash
gh issue view "$ISSUE_N" --json labels,title,state -q '.labels[].name' 2>/dev/null
```

| ラベル | 採用テンプレート | closing keyword |
|--------|------------------|-----------------|
| `bug` / `fix` を含む | `~/.claude/skills/pr/references/pr-template-fix.md` | `Fixes #<N>` |
| `feature` / `enhancement` を含む | `~/.claude/skills/pr/references/pr-template-feat.md` | `Closes #<N>` |
| それ以外 (`chore` / `docs` / `refactor` 等) | `pr-template-feat.md` をベースに簡略化（Summary と Test plan のみ残す） | `Closes #<N>` |

テンプレート本体は Read ツールで読み、`Closes #番号` / `Fixes #番号` の行を実 issue 番号で置換する。

### 4-C. draft フラグ

```bash
cat .takt/config.yaml 2>/dev/null | grep -E '^draft_pr:\s*true' && DRAFT_FLAG=--draft || DRAFT_FLAG=
```

### 4-D. PR 本文の組み立て

`git log main..HEAD --format='%s%n%n%b'` の全コミットメッセージを分析して、テンプレートの各セクションを埋める:

- **概要**: 1〜3 文で「何を / なぜ」
- **設計判断** (feat): plan.md / architect-review.md / supervisor-validation.md の `output_contracts` レポートから抽出
- **変更内容**: 主要な変更点を箇条書き
- **テスト計画**: write_tests.md の出力 or 手動 e2e 手順

closing keyword は **issue ごとに 1 行**（`Closes #14 #15` は GitHub が認識しないので NG）。

### 4-E. PR 作成

```bash
gh pr create $DRAFT_FLAG \
  --base "$(git rev-parse --abbrev-ref @{u} | sed 's|origin/||' || echo main)" \
  --title "<commit-convention タイプ>: <要約>（70 字以内・日本語）" \
  --body "$(cat /tmp/finalize-pr-body.md)"
```

PR URL を `output_contracts/finalize-pr.md` に記録する。

### 4-F. 既存 PR チェック

PR 作成前に既存 PR を確認:

```bash
gh pr list --head "$BRANCH" --json number,url --jq '.[0].url'
```

既に PR が存在する場合は新規作成せず URL を `finalize-pr.md` に記録して step を終了（COMPLETE）。「重複作成しない」のは pr skill と同じ挙動。

### 4-G. 既存 PR 積み上げ（5-B 経路）

`BASE_BRANCH` が `main` / `master` 以外の場合に実行する。worktree ブランチを既存 PR ブランチに merge して push し、PR 本文に `Closes #<N>` を追記する。

```bash
# 1. main repo に戻る
MAIN_REPO=$(git rev-parse --show-toplevel | xargs dirname | xargs dirname)  # worktree path から逆算
cd "$MAIN_REPO"

# 2. 既存 PR ブランチに切り替えて worktree ブランチを merge
git checkout "$BASE_BRANCH"
git pull --ff-only origin "$BASE_BRANCH"
git merge --no-ff "$BRANCH" -m "Merge $BRANCH into $BASE_BRANCH"
git push origin "$BASE_BRANCH"

# 3. 既存 PR 本文に Closes #<N> を追記
EXISTING_PR=$(gh pr list --head "$BASE_BRANCH" --state open --json number -q '.[0].number')
if [ -n "$EXISTING_PR" ] && [ -n "$ISSUE_N" ]; then
  CURRENT_BODY=$(gh pr view "$EXISTING_PR" --json body -q '.body')
  echo "$CURRENT_BODY" | grep -qE "^(Closes|Fixes) #${ISSUE_N}$" || {
    NEW_BODY="${CURRENT_BODY}

Closes #${ISSUE_N}"
    gh pr edit "$EXISTING_PR" --body "$NEW_BODY"
  }
fi
```

積み上げ先の PR URL を `output_contracts/finalize-pr.md` の `## PR` セクションに「積み上げモード」と明記して記録する。

## 失敗時の挙動

| 失敗内容 | 次の step |
|----------|-----------|
| main / master ブランチ上で実行 | `fix`（人手で feature ブランチに切り替え） |
| Step 2 の CI 検証で失敗 | `fix`（再修正ループ） |
| `gh pr create` が認証エラー / 既存 PR エラー | `COMPLETE`（人手で takt-issue skill 経由で対応） |

## output_contracts/finalize-pr.md フォーマット

```
# finalize-pr 実行結果

## self-review
- 修正したファイル数: N
- 検出したセキュリティ警告: CRITICAL=N / WARNING=N / INFO=N

## CI ローカル検証
- 実行コマンド: <list>
- 結果: 成功 / 失敗（失敗時はログ抜粋）

## PR
- URL: <https://github.com/...>
- closing keyword: Closes #<N>
- テンプレート: feat / fix / 簡略版
- draft: true / false
```

## Rules

- takt の auto-commit メッセージ（`takt: <slug>`）は書き換えない
- self-review 修正コミットのみ追加コミットする
- `Skill()` ツールに依存しない（workflow の provider 非対応のため、すべてインラインで実行）
- `Closes #N` / `Fixes #N` は issue ごとに 1 行
- 既存 PR があれば重複作成しない（URL を記録して COMPLETE）
- Node プロジェクトでは必ず `ni` / `nr` / `nlx` 経由で実行
