#!/bin/sh
# takt 同梱の node で verify.mjs を動かす。takt の内部 API を使うので、本体と node の場所は takt-node.sh に引かせる（nix 版と vite-plus 版の両方）。
# 使い方: verify.sh [--expect-violation <inv*|prop*>] <spec.md>（```quint / ```alloy のブロックを含む Markdown）
set -eu
here=$(dirname "$0")
exec "$here/../../takt/scripts/takt-node.sh" "$here/verify.mjs" "$@"
