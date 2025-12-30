#!/bin/bash

echo "🔗 シンボリックリンクを作成するで..."

DOTFILES_DIR="$HOME/.dotfiles"
CONFIG_DIR="$DOTFILES_DIR/config"

# リンクを作成する関数
create_symlink() {
    local source=$1
    local target=$2
    
    # 既存ファイルがあればバックアップ
    if [ -e "$target" ] && [ ! -L "$target" ]; then
        echo "📦 既存ファイルをバックアップ: $target → $target.backup"
        mv "$target" "$target.backup"
    fi
    
    # シンボリックリンク作成
    if [ -L "$target" ]; then
        echo "⏭️  スキップ（既にリンク済み）: $target"
    else
        ln -sf "$source" "$target"
        echo "✅ リンク作成: $target → $source"
    fi
}

# dotfilesをリンク
create_symlink "$CONFIG_DIR/.zshrc" "$HOME/.zshrc"
create_symlink "$CONFIG_DIR/.zprofile" "$HOME/.zprofile"
create_symlink "$CONFIG_DIR/.gitconfig" "$HOME/.gitconfig"
create_symlink "$CONFIG_DIR/.gitignore_global" "$HOME/.gitignore_global"
create_symlink "$CONFIG_DIR/.tmux.conf" "$HOME/.tmux.conf"

echo "🎉 シンボリックリンクの作成完了！"