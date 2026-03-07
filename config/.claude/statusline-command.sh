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
    context_part=$(printf "📊 ${BAR_COLOR}%s${RESET} %.1f%%" "$bar" "$used")
else
    context_part=$(printf "📊 ${YELLOW}░░░░░░░░░░${RESET} N/A")
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
printf "%s %s %s %s" "$prefix" "$model_part" "$context_part" "$tokens_part"
