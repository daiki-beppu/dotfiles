# dotfiles 自動同期ガイド

dotfilesの自動同期機能の詳細な使用方法とカスタマイズガイドです。

## 📋 目次

- [概要](#概要)
- [クイックスタート](#クイックスタート)
- [セットアップ](#セットアップ)
- [同期方法](#同期方法)
- [カスタマイズ](#カスタマイズ)
- [トラブルシューティング](#トラブルシューティング)
- [FAQ](#faq)

## 概要

この機能は、ホームディレクトリの設定ファイルを自動的にdotfilesリポジトリに同期します。

### 対応ファイル

デフォルトで以下のファイルが同期対象です：

- `~/.zshrc`
- `~/.zprofile`
- `~/.gitconfig`
- `~/.gitignore_global`
- `Brewfile`（Homebrewパッケージリスト）

### 3つの同期方法

| 方法 | 実行タイミング | 用途 | 推奨度 |
|------|--------------|------|--------|
| 定期自動同期 | 1時間ごと + ログイン時 | 日常的な同期 | ⭐⭐⭐ |
| 手動同期 | コマンド実行時 | 即座に同期したい時 | ⭐⭐ |
| リアルタイム監視 | ファイル変更時 | 開発中の即時反映 | ⭐ |

## クイックスタート

```bash
# 1. 自動同期を有効化
cd ~/01-dev/dotfiles
./scripts/setup_auto_sync.sh

# 2. 設定完了！
# 以降、1時間ごとに自動同期されます
```

## セットアップ

### 定期自動同期のセットアップ

```bash
./scripts/setup_auto_sync.sh
```

このスクリプトは以下を実行します：

1. `~/Library/LaunchAgents/` ディレクトリを作成
2. `com.dotfiles.sync.plist` をコピー
3. launchdジョブを登録

### 動作確認

```bash
# ジョブが登録されているか確認
launchctl list | grep dotfiles

# ログファイルの確認
cat ~/Library/Logs/dotfiles-sync.log
```

## 同期方法

### 1. 定期自動同期（推奨）

#### 特徴
- macOS標準の `launchd` を使用
- バックグラウンドで動作
- 再起動後も自動的に有効

#### 設定

同期間隔は `config/com.dotfiles.sync.plist` で設定：

```xml
<!-- 同期間隔（秒単位） -->
<key>StartInterval</key>
<integer>3600</integer>  <!-- 3600秒 = 1時間 -->
```

#### 管理コマンド

```bash
# 停止
launchctl unload ~/Library/LaunchAgents/com.dotfiles.sync.plist

# 再開
launchctl load ~/Library/LaunchAgents/com.dotfiles.sync.plist

# ステータス確認
launchctl list | grep com.dotfiles.sync

# 今すぐ実行
launchctl start com.dotfiles.sync
```

#### ログ確認

```bash
# 標準出力ログ
tail -f ~/Library/Logs/dotfiles-sync.log

# エラーログ
tail -f ~/Library/Logs/dotfiles-sync-error.log

# ログをクリア
> ~/Library/Logs/dotfiles-sync.log
> ~/Library/Logs/dotfiles-sync-error.log
```

### 2. 手動同期

#### 基本的な使い方

```bash
# 設定ファイルのみ同期
./scripts/sync_dotfiles.sh

# Brewfileも含めて同期
./scripts/sync_dotfiles.sh --with-brew
```

#### スクリプトの動作

1. ホームディレクトリの設定ファイルを読み込み
2. dotfilesリポジトリのファイルと比較
3. 変更があればコピー
4. Git変更状況を表示

#### 出力例

```
[INFO] dotfiles同期を開始します...
[INFO] 設定ファイルを同期中...
[SUCCESS] 更新: .zshrc
[SUCCESS] 更新: .gitconfig
[INFO] Brewfileを更新中...
[SUCCESS] Brewfileを更新しました
[INFO] 変更が検出されました:
 M config/.gitconfig
 M config/.zshrc
 M Brewfile
[INFO] 同期完了
```

### 3. リアルタイム監視

#### セットアップ

```bash
# 1. fswatchをインストール
brew install fswatch

# 2. 監視開始
./scripts/watch_dotfiles.sh
```

#### バックグラウンド実行

```bash
# バックグラウンドで起動
./scripts/watch_dotfiles.sh > ~/Library/Logs/watch-dotfiles.log 2>&1 &

# プロセスIDを確認
echo $!

# 停止
kill <プロセスID>
```

#### 動作

- 設定ファイルの変更を即座に検知
- 変更があれば自動的に `sync_dotfiles.sh` を実行
- ターミナルを開いている間のみ動作

## カスタマイズ

### 同期対象ファイルの追加

`scripts/sync_dotfiles.sh` を編集：

```bash
# 同期する設定ファイルのリスト
local files=(
    ".zshrc"
    ".zprofile"
    ".gitconfig"
    ".gitignore_global"
    ".vimrc"           # 追加
    ".tmux.conf"       # 追加
)
```

### リアルタイム監視の対象追加

`scripts/watch_dotfiles.sh` を編集：

```bash
# 監視するファイルのリスト
WATCH_FILES=(
    "$HOME/.zshrc"
    "$HOME/.zprofile"
    "$HOME/.gitconfig"
    "$HOME/.gitignore_global"
    "$HOME/.vimrc"        # 追加
    "$HOME/.tmux.conf"    # 追加
)
```

### 自動コミットの有効化

`scripts/sync_dotfiles.sh:55-57` のコメントを解除：

```bash
# Git変更を確認
check_git_changes() {
    cd "$DOTFILES_DIR"

    if [ -n "$(git status --porcelain)" ]; then
        log_info "変更が検出されました:"
        git status --short

        # 自動コミットを有効化
        git add -A
        git commit -m "chore: auto-sync dotfiles at $(date '+%Y-%m-%d %H:%M:%S')"
        log_success "変更を自動コミットしました"

        return 0
    fi
}
```

### 自動プッシュの追加

自動コミットを有効にした後、さらに自動プッシュを追加する場合：

```bash
        git add -A
        git commit -m "chore: auto-sync dotfiles at $(date '+%Y-%m-%d %H:%M:%S')"
        git push origin main  # この行を追加
        log_success "変更を自動コミット・プッシュしました"
```

### 同期間隔の変更

`config/com.dotfiles.sync.plist` を編集：

```xml
<!-- 30分ごとに同期 -->
<key>StartInterval</key>
<integer>1800</integer>

<!-- 1日1回（24時間ごと） -->
<key>StartInterval</key>
<integer>86400</integer>
```

変更後、ジョブを再登録：

```bash
launchctl unload ~/Library/LaunchAgents/com.dotfiles.sync.plist
cp config/com.dotfiles.sync.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.dotfiles.sync.plist
```

### 特定の時刻に実行

間隔ではなく、特定の時刻に実行したい場合：

```xml
<!-- StartIntervalを削除して、以下を追加 -->
<key>StartCalendarInterval</key>
<dict>
    <key>Hour</key>
    <integer>9</integer>    <!-- 9時 -->
    <key>Minute</key>
    <integer>0</integer>    <!-- 0分 -->
</dict>
```

## トラブルシューティング

### 自動同期が動作しない

#### 1. ジョブの登録確認

```bash
launchctl list | grep dotfiles
```

出力がない場合は未登録です。セットアップを再実行：

```bash
./scripts/setup_auto_sync.sh
```

#### 2. ログの確認

```bash
# エラーログを確認
cat ~/Library/Logs/dotfiles-sync-error.log
```

#### 3. 手動実行テスト

```bash
# スクリプトが正しく動作するか確認
./scripts/sync_dotfiles.sh --with-brew
```

#### 4. パスの確認

`config/com.dotfiles.sync.plist` のパスが正しいか確認：

```xml
<key>ProgramArguments</key>
<array>
    <!-- このパスが正しいか確認 -->
    <string>/Users/mba/01-dev/dotfiles/scripts/sync_dotfiles.sh</string>
    <string>--with-brew</string>
</array>
```

### Permission denied エラー

スクリプトに実行権限がない場合：

```bash
chmod +x scripts/sync_dotfiles.sh
chmod +x scripts/watch_dotfiles.sh
chmod +x scripts/setup_auto_sync.sh
```

### Brewfileが更新されない

Homebrewのパスが通っていない可能性があります。

`config/com.dotfiles.sync.plist` の環境変数を確認：

```xml
<key>EnvironmentVariables</key>
<dict>
    <key>PATH</key>
    <!-- M1/M2 Macの場合は /opt/homebrew/bin が必要 -->
    <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin</string>
</dict>
```

### fswatch がインストールできない

```bash
# Homebrewの更新
brew update

# fswatchのインストール
brew install fswatch

# インストール確認
fswatch --version
```

### ログファイルが見つからない

ログディレクトリを手動で作成：

```bash
mkdir -p ~/Library/Logs
touch ~/Library/Logs/dotfiles-sync.log
touch ~/Library/Logs/dotfiles-sync-error.log
```

## FAQ

### Q: 自動コミットは推奨されますか？

**A:** 状況によります。

- **推奨する場合**: 個人的な設定ファイルで、履歴を細かく残したい場合
- **推奨しない場合**: 複数人で共有するリポジトリや、慎重な変更管理が必要な場合

デフォルトでは無効にしており、手動でのコミットを推奨しています。

### Q: Brewfileはいつ更新されますか？

**A:** `--with-brew` オプション付きで実行された場合のみ更新されます。

定期自動同期では毎回更新されます。頻繁に更新したくない場合は、`config/com.dotfiles.sync.plist` から `--with-brew` を削除してください。

### Q: 同期されたファイルをGitにコミットする方法は？

**A:** 通常のGitワークフローで行います：

```bash
cd ~/01-dev/dotfiles
git status
git add config/.zshrc config/.gitconfig
git commit -m "Update zsh and git configuration"
git push
```

### Q: 複数のMacで同じdotfilesを使う場合は？

**A:** 各Macで以下を実行：

```bash
# 1. リポジトリをクローン
git clone <your-repo-url> ~/01-dev/dotfiles

# 2. セットアップ
cd ~/01-dev/dotfiles
./setup.sh

# 3. 自動同期を有効化
./scripts/setup_auto_sync.sh
```

各Macで変更した内容を定期的に `git pull` と `git push` で同期してください。

### Q: 一時的に自動同期を停止したい

**A:**

```bash
# 停止
launchctl unload ~/Library/LaunchAgents/com.dotfiles.sync.plist

# 再開
launchctl load ~/Library/LaunchAgents/com.dotfiles.sync.plist
```

### Q: 自動同期を完全に削除したい

**A:**

```bash
# 1. ジョブを停止
launchctl unload ~/Library/LaunchAgents/com.dotfiles.sync.plist

# 2. plistファイルを削除
rm ~/Library/LaunchAgents/com.dotfiles.sync.plist

# 3. ログファイルを削除（オプション）
rm ~/Library/Logs/dotfiles-sync.log
rm ~/Library/Logs/dotfiles-sync-error.log
```

### Q: 別のディレクトリにdotfilesを配置している場合は？

**A:** 各スクリプトとplistファイルのパスを変更する必要があります：

1. `scripts/sync_dotfiles.sh` の `DOTFILES_DIR` を変更
2. `scripts/watch_dotfiles.sh` の `DOTFILES_DIR` を変更
3. `config/com.dotfiles.sync.plist` の `ProgramArguments` のパスを変更

### Q: プライベートな情報が含まれるファイルの扱いは？

**A:** `.gitignore` に追加して、Gitにコミットされないようにしてください：

```bash
# .gitignore に追加
echo "config/.gitconfig.local" >> .gitignore
```

また、機密情報は環境変数や別の設定ファイルに分離することを推奨します。

## 関連ファイル

- [`scripts/sync_dotfiles.sh`](../scripts/sync_dotfiles.sh) - 手動同期スクリプト
- [`scripts/watch_dotfiles.sh`](../scripts/watch_dotfiles.sh) - リアルタイム監視スクリプト
- [`scripts/setup_auto_sync.sh`](../scripts/setup_auto_sync.sh) - セットアップスクリプト
- [`config/com.dotfiles.sync.plist`](../config/com.dotfiles.sync.plist) - launchd設定ファイル

## 参考リンク

- [launchd の公式ドキュメント](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)
- [fswatch GitHub](https://github.com/emcrisostomo/fswatch)
- [Homebrew Bundle](https://github.com/Homebrew/homebrew-bundle)
