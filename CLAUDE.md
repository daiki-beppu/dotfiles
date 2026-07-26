# dotfiles プロジェクト

## プロジェクト概要

Nix + Home Manager ベースの dotfiles 管理リポジトリ。

- `config/` 配下にドットファイルの実体を配置
- `~/.dotfiles` → このリポジトリへのシンボリックリンク
- Nix flake でパッケージ管理、darwin-rebuild で適用

## ~/.claude の管理

`~/.claude/` 配下の `CLAUDE.md` / `settings.json` / `hooks/` / `skills/` /
`statusline-command.sh` は `config/.claude/` 内の実体への symlink
（それ以外の `sessions/` `projects/` `plugins/` 等は Claude Code 自身が管理する実体）。

スキル・設定の編集は必ず dotfiles 側（`config/.claude/`）で行う。
`~/.claude/` を直接書き換えると symlink を実ファイルに置き換えて管理から外れる。
