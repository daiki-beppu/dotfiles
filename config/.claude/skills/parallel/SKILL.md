---
name: parallel
description: cmux で複数の Claude Code セッションを並列起動し、git worktree で分離して同一リポジトリの複数タスクを同時進行する。「並列で」「同時に」「cmux で分割」「複数タスク」「並行して進めたい」など、1つのリポジトリで複数の独立したタスクを並行作業したい場面で使用すること。タスクの分割や同時実行について言及があれば、このスキルの出番
---

# parallel — cmux 並列 Claude Code セッション起動

cmux のペイン分割と git worktree を組み合わせて、同一リポジトリで複数の独立した Claude Code セッションを並列に起動する。
各セッションは別の worktree（別ブランチ）で動くため、ファイル競合なしに並行作業できる。

## Prerequisites

- cmux が起動中であること（cmux 内のターミナルで実行する）
- git リポジトリ内であること
- 未コミットの変更がないこと（worktree 作成前にクリーンな状態が必要）

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
elif [ -f go.mod ]; then go mod download; \
fi
```

- `<name>` はタスク名を英数字・ハイフンにサニタイズしたもの（例: "ユーザー認証" → "user-auth"）
- Node.js プロジェクトでは `ni` を使う（CLAUDE.md の方針）
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

- 1つ目のタスク: `cmux new-split right` で右にペイン分割
- 2つ目以降: `cmux new-split down` で新しいペインを下に分割

### 実行手順（各タスク）

```bash
# ペイン分割（1つ目は right、2つ目以降は down）
cmux new-split <direction>
```

分割後、新しいペインに Claude セッションを起動:

```bash
cmux send "cd <absolute_worktree_path> && claude\n"
```

Claude が起動するまで数秒待つ:

```bash
sleep 5
```

タスクプロンプトを送信:

```bash
cmux send "<タスクの指示内容>\n"
```

送信後、元のペインにフォーカスを戻す:

```bash
cmux focus-pane --pane <original_pane_id>
```

次のタスクのペイン分割に進む前に、直前に作成したペインの surface を確認して正しいペインに送信していることを確認する。

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
- ブランチ名は `worktree-` プレフィックスで統一する（wt-clean 等との互換性）
- 依存関係インストールは worktree 作成時に一度だけ行う（Claude セッション側では不要）
- 各セッションは完全に独立しており、セッション間の通信やファイル共有は想定しない
