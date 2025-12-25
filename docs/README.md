# ドキュメント

dotfiles リポジトリの詳細なドキュメントです。

## 📚 ドキュメント一覧

### [自動同期ガイド](auto-sync.md)
設定ファイルの自動同期機能の詳細な使用方法とカスタマイズガイド

**内容:**
- 3つの同期方法（定期自動同期、手動同期、リアルタイム監視）
- セットアップ手順
- カスタマイズ方法（同期対象の追加、自動コミット設定など）
- トラブルシューティング
- FAQ

### [手動セットアップガイド](manual-setup.md)
自動化できない、手動で設定が必要な項目のガイド

**内容:**
- macOS システム設定
- アプリケーション固有の設定
- 認証情報の設定

## 🔧 クイックリンク

### セットアップ
- [初回セットアップ](../README.md#クイックスタート)
- [自動同期のセットアップ](auto-sync.md#クイックスタート)

### トラブルシューティング
- [自動同期が動作しない](auto-sync.md#自動同期が動作しない)
- [Permission denied エラー](auto-sync.md#permission-denied-エラー)

### カスタマイズ
- [同期対象ファイルの追加](auto-sync.md#同期対象ファイルの追加)
- [同期間隔の変更](auto-sync.md#同期間隔の変更)
- [自動コミットの有効化](auto-sync.md#自動コミットの有効化)

## 💡 使い方のヒント

### 新しいMacをセットアップする
1. リポジトリをクローン
2. `./setup.sh` を実行
3. [手動セットアップガイド](manual-setup.md) を参照して追加設定
4. `./scripts/setup_auto_sync.sh` で自動同期を有効化

### 設定を変更したとき
1. 通常通り設定ファイルを編集
2. 自動同期が有効なら1時間以内に自動でコピーされる
3. または `./scripts/sync_dotfiles.sh` で即座に同期
4. 変更を確認して `git commit` & `git push`

### 新しいツールをインストールしたとき
```bash
# Homebrewでインストール
brew install <package-name>

# Brewfileを更新
./scripts/sync_dotfiles.sh --with-brew

# コミット
git add Brewfile
git commit -m "Add <package-name>"
git push
```

## 📖 参考資料

### 公式ドキュメント
- [Homebrew](https://brew.sh/)
- [Homebrew Bundle](https://github.com/Homebrew/homebrew-bundle)
- [launchd](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)

### ツール
- [fswatch](https://github.com/emcrisostomo/fswatch) - ファイルシステム監視
- [proto](https://moonrepo.dev/proto) - Node.jsバージョン管理

## 🆘 サポート

問題が発生した場合：

1. まず該当するガイドの「トラブルシューティング」セクションを確認
2. ログファイルを確認（`~/Library/Logs/dotfiles-sync.log`）
3. 手動でスクリプトを実行して動作確認
4. それでも解決しない場合は、Issueを作成してください
