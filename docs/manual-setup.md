# 手動セットアップ手順

`darwin-rebuild switch` 実行後に、以下の設定を手動で行ってください。

## 1. ディスプレイ解像度の変更

1. システム設定を開く
2. 「ディスプレイ」をクリック
3. 「スペースを拡大」を選択

## 2. Raycast の設定

1. Raycast を起動
2. 設定を開く（`Cmd + ,`）
3. 「Hotkey」タブで、Raycast のショートカットを設定
4. Spotlight のショートカットを無効化：
   - システム設定 → キーボード → キーボードショートカット
   - Spotlight → 「Spotlight 検索を表示」のチェックを外す

## 3. proto で Node.js をインストール

```bash
# 最新の LTS をインストール
proto install node lts

# デフォルトバージョンを設定
proto use node lts
```

## 4. アプリの初期設定

| アプリ | 設定内容 |
|-------|---------|
| 1Password | アカウントでサインイン |
| Docker Desktop | ログインとリソース設定 |
| Google Drive | ログインして同期フォルダを設定 |
| Gyazo | アカウント連携とショートカット設定 |
