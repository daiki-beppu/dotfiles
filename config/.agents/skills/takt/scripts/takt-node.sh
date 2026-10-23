#!/bin/sh
# takt 同梱の node で、takt の内部 API を使うスクリプトを動かす。TAKT_ROOT を渡す。
# 使い方: takt-node.sh <script.mjs> [args...]（cwd はリポジトリのルート）
bin=$(realpath "$(command -v takt)")
vp_meta="$HOME/.vite-plus/packages/takt.json"
if [ "$(basename "$bin")" = vp ] && [ -f "$vp_meta" ]; then
  # vite-plus の takt は vp への symlink。本体は packages/takt/<installId> に、node は js_runtime にある
  id=$(sed -n 's/.*"installId": *"\([^"]*\)".*/\1/p' "$vp_meta")
  ver=$(sed -n 's/.*"node": *"\([^"]*\)".*/\1/p' "$vp_meta")
  TAKT_ROOT="$HOME/.vite-plus/packages/takt/$id/lib/node_modules/takt"
  node="$HOME/.vite-plus/js_runtime/node/$ver/bin/node"
else
  TAKT_ROOT=$(dirname "$(dirname "$bin")")/lib/node_modules/takt
  node=$(grep -o '/nix/store/[^ ]*/bin/node' "$bin" | head -1)
fi
[ -x "${node:-}" ] || node=node
TAKT_ROOT="$TAKT_ROOT" exec "$node" "$@"
