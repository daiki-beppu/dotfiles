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

## 3. oh-my-zsh のインストール

`.zshrc` がテーマ（eastwood）と git plugin に使用。未インストールだとシェル起動時に警告が出る。

```bash
sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)" "" --unattended --keep-zshrc
```

`--keep-zshrc` 必須（インストーラに dotfiles 管理の .zshrc を上書きさせない）。

## 4. Vite+ のインストール（任意）

Nix 管理外。公式手順（https://viteplus.dev）でインストールすると `~/.vite-plus/env` が生成され、`.zshenv` がガード付きで自動的に読み込む。未インストールの状態でもシェルはエラーなく起動する。

## 5. アプリの初期設定

| アプリ | 設定内容 |
|-------|---------|
| 1Password | アカウントでサインイン |
| Docker Desktop | ログインとリソース設定 |
| Google Drive | ログインして同期フォルダを設定 |
| Gyazo | アカウント連携とショートカット設定 |
