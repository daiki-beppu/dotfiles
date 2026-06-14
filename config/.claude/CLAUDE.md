# Claude Code 設定

## ツール制約

### ni（必須）
npm, yarn, pnpm コマンドを直接実行してはならない。必ず ni 経由で実行すること
- `npm install` → `ni`
- `npm run <script>` → `nr <script>`
- `npm install <pkg>` → `ni <pkg>`
- `npm install -D <pkg>` → `ni -D <pkg>`
- `npx <cmd>` → `nlx <cmd>`

### ripgrep（必須）
検索には `grep` ではなく必ず `rg` を使うこと。`grep -r` / `grep -rn` 等は禁止

### gh
GitHub CLI。PR・Issue 操作に使用

## 開発ワークフロー

### main を最新化してから作業開始

新しいタスクに着手する前、または worktree を切る前に、必ず main の作業ツリーで `git pull --ff-only` を実行して最新化する。古い main から派生した worktree は無用な merge conflict と「すでに main に入っている変更の再実装」を引き起こす。

### worktree 必須

開発作業（コード編集 / コミット / PR 化）は **必ず worktree 上で行う**。リポジトリ本体のメイン作業ツリーで直接ブランチを切って作業してはならない（進行中の他作業との衝突を避けるため）。

worktree の置き場は以下に統一する:

- **takt 自動生成**: `<repo-parent>/takt-worktrees/<timestamp>-<N>-<slug>/`（takt CLI が自動管理）
- **手動 `git worktree add`**: `$REPO_ROOT/.worktrees/<slug>/`（リポジトリ内・gitignore 必須）

新しいリポジトリで手動 worktree を初めて使う際は、`.gitignore` に `.worktrees/` を追加すること。

## dotfiles 管理

- 実体: `~/01-dev/dotfiles/config/.claude/`（git 管理）
- `~/.claude/` 自体は通常ディレクトリ。配下の以下の個別エントリのみ dotfiles 内の対応ファイルへの symlink:
  - `CLAUDE.md`, `settings.json`, `hooks/`, `skills/`, `statusline-command.sh`
- 他のエントリ（`sessions/`, `projects/`, `plugins/`, `cache/` など）は Claude Code 自身が管理する実体
- スキルや設定の編集は dotfiles リポジトリ側で行うこと（symlink 経由で反映される）

## コンテキスト運用（トークン節約）

- タスクの区切りごとに `/clear`（文脈を引き継ぎたい場合のみ `/compact`）。前タスクの文脈を残したまま新タスクを始めない
- 広域のコード探索・調査は Explore subagent に委譲し、メイン会話に生のファイルダンプを持ち込まない
- 巨大ファイルは全文 Read せず、offset/limit で必要範囲のみ読む
- 長大な出力が予想されるコマンドはファイルへ redirect し、必要部分だけ読む
