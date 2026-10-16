# dotfiles

daiki-beppu の macOS 開発環境セットアップ。

Nix (nix-darwin + Home Manager) で宣言的に管理する。

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
| **Nix (nixpkgs)** | CLI ツール (git, gh, ffmpeg, uv, turso-cli 等) |
| **Nix (nixpkgs の上書き)** | gh-stack 0.2.0（`gh` 拡張として登録） |
| **Nix (自前ビルド)** | nixpkgs 未収録の npm 配布ツール (Cloudflare CLI `cf`: `nix/cf/`) |
| **Nix (flake input)** | nixpkgs 未収録で upstream が flake を提供するツール (takt) |
| **Nix (programs.git / programs.nh)** | git の設定 (.gitconfig, .gitignore)、nh |
| **Nix (system.defaults)** | macOS システム設定 (Dock, Finder, キーボード等) |
| **Nix (security.pam)** | sudo の Touch ID 認証 |
| **Nix (launchd)** | 週次の自動クリーン（Nix ストア・Codex セッション） |
| **Nix (home.activation)** | dotfiles 一式のシンボリックリンク (.zshenv, .zshrc, .zprofile, .local/bin/*, .config/zsh-abbr/*, .claude/*, .codex/AGENTS.md, .agents/skills, .takt/*) |
| **Nix (home.activation / vp self-setup)** | Vite+ グローバル CLI `vp`（shim は system-first） |
| **Homebrew (brews)** | nixpkgs にないツール (git-lfs, ni, vercel) |
| **Homebrew (casks)** | GUI アプリ (Claude, Codex, Cursor, Orca, Raycast 等) |
| **Homebrew (masApps)** | Mac App Store 限定アプリ (Klack) |

対応ホスト: `mba` = MacBook Air（user `mba`）、`MacBook-Pro-3` = MacBook Pro（user `daikibeppu`）。

## ファイル構成

```
dotfiles/
├── flake.nix              # エントリポイント（inputs, system.defaults, Homebrew）
├── flake.lock             # 依存バージョンのロック（自動生成）
├── nix/
│   ├── packages.nix       # Home Manager 設定（パッケージ, git, シンボリックリンク）
│   ├── vite-plus.nix      # Vite+ グローバル CLI（vp）の固定と self-setup
│   └── cf/                # Cloudflare CLI（cf）のビルド定義
├── config/
│   ├── .zshenv            # zsh 環境変数（全セッション共通）
│   ├── .zshrc             # zsh 設定
│   ├── .zprofile          # PATH 設定（Homebrew + Nix）
│   ├── .local/bin/        # open-browser, takt-usage-report, takt-mcp-root, gh-subissues
│   ├── .config/
│   │   └── zsh-abbr/      # zsh-abbr のユーザー定義略語
│   ├── .takt/             # takt グローバル設定（~/.takt/ に symlink）
│   │   ├── config.yaml    # カスタム workflow は各プロジェクトの .takt/ で管理
│   │   └── runtime.yaml   # provider / model の割り当てと companion reviewer
│   ├── .agents/
│   │   ├── AGENTS.md      # グローバル指示の正本（~/.claude/CLAUDE.md・~/.codex/AGENTS.md に symlink）
│   │   └── skills/        # 共通スキルの正本（Codex / Claude Code）
│   ├── .claude/           # Claude Code 設定
│   │   ├── settings.json
│   │   ├── statusline-command.sh
│   │   └── hooks/         # main への直接 commit・pkill・rm のガード、main の自動更新
│   └── codex-cloud/
│       └── skills.txt     # Codex Cloud に公開するスキル一覧
├── scripts/
│   ├── check.sh                     # ローカル / CI 共通の検証エントリポイント
│   ├── sync-agent-skills.sh         # スキルのリンク（Codex Cloud では --manifest）
│   ├── setup-codex-cloud.sh         # Codex Cloud の bootstrap
│   ├── check-codex-cloud-evidence.sh  # Cloud の録画環境の検証
│   └── gyazo-retire.sh              # Gyazo 退会ウィザード（cap.so へ移行）
├── .github/workflows/ci.yml  # CI（scripts/check.sh を実行）
├── .takt/                 # このリポジトリ用の takt 設定
├── docs/
│   ├── manual-setup.md         # 手動設定ガイド
│   ├── takt-usage-baseline.md  # takt 運用状況のベースライン記録
│   └── knowledge/              # 作業の学びに関する開発ログ
└── plans/                 # improve 監査に基づく実装プラン群
```

## よくある操作

| やりたいこと | 操作 |
|-------------|------|
| CLI ツール追加 | `nix/packages.nix` の `home.packages` に追加 |
| GUI アプリ追加 | `flake.nix` の `casks` に追加 |
| nixpkgs にないツール追加 | upstream が flake を提供しているなら `flake.nix` の `inputs` に、なければ `brews` に追加 |
| takt を更新 | `flake.nix` の `takt.url` のタグを上げて `nix flake update takt` → switch → `takt update`（provider の SDK を揃える。初回は `takt install claude-sdk` と `takt install codex`） |
| vp を更新 | `nix/vite-plus.nix` の `version` と npm tarball の `hash` を更新 → switch（ネットワーク接続が必要） |
| cf を更新 | `nix/cf/default.nix` 冒頭のコメントの手順で `version`・`hash`・`package-lock.json` を差し替える |
| 変更を検証 | `scripts/check.sh`（CI と同じ。`--list` で検査の一覧を表示） |
| 変更を適用 | `sudo darwin-rebuild switch --flake ~/ghq/github.com/daiki-beppu/dotfiles`（`nh darwin switch` でも可） |
| パッケージ検索 | `nix search nixpkgs <キーワード>` |
| 全依存を最新化 | `nix flake update --flake ~/ghq/github.com/daiki-beppu/dotfiles` |
| ロールバック | `sudo darwin-rebuild switch --rollback` |

## 共通スキル

`config/.agents/skills/` を正本とし、Nix の activation によって `~/.agents/skills/` と `~/.claude/skills/` を同じディレクトリへリンクする。追加や削除のたびに同期作業を行う必要はない。
各スキルの有効・無効は、Claude Code の `skillOverrides` と Codex の `skills.config` で個別に管理する。

旧構成から初めて切り替える場合は、既存の `~/.agents/skills/` にある外部スキルを正本へ引き継ぎ、同名の衝突がないことを確認したうえで activation を実行する。
あわせて、旧 `config/.claude/skills/` 内にある未追跡のスキルも確認する。
外部 installer によるファイルは、ローカルの `.git/info/exclude` で追跡対象から除外する。
既存のリンクやディレクトリは、activation 実行時に `.backup-before-link` として退避される。

## Codex Cloud

Codex Cloud では dotfiles をクローンした後、次の共通 bootstrap を実行する。

```bash
"$HOME/.local/share/dotfiles/scripts/setup-codex-cloud.sh"
```

Cloud に公開するスキル一覧は `config/codex-cloud/skills.txt` で定義し、スキルの実体は `config/.agents/skills/` が正本となる。bootstrap では対象のスキルのみを公式 user scope の `~/.agents/skills/` へシンボリックリンクするため、Cloud 側にスキルを複製することはない。

bootstrap は Ubuntu Linux (amd64 / arm64)、Node.js 18 以上と npm、root または非対話の sudo 権限を前提とする。標準の `--attach` に対応していない gh については、公式の 2.99.0 バイナリをチェックサム照合したうえで `/usr/local/bin` に導入する。mise がある場合は gh を `system` に切り替え、検証済みの `/usr/local/bin/gh` を使用する。また、Playwright CLI 0.1.19、対応する Chromium・Linux 依存パッケージ、FFmpeg も導入し、短い WebM 録画と MP4 への変換を検証する。セットアップとメンテナンスの両方で、同じ bootstrap を実行できる。

Cloud の独立したエージェントシェルでも `scripts/check-codex-cloud-evidence.sh` を実行し、PATH やブラウザキャッシュが後続のフェーズで利用可能か確認する。
録画時には `~/.config/dotfiles/evidence-browser.json` を `playwright-cli open --config=...` に指定する。なお、この検証では GitHub へのファイルアップロードは行われない。

PR への動画添付には gh 標準の `--attach` を使用する。対象リポジトリへの書き込み権限を持つ OAuth トークンまたは classic PAT を、エージェント段階でも利用可能な `GH_TOKEN` 環境変数として設定しておく必要がある。Cloud Secrets はセットアップ段階でしか利用できないため、添付用途には適さない。fine-grained PAT によるメディア添付への対応は未保証である。ブラウザの Cookie や gh-attach 拡張は必要ない。
通信の許可設定には GitHub API とメディアアップロード先が必要であり、実際に添付が成功することを確認するまでは、認証・通信ともに未検証として扱う。セットアップの成功がそのまま動画添付の成功を意味するわけではない。

## macOS 設定 (system.defaults)

`flake.nix` で以下を宣言的に管理する。

- ダークモード
- キーボードのリピート速度
- トラックパッド（ナチュラルスクロール無効、タップでクリック等）
- Finder（拡張子の常時表示、カラム表示等）
- Dock（自動非表示、最近使ったアプリの非表示等）
- 入力メニューのメニューバー表示（azooKey）

## 自動クリーン (launchd)

いずれも毎週月曜 12:00 に実行する。

- `nh-clean`（root）: `nh clean all --keep 3 --optimise` で Nix の世代を最新 3 つだけ残し、ストアの重複排除を行う
- `codex-sessions-clean`（ユーザー）: 最終更新から 7 日を経過した Codex のセッション（Orca の共有先を含む）を削除する

なお、Claude Code のセッションは `config/.claude/settings.json` の `cleanupPeriodDays` 設定により、14 日後に自動で削除される。

## 手動で設定が必要な項目

詳細は [`docs/manual-setup.md`](docs/manual-setup.md) を参照。

- ディスプレイ解像度を「スペースを拡大」に変更
- Raycast の設定（Spotlight ショートカットの変更）
- oh-my-zsh のインストール
- Vite+ の確認
- アプリの初期設定（1Password・Google Drive・Cap 等）
- takt MCP の登録

## PATH 優先順位

`vp` は `~/.vite-plus/bin/vp` に導入され、既存の `.zshenv` が `~/.vite-plus/env` を読み込むため、非対話の zsh でも利用できる。新しいシェルを開いたら `command -v vp` と `vp --version` で動作を確認する。起動済みのアプリが古い PATH を保持している場合は、ターミナルや Codex を再起動する。

Vite+ は nixpkgs に未収録である。Homebrew 版が Node.js とその依存を更新するのを避けるため、npm 配布の `vp` バイナリをバージョンとハッシュで固定し、Home Manager の activation 時の self-setup で `~/.vite-plus` に展開している。
`VP_SELF_SETUP_NO_MODIFY_PATH=1` でシェル設定ファイルの自動書き換えを防ぎ、`VP_NODE_MANAGER=no` で `node` / `npm` / `pnpm` の shim を system-firstにする。
通常の `node` / `npm` / `pnpm` の管理は維持し、`vp` 内の実行環境は各プロジェクトの指定に従わせる。
各リポジトリの `vite-plus` 依存と lockfile は変更しない。
グローバル CLI の更新は `vp upgrade` ではなく、上記の Nix 設定を介して行う。
なお、activation で取得したファイルは Nix store 外にあるため、Nix の rollback だけでは `vp` は元の状態に戻らない。以前の `version` / `hash` に戻したうえで switch を実行する。

公式資料: [Getting Started](https://viteplus.dev/guide/)、[環境変数の定義（v1.0.0）](https://github.com/voidzero-dev/vite-plus/blob/v1.0.0/crates/vp_shared/src/env_vars.rs)。

```
Nix (/etc/profiles/per-user/$USER/bin/)
  > Homebrew (/opt/homebrew/bin/)
  > システム
```
