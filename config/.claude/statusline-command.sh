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

# Git diff stat（GitHub 風: +追加 -削除）
RED='\033[31m'
git_stat=""
if [ -n "$branch" ]; then
    diff_output=$(GIT_OPTIONAL_LOCKS=0 git diff --numstat HEAD 2>/dev/null)
    if [ -n "$diff_output" ]; then
        added=$(echo "$diff_output" | awk '{s+=$1} END {printf "%d", s}')
        deleted=$(echo "$diff_output" | awk '{s+=$2} END {printf "%d", s}')
        parts=""
        [ "$added" -gt 0 ] && parts=$(printf "${GREEN}+%d${RESET}" "$added")
        if [ "$deleted" -gt 0 ]; then
            [ -n "$parts" ] && parts="${parts} "
            parts="${parts}$(printf "${RED}-%d${RESET}" "$deleted")"
        fi
        [ -n "$parts" ] && git_stat=$(printf " | 📝 Changes %s" "$parts")
    fi
fi

# プログレスバーを生成する関数（10マス）
make_bar() {
    local pct=$1
    local total=10
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
    context_part=$(printf "📊 Context ${BAR_COLOR}%s${RESET} %.1f%%" "$bar" "$used")
else
    context_part=$(printf "📊 Context ${YELLOW}░░░░░░░░░░${RESET} N/A")
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

# レートリミット情報を取得（キャッシュ付き）
CACHE_FILE="/tmp/claude-usage-cache.json"
CACHE_TTL=360

fetch_usage() {
    # キャッシュが有効ならそれを使う
    if [ -f "$CACHE_FILE" ]; then
        cache_age=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE") ))
        if [ "$cache_age" -lt "$CACHE_TTL" ]; then
            cat "$CACHE_FILE"
            return
        fi
    fi
    # Keychain からトークン取得
    local cred
    cred=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null) || return
    local token
    token=$(echo "$cred" | jq -r '.claudeAiOauth.accessToken // .accessToken // .access_token // empty') || return
    [ -z "$token" ] && return
    # API 呼び出し
    local resp
    resp=$(curl -sf --max-time 5 \
        -H "Authorization: Bearer ${token}" \
        -H "anthropic-beta: oauth-2025-04-20" \
        "https://api.anthropic.com/api/oauth/usage" 2>/dev/null) || return
    echo "$resp" > "$CACHE_FILE"
    echo "$resp"
}

# レートリミット表示部分を生成
make_rate_part() {
    local label=$1 pct=$2
    if [ -z "$pct" ]; then
        return
    fi
    local bar
    bar=$(make_bar "$pct")
    local color
    if [ "$(echo "$pct >= 80" | bc)" -eq 1 ]; then
        color='\033[31m'  # 赤
    elif [ "$(echo "$pct >= 50" | bc)" -eq 1 ]; then
        color='\033[33m'  # 黄
    else
        color='\033[32m'  # 緑
    fi
    printf "⏱ %s Limit ${color}%s${RESET} %.0f%%" "$label" "$bar" "$pct"
}

usage_json=$(fetch_usage)
rate_5h=""
rate_7d=""
if [ -n "$usage_json" ]; then
    util_5h=$(echo "$usage_json" | jq -r '.five_hour.utilization // empty')
    util_7d=$(echo "$usage_json" | jq -r '.seven_day.utilization // empty')
    rate_5h=$(make_rate_part "5h" "$util_5h")
    rate_7d=$(make_rate_part "7d" "$util_7d")
fi

# レートリミット部分を結合
rate_part=""
if [ -n "$rate_5h" ] && [ -n "$rate_7d" ]; then
    rate_part=$(printf "%s | %s" "$rate_5h" "$rate_7d")
elif [ -n "$rate_5h" ]; then
    rate_part="$rate_5h"
elif [ -n "$rate_7d" ]; then
    rate_part="$rate_7d"
fi

# 全体を結合して出力（1行目: ブランチ+ディレクトリ+モデル、2行目: バー類）
bar_line="$context_part"
if [ -n "$rate_part" ]; then
    bar_line=$(printf "%s | %s" "$context_part" "$rate_part")
fi
printf "%s | %s%s\n%s %s" "$prefix" "$model_part" "$git_stat" "$bar_line" "$tokens_part"
