# 実行と完了回収

実行を依頼された場合だけ読む。既存 runner がある場合は新しい runner を重ねず、その実行と対象タスクを追跡する。

## 起動

[cmux-workspace](../../cmux-workspace/SKILL.md) の Right-Side Helper Pane 方針で surface を確保する。surface ref は作成応答または `list-pane-surfaces --pane <ref>` / `cmux tree` から取得する。別 workspace のフォーカスを変えない。

surface に送るコマンドは対象リポジトリへ移動して `takt run`、終了後に一意な完了トークンを通知する形にする。パスを shell quote し、トークンは実行ごとに生成する。以前の slug のトークンを再利用すると古い signal を拾い得る。

```sh
cmux send --surface <取得したsurface-ref> "cd <shell-quote済みrepo_root> && takt run; cmux wait-for -S <一意なトークン>\n"
```

末尾の `\n` がコマンド実行のトリガ。pane は人間が進捗を見るために使うので、`-q` で AI 出力を消さず、`tee` でログを二重保存しない。takt 自身の run ログを使う。

複数タスクでも runner の起動は一回。worker pool が設定された concurrency で pending を消化する。全 pending が対象になり得るため、実行前に依頼外の pending が混じっていないか確認する。

## 待機

```sh
cmux wait-for <起動時と同じトークン> --timeout 7200
```

Claude Code では background Bash、Codex 等では継続可能な実行セッションを使い、同じ待機を回収する。ホスト側の待機時間・進捗通知規約に従う。待機 timeout は takt の終了・失敗の証拠ではなく、再起動の理由にしない。

`cmux wait-for` は先に来た signal を保持し、wait 成功時に消費する。timeout では消費しないので同じトークンで再度待てる。これらは過去の実測であり、挙動が違う場合は現在の CLI を確認する。

cmux が利用できなければ [fallbacks.md](fallbacks.md) の継続実行セッションを使う。

## 完了時の確認

signal は runner の終了通知であり、タスク成功の証拠ではない。`tasks.yaml` で対象全件の最終 status を確認する。

- `completed`: `pr_url`、または対象 branch の PR から成果を確認する。
- `failed` / `aborted`: 失敗原因と未完了部分を調べる。
- `pending` / `running` 等が残る: 完了扱いせず、同じ実行の状態を確認する。

実行ログは `.takt/clone-meta/<name>.json` の `clonePath` から辿り、そのクローンの `.takt/runs/<run_slug>/reports/` を使う。メイン checkout のログだけで判断しない。必要なら pane の末尾を取得できるが、trace や JSONL を全文表示せず、エラーや検証結果の周辺だけ読む。

status、PR URL、テスト結果、review verdict と未完了の理由を報告する。
