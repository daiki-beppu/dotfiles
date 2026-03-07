# Claude Code 設定

## 利用可能なツール

- **ni** (`@antfu/ni`) - パッケージマネージャーラッパー
- **gh** - GitHub CLI

## プロジェクト方針

### Node.js プロジェクト
- **必須**: すべての Node.js プロジェクトで `ni` を使用すること
- npm、yarn、pnpm コマンドを直接使用せず、ni 経由で実行してください
- 詳細な使い方は `/skills using-ni` を参照

## コミットメッセージ

詳細は `/skills commit-convention` を参照

## dotfiles 管理

- **実体**: `~/01-dev/dotfiles/config/.claude/`（git 管理）
- **シンボリックリンク**: `~/.dotfiles` → `~/01-dev/dotfiles`
- `~/.claude/` 配下（CLAUDE.md, skills/, hooks/, settings.json, statusline-command.sh）は `~/.dotfiles/config/.claude/` へのシンボリックリンク
- スキルや設定の編集は dotfiles リポジトリ側で行い、コミット＆プッシュで反映
