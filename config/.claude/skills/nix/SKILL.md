---
name: nix
description: macOS (nix-darwin) 環境の dotfiles の Nix 環境管理に使用する。CLI ツールの追加・削除、GUI アプリ (cask) の管理、パッケージの検索、設定の適用 (darwin-rebuild)、依存の更新 (flake update) など、Nix に関わる操作全般で使用すること。「パッケージ追加」「ツール入れたい」「アプリ追加」「brew install」「nix」「darwin-rebuild」といった文脈で積極的に発動する。
---

# Nix 環境管理

## 概要

この dotfiles は Nix (nix-darwin + Home Manager) で CLI ツールを宣言的に管理している。GUI アプリ (cask) は nix-darwin 経由で Homebrew に委譲。

## 構成ファイル

| ファイル | 役割 | 編集頻度 |
|---------|------|---------|
| `flake.nix` | エントリポイント。inputs（依存）、nix-darwin 設定、Homebrew cask/brews 定義 | たまに |
| `flake.lock` | 依存バージョンのロック（自動生成、手動編集しない） | 触らない |
| `nix/packages.nix` | Home Manager の CLI パッケージ一覧 | よく編集する |

## パッケージ追加・削除

### CLI ツール（nixpkgs にあるもの）

`nix/packages.nix` の `home.packages` リストに追加・削除する。

```nix
home.packages = with pkgs; [
  gh
  git
  ripgrep  # ← 追加
];
```

パッケージ名は https://search.nixos.org/packages で検索できる。
コマンドラインで検索する場合: `nix search nixpkgs <キーワード>`

### GUI アプリ（Homebrew cask）

`flake.nix` の `homebrew.casks` リストに追加・削除する。

```nix
casks = [
  "1password"
  "slack"  # ← 追加
];
```

### nixpkgs にない CLI ツール

`flake.nix` の `homebrew.brews` リストに追加する。
必要なら `homebrew.taps` にも tap を追加する。

```nix
taps = [
  "some-org/tap"  # ← tap が必要なら追加
];
brews = [
  "ni"
  "some-org/tap/some-tool"  # ← 追加
];
```

## 適用コマンド

パッケージの追加・削除・変更後は以下を実行して反映する:

```bash
sudo darwin-rebuild switch --flake ~/01-dev/dotfiles#mba
```

**注意:** `sudo` が必要（nix-darwin はシステム設定を変更するため）。
`nix` コマンドが `sudo` 環境で見つからない場合はフルパスを使う:

```bash
sudo /nix/var/nix/profiles/default/bin/nix run nix-darwin -- switch --flake ~/01-dev/dotfiles#mba
```

初回のみ `nix run nix-darwin --` 経由で実行する。2回目以降は `darwin-rebuild` が PATH に入る。

**`#mba` について:** `#mba` は `flake.nix` 先頭の `hostname` 変数（`hostname = "mba"`）を指すフラグメントで、`darwinConfigurations.${hostname}` から生成される。個人 ID ではないので通常は触らない。この dotfiles をフォークして自分用にリネームする場合のみ、`flake.nix` の `hostname` と `username` を合わせて変更する。

## 依存の更新

nixpkgs や home-manager を最新に更新する:

```bash
nix flake update --flake ~/01-dev/dotfiles
```

更新後は `darwin-rebuild switch` で適用する。

## パッケージ検索

```bash
# nixpkgs からパッケージを検索
nix search nixpkgs ripgrep

# 結果例:
# * legacyPackages.aarch64-darwin.ripgrep (14.1.1)
#   A utility that combines the usability of The Silver Searcher ...
```

nixpkgs にない場合は `homebrew.brews` に追加する。

## パス優先順位

Nix > Homebrew > システム の順で PATH が構成されている。

- Nix パッケージ: `/etc/profiles/per-user/$USER/bin/`（`$USER` は実行ユーザー）
- Homebrew: `/opt/homebrew/bin/`

`which <command>` でどちらが使われているか確認できる。

## よくある操作の早見表

| やりたいこと | 操作 |
|-------------|------|
| CLI ツール追加 | `nix/packages.nix` に追加 → `darwin-rebuild switch` |
| GUI アプリ追加 | `flake.nix` の `casks` に追加 → `darwin-rebuild switch` |
| nixpkgs にないツール追加 | `flake.nix` の `brews` に追加 → `darwin-rebuild switch` |
| パッケージ検索 | `nix search nixpkgs <キーワード>` |
| 全依存を最新化 | `nix flake update` → `darwin-rebuild switch` |
| 現在のパッケージ一覧 | `nix/packages.nix` を読む |
| ロールバック | `sudo darwin-rebuild switch --rollback` |
