---
name: nix
description: >-
  macOS (nix-darwin) dotfiles の Nix 環境管理(CLI ツール・GUI アプリ (cask) の追加削除、パッケージ検索、darwin-rebuild、flake update)。「パッケージ追加」「ツール入れたい」「アプリ追加」「brew install」「nix」「darwin-rebuild」の文脈で発動。
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
sudo darwin-rebuild switch --flake ~/01-dev/dotfiles
```

**注意:** `sudo` が必要（nix-darwin はシステム設定を変更するため）。
`nix` コマンドが `sudo` 環境で見つからない場合はフルパスを使う:

```bash
sudo /nix/var/nix/profiles/default/bin/nix run nix-darwin -- switch --flake ~/01-dev/dotfiles
```

初回のみ `nix run nix-darwin --` 経由で実行する。2回目以降は `darwin-rebuild` が PATH に入る。

**マルチホスト構成について:** `--flake <path>` だけで、実行マシンの hostname に一致する `darwinConfigurations.<hostname>` が自動選択される。現在対応しているのは `mba`（MacBook Air / user `mba`）と `MacBook-Pro-3`（MacBook Pro / user `daikibeppu`）。新マシンを追加する場合は `flake.nix` の `hosts` attrset に 1 行追加するだけでよい。ホスト名が一致しない環境で試す場合のみ `.#mba` / `.#MacBook-Pro-3` のように明示する。

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

## ストア掃除（nh）

Determinate Nix（`nix.enable = false`）のため nix-darwin の `nix.gc` /
`nix.optimise` は使えない。代わりに [nh](https://github.com/nix-community/nh) を使う。

- **自動**: root の launchd daemon `org.nixos.nh-clean` が毎週月曜 12:00 に
  `nh clean all --keep 1 --keep-since 30d --optimise` を実行する
  （`flake.nix` で定義。ログ: `/var/log/nh-clean.log`）
- **手動で即掃除したい場合**:

```bash
# 削除対象の確認（dry-run）
nh clean all --dry --keep 1 --keep-since 30d

# 実行（システムプロファイルの世代削除には root が必要）
sudo nh clean all --keep 1 --keep-since 30d --optimise
```

保持ポリシー: 直近 30 日の世代はすべて保持 + それ以前は最低 1 世代。
`--keep-one` は「世代を 1 つ残す」ではなく「direnv プロジェクトごとに
gcroot を最低 1 つ保持する」フラグなので注意（世代数は `--keep <N>`）。

`programs.nh.flake` で `NH_FLAKE` が設定済みのため、`nh darwin switch` だけで
`sudo darwin-rebuild switch --flake ~/01-dev/dotfiles` 相当の rebuild ができる。

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
| ストア掃除（dry-run） | `nh clean all --dry --keep 1 --keep-since 30d` |
| ストア掃除（実行） | `sudo nh clean all --keep 1 --keep-since 30d --optimise` |
