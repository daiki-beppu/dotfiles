---
name: chrome-devtools
description: Browser / Computer Use で不足する通信・JavaScript エラー・性能・メモリ情報を Chrome DevTools MCP で診断するとき、Browser / Computer Use の無い環境で UI 変更後の画面を確かめるとき、またはその MCP の接続失敗を復旧するときに使う。
---

# Chrome DevTools diagnostics

通常の閲覧・クリック・入力・画面確認には実行環境の Browser / Computer Use を使う。必要な診断情報が取れない場合に、この MCP で再現と採取を行う。Browser / Computer Use が無い環境では、画面の確認（`navigate_page` → `take_screenshot`）にもこの MCP を使う。

## 接続と対象

この設定は `--headless --isolated` で MCP 専用の Chrome を画面なしで起動する。毎回空のプロファイルなので、ユーザーの Chrome のタブ・ログイン状態は使えない。ログインが必要なページはその旨を報告する。接続・ページ取得に失敗した場合だけ [接続復旧](references/connection.md) を読む。

対象 URL は `new_page` / `navigate_page` で開く。

## 証拠の取得

不足する情報に対応する tool を使い、再現操作は診断に必要な範囲に留める。要素の uid は新しい snapshot から取得する。大量の trace・snapshot はファイルへ出し、フィルタ・ページネーションで必要な部分だけ読む。

拡張機能の診断には [拡張ツールと互換性](references/extensions.md) を読む。通信やエラーの診断だけなら不要。

観測結果と再現条件を報告し、復旧を依頼された場合は修正後に同じ症状が解消したか確認する。通常のブラウザ作業に戻ったら Browser / Computer Use を使う。

Adapted from the official `chrome-devtools-mcp` skill ([Apache-2.0](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/LICENSE), Copyright Google LLC). Modified for a headless-only setup.
