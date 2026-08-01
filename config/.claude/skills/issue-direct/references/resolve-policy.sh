#!/usr/bin/env bash
# resolve-policy.sh — takt の policy facet を解決して絶対パスを1行ずつ出力する。
#
# 解決順は takt 本体と同じ「プロジェクト .takt → global ~/.takt → builtin」。
# この順を守ることで、カスタム policy を持つリポジトリではそちらが自動的に優先される
# (builtin を固定参照すると、そのリポジトリの規約を無視した実装になる)。
#
# takt が未導入、または policy が存在しない場合は stdout に何も出さず exit 0 で抜ける。
# 呼び出し側は「取れた分だけ subagent に読ませ、取れなければ policy 無しで進む」。
#
# usage: resolve-policy.sh coding testing
#        resolve-policy.sh --list          # 解決可能な policy 名を一覧する

set -uo pipefail

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null || pwd
}

canonical() {
  readlink -f "$1" 2>/dev/null || python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

# language は project .takt/config.yaml → ~/.takt/config.yaml → takt の既定値(en)。
# takt の getLanguage() と同じ優先順。
takt_language() {
  local cfg lang
  for cfg in "$(repo_root)/.takt/config.yaml" "$HOME/.takt/config.yaml"; do
    [ -f "$cfg" ] || continue
    lang=$(sed -n 's/^language:[[:space:]]*\([a-z][a-z]*\).*/\1/p' "$cfg" | head -1)
    if [ -n "$lang" ]; then
      printf '%s\n' "$lang"
      return
    fi
  done
  printf 'en\n'
}

# builtin は <takt>/lib/node_modules/takt/builtins/ に置かれる。
# bin/takt が wrapper スクリプト(nix)でも dist への symlink(npm -g)でも辿り着けるよう、
# 実体から親を遡って builtins ディレクトリを探す。
builtin_root() {
  local bin dir
  bin=$(command -v takt 2>/dev/null) || return 1
  bin=$(canonical "$bin")
  dir=$(dirname "$bin")
  while [ "$dir" != "/" ] && [ -n "$dir" ]; do
    if [ -d "$dir/builtins" ]; then
      printf '%s\n' "$dir/builtins"
      return 0
    fi
    if [ -d "$dir/lib/node_modules/takt/builtins" ]; then
      printf '%s\n' "$dir/lib/node_modules/takt/builtins"
      return 0
    fi
    dir=$(dirname "$dir")
  done
  return 1
}

# 探索対象のディレクトリを優先順で出力する。
policy_dirs() {
  local root builtins lang
  root=$(repo_root)
  printf '%s\n' "$root/.takt/facets/policies"
  printf '%s\n' "$HOME/.takt/facets/policies"

  builtins=$(builtin_root) || return 0
  lang=$(takt_language)
  # 設定言語の builtin が無い場合だけ en へ落とす(takt が同梱するのは ja / en のみ)。
  if [ -d "$builtins/$lang/facets/policies" ]; then
    printf '%s\n' "$builtins/$lang/facets/policies"
  elif [ -d "$builtins/en/facets/policies" ]; then
    printf '%s\n' "$builtins/en/facets/policies"
  fi
}

list_policies() {
  local dir
  policy_dirs | while read -r dir; do
    [ -d "$dir" ] || continue
    ls "$dir" 2>/dev/null | sed -n 's/\.md$//p'
  done | sort -u
}

if [ "$#" -eq 0 ]; then
  printf 'usage: %s <policy-name>... | --list\n' "$(basename "$0")" >&2
  exit 2
fi

if [ "$1" = "--list" ]; then
  list_policies
  exit 0
fi

missing=""
for name in "$@"; do
  found=""
  while read -r dir; do
    if [ -f "$dir/$name.md" ]; then
      found="$dir/$name.md"
      break
    fi
  done <<EOF
$(policy_dirs)
EOF
  if [ -n "$found" ]; then
    printf '%s\n' "$found"
  else
    missing="$missing $name"
  fi
done

if [ -n "$missing" ]; then
  printf 'policy not found:%s (takt 未導入か facet 名が違う。policy 無しで続行してよい)\n' "$missing" >&2
fi

exit 0
