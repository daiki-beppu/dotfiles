#!/bin/bash

# JSON 入力を読み込み
input=$(cat)

# 必要な情報を抽出
cwd=$(echo "$input" | jq -r '.workspace.current_dir')
model=$(echo "$input" | jq -r '.model.display_name')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
input_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
output_tokens=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
context_size=$(echo "$input" | jq -r '.context_window.context_window_size // 200000')
current_input=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // empty')

# Usage API からプラン使用制限を取得（60秒キャッシュ）
get_usage_limits() {
    # 環境変数 → Keychain の順でトークンを取得
    local token="${ANTHROPIC_AUTH_TOKEN:-}"
    if [ -z "$token" ]; then
        token=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null \
            | jq -r '.claudeAiOauth.accessToken // empty' 2>/dev/null)
    fi
    if [ -z "$token" ]; then
        return 1
    fi

    local cache_file="$HOME/.claude/.statusline_usage_cache"
    local now=$(date +%s)

    # キャッシュが60秒以内なら再利用
    if [ -f "$cache_file" ]; then
        local mtime=$(stat -f%m "$cache_file" 2>/dev/null || echo 0)
        local age=$((now - mtime))
        if [ "$age" -lt 60 ]; then
            cat "$cache_file"
            return 0
        fi
    fi

    # API 呼び出し（バックグラウンドでブロックしないよう timeout 付き）
    local result
    result=$(curl -s --max-time 3 \
        -H "Authorization: Bearer $token" \
        "https://api.anthropic.com/api/oauth/usage" 2>/dev/null)

    if [ -n "$result" ] && echo "$result" | jq -e '.five_hour' >/dev/null 2>&1; then
        echo "$result" > "$cache_file"
        echo "$result"
        return 0
    fi

    # 失敗時は古いキャッシュがあればそれを使う
    if [ -f "$cache_file" ]; then
        cat "$cache_file"
        return 0
    fi

    return 1
}

# トークン数をK単位でフォーマット
format_tokens() {
    local tokens=$1
    if [ "$tokens" -ge 1000 ]; then
        printf "%.1fK" "$(echo "scale=1; $tokens / 1000" | bc)"
    else
        printf "%d" "$tokens"
    fi
}

# ホームディレクトリを ~ に置換
cwd_short=$(echo "$cwd" | sed "s|^$HOME|~|")

# Git ブランチ情報を取得
cd "$cwd" 2>/dev/null
branch=$(GIT_OPTIONAL_LOCKS=0 git symbolic-ref --short HEAD 2>/dev/null)

# ANSI カラーコード
GREEN='\033[32m'
CYAN='\033[36m'
MAGENTA='\033[35m'
YELLOW='\033[33m'
RESET='\033[0m'

# プレフィックス部分（ブランチ + ディレクトリ）
if [ -n "$branch" ]; then
    prefix=$(printf "[${GREEN}%s${RESET}][${CYAN}%s${RESET}]" "$branch" "$cwd_short")
else
    prefix=$(printf "[${CYAN}%s${RESET}]" "$cwd_short")
fi

# モデル名部分（マゼンタ + アイコン）
model_part=$(printf "${MAGENTA}🤖 %s${RESET}" "$model")

# プログレスバーを生成する関数（10マス）
make_bar() {
    local pct=$1
    local total=${2:-10}
    local filled=$(echo "$pct $total" | awk '{printf "%d", ($1 / 100) * $2 + 0.5}')
    local empty=$((total - filled))
    local bar=""
    for i in $(seq 1 $filled); do bar="${bar}█"; done
    for i in $(seq 1 $empty); do bar="${bar}░"; done
    echo "$bar"
}

# コンテキスト部分（使用率に応じて色を変化 + プログレスバー + Free space）
if [ -n "$used" ]; then
    bar=$(make_bar "$used")
    # 使用率に応じて色を変化: ~60% 緑、60~70% 黄、70%~ 赤
    if [ "$(echo "$used >= 70" | bc)" -eq 1 ]; then
        BAR_COLOR='\033[31m'  # 赤
    elif [ "$(echo "$used >= 60" | bc)" -eq 1 ]; then
        BAR_COLOR='\033[33m'  # 黄
    else
        BAR_COLOR='\033[32m'  # 緑
    fi
    context_part=$(printf "📊 ${BAR_COLOR}%s${RESET} %.1f%%" "$bar" "$used")
else
    context_part=$(printf "📊 ${YELLOW}░░░░░░░░░░${RESET} N/A")
fi

# 使用制限部分（Usage API から取得）
usage_part=""
usage_data=$(get_usage_limits 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$usage_data" ]; then
    five_hour=$(echo "$usage_data" | jq -r '.five_hour.utilization // empty')
    seven_day=$(echo "$usage_data" | jq -r '.seven_day.utilization // empty')

    if [ -n "$five_hour" ]; then
        five_pct=$(echo "$five_hour * 100" | bc)
        five_bar=$(make_bar "$five_pct" 5)
        if [ "$(echo "$five_pct >= 80" | bc)" -eq 1 ]; then
            FIVE_COLOR='\033[31m'
        elif [ "$(echo "$five_pct >= 60" | bc)" -eq 1 ]; then
            FIVE_COLOR='\033[33m'
        else
            FIVE_COLOR='\033[32m'
        fi
        five_part=$(printf "${FIVE_COLOR}%s${RESET} %.0f%%" "$five_bar" "$five_pct")
    else
        five_part="N/A"
    fi

    if [ -n "$seven_day" ]; then
        seven_pct=$(echo "$seven_day * 100" | bc)
        seven_bar=$(make_bar "$seven_pct" 5)
        if [ "$(echo "$seven_pct >= 80" | bc)" -eq 1 ]; then
            SEVEN_COLOR='\033[31m'
        elif [ "$(echo "$seven_pct >= 60" | bc)" -eq 1 ]; then
            SEVEN_COLOR='\033[33m'
        else
            SEVEN_COLOR='\033[32m'
        fi
        seven_part=$(printf "${SEVEN_COLOR}%s${RESET} %.0f%%" "$seven_bar" "$seven_pct")
    else
        seven_part="N/A"
    fi

    usage_part=$(printf "5h:%s 7d:%s" "$five_part" "$seven_part")
fi

# トークン内訳部分（白 + アイコン）
# トークン数が0の場合（セッションリセット後）は非表示
if [ "$input_tokens" -eq 0 ] && [ "$output_tokens" -eq 0 ]; then
    tokens_part=""
else
    input_fmt=$(format_tokens "$input_tokens")
    output_fmt=$(format_tokens "$output_tokens")
    context_fmt=$(format_tokens "$context_size")
    tokens_part=""
fi

# 全体を結合して出力
# usage_part が空でなければ区切りを付けて追加
if [ -n "$usage_part" ]; then
    printf "%s %s %s %s %s" "$prefix" "$model_part" "$context_part" "$tokens_part" "$usage_part"
else
    printf "%s %s %s %s" "$prefix" "$model_part" "$context_part" "$tokens_part"
fi
