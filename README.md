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
├── setup.sh              # メインセットアップスクリプト
├── Brewfile              # Homebrewパッケージ管理
├── scripts/
│   ├── 1_macos.sh       # macOS設定
│   ├── 2_homebrew.sh    # Homebrewとパッケージ
│   └── 3_symlink.sh     # dotfilesリンク作成
├── config/
│   ├── .zshrc
│   ├── .zprofile
│   ├── .gitconfig
│   └── .gitignore_global
└── docs/
    └── manual-setup.md
```

## 🔄 更新方法
```bash
cd ~/.dotfiles
git pull
./setup.sh
```