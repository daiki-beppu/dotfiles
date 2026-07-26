# Claude Code 設定

## 開発ワークフロー

### main を最新化してから作業開始

新しいタスクに着手する前、または worktree を切る前に、必ず main の作業ツリーで `git pull --ff-only` と `git status -sb` を実行する。古い main から派生した worktree は無用な merge conflict と「すでに main に入っている変更の再実装」を引き起こす。

**落とし穴**: worktree の分岐元は `origin/HEAD` であってローカル main ではない（`worktree.baseRef: "fresh"`）。ローカルに未 push コミットがあるとその変更は worktree に入らないが、`git pull --ff-only` は「リモートに新着なし」を Already up to date と答えるだけでこれを教えない。`git status -sb` の `ahead` を確認し、push するか worktree 側で `git reset --hard main` して揃える。

### worktree 必須

開発作業（コード編集 / コミット / PR 化）は **必ず worktree 上で行う**。リポジトリ本体のメイン作業ツリーで直接ブランチを切って作業してはならない（進行中の他作業との衝突を避けるため）。

置き場は `$REPO_ROOT/.claude/worktrees/<slug>/` に統一する（takt 自動生成の `<repo-parent>/takt-worktrees/` のみ例外・takt CLI が管理）。新しいリポジトリでは `.gitignore` に `.claude/worktrees/` を追加すること。

- 別ターミナルで開始: `claude --worktree <slug>`（`-w`。名前省略で自動生成）
- セッション途中で分離: 「worktree で作業して」と指示（EnterWorktree ツール）
- PR ベース: `claude --worktree "#<PR番号>"` → `.claude/worktrees/pr-<番号>/`
- subagent 並列: 「エージェント用に worktree を使う」と指示、または subagent の frontmatter に `isolation: worktree`

**落とし穴**: `--worktree` / EnterWorktree で作った worktree は `cleanupPeriodDays` の自動スイープ対象外（スイープされるのは subagent / background 由来のみ）。セッション終了時に「保持」を選ぶと削除するまで残り続ける。不要になったら `git worktree remove <path>`、まとめてなら `/clean-branch`。

### worktree に .env を持ち込む

worktree は新規チェックアウトなので `.env` 等の未追跡ファイルが存在しない。リポジトリルートに `.worktreeinclude`（`.gitignore` 構文）を置くと、worktree 作成時に自動コピーされる（gitignore 済みファイルのみが対象で、追跡ファイルは複製されない）。

```text
.env
.env.local
config/secrets.json
```

gitignore された設定ファイルを持つリポジトリでは、**worktree を使う前に必ず `.worktreeinclude` を置く**（フォールバックの hook は廃止済み。置き忘れると worktree でだけ `.env` が無い状態になり、原因が分かりにくい）。

`.worktreeinclude` は Codex（ChatGPT デスクトップアプリ）とも同名・同構文の共通仕様なので、1 つ置けば両方に効く（Codex 側は `AGENTS.override.md` を列挙なしで自動コピーする）。

**落とし穴**: `.worktreeinclude` が効くのは **エージェントが worktree を作るとき**（Claude Code の `--worktree` / EnterWorktree / subagent / Desktop、Codex デスクトップの Worktree チャット）だけ。手動 `git worktree add`、Codex CLI、takt では適用されないので、その場合は自分でコピーする。

なお Codex デスクトップの worktree は `$CODEX_HOME/worktrees`（既定 `~/.codex/worktrees`）に作られ、`.claude/worktrees/` 統一規約の外側にある。保持数は直近 15 件（日数ではなく件数）で、Claude Code の `cleanupPeriodDays` とは別管理。
