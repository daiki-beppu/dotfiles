#!/bin/bash
# PostToolUse hook: keep ~/.codex/skills/ in sync with dotfiles skill directories
# so Codex CLI picks up newly added/removed Claude Code skills automatically.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // empty')

if [ "$TOOL" != "Write" ] && [ "$TOOL" != "Edit" ]; then
  exit 0
fi

FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

case "$FILE_PATH" in
  */.claude/skills/*) ;;
  *) exit 0 ;;
esac

DOTFILES_SKILLS="$HOME/01-dev/dotfiles/config/.claude/skills"
CODEX_SKILLS="$HOME/.codex/skills"

[ -d "$DOTFILES_SKILLS" ] || exit 0
[ -d "$CODEX_SKILLS" ] || exit 0

# 追加: dotfiles にあって codex に無いスキルを symlink
for dir in "$DOTFILES_SKILLS"/*/; do
  [ -d "$dir" ] || continue
  name=$(basename "$dir")
  target="$CODEX_SKILLS/$name"
  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    ln -s "${dir%/}" "$target"
    echo "[sync-codex-skills] linked: $name" >&2
  fi
done

# 削除: codex 側の symlink のうち、dotfiles 側の実体が消えたものを掃除
# (symlink 以外の実体ディレクトリ = codex 組み込み/別途インストールされた skill には触れない)
for link in "$CODEX_SKILLS"/*; do
  [ -L "$link" ] || continue
  resolved=$(readlink "$link")
  case "$resolved" in
    "$DOTFILES_SKILLS"/*)
      if [ ! -e "$resolved" ]; then
        rm "$link"
        echo "[sync-codex-skills] removed stale: $(basename "$link")" >&2
      fi
      ;;
  esac
done

exit 0
