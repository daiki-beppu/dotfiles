#!/bin/sh
# takt 同梱の node で verify.mjs を動かす。takt の内部 API を使うので TAKT_ROOT を渡す。
# 使い方: verify.sh <spec.md>（```quint / ```alloy のブロックを含む Markdown）
set -eu
bin=$(realpath "$(command -v takt)")
TAKT_ROOT=$(dirname "$(dirname "$bin")")/lib/node_modules/takt
node=$(grep -o '/nix/store/[^ ]*/bin/node' "$bin" | head -1)
TAKT_ROOT="$TAKT_ROOT" exec "${node:-node}" "$(dirname "$0")/verify.mjs" "$@"
