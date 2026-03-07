#!/bin/bash
# Playwright MCP の残存プロセス・ロックファイルをクリーンアップ
# SessionStart / SessionEnd フックから呼び出される

# 1. playwright-mcp node プロセスを終了
pkill -f '@playwright/mcp' 2>/dev/null

# 2. MCP 経由で起動された Chrome/Chromium プロセスのみ終了
#    --user-data-dir に mcp-chrome- を含むプロセスだけを対象にし、
#    ユーザーの通常 Chrome には影響しない
pkill -f 'user-data-dir=.*/mcp-chrome-' 2>/dev/null

# 3. stale な SingletonLock を削除
for lock in ~/Library/Caches/ms-playwright/mcp-chrome-*/SingletonLock; do
  [ -L "$lock" ] && rm -f "$lock"
done

# 4. 古いプロファイルディレクトリを整理（最新1つだけ残す）
PROFILES=($(ls -dt ~/Library/Caches/ms-playwright/mcp-chrome-* 2>/dev/null))
for ((i=1; i<${#PROFILES[@]}; i++)); do
  rm -rf "${PROFILES[$i]}"
done

exit 0
