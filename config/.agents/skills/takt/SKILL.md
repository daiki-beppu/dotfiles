---
name: takt
description: GitHub issue を takt に投入・実行する依頼に使う。「積む」は投入のみ、「回す」は完了回収まで。
---

# takt タスク投入・実行

起票済み issue をキューへ積み、実行依頼があれば完了まで追跡する。通常 PR を既定とし、マージは含めない。バージョン依存のレシピは各参照に書いた版での確認なので、現行のインストールを確認して使う。

## モード

- `<issue番号>` / 「積んでおいて」: 投入のみ。
- `--run` / 「回して」: 投入後に実行。番号なしの `--run` は既存 pending を実行。
- `--workflow <name>`: 実在する実行用 workflow を指定。
- `--branch <name>` / `--pr <N>`: 既存ブランチ／PR への積み増し。
- `--base <name>`: 実在する base を指定。
- `--draft` / `--no-auto-pr`: draft にする（repo の `draft_pr` 次第）／PR を自動作成しない。
- `--dry-run`: workflow・branch・base・auto_pr・draft の予定を示すだけ。投入・起動・issue 編集をしない。

## 投入条件

issue 本文が仕様の正本で、投入時に order.md へコピーされる。自前の order.md は上書きされ、積んだ後に直した本文はタスクに届かない。直したら、pending なら積み直し、running なら [run.md](references/run.md) の「実行中の追加指示」で届ける。本文の矛盾・不足を確認し、修正は依頼された範囲で issue 側に行う。完了条件はエージェントが自力で満たせる項目だけにする。人の手が要る項目（実機・資格情報が要る確認など）や答えの出ていない確認事項が残っていれば、先に本文で決めるか別 issue に切り出してから積む。満たせない完了条件は BLOCKED や ABORT を招き、周回を浪費する。エージェントはリンク先の issue を読めないので、実装に要る仕様は本文に書き写す。親の仕様 issue に `formal-spec` の Formal Spec コメントがあれば、その issue に関わる性質とブロックも書き写す。未起票ならリポジトリの起票規約に従う。起票は `to-spec` →（`formal-spec`）→ `to-tickets`（仕様が完成済みなら `to-tickets`）を使う。

pending / running と既存 branch を確認して重複・競合を避ける。稼働中の runner は投入直後に pending を拾うため、「後で実行」と指定されていれば即実行されるキューへ投入しない。実行を許可された場合は即時に走り得ることを伝える。

新規ブランチの起点は最新化したローカルのデフォルトブランチ。クリーンな main checkout なら ff-only で更新できる。dirty・diverged・別ブランチなら既存作業を保持して、正しい起点を用意する。既存 PR の積み増しは push 済み remote HEAD が起点で、未 push 変更は含まれない。

## Workflow と投入

明示指定 → リポジトリの運用文書 → issue のラベル → 内容の順で選ぶ。選択前に実在と直接実行可能かを確認する。step fragment や `subworkflow.callable: true` は投入対象にしない。`takt:manual` は手動の意思表示なので、今回の明示指示と食い違う場合は意図を確認する。古いラベルを理由に存在しない workflow を選ばない。

builtin から選ぶ場合は [workflow-catalog.md](references/workflow-catalog.md)、投入する場合は [enqueue.md](references/enqueue.md) を読む。投入は takt MCP の `takt_enqueue_task` を使い、`worktree: true`・issue 本文・workflow 検証・base 実在確認を保持する。`tasks.yaml` は MCP 経由で更新し、手書きしない。現ブランチを書き換える直接実行経路は使わない。

MCP が使えない場合だけ [fallbacks.md](references/fallbacks.md) を読む。投入応答が不明ならタスクレコードを照合してから再試行し、二重投入を避ける。書かれたレコードの issue・workflow・branch・base・draft を確認する。

## 実行と完了

実行依頼・途中経過の確認・実行中タスクへの追加指示のときだけ [run.md](references/run.md) を読む。runner は repo ごとに常駐する `takt watch` 1 本で、既にあれば起動せず、無ければ Orca の新しいターミナルタブで起動する。大量の stdout をコンテキストへ流さず、タスク状態で完了を追跡する。待機 timeout だけで runner を立て直さない。

後片付けは `scripts/takt-cleanup.mjs` を使う（使い方は [run.md](references/run.md)）。

投入だけなら slug と設定・pending 状態を報告する。実行を依頼された場合は対象全件の最終 status、PR URL、検証・review 結果まで回収し、failed / exceeded / pr_failed と未完了を区別する。ログは takt MCP の `takt_get_run`（無ければ実行クローンの `clonePath` 配下）から必要部分だけ読む。

未知のエラーは [gotchas.md](references/gotchas.md) を参照する。
