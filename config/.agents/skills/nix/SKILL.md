---
name: nix
description: この Mac の nix-darwin 管理下のパッケージ追加・削除、flake 更新、適用・世代整理に使う。
---

# Nix 環境管理

この dotfiles は CLI を Nix / Home Manager、GUI アプリを nix-darwin の Homebrew cask で管理する。依頼された構成変更と反映まで進める。

## 操作の範囲

- `--search <語>`: 読み取り専用の検索。
- `--add` / `--remove`: 指定分を編集して switch。
- `--rebuild`: 編集せず switch。
- `--update [input]`: 指定 input または依頼された全依存を更新し switch。
- `--clean`: [世代整理](references/cleanup.md)。
- `--rollback`: `sudo darwin-rebuild switch --rollback`。
- `--dry-run`: 全モードで予定だけ提示し、編集・更新・適用・削除をしない。

自然文も対応する操作として扱う。パッケージ追加に無関係な全依存更新や整理を混ぜない。依頼範囲を超える依存更新が必要なら、理由と具体的な範囲を示して確認する。

## 編集と適用

実際の dotfiles の設定と worktree 規約を確認する。配置は `nix/packages.nix` の `home.packages`（CLI）、`flake.nix` の `homebrew.casks`（GUI）を基本とし、nixpkgs にない CLI は `homebrew.brews` を使う。

追加前に現行のパッケージ検索で実在名を確認する。依存更新は `nix flake update` で行い、`flake.lock` を手編集しない。

適用する場合だけ [適用と Touch ID](references/apply.md) を読む。編集した worktree と対象ホストを明示して適用する。`sudo` は実行する旨を伝え、Touch ID の通常の認証経路を使う。`sudo -n true` の失敗だけで実行不能と判断しない。

switch の成功と対象コマンド／アプリの反映を確認する。評価・ビルドだけの成功は適用済みと区別し、失敗や未確認部分を報告する。再検証は変更・失敗・未解決の懸念に対応するものに絞る。
