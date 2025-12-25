#!/bin/bash

# dotfiles自動同期スクリプト
# ホームディレクトリの設定ファイルをdotfilesリポジトリに同期します

set -e

DOTFILES_DIR="$HOME/01-dev/dotfiles"
CONFIG_DIR="$DOTFILES_DIR/config"

# 色付きログ
log_info() {
    echo "\033[0;34m[INFO]\033[0m $1"
}

log_success() {
    echo "\033[0;32m[SUCCESS]\033[0m $1"
}

log_error() {
    echo "\033[0;31m[ERROR]\033[0m $1"
}

# 設定ファイルを同期
sync_config_files() {
    log_info "設定ファイルを同期中..."

    # 同期する設定ファイルのリスト
    local files=(
        ".zshrc"
        ".zprofile"
        ".gitconfig"
        ".gitignore_global"
    )

    local updated=false

    for file in "${files[@]}"; do
        local source="$HOME/$file"
        local dest="$CONFIG_DIR/$file"

        if [ -f "$source" ]; then
            # ファイルが存在し、内容が異なる場合のみコピー
            if ! cmp -s "$source" "$dest" 2>/dev/null; then
                cp "$source" "$dest"
                log_success "更新: $file"
                updated=true
            fi
        fi
    done

    if [ "$updated" = false ]; then
        log_info "設定ファイルに変更はありません"
    fi

    return 0
}

# Brewfileを更新
update_brewfile() {
    log_info "Brewfileを更新中..."

    if command -v brew &> /dev/null; then
        local brewfile="$DOTFILES_DIR/Brewfile"
        local temp_brewfile="${brewfile}.tmp"

        # 現在のインストール済みパッケージをダンプ
        brew bundle dump --file="$temp_brewfile" --force

        # 内容が異なる場合のみ更新
        if ! cmp -s "$temp_brewfile" "$brewfile" 2>/dev/null; then
            mv "$temp_brewfile" "$brewfile"
            log_success "Brewfileを更新しました"
        else
            rm "$temp_brewfile"
            log_info "Brewfileに変更はありません"
        fi
    else
        log_error "Homebrewがインストールされていません"
    fi
}

# Git変更を確認
check_git_changes() {
    cd "$DOTFILES_DIR"

    if [ -n "$(git status --porcelain)" ]; then
        log_info "変更が検出されました:"
        git status --short

        # 自動コミット・プッシュ
        git add -A
        git commit -m "chore: auto-sync dotfiles at $(date '+%Y-%m-%d %H:%M:%S')"

        # GitHubにプッシュ
        if git push origin main 2>&1; then
            log_success "変更を自動コミット・プッシュしました"
        else
            log_error "プッシュに失敗しました"
            return 1
        fi

        return 0
    else
        log_info "変更はありません"
        return 1
    fi
}

# メイン処理
main() {
    log_info "dotfiles同期を開始します..."

    # 設定ファイルを同期
    sync_config_files

    # Brewfileを更新（オプション）
    if [ "$1" = "--with-brew" ]; then
        update_brewfile
    fi

    # Git変更を確認
    check_git_changes

    log_info "同期完了"
}

# スクリプト実行
main "$@"
