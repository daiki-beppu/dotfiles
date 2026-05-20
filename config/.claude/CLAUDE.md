# Claude Code 設定

## ツール制約

### ni（必須）
npm, yarn, pnpm コマンドを直接実行してはならない。必ず ni 経由で実行すること
- `npm install` → `ni`
- `npm run <script>` → `nr <script>`
- `npm install <pkg>` → `ni <pkg>`
- `npm install -D <pkg>` → `ni -D <pkg>`
- `npx <cmd>` → `nlx <cmd>`

### gh
GitHub CLI。PR・Issue 操作に使用

## 開発ワークフロー

### worktree 必須

開発作業（コード編集 / コミット / PR 化）は **必ず worktree 上で行う**。リポジトリ本体のメイン作業ツリーで直接ブランチを切って作業してはならない（進行中の他作業との衝突を避けるため）。

worktree の置き場は以下に統一する:

- **takt 自動生成**: `<repo-parent>/takt-worktrees/<timestamp>-<N>-<slug>/`（takt CLI が自動管理）
- **手動 `git worktree add`**: `$REPO_ROOT/.worktrees/<slug>/`（リポジトリ内・gitignore 必須・`parallel` スキルと共通）

新しいリポジトリで手動 worktree を初めて使う際は、`.gitignore` に `.worktrees/` を追加すること。

## dotfiles 管理

- 実体: `~/01-dev/dotfiles/config/.claude/`（git 管理）
- `~/.claude/` 配下は `~/.dotfiles/config/.claude/` へのシンボリックリンク
- スキルや設定の編集は dotfiles リポジトリ側で行うこと
