# 監視ループの擬似アルゴリズムと判定ロジック

parallel スキルの Step 5.5 で使う監視ループの中核。各 pane をポーリングし、完了・エラー・停滞を判定してメインペインに集約表示する。

## サンプリング間隔の設計

| 状態 | 間隔 | 理由 |
|---|---|---|
| 通常時 | **25 秒** | Anthropic の prompt cache TTL 5 分内に 10〜12 回反復でき、cache を保持できる |
| 起動後 2 分間 | **15 秒** | 初期エラー（依存インストール失敗、Claude 起動失敗等）を早く検出するため |

## 完了判定

画面に **PR URL** が出現したら完了とみなす。

```
正規表現: https://github\.com/[^/[:space:]]+/[^/[:space:]]+/pull/[0-9]+
```

Claude Code のプロンプト記号（`> ` や `│ > `）単体は完了と認めない。一瞬の待機でも拾ってしまい false positive になるため。PR URL が唯一の強い完了シグナル。

検出した PR URL は `$STATE_DIR/<name>.done` に保存し、次反復以降スキップする。

## エラー検知

一度検知したら `.err-seen` フラグで同一 pane の再通知を抑止する。**強制停止はしない** — pane 側 Claude の自己回復余地を残すため、通知 (`cmux notify`) とログ (`cmux log --level warn`) のみで対応する。

検知対象キーワードは以下の方針で設定する:

- 汎用エラー語（`error` / `fatal` / `failed` / `traceback` / `exception` / `panic`）は境界条件で区切り、文中の自然言語（例: "error handling を実装"）を除外
- CI・hook・権限系の定型文をリテラルで追加
- プロジェクト固有のキーワードは当面含めない（汎用のみで運用し、必要なら後で追加）

```bash
ERROR_PATTERN='(^|[^a-z])(error|fatal|failed|traceback|exception|panic)([^a-z]|$)|pre-commit hook failed|ci( check)? failed|permission denied|command not found'
```

## 停滞検知

直近 3 反復（約 75 秒）で画面末尾 40 行が完全一致 → 停滞と判定。`cmux log --level warn` でメインに通知するのみで介入はしない。ただし **直前に PR URL が出ている場合は停滞扱いしない**（正常完了後のアイドル状態）。

カウンタファイル `$STATE_DIR/<name>.stall` をインクリメントし、3 回連続で一致したら `<name>.stall-notified` をセット。画面が変化したらカウンタはリセット。

## 状態管理

`STATE_DIR=/tmp/parallel-monitor-$$/` を監視ループ開始時に作成し、Step 6 のサマリー出力完了後に `rm -rf` する。

| ファイル | 内容 |
|---|---|
| `<name>.screen` | 最新の read-screen 結果 |
| `<name>.prev` | 前回反復の read-screen 結果（停滞検知用） |
| `<name>.done` | 完了判定時に PR URL を保存 |
| `<name>.err-seen` | エラー初検知のフラグ（空ファイル） |
| `<name>.stall` | 停滞カウンタ（数値） |
| `<name>.stall-notified` | 停滞通知済みフラグ |

## 擬似コード全体

parallel スキルの Step 5 終了時点で、以下の変数が bash 配列で揃っている前提:

- `SURFACES=(surface:2 surface:3 ...)` — 各 pane の surface ID
- `TASK_NAMES=(user-auth billing ...)` — 対応する短縮名

```bash
STATE_DIR="/tmp/parallel-monitor-$$"
mkdir -p "$STATE_DIR"

TIMEOUT_SEC=2700       # 45 分
INTERVAL_SEC=25        # 通常間隔
BOOT_INTERVAL_SEC=15   # 起動後間隔
BOOT_WINDOW_SEC=120    # 起動直後ウィンドウ

START=$(date +%s)
ITER=0
DONE_COUNT=0
TOTAL=${#SURFACES[@]}
EXIT_REASON="unknown"

cmux set-status "parallel" "monitoring" --icon "eye" --color "#3b82f6"
cmux set-progress 0 --label "0/${TOTAL} pane 完了"
cmux log "parallel: 監視開始 (${TOTAL} pane, timeout=${TIMEOUT_SEC}s)"

while true; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))

  if [ $ELAPSED -ge $TIMEOUT_SEC ]; then
    cmux notify --title "parallel: timeout" --body "監視が ${TIMEOUT_SEC}s を超過"
    EXIT_REASON="timeout"
    break
  fi

  if [ $ELAPSED -lt $BOOT_WINDOW_SEC ]; then
    CUR_INTERVAL=$BOOT_INTERVAL_SEC
  else
    CUR_INTERVAL=$INTERVAL_SEC
  fi

  ITER=$((ITER + 1))
  DONE_COUNT=0

  for i in "${!SURFACES[@]}"; do
    SURF="${SURFACES[$i]}"
    NAME="${TASK_NAMES[$i]}"
    SCREEN_FILE="$STATE_DIR/${NAME}.screen"
    PREV_FILE="$STATE_DIR/${NAME}.prev"
    DONE_FLAG="$STATE_DIR/${NAME}.done"
    ERR_FLAG="$STATE_DIR/${NAME}.err-seen"

    if [ -f "$DONE_FLAG" ]; then
      DONE_COUNT=$((DONE_COUNT + 1))
      continue
    fi

    cmux read-screen --surface "$SURF" --scrollback --lines 200 > "$SCREEN_FILE" 2>/dev/null

    # 完了判定
    PR_URL=$(grep -oE 'https://github\.com/[^/[:space:]]+/[^/[:space:]]+/pull/[0-9]+' "$SCREEN_FILE" | tail -1)
    if [ -n "$PR_URL" ]; then
      echo "$PR_URL" > "$DONE_FLAG"
      DONE_COUNT=$((DONE_COUNT + 1))
      cmux log "parallel/${NAME}: PR 作成確認 → $PR_URL"
      cmux set-status "parallel:${NAME}" "done" --icon "check" --color "#22c55e"
      continue
    fi

    # エラー検知（ERROR_PATTERN は上で TODO(human) により定義）
    if [ ! -f "$ERR_FLAG" ]; then
      ERR_MATCH=$(grep -iE "$ERROR_PATTERN" "$SCREEN_FILE" | tail -3)
      if [ -n "$ERR_MATCH" ]; then
        touch "$ERR_FLAG"
        cmux notify --title "parallel/${NAME}: エラー兆候" --body "$(echo "$ERR_MATCH" | head -1)"
        cmux log --level warn --source "parallel/${NAME}" "エラー兆候: $(echo "$ERR_MATCH" | head -1)"
        cmux set-status "parallel:${NAME}" "error?" --icon "alert-triangle" --color "#f59e0b"
      fi
    fi

    # 停滞検知
    if [ -f "$PREV_FILE" ]; then
      TAIL_NOW=$(tail -40 "$SCREEN_FILE")
      TAIL_PREV=$(tail -40 "$PREV_FILE")
      if [ "$TAIL_NOW" = "$TAIL_PREV" ]; then
        STALL_COUNT=$(cat "$STATE_DIR/${NAME}.stall" 2>/dev/null || echo 0)
        STALL_COUNT=$((STALL_COUNT + 1))
        echo "$STALL_COUNT" > "$STATE_DIR/${NAME}.stall"
        if [ "$STALL_COUNT" -ge 3 ] && [ ! -f "$STATE_DIR/${NAME}.stall-notified" ]; then
          touch "$STATE_DIR/${NAME}.stall-notified"
          cmux log --level warn --source "parallel/${NAME}" "75s 画面変化なし（停滞の可能性）"
        fi
      else
        rm -f "$STATE_DIR/${NAME}.stall" "$STATE_DIR/${NAME}.stall-notified"
      fi
    fi
    cp "$SCREEN_FILE" "$PREV_FILE"

    # 進行中ステータス（末尾の非空行を抜粋）
    LAST_LINE=$(grep -v '^[[:space:]]*$' "$SCREEN_FILE" | tail -1 | cut -c1-40)
    cmux set-status "parallel:${NAME}" "${LAST_LINE}" --icon "loader" --color "#6366f1"
  done

  # 全体プログレス
  PCT=$(awk -v d="$DONE_COUNT" -v t="$TOTAL" 'BEGIN{printf "%.2f", d/t}')
  cmux set-progress "$PCT" --label "${DONE_COUNT}/${TOTAL} pane 完了 (iter=${ITER})"

  # 全完了？
  if [ "$DONE_COUNT" -ge "$TOTAL" ]; then
    cmux notify --title "parallel: 全完了" --body "${TOTAL} 個の PR が揃いました"
    EXIT_REASON="all-done"
    break
  fi

  sleep "$CUR_INTERVAL"
done

cmux set-progress 1.0 --label "監視終了 (${EXIT_REASON})"
# STATE_DIR は Step 6 で PR URL 回収に使うので、Step 6 完了後に rm -rf
```

## cmux API の使い分け

| API | 用途 | 頻度 |
|---|---|---|
| `set-status "parallel:<name>"` | 各 pane の末尾 1 行（40 文字まで） | 毎反復・pane 毎 |
| `set-status "parallel"` | 全体状態（monitoring / all-done / timeout） | 状態遷移時のみ |
| `set-progress` | `完了数 / 全体` と iter 番号 | 毎反復 |
| `cmux log` | 完了・停滞・エラーなどイベント | 状態変化時のみ |
| `cmux notify` | PR 全完了、エラー初検出、タイムアウト | 重大事象のみ |

## 監視ループ終了後の状態

- `EXIT_REASON` は `all-done` / `timeout` のいずれか
- `STATE_DIR/<name>.done` に PR URL、`<name>.err-seen` がエラー検知の印
- これらを Step 6（サマリー出力）で集約し、サマリー出力後に `rm -rf "$STATE_DIR"`
