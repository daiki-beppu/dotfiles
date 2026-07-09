# dotfiles

daiki-beppu の macOS 開発環境セットアップ

Nix (nix-darwin + Home Manager) で宣言的に管理。

## クイックスタート

### 新しい Mac のセットアップ

```bash
# 1. Determinate Nix をインストール
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install

# 2. シェル再起動
exec $SHELL

# 3. リポジトリをクローン
git clone https://github.com/daiki-beppu/dotfiles.git ~/01-dev/dotfiles
ln -sf ~/01-dev/dotfiles ~/.dotfiles

# 4. 初回ビルド（nix-darwin + Home Manager + Homebrew cask 全て）
cd ~/01-dev/dotfiles
sudo nix run nix-darwin -- switch --flake .
# ホスト名が一致しない場合は .#mba / .#MacBook-Pro-3 を明示する

# 5. 2回目以降
sudo darwin-rebuild switch --flake ~/01-dev/dotfiles
```

## 管理構成

| 管理方式 | 対象 |
|---------|------|
| **Nix (nixpkgs)** | CLI ツール (git, gh, ffmpeg, uv 等) |
| **Nix (programs.git)** | git の設定 (.gitconfig, .gitignore) |
| **Nix (system.defaults)** | macOS システム設定 (Dock, Finder, キーボード等) |
| **Nix (home.activation)** | dotfiles 一式のシンボリンク (.zshenv, .zshrc, .zprofile, .wezterm.lua, .local/bin/*, .config/zsh-abbr/*, .claude/*, .takt/*) |
| **Homebrew (brews)** | nixpkgs にないツール (ni, turso) |
| **Homebrew (casks)** | GUI アプリ (Arc, Claude, Cursor, Figma 等) |

対応ホスト: `mba` = MacBook Air（user `mba`）、`MacBook-Pro-3` = MacBook Pro（user `daikibeppu`）。

## ファイル構成

```
dotfiles/
├── flake.nix              # エントリポイント（inputs, system.defaults, Homebrew）
├── flake.lock             # 依存バージョンのロック（自動生成）
├── nix/
│   └── packages.nix       # Home Manager 設定（パッケージ, git, シンボリンク）
├── config/
│   ├── .zshenv            # zsh 環境変数（全セッション共通）
│   ├── .zshrc             # zsh 設定
│   ├── .zprofile          # PATH 設定（Homebrew + Nix）
│   ├── .wezterm.lua       # WezTerm 設定
│   ├── .local/bin/        # open-browser, takt-usage-report
│   ├── .config/
│   │   └── zsh-abbr/      # zsh-abbr のユーザー定義略語
│   ├── .takt/             # takt 設定
│   │   ├── config.yaml
│   │   ├── workflows/
│   │   ├── facets/
│   │   └── schemas/
│   └── .claude/           # Claude Code 設定
│       ├── CLAUDE.md
│       ├── settings.json
│       ├── skills-lock.json
│       ├── statusline-command.sh
│       ├── hooks/
│       └── skills/
├── docs/
│   ├── manual-setup.md         # 手動設定ガイド
│   └── takt-usage-baseline.md  # takt 運用状況のベースライン記録
└── plans/                 # improve 監査に基づく実装プラン群
```

## よくある操作

| やりたいこと | 操作 |
|-------------|------|
| CLI ツール追加 | `nix/packages.nix` の `home.packages` に追加 |
| GUI アプリ追加 | `flake.nix` の `casks` に追加 |
| nixpkgs にないツール追加 | `flake.nix` の `brews` に追加 |
| 変更を適用 | `sudo darwin-rebuild switch --flake ~/01-dev/dotfiles` |
| パッケージ検索 | `nix search nixpkgs <キーワード>` |
| 全依存を最新化 | `nix flake update --flake ~/01-dev/dotfiles` |
| ロールバック | `sudo darwin-rebuild switch --rollback` |

## macOS 設定 (system.defaults)

`flake.nix` で宣言的に管理:

- ダークモード
- キーボードリピート速度
- トラックパッド（ナチュラルスクロール無効、タップでクリック等）
- Finder（拡張子表示、カラム表示等）
- Dock（自動非表示、最近のアプリ非表示等）

## 手動で設定が必要な項目

詳細は [`docs/manual-setup.md`](docs/manual-setup.md) を参照。

- ディスプレイ解像度を「スペースを拡大」に変更
- Raycast の設定（Spotlight ショートカット変更）

## PATH 優先順位

```
Nix (/etc/profiles/per-user/mba/bin/)
  > Homebrew (/opt/homebrew/bin/)
  > システム
```
