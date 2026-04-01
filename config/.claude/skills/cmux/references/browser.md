# cmux browser — 全コマンドリファレンス

cmux 内蔵ブラウザの操作コマンド。`cmux browser <subcommand>` で使用する。
`--surface` でブラウザサーフェスを指定可能（省略時はカレントまたは自動選択）。

## ページ操作

```bash
cmux browser open [url]                           # ブラウザペインを開く（URL 省略で空白ページ）
cmux browser open-split [url]                     # 分割してブラウザを開く
cmux browser goto <url>                           # URL 遷移（navigate のエイリアス）
cmux browser navigate <url>                       # URL 遷移
cmux browser navigate <url> --snapshot-after       # 遷移後に自動スナップショット
cmux browser back                                 # 戻る
cmux browser forward                              # 進む
cmux browser reload                               # リロード
cmux browser url                                  # 現在の URL
cmux browser get url                              # 現在の URL（get 経由）
cmux browser get title                            # ページタイトル
```

## スナップショット・スクリーンショット

```bash
cmux browser snapshot                             # DOM のテキスト表現
cmux browser snapshot --interactive               # インタラクティブ要素をハイライト
cmux browser snapshot --interactive --cursor       # カーソル位置も表示
cmux browser snapshot --compact                   # コンパクト出力
cmux browser snapshot --max-depth 3               # DOM 深度制限
cmux browser snapshot --selector "main"           # 特定要素のみ
cmux browser screenshot                           # スクリーンショット（標準出力）
cmux browser screenshot --out /tmp/shot.png       # ファイルに保存
cmux browser screenshot --json                    # JSON 形式（base64）
```

## インタラクション

```bash
# クリック・ホバー
cmux browser click "<selector>"                   # クリック
cmux browser dblclick "<selector>"                # ダブルクリック
cmux browser hover "<selector>"                   # ホバー
cmux browser focus "<selector>"                   # フォーカス

# テキスト入力
cmux browser type "<selector>" "text"             # 入力（既存テキストに追加）
cmux browser fill "<selector>" "text"             # 入力（既存テキストをクリアして入力）
cmux browser fill "<selector>"                    # テキストなし = 入力欄クリア

# キー操作
cmux browser press "Enter"                        # キー押下
cmux browser keydown "Shift"                      # キー押し下げ
cmux browser keyup "Shift"                        # キー離す

# フォーム
cmux browser check "<selector>"                   # チェックボックス ON
cmux browser uncheck "<selector>"                 # チェックボックス OFF
cmux browser select "<selector>" "value"          # セレクトボックス選択

# スクロール
cmux browser scroll --dy 500                      # 下にスクロール
cmux browser scroll --dy -500                     # 上にスクロール
cmux browser scroll --selector ".container" --dy 300  # 特定要素内スクロール
cmux browser scroll-into-view "<selector>"        # 要素が見えるまでスクロール
```

## 情報取得

```bash
cmux browser get text                             # ページ全体のテキスト
cmux browser get html                             # HTML ソース
cmux browser get value "<selector>"               # input の値
cmux browser get attr "<selector>" "href"         # 属性値
cmux browser get count "<selector>"               # マッチ数
cmux browser get box "<selector>"                 # 要素の位置・サイズ
cmux browser get styles "<selector>"              # 計算済みスタイル

cmux browser is visible "<selector>"              # 表示されているか
cmux browser is enabled "<selector>"              # 有効か
cmux browser is checked "<selector>"              # チェック状態か
```

## 要素検索

```bash
cmux browser find role "button"                   # ARIA ロールで検索
cmux browser find text "Submit"                   # テキストで検索
cmux browser find label "Email"                   # ラベルで検索
cmux browser find placeholder "Enter name"        # placeholder で検索
cmux browser find testid "submit-btn"             # data-testid で検索
cmux browser find first "<selector>"              # 最初の要素
cmux browser find last "<selector>"               # 最後の要素
cmux browser find nth "<selector>" 2              # N番目の要素
cmux browser highlight "<selector>"               # 要素をハイライト表示
```

## JavaScript 実行

```bash
cmux browser eval "document.title"                # JS 式を評価
cmux browser eval "document.querySelectorAll('a').length"
cmux browser addinitscript "console.log('loaded')" # ページ読み込み時に実行
cmux browser addscript "..."                       # スクリプト追加
cmux browser addstyle "body { background: red }"   # スタイル追加
```

## フレーム・ダイアログ

```bash
cmux browser frame "iframe.content"               # iframe に切り替え
cmux browser frame main                           # メインフレームに戻る
cmux browser dialog accept                        # ダイアログ承認
cmux browser dialog accept "input text"           # テキスト入力して承認
cmux browser dialog dismiss                       # ダイアログ却下
```

## タブ管理

```bash
cmux browser tab new                              # 新しいタブ
cmux browser tab new "https://example.com"        # URL 指定で新しいタブ
cmux browser tab list                             # タブ一覧
cmux browser tab switch 2                         # タブ切り替え（インデックス）
cmux browser tab close                            # 現在のタブを閉じる
cmux browser tab close 2                          # 指定タブを閉じる
```

## ダウンロード・ストレージ

```bash
# ダウンロード
cmux browser download wait --timeout-ms 10000     # ダウンロード完了待ち
cmux browser download wait --path /tmp/file.pdf   # パス指定

# Cookie
cmux browser cookies get                          # 全 Cookie 取得
cmux browser cookies set "name=value"             # Cookie 設定
cmux browser cookies clear                        # Cookie クリア

# ストレージ
cmux browser storage local get "key"              # localStorage 取得
cmux browser storage local set "key" "value"      # localStorage 設定
cmux browser storage local clear                  # localStorage クリア
cmux browser storage session get "key"            # sessionStorage 取得
```

## デバッグ

```bash
cmux browser console list                         # コンソールメッセージ一覧
cmux browser console clear                        # コンソールクリア
cmux browser errors list                          # エラー一覧
cmux browser errors clear                         # エラークリア
cmux browser state save /tmp/state.json           # ブラウザ状態保存
cmux browser state load /tmp/state.json           # ブラウザ状態復元
cmux browser identify                             # ブラウザサーフェス情報
```

## 待機

```bash
cmux browser wait --selector ".loaded"            # 要素の出現を待つ
cmux browser wait --text "Complete"               # テキストの出現を待つ
cmux browser wait --url-contains "/dashboard"     # URL の変化を待つ
cmux browser wait --load-state complete            # ページ読み込み完了を待つ
cmux browser wait --function "() => window.ready"  # JS 関数の結果を待つ
cmux browser wait --timeout-ms 5000               # タイムアウト指定
```

## --snapshot-after フラグ

多くのインタラクションコマンドは `--snapshot-after` を付けると、操作直後に
自動でスナップショットを取得する。操作 → 結果確認を1コマンドで行える:

```bash
cmux browser click ".next-page" --snapshot-after
cmux browser fill "input[name=q]" "search" --snapshot-after
cmux browser navigate "https://example.com" --snapshot-after
```
