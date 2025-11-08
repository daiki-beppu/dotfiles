#!/bin/bash

echo "🚀 dotfilesセットアップを開始"
echo ""

# スクリプトのディレクトリを取得
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# 各スクリプトを順番に実行
bash "$SCRIPT_DIR/scripts/1_macos.sh"
echo ""

bash "$SCRIPT_DIR/scripts/2_homebrew.sh"
echo ""

bash "$SCRIPT_DIR/scripts/3_symlink.sh"
echo ""

echo "🎉 すべてのセットアップが完了したで！"
echo ""
echo "📝 次にやること："
echo "  1. ディスプレイ設定で「スペースを拡大」に変更"
echo "  2. Raycastの設定（Spotlightショートカット変更）"
echo "  3. naniアプリを手動でインストール"
echo "  4. VS CodeでSettings Syncを有効化"
echo ""
echo "詳細は docs/manual-setup.md を見てな！"