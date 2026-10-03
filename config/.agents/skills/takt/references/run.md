# 実行と完了回収

実行を依頼された場合だけ読む。既存 runner がある場合は新しい runner を重ねず、その実行と対象タスクを追跡する。

## 起動

対象リポジトリへ移動して `takt run` を一度起動する。パスは shell quote する。

Orca の端末内（`ORCA_TERMINAL_HANDLE` がある）では、自分の pane の右に分割した別 pane で起動し、ユーザーが進行を見られるようにする。

```sh
orca terminal split --terminal "$ORCA_TERMINAL_HANDLE" --direction vertical --json \
  --command "cd <shell-quote済みrepo_root> && takt run 2>&1 | tee <scratchpad>/takt_<slug>.log; touch <scratchpad>/takt_<slug>.done"
```

- 右に出すのは `vertical`。Orca 1.4.217 の実測では `horizontal` が上下分割で、同梱ガイドの説明と逆になっている。
- `--command` は pane のシェルに打ち込まれるだけで、takt が終わっても pane は残る。`terminal wait --for exit` は返らないので、終了は `.done` の出現で回収する。`until [ -f <scratchpad>/takt_<slug>.done ]; do sleep 30; done` を `run_in_background: true` と `timeout: 7200000` で流し、上限で止まったらループだけ張り直す。返った `handle` は報告に含める。
- pane を閉じると takt も止まる。pane の後片付けは完了を確認してから行う。

Orca の外では、継続可能な実行セッションで切り離して起動する。

```sh
cd <shell-quote済みrepo_root> && takt run > <scratchpad>/takt_<slug>.log 2>&1
```

- Claude Code は takt run を `nohup … < /dev/null & echo $! > <scratchpad>/takt_<slug>.pid; disown` で切り離して起動し、終了の回収には PID の終了を待つループを `run_in_background: true` と `timeout: 7200000` で流す。takt run 自体をバックグラウンド実行に載せると、その上限（既定 30 分、最大 2 時間）で takt も道連れで止まる（調査の issue は 2 時間を超えた）。待つループが上限で止まっても takt は動き続けるので、ループだけ張り直す。Codex はセッション ID を返す exec/TTY を使う。

どちらでも `-q` で AI 出力を消さない。ログは失敗箇所を探すためだけに使い、全文は読まない。

複数タスクでも runner の起動は一回。worker pool が設定された concurrency で pending を消化する。全 pending が対象になり得るため、実行前に依頼外の pending が混じっていないか確認する。

## 待機

同じセッションの終了を回収する。ホスト側の待機時間・進捗通知規約に従う。セッションが実行中なら待機を続ける。応答待ち timeout は takt の終了・失敗の証拠ではなく、再起動の理由にしない。

セッションを回収できないときはプロセスとタスク状態を確認する。古いログの存在だけで成功扱い・再起動しない。継続実行できる手段が無ければ、投入済み／実行未完了を分けて報告する。

途中経過を聞かれたら、`scripts/takt-status.mjs` を流す（`<skill>/scripts/takt-node.sh <skill>/scripts/takt-status.mjs <issue> [起動時のログ]`）。状態・今の run・直近の工程・各レビューの判定・裁定で直す問題を数行で返す。足りなければ takt MCP を引く。`takt_list_tasks`（`cwd` = repo root の絶対パス）で状態・run slug・現在 step を、`takt_get_run`（`cwd` + `runSlug`）でその run の step log・レポートを取る。MCP ツールが見えない環境では下の「完了時の確認」の手作業経路を使う。

## 実行中の追加指示

実行中のタスクに指示を足すよう頼まれたら、止めて積み直さず、次の step 境界で届ける `takt_tell_run`（`cwd` + `runSlug` + `content`）を使う。`runSlug` は送る直前に `tasks.yaml`（または takt-status）から読み直す。自動の積み直しで run が新しくなると、前に見た slug は「タスクにない」と断られる。送る前に対象 slug と指示文をユーザーに示して確認を取る。届くのは worktree クローンで running のタスクだけで、完了・slug 不一致なら書き込まず理由が返る。MCP が無ければ、人間が `takt list` → 対象の running タスク → **Interactive** → `/tell` で送る（TTY が要る）。

## 完了時の確認

セッションの終了は runner の終了通知であり、タスク成功の証拠ではない。`tasks.yaml` で対象全件の最終 status を確認する。

- `completed`: `pr_url`、または対象 branch の PR から成果を確認する。
- `pr_failed`: workflow は成功し、PR 作成／push だけが失敗している。branch の push 状態を確かめ、PR 作成から再開する。
- `failed` / `exceeded`: 失敗原因と未完了部分を調べる。`exceeded` は step 予算切れで、続けるなら `--ignore-exceed`（[gotchas.md](gotchas.md)）。
- `pending` / `running` 等が残る: 完了扱いせず、同じ実行の状態を確認する。

実行ログは `takt_get_run` で取る。MCP が無ければ `.takt/clone-meta/<name>.json` の `clonePath` から辿り、そのクローンの `.takt/runs/<run_slug>/reports/` を使う。メイン checkout のログだけで判断しない。必要なら起動時ログの末尾を読めるが、trace や JSONL を全文表示せず、エラーや検証結果の周辺だけ読む。

status、PR URL、テスト結果、review verdict と未完了の理由を報告する。

## 後片付け

マージした後のクローンは、開発ログ（`/knowledge`）を書き終えるまで残す。報告書（`.takt/runs/*/reports/`）が開発ログの素材になる。書き終えたら `scripts/takt-cleanup.mjs <issue>...` で片付ける。takt の削除の操作と同じく、クローン・worktree-session・タスクの記録をまとめて消す。クローンだけを `rm -rf` すると、記録が消えたクローンを指したまま残り、`takt_list_tasks` が `Worktree directory does not exist` で使えなくなる。そうなったら `takt-cleanup.mjs --missing` で記録を消す。
