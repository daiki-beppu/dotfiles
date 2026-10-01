# 実行と完了回収

実行を依頼された場合だけ読む。既存 runner がある場合は新しい runner を重ねず、その実行と対象タスクを追跡する。

## 起動

対象リポジトリへ移動して `takt run` を一度起動する。パスは shell quote する。`-q` で AI 出力を消さない。

### Orca 上（`ORCA_TERMINAL_HANDLE` がある）

ユーザーが進捗を見られるよう、自分の pane の右に split して takt を走らせる。`orca` の解決と `runtime_access_denied` の扱いは orca-cli スキルに従う。

```sh
orca terminal split --terminal "$ORCA_TERMINAL_HANDLE" --direction horizontal \
  --command "cd <shell-quote済みrepo_root> && takt run; exit" --json
```

- 末尾の `; exit` を省かない。`--command` の後もシェルが残り、終了を検知できなくなる。
- 出力は pane に素通しする。`tee` やリダイレクトを挟まない。
- pane は takt の終了で閉じ、出力は残らない。結果は下の「完了時の確認」で取る。
- 返った `result.split.handle` の終了を下のコマンドで待つ（Claude Code は `run_in_background: true`、Codex はセッション ID を返す exec）。`satisfied: false` は timeout なので、同じ handle で待ち直す。

```sh
orca terminal wait --terminal <handle> --for exit --timeout-ms 7000000 --json
```

### それ以外

ホストの継続可能な実行セッションで起動する。Claude Code は `run_in_background: true`、Codex はセッション ID を返す exec/TTY を使う。ログは失敗箇所を探すためだけに使い、全文は読まない。

```sh
cd <shell-quote済みrepo_root> && takt run > <scratchpad>/takt_<slug>.log 2>&1
```

複数タスクでも runner の起動は一回。worker pool が設定された concurrency で pending を消化する。全 pending が対象になり得るため、実行前に依頼外の pending が混じっていないか確認する。

## 待機

同じセッションの終了を回収する。ホスト側の待機時間・進捗通知規約に従う。セッションが実行中なら待機を続ける。応答待ち timeout は takt の終了・失敗の証拠ではなく、再起動の理由にしない。

セッションを回収できないときはプロセスとタスク状態を確認する。古いログの存在だけで成功扱い・再起動しない。継続実行できる手段が無ければ、投入済み／実行未完了を分けて報告する。

途中経過を聞かれたら、ログではなく takt MCP を引く。`takt_list_tasks`（`cwd` = repo root の絶対パス）で状態・run slug・現在 step を、`takt_get_run`（`cwd` + `runSlug`）でその run の step log・レポートを取る。MCP ツールが見えない環境では下の「完了時の確認」の手作業経路を使う。

## 実行中の追加指示

実行中のタスクに指示を足すよう頼まれたら、止めて積み直さず、次の step 境界で届ける `takt_tell_run`（`cwd` + `runSlug` + `content`）を使う。送る前に対象 slug と指示文をユーザーに示して確認を取る。届くのは worktree クローンで running のタスクだけで、完了・slug 不一致なら書き込まず理由が返る。MCP が無ければ、人間が `takt list` → 対象の running タスク → **Interactive** → `/tell` で送る（TTY が要る）。

## 完了時の確認

セッションの終了は runner の終了通知であり、タスク成功の証拠ではない。`tasks.yaml` で対象全件の最終 status を確認する。

- `completed`: `pr_url`、または対象 branch の PR から成果を確認する。
- `pr_failed`: workflow は成功し、PR 作成／push だけが失敗している。branch の push 状態を確かめ、PR 作成から再開する。
- `failed` / `exceeded`: 失敗原因と未完了部分を調べる。`exceeded` は step 予算切れで、続けるなら `--ignore-exceed`（[gotchas.md](gotchas.md)）。
- `pending` / `running` 等が残る: 完了扱いせず、同じ実行の状態を確認する。

実行ログは `takt_get_run` で取る。MCP が無ければ `.takt/clone-meta/<name>.json` の `clonePath` から辿り、そのクローンの `.takt/runs/<run_slug>/reports/` を使う。メイン checkout のログだけで判断しない。必要なら起動時ログの末尾を読めるが、trace や JSONL を全文表示せず、エラーや検証結果の周辺だけ読む。

status、PR URL、テスト結果、review verdict と未完了の理由を報告する。
