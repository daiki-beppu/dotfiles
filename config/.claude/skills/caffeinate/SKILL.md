---
name: caffeinate
description: >-
  macOS のスリープ防止（caffeinate 管理）。「スリープさせないで」「awake にして」「caffeinate して」「解除して」「もう寝ていいよ」で発動。長時間タスク（ビルド・テスト・大規模操作）の実行前にも自発的に使用すること。
---

## Overview

macOS 組み込みの `caffeinate` コマンドでスリープを一時的に防止する。
追加インストール不要。手動トリガーと長時間コマンドの自動ラップの 2 モードを持つ。

## 手動開始

ユーザーが「スリープさせないで」「awake にして」等と言ったとき。

### 手順

1. 既存プロセスを確認し、動いていれば報告する:
   ```bash
   if [ -f /tmp/caffeinate-claude.pid ] && ps -p $(cat /tmp/caffeinate-claude.pid) -o pid= 2>/dev/null; then
     echo "caffeinate 実行中 (PID: $(cat /tmp/caffeinate-claude.pid))"
   fi
   ```

2. バッテリー駆動中なら警告する:
   ```bash
   pmset -g batt | head -1
   ```
   「Battery Power」を含む場合、バッテリー消費が増える旨を伝え、短めの時間を提案する。

3. 既存を停止してから起動:
   ```bash
   kill $(cat /tmp/caffeinate-claude.pid 2>/dev/null) 2>/dev/null; rm -f /tmp/caffeinate-claude.pid
   caffeinate -id -t <seconds> &
   echo $! > /tmp/caffeinate-claude.pid
   ```

### デフォルトタイムアウト: 2 時間（7200 秒）

| ユーザー指定 | 秒数 |
|---|---|
| 30分 | 1800 |
| 1時間 | 3600 |
| 2時間（デフォルト） | 7200 |
| 3時間 | 10800 |
| 数値のみ（例: 30） | 分として解釈 → 1800 |

## 長時間コマンドの自動ラップ

ビルド・テストスイート・大規模操作など 5 分以上かかりそうなコマンドを実行する際、自発的に `caffeinate -i` でラップする。子プロセス終了で caffeinate も自動終了するため PID 管理は不要。

```bash
caffeinate -i <command> [args...]
```

`run_in_background` で実行するコマンドにはラップ不要（バックグラウンドシェルが独自のライフサイクルを持つため）。

## 停止

ユーザーが「解除して」「もう寝ていいよ」等と言ったとき。

```bash
if [ -f /tmp/caffeinate-claude.pid ]; then
  kill $(cat /tmp/caffeinate-claude.pid) 2>/dev/null
  rm -f /tmp/caffeinate-claude.pid
  echo "caffeinate を停止しました"
else
  echo "管理中の caffeinate プロセスはありません"
fi
```

## 状態確認

```bash
pgrep -la caffeinate
```

PID ファイルがあれば自分が起動したプロセスかどうかも照合する。

## 注意点

- 多重起動は無駄。新規開始時は必ず既存を kill してから起動する
- `-s`（システムスリープ防止）は AC 電源時のみ有効なので使わない。`-i -d` で十分
- `-w <pid>` は既に動いているバックグラウンドプロセスに紐づけたい場合の代替手段
