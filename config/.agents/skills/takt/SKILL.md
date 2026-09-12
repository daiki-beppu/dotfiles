---
name: takt
description: GitHub issue を takt に投入・実行する依頼に使う。「積む」は投入のみ、「回す」は完了回収まで。
---

# takt タスク投入・実行

起票済み issue をキューへ積み、実行依頼があれば完了まで追跡する。通常 PR を既定とし、マージは含めない。バージョン依存のレシピは takt 0.62.0 の実測なので、現行のインストールを確認して使う。

## モード

- `<issue番号>` / 「積んでおいて」: 投入のみ。
- `--run` / 「回して」: 投入後に実行。番号なしの `--run` は既存 pending を実行。
- `--workflow <name>`: 実在する実行用 workflow を指定。
- `--branch <name>` / `--pr <N>`: 既存ブランチ／PR への積み増し。
- `--base <name>`: 実在する base を指定。
- `--draft` / `--no-auto-pr`: draft にする／PR を自動作成しない。
- `--dry-run`: workflow・branch・base・auto_pr・draft の予定を示すだけ。投入・起動・issue 編集をしない。

## 投入条件

issue 本文が仕様の正本で、投入時に order.md へコピーされる。自前の order.md は上書きされる。本文の矛盾・不足を確認し、修正は依頼された範囲で issue 側に行う。未起票ならリポジトリの起票規約に従う。Wayfinder 後は `to-spec` → `to-tickets`、その他は `issue` を使う。

pending / running と既存 branch を確認して重複・競合を避ける。稼働中の runner は投入直後に pending を拾うため、「後で実行」と指定されていれば即実行されるキューへ投入しない。実行を許可された場合は即時に走り得ることを伝える。

新規ブランチの起点は最新化したローカルのデフォルトブランチ。クリーンな main checkout なら ff-only で更新できる。dirty・diverged・別ブランチなら既存作業を保持して、正しい起点を用意する。既存 PR の積み増しは push 済み remote HEAD が起点で、未 push 変更は含まれない。

## Workflow と投入

明示指定 → リポジトリの運用文書 → issue のラベル → 内容の順で選ぶ。選択前に実在と直接実行可能かを確認する。step fragment や `subworkflow.callable: true` は投入対象にしない。`takt:manual` は手動の意思表示なので、今回の明示指示と食い違う場合は意図を確認する。古いラベルを理由に存在しない workflow を選ばない。

builtin から選ぶ場合は [workflow-catalog.md](references/workflow-catalog.md)、投入する場合は [enqueue.md](references/enqueue.md) を読む。投入は検証済みの内部 API を使い、`worktree: true`・issue 解決・workflow 検証・base 実在確認を保持する。`tasks.yaml` はロック付き API で更新し、手書きしない。現ブランチを書き換える直接実行経路は使わない。

API が使えない場合だけ [fallbacks.md](references/fallbacks.md) を読む。投入応答が不明ならタスクレコードを照合してから再試行し、二重投入を避ける。書かれたレコードの issue・workflow・branch・base・draft を確認する。

## 実行と完了

実行依頼がある場合だけ [run.md](references/run.md) を読み、cmux の helper surface または継続可能な実行セッションで一度起動する。大量の stdout をコンテキストへ流さず、完了シグナルとタスク状態で追跡する。待機 timeout だけで再起動しない。

投入だけなら slug と設定・pending 状態を報告する。実行を依頼された場合は対象全件の最終 status、PR URL、検証・review 結果まで回収し、failed / aborted と未完了を区別する。ログは実行クローンの `clonePath` 配下から必要部分だけ読む。

未知のエラーは [gotchas.md](references/gotchas.md)、過去の設計理由が必要なら [design-history.md](references/design-history.md) を参照する。履歴を現在の状態の代わりにしない。
