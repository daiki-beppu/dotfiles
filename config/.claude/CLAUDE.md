# Claude Code 設定

## 開発ワークフロー

### main を最新化してから作業開始

新しいタスクに着手する前、または worktree を切る前に、必ず main の作業ツリーで `git pull --ff-only` を実行して最新化する。古い main から派生した worktree は無用な merge conflict と「すでに main に入っている変更の再実装」を引き起こす。

### worktree 必須

開発作業（コード編集 / コミット / PR 化）は **必ず worktree 上で行う**。リポジトリ本体のメイン作業ツリーで直接ブランチを切って作業してはならない（進行中の他作業との衝突を避けるため）。

worktree の置き場は以下に統一する:

- **Claude Code 標準**: `$REPO_ROOT/.claude/worktrees/<自動生成名>/`（`--worktree` / EnterWorktree が自動管理）
- **takt 自動生成**: `<repo-parent>/takt-worktrees/<timestamp>-<N>-<slug>/`（takt CLI が自動管理）
- **手動 `git worktree add`**: `$REPO_ROOT/.worktrees/<slug>/`（リポジトリ内・gitignore 必須）

新しいリポジトリで手動 worktree を初めて使う際は、`.gitignore` に `.worktrees/` を追加すること。
