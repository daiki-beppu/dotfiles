---
name: parallel
description: cmux で複数の Claude Code セッションを並列起動し、git worktree で分離して同一リポジトリの複数タスクを同時進行する。起動後はメインエージェントが各 pane の画面を監視し、進捗集約・エラー検知・完了判定まで自動で行う。「並列で」「同時に」「cmux で分割」「複数タスク」「並行して進めたい」「まとめて実装」「オーケストレーション」「監視付きで並列実行」「進捗集約」など、1 つのリポジトリで複数の独立したタスクを並行作業したい場面で使用すること。タスクの分割・同時実行・並列進捗管理について言及があればこのスキルの出番
---

# parallel — cmux 並列 Claude Code セッションのオーケストレーション

cmux のペイン分割と git worktree を組み合わせて、同一リポジトリで複数の独立した Claude Code セッションを並列に起動する。
各セッションは別の worktree（別ブランチ）で動くため、ファイル競合なしに並行作業できる。

**メインエージェントの役割**: 起動したら終わりではなく、各 pane の画面を定期的にポーリングし、
進捗を `cmux set-status` / `set-progress` に集約、エラーを `cmux notify` で警告、
完了（PR URL 出現）を自動検知する。全 pane 完了まで監視を続ける。

> cmux コマンドの詳細は cmux スキルを参照。

## Prerequisites

- cmux が起動中であること（cmux 内のターミナルで実行する）
- git リポジトリ内であること
- 未コミットの変更がないこと（worktree 作成前にクリーンな状態が必要）

## Important: plan mode の扱い

このスキルは git worktree 作成や .gitignore 編集など、**書き込みを伴う操作**を行う。
plan mode が有効な場合は、ユーザーにタスク一覧を提示した上で plan を exit し、実行に移ること。

## Step 1: 前提チェック

以下を **1 回の Bash コール** で実行:

```bash
git rev-parse --show-toplevel && echo "---" && git status --short && echo "---" && cmux list-panes
```

確認事項:
- git リポジトリ内であること（`--show-toplevel` が成功）
- 未コミット変更がないこと（`git status --short` が空）→ 変更がある場合はユーザーに警告して `/cp` を促す
- cmux が利用可能であること（`list-panes` が成功）

## Step 2: .worktrees/ の gitignore 検証

worktree をプロジェクト内に作成するため、`.worktrees/` が git に追跡されないよう検証する。
追跡されてしまうと、worktree 内の作業中ファイルがメインブランチにコミットされてしまう。

```bash
git check-ignore -q .worktrees/ 2>/dev/null || echo "NOT_IGNORED"
```

`NOT_IGNORED` が出力された場合、`.gitignore` に追加してコミットする:

```bash
echo ".worktrees/" >> .gitignore && git add .gitignore && git commit -m "chore: .worktrees/ を gitignore に追加"
```

すでに無視されていれば何もしない。

## Step 3: タスク収集

AskUserQuestion で並列実行するタスクを収集する。

質問例: 「並列で実行するタスクを教えてください。各タスクの説明、短縮名、タイプ（feat/fix/chore）をお願いします」

各タスクについて以下を把握する:

- **タスクの説明**: Claude への指示になる。長文可（一時ファイル経由で渡すため）
- **短縮名**: ブランチ名に使う英数字・ハイフン（例: `user-auth`）
- **タイプ**: `feat` / `fix` / `chore`（デフォルト `feat`）。`/pr` のテンプレート分岐で使う

## Step 4: worktree 作成 + 依存関係インストール

各タスクについて、以下を **1 回の Bash コール** で実行:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel) &&
git worktree add "$REPO_ROOT/.worktrees/<name>" -b "<type>/parallel-<name>" &&
cd "$REPO_ROOT/.worktrees/<name>" &&
if [ -f package.json ]; then ni; \
elif [ -f Cargo.toml ]; then cargo build; \
elif [ -f requirements.txt ]; then pip install -r requirements.txt; \
elif [ -f pyproject.toml ]; then pip install -e .; \
elif [ -f go.mod ]; then go mod download; \
fi
```

- `<name>` はタスク短縮名
- `<type>` は `feat` / `fix` / `chore`
- ブランチ名は `<type>/parallel-<name>` に統一（`/pr` のテンプレート分岐に合わせるため）
- Node.js プロジェクトでは `ni` を使う（CLAUDE.md の方針）
- .env ファイルは既存の copy-env.sh SessionStart フックが自動コピーする

## Step 5: cmux ペイン起動 + タスクプロンプト送信

各タスクについて以下を実行する。

### 5a. プロンプトファイル生成

`references/task-prompt-template.md` を Read ツールで取得し、変数を置換して `/tmp/parallel-prompt-<name>.md` に Write する。

差し込み変数:
- `{{TASK_NAME}}`: 短縮名
- `{{TASK_DESCRIPTION}}`: Step 3 で収集した説明
- `{{WORKTREE_PATH}}`: worktree の絶対パス
- `{{BRANCH_NAME}}`: `<type>/parallel-<name>`

### 5b. レイアウト戦略

```
┌──────────────┬──────────────┐
│              │  Agent #1    │
│  元のペイン   ├──────────────┤
│  (自分)      │  Agent #2    │
│              ├──────────────┤
│              │  Agent #3    │
└──────────────┴──────────────┘
```

### 5c. 起動手順

**cmux コマンドの仕様:**
- `cmux new-split right` → `OK surface:<id> workspace:<id>` を返す（サーフェス ID を出力からパースする）
- `cmux send --surface surface:<id> "text\n"` → 指定サーフェスにテキスト送信（`\n` で Enter）
- 2 つ目以降のペインは最初に作った**サーフェスから** `down` で分割する

**各タスクの起動（Bash で実行）:**

```bash
# --- タスク 1: 右に分割 ---
SURFACE1=$(cmux new-split right 2>&1 | awk '{print $2}')
cmux send --surface "$SURFACE1" "cd <absolute_worktree_path_1> && claude --permission-mode default\n"
sleep 8
cmux send --surface "$SURFACE1" "/tmp/parallel-prompt-<name1>.md を Read ツールで読んで、書かれた手順に従ってタスクを完了させて\n"

# --- タスク 2: タスク 1 のサーフェスから下に分割 ---
SURFACE2=$(cmux new-split down --surface "$SURFACE1" 2>&1 | awk '{print $2}')
cmux send --surface "$SURFACE2" "cd <absolute_worktree_path_2> && claude --permission-mode default\n"
sleep 8
cmux send --surface "$SURFACE2" "/tmp/parallel-prompt-<name2>.md を Read ツールで読んで、書かれた手順に従ってタスクを完了させて\n"

# --- タスク 3 以降: 同様に直前のサーフェスから下に分割 ---
```

**起動オプションの説明:**
- `--permission-mode default` を付ける。ユーザーの settings.json で plan mode がデフォルトの場合でも、子セッションは default mode で起動する。タスクを受け取ってすぐ実行に移れるようにするため。
- `sleep 8` で Claude CLI の初期化を待つ。初回起動は MCP サーバーやプラグインのロードに時間がかかるため、5 秒では足りないことがある。
- タスクプロンプト本体は `/tmp/parallel-prompt-<name>.md` に置き、`cmux send` では「そのファイルを Read せよ」という短い指示だけ送る。これで長文送信時の破壊を避ける。

### 5d. 監視用配列の準備

Step 5.5 で使う bash 配列を組み立てておく:

```bash
SURFACES=("$SURFACE1" "$SURFACE2" "$SURFACE3")
TASK_NAMES=("<name1>" "<name2>" "<name3>")
```

## Step 5.5: 監視ループ

全 pane 起動後、メインは監視モードに入る。

**実行前に `references/monitoring.md` を Read ツールで読む。** そこに以下が定義されている:

- サンプリング間隔（通常 25 秒 / 起動後 2 分は 15 秒）
- 完了判定: PR URL の出現で検知
- エラー検知: `ERROR_PATTERN` 正規表現で `grep -iE`、初回のみ `cmux notify`
- 停滞検知: 75 秒間画面末尾が変化なし → `cmux log --level warn`
- 状態管理: `/tmp/parallel-monitor-$$/` 配下のフラグファイル
- 擬似コード全体と cmux API の使い分け

Step 5d で準備した `SURFACES` / `TASK_NAMES` 配列を使って、monitoring.md の擬似コードを実行する。
ループは以下のいずれかで抜ける:

- 全 pane 完了（`EXIT_REASON=all-done`）
- タイムアウト（既定 45 分、`EXIT_REASON=timeout`）

## Step 6: 完了後サマリー & 次アクション提示

監視ループ終了後、`STATE_DIR/<name>.done`（PR URL が書かれている）と `<name>.err-seen` を集約して分岐する。

### 6a. 全完了（`EXIT_REASON=all-done`）

```markdown
## 並列セッション完了サマリー

| # | タスク | ブランチ | PR |
|---|--------|----------|------|
| 1 | <name1> | feat/parallel-<name1> | <PR URL> |
| 2 | <name2> | feat/parallel-<name2> | <PR URL> |
```

AskUserQuestion で次アクションを提示:

- 全 PR をブラウザで順に開く（`cmux browser open <url>` を繰り返す）
- 1 つずつレビューする（`/review-pr <番号>` を提案）
- worktree を残したまま後で作業
- 全 worktree を削除（`git worktree remove .worktrees/<name>` を繰り返す）

### 6b. エラー検知あり（`.err-seen` が 1 個以上）

全完了していてもエラー兆候が出ていれば、警告を添える:

```markdown
## 並列セッション完了（警告あり）

以下の pane でエラー兆候を検知しました。PR は作成されていますが内容を確認してください:

- <name>: <エラー末尾 3 行のサマリー>
```

### 6c. タイムアウト（`EXIT_REASON=timeout`）

```markdown
## 並列セッション: タイムアウト

45 分経過しても PR が作成されなかった pane があります:

| タスク | surface | 現在の末尾行 |
|--------|---------|-------------|
| <name> | <surface> | "<末尾行>" |
```

AskUserQuestion で:

- 監視を 15 分延長する（Step 5.5 を `TIMEOUT_SEC=900` で再実行）
- 該当 pane にフォーカスを移す（`cmux focus-pane`）
- 中断して現状のサマリーで終了

### 6d. 状態ファイルのクリーンアップ

サマリー出力完了後:

```bash
rm -rf "$STATE_DIR"
```

## Rules

- 元のペイン（呼び出し元）は分割するだけで、そこでは Claude セッションを起動しない
- worktree パスは絶対パスで `cmux send` に渡す（相対パスだと新しいペインの作業ディレクトリに依存してしまう）
- ブランチ名は `<type>/parallel-<name>` で統一する（`/pr` のテンプレート分岐に合わせるため）
- 依存関係インストールは worktree 作成時に一度だけ行う（Claude セッション側では不要）
- 各セッションは独立しており、セッション間の通信やファイル共有は想定しない
- サーフェス ID は `cmux new-split` の出力から `awk '{print $2}'` でパースする
- タスクプロンプトは `/tmp/parallel-prompt-<name>.md` に出力し、pane 側 Claude には「そのファイルを Read せよ」と短い指示だけ送る（`cmux send` の長文破壊を避ける）
- 監視ループ中はメインペインで別作業を開始しない（`$CMUX_SURFACE_ID` が変わると集約表示が壊れる）
- エラー検知は通知のみ。強制停止しない — pane 側 Claude の自己回復余地を残す
- 停滞検知も通知のみ。介入しない
- 状態ファイル（`/tmp/parallel-monitor-$$/`）は Step 6 完了後に `rm -rf` する
