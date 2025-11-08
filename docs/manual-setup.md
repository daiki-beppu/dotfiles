# 手動セットアップ手順

セットアップスクリプト実行後に、以下の設定を手動で行ってください。

## 1. ディスプレイ解像度の変更

1. システム設定を開く
2. 「ディスプレイ」をクリック
3. 「スペースを拡大」を選択

## 2. Raycastの設定

1. Raycastを起動
2. 設定を開く（`Cmd + ,`）
3. 「Hotkey」タブで、Raycastのショートカットを設定
4. Spotlightのショートカットを無効化：
   - システム設定 → キーボード → キーボードショートカット
   - Spotlight → 「Spotlight検索を表示」のチェックを外す

## 3. naniアプリのインストール

1. [naniの公式サイト](https://nani.ooo/)からダウンロード
2. インストールして起動

## 4. VS Code Settings Sync

1. VS Codeを起動
2. `Cmd + Shift + P` → 「Settings Sync: Turn On」
3. GitHubアカウントでサインイン
4. 同期する項目を選択

## 5. Gitユーザー情報の設定

`.gitconfig` ファイルを編集：
```bash
code ~/.dotfiles/config/.gitconfig
```

以下の部分を自分の情報に書き換える：
```gitconfig
[user]
    name = YOUR_NAME              # ← 自分の名前
    email = YOUR_EMAIL@example.com # ← 自分のメールアドレス
```

## 6. protoでNode.jsをインストール
```bash
# 最新のLTSをインストール
proto install node lts

# バージョン指定でインストール
proto install node 20

# デフォルトバージョンを設定
proto use node lts
```

## 7. その他の設定

### Docker Desktop
初回起動時にログインとリソース設定を行う

### Dropbox
ログインして同期フォルダを設定

### Gyazo
アカウント連携とショートカット設定

### 1Password
アカウントでサインインして設定