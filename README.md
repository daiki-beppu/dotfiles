# dotfiles

momochico の macOS 開発環境セットアップ

## 🚀 クイックスタート
```bash
# 1. リポジトリをクローン
git clone https://github.com/momochico/.dotfiles.git ~/.dotfiles

# 2. ディレクトリに移動
cd ~/.dotfiles

# 3. セットアップ実行
./setup.sh
```

## 📦 インストールされるもの

### CLI Tools
- gh (GitHub CLI)
- git
- proto (Node.js バージョン管理)
- tree

### Applications
- 1Password
- Arc
- AZooKey
- CleanMyMac
- Docker Desktop
- Dropbox
- Figma
- Google Chrome
- Gyazo
- Notion
- NVIDIA GeForce NOW
- Raycast
- Visual Studio Code
- Warp
- Zoom

## ⚙️ 自動設定される項目

### macOS
- ダークモード
- キーボードリピート速度
- トラックパッド設定
- Dock設定
- Finder設定

### dotfiles
- `.zshrc`
- `.zprofile`
- `.gitconfig`
- `.gitignore_global`

## 📚 ドキュメント

詳細なガイドは [`docs/`](docs/) ディレクトリを参照してください。

- **[自動同期ガイド](docs/auto-sync.md)** - 設定ファイルの自動同期の詳細な使用方法
- **[手動セットアップガイド](docs/manual-setup.md)** - 自動化できない手動設定項目

## 📝 手動で設定が必要な項目

詳細は [`docs/manual-setup.md`](docs/manual-setup.md) を参照してください。

- ディスプレイ解像度を「スペースを拡大」に変更
- Raycastの設定（Spotlightショートカット変更）
- naniアプリのインストール
- VS Code Settings Syncの有効化
- `.gitconfig` のユーザー名・メールアドレス設定

## 🗂️ ファイル構成
```
.dotfiles/
├── README.md
├── setup.sh                    # メインセットアップスクリプト
├── Brewfile                    # Homebrewパッケージ管理
├── scripts/
│   ├── 1_macos.sh             # macOS設定
│   ├── 2_homebrew.sh          # Homebrewとパッケージ
│   ├── 3_symlink.sh           # dotfilesリンク作成
│   ├── setup_auto_sync.sh     # 自動同期セットアップ
│   ├── sync_dotfiles.sh       # 手動同期スクリプト
│   └── watch_dotfiles.sh      # リアルタイム監視スクリプト
├── config/
│   ├── .zshrc
│   ├── .zprofile
│   ├── .gitconfig
│   ├── .gitignore_global
│   └── com.dotfiles.sync.plist # 自動同期設定
└── docs/
    └── manual-setup.md
```

## 🔄 更新方法
```bash
cd ~/.dotfiles
git pull
./setup.sh
```

## 🔁 自動同期

設定ファイルを変更した際に、自動的に dotfiles リポジトリに同期する機能を提供しています。

詳細な使用方法は [自動同期ガイド](docs/auto-sync.md) を参照してください。

### セットアップ

```bash
# 自動同期を有効化
./scripts/setup_auto_sync.sh
```

### 機能

#### 1. 定期自動同期（推奨）
- **間隔**: 1時間ごと + ログイン時
- **対象**: `.zshrc`, `.zprofile`, `.gitconfig`, `.gitignore_global`, `Brewfile`
- **ログ**: `~/Library/Logs/dotfiles-sync.log`

#### 2. 手動同期
```bash
# 設定ファイルのみ同期
./scripts/sync_dotfiles.sh

# Brewfileも含めて同期
./scripts/sync_dotfiles.sh --with-brew
```

#### 3. リアルタイム監視（オプション）
```bash
# fswatch が必要
brew install fswatch

# 監視開始（バックグラウンドで実行）
./scripts/watch_dotfiles.sh &
```

### 自動同期の管理

```bash
# 停止
launchctl unload ~/Library/LaunchAgents/com.dotfiles.sync.plist

# 再開
launchctl load ~/Library/LaunchAgents/com.dotfiles.sync.plist

# ステータス確認
launchctl list | grep dotfiles

# ログ確認
tail -f ~/Library/Logs/dotfiles-sync.log
```

### 注意事項
- 自動同期は変更を検出して dotfiles リポジトリにコピーしますが、**自動コミットはしません**
- 変更を Git にコミットする場合は、手動で `git add` と `git commit` を実行してください
- 自動コミットを有効にしたい場合は、`scripts/sync_dotfiles.sh` の該当箇所のコメントを解除してください