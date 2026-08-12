#!/usr/bin/env bash
# dotfiles を正本として、Codex の公式 user scope (~/.agents/skills) へ
# スキルディレクトリの symlink を同期する。
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DIR="${DOTFILES_SKILLS_DIR:-$REPO_ROOT/config/.claude/skills}"
DEST_DIR="${AGENT_SKILLS_DIR:-$HOME/.agents/skills}"
LEGACY_DIR="${LEGACY_AGENT_SKILLS_DIR:-${CODEX_HOME:-$HOME/.codex}/skills}"
MANIFEST=""

usage() {
  cat <<'EOF'
Usage: sync-agent-skills.sh [--manifest <path>]

Without --manifest, links every non-symlink skill managed by dotfiles.
With --manifest, links only the listed skill names.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --manifest)
      [ "$#" -ge 2 ] || { echo "ERROR: --manifest requires a path" >&2; exit 2; }
      MANIFEST="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

[ -d "$SOURCE_DIR" ] || { echo "ERROR: skill source not found: $SOURCE_DIR" >&2; exit 1; }
if [ -n "$MANIFEST" ]; then
  [ -f "$MANIFEST" ] || { echo "ERROR: manifest not found: $MANIFEST" >&2; exit 1; }
fi

mkdir -p "$DEST_DIR"
desired_file="$(mktemp)"
trap 'rm -f "$desired_file"' EXIT

add_skill() {
  local name="$1"
  local source="$SOURCE_DIR/$name"

  if [[ ! "$name" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
    echo "ERROR: invalid skill name: $name" >&2
    exit 1
  fi
  [ -d "$source" ] || { echo "ERROR: skill directory not found: $source" >&2; exit 1; }
  [ -f "$source/SKILL.md" ] || { echo "ERROR: SKILL.md not found: $source/SKILL.md" >&2; exit 1; }
  if grep -Fxq "$name" "$desired_file"; then
    echo "ERROR: duplicate skill in selection: $name" >&2
    exit 1
  fi
  printf '%s\n' "$name" >> "$desired_file"
}

if [ -n "$MANIFEST" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [ -n "$line" ] || continue
    add_skill "$line"
  done < "$MANIFEST"
else
  for source in "$SOURCE_DIR"/*; do
    [ -d "$source" ] || continue
    [ -L "$source" ] && continue
    [ -f "$source/SKILL.md" ] || continue
    add_skill "$(basename "$source")"
  done
fi

while IFS= read -r name; do
  source="$SOURCE_DIR/$name"
  target="$DEST_DIR/$name"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    echo "ERROR: refusing to replace non-symlink skill: $target" >&2
    exit 1
  fi
  ln -sfn "$source" "$target"
done < "$desired_file"

# この同期スクリプト自身が作る dotfiles 向けリンクだけを掃除する。
# 他の installer が置いた実ディレクトリや別ソースへの symlink には触れない。
for target in "$DEST_DIR"/*; do
  [ -L "$target" ] || continue
  resolved="$(readlink "$target")"
  case "$resolved" in
    "$SOURCE_DIR"/*)
      name="$(basename "$target")"
      if ! grep -Fxq "$name" "$desired_file"; then
        rm "$target"
        echo "[sync-agent-skills] removed stale: $name" >&2
      fi
      ;;
  esac
done

# 旧Codex専用配置から、同じ dotfiles source を指す symlink だけを取り除く。
# 他ソースへの symlink と実ディレクトリは移行対象外として保護する。
if [ -d "$LEGACY_DIR" ] && [ "$LEGACY_DIR" != "$DEST_DIR" ]; then
  for target in "$LEGACY_DIR"/*; do
    [ -L "$target" ] || continue
    resolved="$(readlink "$target")"
    case "$resolved" in
      "$SOURCE_DIR"/*)
        rm "$target"
        echo "[sync-agent-skills] removed legacy link: $(basename "$target")" >&2
        ;;
    esac
  done
  rmdir "$LEGACY_DIR" 2>/dev/null || true
fi

echo "[sync-agent-skills] linked $(wc -l < "$desired_file" | tr -d ' ') skill(s) into $DEST_DIR" >&2
