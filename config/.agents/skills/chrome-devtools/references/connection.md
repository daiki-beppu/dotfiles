# 接続復旧

接続・ページ取得・接続先の誤りが発生した場合だけ読む。Browser / Computer Use 自体の障害には適用しない。

## 症状に応じて確認する

使用中のエージェントの MCP 登録と実際のエラーを確認する。Claude Code なら `claude mcp get chrome-devtools` が使える。他のクライアントの設定を Claude のコマンドで修復しない。

- Chrome が起動しない: Chrome のインストール、`npx` によるパッケージ取得、エラー出力を確認する。
- 画面が表示される: 実際に呼ばれた MCP の引数に `--headless` があるか、重複登録が無いかを照合する。過去の設定を根拠に別プラグインを削除しない。
- tool 不足: `--slim`・カテゴリ指定・クライアント側の利用権限を確認する。tool 数だけで原因を断定しない。
- 拡張機能だけ失敗: [拡張ツールと互換性](extensions.md) を読む。
- その他: [公式トラブルシューティング](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/troubleshooting.md) からエラーに該当する項目を調べる。

## 修復と確認

依頼された接続復旧に必要な設定だけを変更し、無関係な MCP・marketplace・権限を保持する。Chrome の Allow やクライアント再起動など、人の操作が必要な箇所だけ具体的に依頼する。

追加診断が必要ならログ出力を一時的に設定し、該当エラー周辺だけ読む。秘密値を伏せ、採取後は診断用設定を戻す。

`list_pages` で接続できたことを確認し、元の診断へ戻る。同じエラーを根拠なく再試行しない。ログイン済みセッションが必要で `--autoConnect` 等への切り替えが要る場合は、画面が表示されユーザーの Chrome を操作することを説明し、その変更が依頼の範囲か確認してから行う。

成功した接続先と修正内容、または残るエラーと最小のユーザー操作を報告する。

Adapted from the official `chrome-devtools-mcp` troubleshooting skill ([Apache-2.0](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/LICENSE), Copyright Google LLC). Modified for a headless-only setup.
