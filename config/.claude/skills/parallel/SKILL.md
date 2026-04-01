---
name: parallel
description: cmux で複数の Claude Code セッションを並列起動し、git worktree で分離して同一リポジトリの複数タスクを同時進行する。「並列で」「同時に」「cmux で分割」「複数タスク」「並行して進めたい」など、1つのリポジトリで複数の独立したタスクを並行作業したい場面で使用すること。タスクの分割や同時実行について言及があれば、このスキルの出番
---

# parallel — cmux 並列 Claude Code セッション起動

cmux のペイン分割と git worktree を組み合わせて、同一リポジトリで複数の独立した Claude Code セッションを並列に起動する。
各セッションは別の worktree（別ブランチ）で動くため、ファイル競合なしに並行作業できる。

> cmux コマンドの詳細は cmux スキルを参照。

## Prerequisites

- cmux が起動中であること（cmux 内のターミナルで実行する）
- git リポジトリ内であること
- 未コミットの変更がないこと（worktree 作成前にクリーンな状態が必要）

## Important: plan mode の扱い

このスキルは git worktree 作成や .gitignore 編集など、**書き込みを伴う操作**を行う。
plan mode が有効な場合は、ユーザーにタスク一覧を提示した上で plan を exit し、実行に移ること。

## Step 1: 前提チェック

以下を **1回の Bash コール** で実行:

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

質問例: 「並列で実行するタスクを教えてください。各タスクの簡潔な説明をお願いします」

各タスクについて以下を把握する:
- タスクの説明（Claude への指示になる）
- ブランチ名に使う短縮名（英数字・ハイフン）

## Step 4: worktree 作成 + 依存関係インストール

各タスクについて、以下を **1回の Bash コール** で実行:

```bash
REPO_ROOT=$(git rev-parse --show-toplevel) &&
git worktree add "$REPO_ROOT/.worktrees/<name>" -b "worktree-<name>" &&
cd "$REPO_ROOT/.worktrees/<name>" &&
if [ -f package.json ]; then ni; \
elif [ -f Cargo.toml ]; then cargo build; \
elif [ -f requirements.txt ]; then pip install -r requirements.txt; \
elif [ -f pyproject.toml ]; then pip install -e .; \
elif [ -f go.mod ]; then go mod download; \
fi
```

- `<name>` はタスク名を英数字・ハイフンにサニタイズしたもの（例: "ユーザー認証" → "user-auth"）
- Node.js プロジェクトでは `ni` を使う（CLAUDE.md の方針）
- Python プロジェクトは requirements.txt 優先、なければ pyproject.toml から `pip install -e .`
- .env ファイルは既存の copy-env.sh SessionStart フックが自動コピーする

## Step 5: cmux ペイン起動

各タスクについて cmux でペインを分割し、Claude セッションを起動する。

### レイアウト戦略

```
┌──────────────┬──────────────┐
│              │  Agent #1    │
│  元のペイン   ├──────────────┤
│  (自分)      │  Agent #2    │
│              ├──────────────┤
│              │  Agent #3    │
└──────────────┴──────────────┘
```

### 実行手順

**cmux コマンドの仕様:**
- `cmux new-split right` → `OK surface:<id> workspace:<id>` を返す（サーフェスIDを出力からパースする）
- `cmux send --surface surface:<id> "text\n"` → 指定サーフェスにテキスト送信（`\n` で Enter）
- 2つ目以降のペインは最初に作った**サーフェスから** `down` で分割する

**各タスクの起動（Bash で実行）:**

```bash
# --- タスク1: 右に分割 ---
SURFACE1=$(cmux new-split right 2>&1 | awk '{print $2}')
cmux send --surface "$SURFACE1" "cd <absolute_worktree_path_1> && claude --permission-mode default\n"

sleep 8

# タスクプロンプトを送信
cmux send --surface "$SURFACE1" "<タスク1の指示>\n"
```

```bash
# --- タスク2: タスク1のサーフェスから下に分割 ---
SURFACE2=$(cmux new-split down --surface "$SURFACE1" 2>&1 | awk '{print $2}')
cmux send --surface "$SURFACE2" "cd <absolute_worktree_path_2> && claude --permission-mode default\n"

sleep 8

cmux send --surface "$SURFACE2" "<タスク2の指示>\n"
```

```bash
# --- タスク3以降: 同様に直前のサーフェスから下に分割 ---
SURFACE_N=$(cmux new-split down --surface "$SURFACE_PREV" 2>&1 | awk '{print $2}')
# ... 同じパターン
```

**起動オプションの説明:**
- `--permission-mode default` を付ける。ユーザーの settings.json で plan mode がデフォルトの場合でも、
  子セッションは default mode で起動する。タスクを受け取ってすぐ実行に移れるようにするため。
- `sleep 8` で Claude CLI の初期化を待つ。初回起動は MCP サーバーやプラグインのロードに時間がかかるため、
  5秒では足りないことがある。

## Step 6: サマリー表示

すべてのセッションを起動したら、元のペインにサマリーを表示:

```
## 並列セッション起動完了

| # | タスク | ブランチ | worktree パス |
|---|--------|----------|--------------|
| 1 | <説明> | worktree-<name> | .worktrees/<name> |
| 2 | <説明> | worktree-<name> | .worktrees/<name> |

### 完了後のワークフロー
各セッションで作業完了後:
1. 各セッション内で `/cp` でコミット＆プッシュ
2. メインの worktree に戻り、superpowers の finishing-a-development-branch でマージまたは PR 作成
3. `git worktree remove .worktrees/<name>` でクリーンアップ
```

## Rules

- 元のペイン（呼び出し元）は分割するだけで、そこでは Claude セッションを起動しない
- worktree パスは絶対パスで `cmux send` に渡す（相対パスだと新しいペインの作業ディレクトリに依存してしまう）
- ブランチ名は `worktree-` プレフィックスで統一する
- 依存関係インストールは worktree 作成時に一度だけ行う（Claude セッション側では不要）
- 各セッションは完全に独立しており、セッション間の通信やファイル共有は想定しない
- サーフェスIDは `cmux new-split` の出力から `awk '{print $2}'` でパースする
- タスクプロンプトは短く簡潔に。長い日本語テキストは cmux send で切り詰められる可能性がある。50文字程度に収めるのが安全
