#!/bin/bash

# JSON 入力を読み込み
input=$(cat)

# 必要な情報を抽出
cwd=$(echo "$input" | jq -r '.workspace.current_dir')
model=$(echo "$input" | jq -r '.model.display_name')
used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

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
    # Worktree 判定
    git_dir=$(GIT_OPTIONAL_LOCKS=0 git rev-parse --git-dir 2>/dev/null)
    if echo "$git_dir" | grep -q '/worktrees/'; then
        wt_name=$(basename "$git_dir")
        git_stat="${git_stat}$(printf " | ${YELLOW}🌳 Worktree${RESET} (%s)" "$wt_name")"
    fi
fi

# TrueColor グラデーション（緑→黄→赤）
pct_color() {
    local pct=$1
    local r g
    if [ "$(echo "$pct <= 50" | bc)" -eq 1 ]; then
        r=$(echo "$pct * 255 / 50" | bc)
        g=200
    else
        r=255
        g=$(echo "200 - ($pct - 50) * 150 / 50" | bc)
    fi
    printf '\033[38;2;%d;%d;0m' "$r" "$g"
}

# Fine Bar プログレスバー（▏▎▍▌▋▊▉█ で1%精度）
DIM='\033[2m'
make_bar() {
    local pct=$1
    local width=${2:-10}
    local subs=(▏ ▎ ▍ ▌ ▋ ▊ ▉)
    local filled=$(echo "$pct * $width * 8 / 100" | bc 2>/dev/null)
    [ -z "$filled" ] && filled=0
    local full=$((filled / 8))
    local partial=$((filled % 8))
    local bar=""
    local i
    for ((i=0; i<full; i++)); do bar="${bar}█"; done
    if [ "$partial" -gt 0 ] && [ "$full" -lt "$width" ]; then
        bar="${bar}${subs[$((partial-1))]}"
        full=$((full + 1))
    fi
    local empty=$((width - full))
    for ((i=0; i<empty; i++)); do bar="${bar}░"; done
    echo "$bar"
}

# コンテキスト部分（TrueColor グラデーション + Fine Bar）
if [ -n "$used" ]; then
    bar=$(make_bar "$used")
    BAR_COLOR=$(pct_color "$used")
    context_part=$(printf "📊 ctx ${BAR_COLOR}%s${RESET} %.1f%%" "$bar" "$used")
else
    context_part=$(printf "📊 ctx ${DIM}░░░░░░░░░░${RESET} N/A")
fi

# 5h 用: epoch 秒を HH:MM 形式のローカル時刻に変換
fmt_reset_hm() {
    local epoch=$1
    [ -z "$epoch" ] && return
    date -j -r "$epoch" +"%H:%M" 2>/dev/null
}

# 7d 用: epoch 秒を M/D 形式のローカル日付に変換
fmt_reset_md() {
    local epoch=$1
    [ -z "$epoch" ] && return
    date -j -r "$epoch" +"%-m/%-d" 2>/dev/null
}

# レートリミット表示部分を生成（stdin JSON の rate_limits から取得）
make_rate_part() {
    local label=$1 pct=$2 reset=$3
    [ -z "$pct" ] && return
    local bar color
    bar=$(make_bar "$pct")
    color=$(pct_color "$pct")
    if [ -n "$reset" ]; then
        printf "⏱ %s ${color}%s${RESET} %.0f%% ${DIM}↻%s${RESET}" "$label" "$bar" "$pct" "$reset"
    else
        printf "⏱ %s ${color}%s${RESET} %.0f%%" "$label" "$bar" "$pct"
    fi
}

util_5h=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
util_7d=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
reset_5h_epoch=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
reset_7d_epoch=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

reset_5h=$(fmt_reset_hm "$reset_5h_epoch")
reset_7d=$(fmt_reset_md "$reset_7d_epoch")

rate_5h=$(make_rate_part "5h" "$util_5h" "$reset_5h")
rate_7d=$(make_rate_part "7d" "$util_7d" "$reset_7d")

# レートリミット部分を結合
rate_part=""
if [ -n "$rate_5h" ] && [ -n "$rate_7d" ]; then
    rate_part=$(printf "%s | %s" "$rate_5h" "$rate_7d")
elif [ -n "$rate_5h" ]; then
    rate_part="$rate_5h"
elif [ -n "$rate_7d" ]; then
    rate_part="$rate_7d"
fi

# 全体を 3 行で出力（ctx とレートリミットの間だけ dim 点線で区切る）
# 1 行目: ブランチ + cwd + git_stat
# 2 行目: ctx + モデル
# 3 行目: 5h + 7d（空でも改行は残す）
separator="${DIM}┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈┈${RESET}"
printf "%s%s\n" "$prefix" "$git_stat"
printf "%s | %s\n" "$context_part" "$model_part"
printf "%b\n" "$separator"
printf "%s" "$rate_part"
