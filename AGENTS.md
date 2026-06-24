# dotfiles プロジェクト

## プロジェクト概要

Nix + Home Manager ベースの dotfiles 管理リポジトリ。

- `config/` 配下にドットファイルの実体を配置
- `~/.dotfiles` → このリポジトリへのシンボリックリンク
- Nix flake でパッケージ管理、darwin-rebuild で適用
