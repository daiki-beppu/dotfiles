#!/bin/bash
# worktree 内で .env がない場合、メインワークツリーからコピー
if [ -f ".env" ]; then
  exit 0
fi

MAIN_WORKTREE=$(git worktree list --porcelain 2>/dev/null | head -1 | sed 's/worktree //')
if [ -n "$MAIN_WORKTREE" ] && [ -f "$MAIN_WORKTREE/.env" ]; then
  cp "$MAIN_WORKTREE/.env" .env
  echo ".env をメインワークツリーからコピーしました"
fi
exit 0
