# Claude Code 設定

## ツール制約

### ni（必須）
npm, yarn, pnpm コマンドを直接実行してはならない。必ず ni 経由で実行すること
- `npm install` → `ni`
- `npm run <script>` → `nr <script>`
- `npm install <pkg>` → `ni <pkg>`
- `npm install -D <pkg>` → `ni -D <pkg>`
- `npx <cmd>` → `nlx <cmd>`
- 詳細は `/skills using-ni` を参照

### gh
GitHub CLI。PR・Issue 操作に使用

## コミットメッセージ

詳細は `/skills commit-convention` を参照

## dotfiles 管理

- 実体: `~/01-dev/dotfiles/config/.claude/`（git 管理）
- `~/.claude/` 配下は `~/.dotfiles/config/.claude/` へのシンボリックリンク
- スキルや設定の編集は dotfiles リポジトリ側で行うこと
