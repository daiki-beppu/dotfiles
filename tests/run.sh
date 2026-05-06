#!/usr/bin/env bash
# tests/ 配下のテストをまとめて実行するシェル。
# Why: dotfiles に node プロジェクト構造が無いため、CI なしでも 1 コマンドで動かせるようにする。

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo_root"

exec python3 -m unittest discover -s tests -p 'test_*.py' -v
