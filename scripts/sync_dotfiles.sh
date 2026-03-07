#!/bin/bash

# dotfiles自動同期スクリプト
# ホームディレクトリの設定ファイルをdotfilesリポジトリに同期します

set -e

DOTFILES_DIR="$HOME/01-dev/dotfiles"
CONFIG_DIR="$DOTFILES_DIR/config"
DOT_CONFIG_DIR="$DOTFILES_DIR/.config"

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

# macOS通知を送信
send_notification() {
    local title="$1"
    local message="$2"
    local sound="${3:-default}"

    # osascriptでmacOSの通知センターに通知を送る
    osascript -e "display notification \"$message\" with title \"$title\" sound name \"$sound\"" 2>/dev/null

    if [ $? -eq 0 ]; then
        log_info "通知を送信しました: $title"
    else
        log_warning "通知の送信に失敗しました"
    fi
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

# .configディレクトリを同期
sync_dot_config_files() {
    log_info ".configディレクトリを同期中..."

    local updated=false

    # gh設定を同期
    local gh_files=("config.yml" "hosts.yml")
    for file in "${gh_files[@]}"; do
        if [ -f "$HOME/.config/gh/$file" ]; then
            local dest_dir="$DOT_CONFIG_DIR/gh"
            mkdir -p "$dest_dir"

            if ! cmp -s "$HOME/.config/gh/$file" "$dest_dir/$file" 2>/dev/null; then
                cp "$HOME/.config/gh/$file" "$dest_dir/"
                log_success "更新: .config/gh/$file"
                updated=true
            fi
        fi
    done

    # git ignore設定を同期
    if [ -f "$HOME/.config/git/ignore" ]; then
        local dest_dir="$DOT_CONFIG_DIR/git"
        mkdir -p "$dest_dir"

        if ! cmp -s "$HOME/.config/git/ignore" "$dest_dir/ignore" 2>/dev/null; then
            cp "$HOME/.config/git/ignore" "$dest_dir/"
            log_success "更新: .config/git/ignore"
            updated=true
        fi
    fi

    if [ "$updated" = false ]; then
        log_info ".configディレクトリに変更はありません"
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

# 機密情報パターンのチェック
check_sensitive_patterns() {
    log_info "機密情報パターンをチェック中..."

    cd "$DOTFILES_DIR"

    # 機密情報の可能性があるパターン
    local patterns=(
        "password\s*=\s*['\"].*['\"]"
        "api[_-]?key\s*=\s*['\"].*['\"]"
        "secret\s*=\s*['\"].*['\"]"
        "token\s*=\s*['\"].*['\"]"
        "private[_-]?key"
        "-----BEGIN.*PRIVATE KEY-----"
        "ghp_[a-zA-Z0-9]{36}"  # GitHub Personal Access Token
        "sk-[a-zA-Z0-9]{48}"   # OpenAI API Key
        "AKIA[0-9A-Z]{16}"     # AWS Access Key
    )

    # ステージングされたファイルの内容をチェック
    local changed_files=$(git diff --cached --name-only 2>/dev/null)

    if [ -z "$changed_files" ]; then
        # ステージングされていなければ、変更されたファイルをチェック
        changed_files=$(git diff --name-only 2>/dev/null)
    fi

    for file in $changed_files; do
        if [ -f "$file" ]; then
            for pattern in "${patterns[@]}"; do
                if grep -iE "$pattern" "$file" > /dev/null 2>&1; then
                    log_error "機密情報の可能性があるパターンを検出: $file"
                    log_warning "パターン: $pattern"
                    log_warning "ファイルを確認して、機密情報が含まれていないことを確認してください"
                    return 1
                fi
            done
        fi
    done

    log_success "機密情報パターンのチェック: OK"
    return 0
}

# リポジトリがプライベートか確認
check_repository_visibility() {
    log_info "リポジトリの公開設定をチェック中..."

    cd "$DOTFILES_DIR"

    # リモートURLを取得
    local remote_url=$(git remote get-url origin 2>/dev/null)

    if [ -z "$remote_url" ]; then
        log_warning "リモートリポジトリが設定されていません"
        return 1
    fi

    # GitHub URLからリポジトリ情報を抽出
    if [[ "$remote_url" =~ github\.com[:/]([^/]+)/([^/\.]+) ]]; then
        local owner="${BASH_REMATCH[1]}"
        local repo="${BASH_REMATCH[2]}"

        # GitHub APIでリポジトリ情報を取得
        local api_response=$(curl -s "https://api.github.com/repos/$owner/$repo")

        if echo "$api_response" | grep -q '"private": true'; then
            log_success "リポジトリはプライベートです: OK"
            return 0
        elif echo "$api_response" | grep -q '"private": false'; then
            log_warning "リポジトリは公開されています"
            log_warning "機密情報が含まれていないか、十分に注意してください"
            # 公開リポジトリでも継続可能だが、警告は出す
            return 0
        else
            log_warning "リポジトリの公開設定を確認できませんでした"
            log_info "GitHub APIのレート制限に達している可能性があります"
            # 確認できない場合は安全側に倒して継続
            return 0
        fi
    else
        log_warning "GitHub以外のリポジトリです。手動で公開設定を確認してください"
        return 0
    fi
}

# .gitignoreに適切な除外設定があるかチェック
check_gitignore_patterns() {
    log_info ".gitignoreの設定をチェック中..."

    local gitignore="$DOTFILES_DIR/.gitignore"

    if [ ! -f "$gitignore" ]; then
        log_warning ".gitignoreファイルが存在しません"
        return 0
    fi

    # 推奨される除外パターン
    local recommended_patterns=(
        "*.env"
        "*.key"
        "*.pem"
        "*secret*"
        "*credentials*"
    )

    local missing_patterns=()

    for pattern in "${recommended_patterns[@]}"; do
        if ! grep -q "^$pattern" "$gitignore" 2>/dev/null; then
            missing_patterns+=("$pattern")
        fi
    done

    if [ ${#missing_patterns[@]} -gt 0 ]; then
        log_warning ".gitignoreに以下のパターンを追加することを推奨します:"
        for pattern in "${missing_patterns[@]}"; do
            echo "  - $pattern"
        done
    fi

    log_success ".gitignoreの設定: OK"
    return 0
}

# セキュリティチェック統合
run_security_checks() {
    log_info "=== セキュリティチェック開始 ==="

    # 1. 機密情報パターンチェック（必須）
    if ! check_sensitive_patterns; then
        log_error "機密情報パターンチェックに失敗しました"
        log_error "自動pushを中止します"
        return 1
    fi

    # 2. リポジトリ公開設定チェック（警告のみ）
    check_repository_visibility

    # 3. .gitignoreチェック（警告のみ）
    check_gitignore_patterns

    log_success "=== セキュリティチェック完了 ==="
    return 0
}

# Git変更を確認
check_git_changes() {
    cd "$DOTFILES_DIR"

    if [ -n "$(git status --porcelain)" ]; then
        log_info "変更が検出されました:"
        git status --short

        # 自動コミット・プッシュ
        git add -A

        # セキュリティチェックを実行
        if ! run_security_checks; then
            log_error "セキュリティチェックに失敗しました"
            log_error "変更はステージングされていますが、コミット・プッシュは中止されました"
            log_info "問題を修正した後、手動でコミット・プッシュしてください"
            send_notification "dotfiles セキュリティ警告" "機密情報の可能性があるパターンを検出しました。ファイルを確認してください。" "Basso"
            # ステージングを取り消す
            git reset HEAD > /dev/null 2>&1
            return 1
        fi

        # セキュリティチェックOKの場合、コミット
        git commit -m "chore: auto-sync dotfiles at $(date '+%Y-%m-%d %H:%M:%S')"

        # GitHubにプッシュ
        if git push origin main 2>&1; then
            log_success "変更を自動コミット・プッシュしました"
        else
            log_error "プッシュに失敗しました"
            send_notification "dotfiles 同期エラー" "GitHubへのプッシュに失敗しました。ネットワーク接続または認証情報を確認してください。" "Basso"
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

    # .configディレクトリを同期
    sync_dot_config_files

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
