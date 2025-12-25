#!/bin/bash

# dotfiles自動同期セットアップスクリプト
# launchd を使用した定期実行を設定します

set -e

DOTFILES_DIR="$HOME/01-dev/dotfiles"
PLIST_SOURCE="$DOTFILES_DIR/config/com.dotfiles.sync.plist"
PLIST_DEST="$HOME/Library/LaunchAgents/com.dotfiles.sync.plist"

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

log_warning() {
    echo "\033[0;33m[WARNING]\033[0m $1"
}

# LaunchAgentsディレクトリの作成
create_launch_agents_dir() {
    if [ ! -d "$HOME/Library/LaunchAgents" ]; then
        mkdir -p "$HOME/Library/LaunchAgents"
        log_success "LaunchAgentsディレクトリを作成しました"
    fi
}

# plistファイルのコピー
copy_plist() {
    if [ -f "$PLIST_DEST" ]; then
        log_warning "既存のplistファイルが見つかりました。上書きします。"
        launchctl unload "$PLIST_DEST" 2>/dev/null || true
    fi

    cp "$PLIST_SOURCE" "$PLIST_DEST"
    log_success "plistファイルをコピーしました"
}

# launchdジョブの登録
load_plist() {
    launchctl load "$PLIST_DEST"
    log_success "自動同期ジョブを登録しました"
}

# ステータス確認
check_status() {
    log_info ""
    log_info "設定完了！以下の設定が有効になりました:"
    log_info "  - 1時間ごとに自動同期"
    log_info "  - ログイン時に同期"
    log_info ""
    log_info "ログファイル:"
    log_info "  - 標準出力: ~/Library/Logs/dotfiles-sync.log"
    log_info "  - エラー: ~/Library/Logs/dotfiles-sync-error.log"
    log_info ""
    log_info "手動同期:"
    log_info "  $DOTFILES_DIR/scripts/sync_dotfiles.sh"
    log_info ""
    log_info "リアルタイム監視（オプション）:"
    log_info "  $DOTFILES_DIR/scripts/watch_dotfiles.sh"
    log_info ""
    log_info "自動同期を停止する場合:"
    log_info "  launchctl unload ~/Library/LaunchAgents/com.dotfiles.sync.plist"
    log_info ""
}

# メイン処理
main() {
    log_info "dotfiles自動同期のセットアップを開始します..."

    # LaunchAgentsディレクトリの作成
    create_launch_agents_dir

    # plistファイルのコピー
    copy_plist

    # launchdジョブの登録
    load_plist

    # ステータス確認
    check_status

    log_success "セットアップ完了！"
}

# スクリプト実行
main
