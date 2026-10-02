#!/bin/sh
# takt 同梱の node で、takt の内部 API を使うスクリプトを動かす。TAKT_ROOT を渡す。
# 使い方: takt-node.sh <script.mjs> [args...]（cwd はリポジトリのルート）
bin=$(realpath "$(command -v takt)")
TAKT_ROOT=$(dirname "$(dirname "$bin")")/lib/node_modules/takt
node=$(grep -o '/nix/store/[^ ]*/bin/node' "$bin" | head -1)
TAKT_ROOT="$TAKT_ROOT" exec "${node:-node}" "$@"
