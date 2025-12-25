#!/bin/bash

# dotfilesリアルタイム監視スクリプト
# fswatch を使用してホームディレクトリの設定ファイルを監視し、
# 変更があれば自動的に dotfiles リポジトリに同期します

set -e

DOTFILES_DIR="$HOME/01-dev/dotfiles"
SYNC_SCRIPT="$DOTFILES_DIR/scripts/sync_dotfiles.sh"

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

# fswatch の確認
check_fswatch() {
    if ! command -v fswatch &> /dev/null; then
        log_error "fswatch がインストールされていません"
        log_info "以下のコマンドでインストールしてください:"
        log_info "brew install fswatch"
        exit 1
    fi
}

# 監視するファイルのリスト
WATCH_FILES=(
    "$HOME/.zshrc"
    "$HOME/.zprofile"
    "$HOME/.gitconfig"
    "$HOME/.gitignore_global"
)

# メイン処理
main() {
    log_info "dotfiles監視を開始します..."
    log_info "監視対象:"

    for file in "${WATCH_FILES[@]}"; do
        echo "  - $file"
    done

    log_info ""
    log_info "Ctrl+C で終了します"
    log_info ""

    # fswatch で監視
    fswatch -0 "${WATCH_FILES[@]}" | while read -d "" event; do
        log_info "変更を検出: $event"

        # 同期スクリプトを実行
        if [ -x "$SYNC_SCRIPT" ]; then
            "$SYNC_SCRIPT"
            log_success "同期完了"
        else
            log_error "同期スクリプトが見つかりません: $SYNC_SCRIPT"
        fi

        echo ""
    done
}

# fswatch の確認
check_fswatch

# スクリプト実行
main
