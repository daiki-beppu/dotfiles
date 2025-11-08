#!/bin/bash

echo "🍺 Homebrewのセットアップを開始するで..."

# Homebrewがインストールされてるか確認
if ! command -v brew &> /dev/null; then
    echo "📦 Homebrewをインストール中..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    
    # Apple Silicon用のパス設定
    echo "🔧 パスを設定中..."
    eval "$(/opt/homebrew/bin/brew shellenv)"
else
    echo "✅ Homebrewは既にインストール済みや"
fi

# Homebrewをアップデート
echo "⬆️  Homebrewをアップデート中..."
brew update

# Brewfileからパッケージをインストール
echo "📦 Brewfileからパッケージをインストール中..."
brew bundle --file="$HOME/.dotfiles/Brewfile"

echo "✅ Homebrewのセットアップ完了！"
echo "🎉 すべてのパッケージがインストールされたで！"