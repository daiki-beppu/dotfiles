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

# 3. ghq の標準配置へリポジトリをクローン
nix run nixpkgs#ghq -- get https://github.com/daiki-beppu/dotfiles.git
ln -sf ~/ghq/github.com/daiki-beppu/dotfiles ~/.dotfiles

# 4. 初回ビルド（nix-darwin + Home Manager + Homebrew cask 全て）
cd ~/ghq/github.com/daiki-beppu/dotfiles
sudo nix run nix-darwin -- switch --flake .
# ホスト名が一致しない場合は .#mba / .#MacBook-Pro-3 を明示する

# 5. 2回目以降
sudo darwin-rebuild switch --flake ~/ghq/github.com/daiki-beppu/dotfiles
```

## 管理構成

| 管理方式 | 対象 |
|---------|------|
| **Nix (nixpkgs)** | CLI ツール (git, gh, ffmpeg, uv 等) |
| **Nix (flake input)** | nixpkgs 未収録で upstream が flake を提供するツール (takt) |
| **Nix (programs.git)** | git の設定 (.gitconfig, .gitignore) |
| **Nix (system.defaults)** | macOS システム設定 (Dock, Finder, キーボード等) |
| **Nix (home.activation)** | dotfiles 一式のシンボリンク (.zshenv, .zshrc, .zprofile, .local/bin/*, .config/zsh-abbr/*, .claude/*) |
| **Nix (home.activation / 公式 installer)** | Vite+ グローバル CLI `vp`（Node.js shim は導入せず、system-first） |
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
│   ├── .local/bin/        # open-browser, takt-usage-report
│   ├── .config/
│   │   └── zsh-abbr/      # zsh-abbr のユーザー定義略語
│   ├── .takt/             # takt グローバル設定（~/.takt/config.yaml に symlink）
│   │   └── config.yaml    # カスタム workflow は各プロジェクトの .takt/ で管理
│   └── .claude/           # Claude Code 設定
│       ├── CLAUDE.md
│       ├── settings.json
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
| nixpkgs にないツール追加 | upstream が flake を提供するなら `flake.nix` の `inputs` に、なければ `brews` に追加 |
| takt を更新 | `flake.nix` の `takt.url` のタグを上げて `nix flake update takt` → switch |
| vp を更新 | `nix/vite-plus.nix` の `version` と公式 installer の `hash` を更新 → switch（ネットワーク接続が必要） |
| 変更を適用 | `sudo darwin-rebuild switch --flake ~/ghq/github.com/daiki-beppu/dotfiles` |
| パッケージ検索 | `nix search nixpkgs <キーワード>` |
| 全依存を最新化 | `nix flake update --flake ~/ghq/github.com/daiki-beppu/dotfiles` |
| ロールバック | `sudo darwin-rebuild switch --rollback` |

## Codex Cloud

Codex Cloud では dotfiles を clone した後、次の共通 bootstrap を実行する。

```bash
"$HOME/.local/share/dotfiles/scripts/setup-codex-cloud.sh"
```

Cloud に公開するスキル一覧は `config/codex-cloud/skills.txt`、スキルの実体は
`config/.claude/skills/` が正本。bootstrap は対象だけを公式 user scope の
`~/.agents/skills/` へ symlink するため、Cloud 側にスキルを複製しない。

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

`vp` は `~/.vite-plus/bin/vp` に導入し、既存の `.zshenv` が
`~/.vite-plus/env` を読むため非対話 zsh でも利用できる。新しいシェルで
`command -v vp` と `vp --version` を確認する。起動済みアプリが古い PATH を
保持している場合はターミナル／Codex を再起動する。

Vite+ は固定中の nixpkgs に未収録。Homebrew 版の Node.js 依存更新を避けるため、
バージョンとハッシュを固定した公式 installer を Home Manager から実行する。
`VP_NODE_MANAGER=no` で Node.js shim の導入を避け、`vp env off` で
system-first にする。通常の `node` / `npm` / `pnpm` の管理は維持し、
`vp` 内の実行環境はプロジェクトの指定に従う。
各リポジトリの `vite-plus` 依存と lockfile は変更しない。
グローバル CLI の更新は `vp upgrade` ではなく上記の Nix 設定で行う。
activation で取得したファイルは Nix store 外にあるため、Nix の rollback だけでは
`vp` は戻らない。以前の `version` / `hash` に戻して switch する。

公式資料: [Getting Started](https://viteplus.dev/guide/)、
[Installer Environment Variables](https://viteplus.dev/guide/installer-env-vars/)。

```
Nix (/etc/profiles/per-user/mba/bin/)
  > Homebrew (/opt/homebrew/bin/)
  > システム
```
