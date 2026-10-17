# 手動セットアップ手順

`darwin-rebuild switch` 実行後に、以下の設定を手動で行ってください。

## 1. ディスプレイ解像度の変更

1. システム設定を開く
2. 「ディスプレイ」をクリック
3. 「スペースを拡大」を選択

## 2. Vite+ の確認

`darwin-rebuild switch` がグローバル CLI を自動導入する。新しいシェルで
`command -v vp` と `vp --version` を確認する。`node` / `npm` などの shim は
system-first に設定し、既存の Node.js／パッケージマネージャーを継続使用する。
導入方法と更新手順は README の「PATH 優先順位」「よくある操作」を参照。

## 3. アプリの初期設定

| アプリ | 設定内容 |
|-------|---------|
| 1Password | アカウントでサインイン |
| Google Drive | ログインして同期フォルダを設定 |
| Cap | 画面収録の権限許可とショートカット設定（クラウド共有を使うならサインイン） |

## 4. takt MCP の登録

MCP サーバーの登録先（`~/.claude.json` / `~/.codex/config.toml`）は実行時データと同居しており dotfiles 管理外。
darwin-rebuild で `~/.local/bin/takt-mcp-root` が張られた後に 1 回だけ登録する。
ラッパーはメインチェックアウトのルートへ移ってから `takt-mcp` を起動するので、worktree のセッションからも本体の `.takt/tasks.yaml` を扱える。

```sh
claude mcp add --scope user takt -- ~/.local/bin/takt-mcp-root
codex mcp add takt -- ~/.local/bin/takt-mcp-root
```

読み取り専用の `takt_list_tasks` / `takt_get_run` は `config/.claude/settings.json` で許可済み。`takt_tell_run` / `takt_enqueue_task` は都度確認になる。

## 5. 案内役（guide）の Discord Bot

案内役は Bot のトークン・サーバー ID・ユーザー ID をキーチェーンから読む。キーチェーンは Mac ごとなので、新しい Mac では入れ直す。

```sh
~/ghq/github.com/daiki-beppu/dotfiles/scripts/setup-guide-discord.sh
```

移行なら、既存のサーバーとアプリケーションを使い、トークンだけ Reset して入れ直す（古い Mac の案内役は止まる）。
