---
name: cmux
description: >
  cmux ターミナルマルチプレクサのコマンドリファレンス（pane / screen / browser / notify / status / workspace 系）。
  本文に記載のあるコマンド群に限定し、未収録のコマンドは保証しない。
  「cmux で」「ペイン分割」「隣のペインに送信」「ブラウザ開いて」「画面読んで」
  「ステータス表示」「通知」「ワークスペース」「サーフェス」「cmux のコマンド教えて」
  など、cmux の操作に関わる場面で発動すること。
  並列 Claude セッション起動は parallel スキルを使う。
---

# cmux — コマンドリファレンス

cmux はターミナルマルチプレクサ。ペイン分割・画面読み書き・ブラウザ制御・通知・
ステータスバーなど、ターミナル環境を統合管理する。

## 環境変数

cmux ターミナル内では以下が自動設定される。コマンドのデフォルト値として機能するため、
自分のワークスペースやサーフェスを対象にする場合は省略できる。

| 変数 | 用途 |
|------|------|
| `CMUX_WORKSPACE_ID` | 全コマンドのデフォルト `--workspace` |
| `CMUX_SURFACE_ID` | 全コマンドのデフォルト `--surface` |
| `CMUX_TAB_ID` | `tab-action` / `rename-tab` のデフォルト `--tab` |

## ID の指定方法

コマンドで window / workspace / pane / surface を指定する際、3つの形式が使える:

- **refs**（デフォルト出力）: `surface:1`, `workspace:2`, `pane:3`
- **UUIDs**: `--id-format uuids` で出力を UUID 形式に
- **indexes**: 数値インデックス

出力から ID をパースするパターン:
```bash
# new-split は "OK surface:<id> workspace:<id>" を返す
SURFACE=$(cmux new-split right 2>&1 | awk '{print $2}')
```

## レイアウト操作

### ペイン分割

```bash
# 方向: left / right / up / down
cmux new-split right                              # 現在のペインを右に分割
cmux new-split down --surface surface:1           # 指定サーフェスから下に分割

# 新しいペイン作成（type: terminal / browser）
cmux new-pane --type terminal --direction right
cmux new-pane --type browser --direction right --url "https://example.com"
```

### ペイン一覧・操作

```bash
cmux list-panes                                   # 現在のワークスペースのペイン一覧
cmux list-pane-surfaces                           # ペイン内のサーフェス一覧
cmux tree                                         # ワークスペースのツリー表示
cmux tree --all                                   # 全ワークスペースのツリー表示
cmux focus-pane --pane pane:1                     # ペインにフォーカス
cmux close-surface --surface surface:2            # サーフェスを閉じる
```

### サーフェス移動・並び替え

```bash
cmux move-surface --surface surface:1 --pane pane:2   # 別ペインに移動
cmux reorder-surface --surface surface:1 --index 0    # 並び替え
cmux drag-surface-to-split --surface surface:1 right  # ドラッグで分割
```

## 画面読み書き

### 読み取り

```bash
cmux read-screen                                  # 現在のサーフェスの画面内容
cmux read-screen --scrollback                     # スクロールバック含む
cmux read-screen --lines 50                       # 最新50行
cmux read-screen --surface surface:2              # 指定サーフェスの画面
cmux read-screen --surface surface:2 --scrollback # 他サーフェスのスクロールバック含む
```

### 送信

```bash
cmux send "echo hello\n"                          # テキスト送信（\n で Enter）
cmux send --surface surface:2 "ls -la\n"          # 指定サーフェスに送信
cmux send-key Enter                               # キー送信
cmux send-key --surface surface:2 "C-c"           # Ctrl+C 送信
```

**長文送信の注意**: `cmux send` はターミナル入力のエミュレーション。
長文や改行を含むテキストはエスケープで壊れやすい。
長文は一時ファイルに書き出し、`cat` や Read で渡すのが安全:

```bash
# 長文を一時ファイル経由で渡すパターン
echo "長いテキスト..." > /tmp/cmux-msg.txt
cmux send --surface surface:2 "cat /tmp/cmux-msg.txt\n"
```

## ワークスペース管理

```bash
cmux list-workspaces                              # 一覧
cmux current-workspace                            # 現在のワークスペース
cmux new-workspace --cwd /path/to/dir             # 新規（作業ディレクトリ指定）
cmux new-workspace --command "claude"              # 新規（コマンド実行）
cmux select-workspace --workspace workspace:2     # 切り替え
cmux rename-workspace "my-project"                # リネーム
cmux close-workspace --workspace workspace:2      # 閉じる
```

## タブ操作

```bash
cmux new-surface --type terminal                  # 新しいタブ（ターミナル）
cmux new-surface --type browser --url "https://example.com"  # 新しいタブ（ブラウザ）
cmux rename-tab "API docs"                        # タブ名変更
cmux tab-action --action close --tab tab:1        # タブ閉じる
```

## ウィンドウ管理

```bash
cmux list-windows                                 # 一覧
cmux current-window                               # 現在のウィンドウ
cmux new-window                                   # 新規ウィンドウ
cmux focus-window --window window:1               # フォーカス
cmux close-window --window window:1               # 閉じる
cmux rename-window "dev"                          # リネーム
cmux next-window                                  # 次のウィンドウ
cmux previous-window                              # 前のウィンドウ
```

## 通知・ステータス

### 通知

```bash
cmux notify --title "完了" --body "ビルドが終わりました"
cmux notify --title "エラー" --subtitle "CI" --body "テスト失敗"
cmux list-notifications
cmux clear-notifications
```

### サイドバーステータス

```bash
cmux set-status "build" "running" --icon "hammer" --color "#f59e0b"
cmux set-status "test" "3/10 passed" --icon "check" --color "#22c55e"
cmux clear-status "build"
cmux list-status
```

### プログレスバー

```bash
cmux set-progress 0.5 --label "Building..."       # 50%
cmux set-progress 1.0 --label "Done"              # 完了
cmux clear-progress
```

### ログ

```bash
cmux log "処理を開始します"
cmux log --level warn --source "build" "依存関係が古いです"
cmux list-log --limit 20
cmux clear-log
```

## ブラウザ制御

**`cmux browser` サブコマンドを使う必要が出た時点で、`references/browser.md` を Read ツールで読んでから実行する。** 以下に基本操作の概観のみ記載する（ナビゲーション・DOM スナップショット・スクリーンショット・DOM 操作・JS 実行など）。個別コマンドの完全なフラグ・オプションは browser.md にまとまっているため、SKILL.md 本文だけを根拠にフラグを推測しない。

```bash
cmux browser open "https://example.com"           # ブラウザペインを開く
cmux browser navigate "https://example.com"       # URL 遷移
cmux browser snapshot                             # DOM スナップショット（テキスト）
cmux browser snapshot --interactive               # インタラクティブ要素付き
cmux browser screenshot                           # スクリーンショット画像
cmux browser screenshot --out /tmp/shot.png       # ファイルに保存
cmux browser click "button.submit"                # 要素クリック
cmux browser type "input[name=q]" "search query"  # テキスト入力
cmux browser eval "document.title"                # JavaScript 実行
cmux browser url                                  # 現在の URL 取得
```

## Markdown ビューア

```bash
cmux markdown open README.md                      # Markdown をフォーマット表示（ライブリロード対応）
```

## tmux 由来の互換コマンド（一部）

tmux に慣れたユーザー向けに用意された限定的な互換レイヤー。**以下に列挙するコマンドのみが保証対象**で、tmux の全コマンドが動くわけではない（例: `kill-session` / `rename-window` などネイティブ tmux 由来のもの全てをサポートするわけではない）:

```bash
cmux capture-pane                                 # read-screen と同等
cmux resize-pane --pane pane:1 -R --amount 10     # ペインリサイズ（-L/-R/-U/-D）
cmux swap-pane --pane pane:1 --target-pane pane:2 # ペイン入れ替え
cmux break-pane                                   # ペインを独立ワークスペースに
cmux join-pane --target-pane pane:1               # ペインを統合
cmux last-pane                                    # 直前のペインに戻る
cmux find-window --content "TODO"                 # ウィンドウ内テキスト検索
```

## よくあるパターン

### 右分割して別ディレクトリでコマンド実行

```bash
SURFACE=$(cmux new-split right 2>&1 | awk '{print $2}')
cmux send --surface "$SURFACE" "cd /path/to/project && ls\n"
```

### 隣のペインの画面内容を取得

```bash
# 自分以外のペインを特定して読む
cmux list-panes                                   # ペイン一覧で ID 確認
cmux read-screen --surface surface:<id> --scrollback
```

### ペインの構造を確認してから操作

```bash
cmux tree                                         # 現在のワークスペースの構造確認
```
