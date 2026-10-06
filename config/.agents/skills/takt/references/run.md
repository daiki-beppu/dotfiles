# 実行と完了回収

実行を依頼された場合だけ読む。runner は repo ごとに常駐させる `takt watch` 1 本で、積まれたタスクを順に拾う。

## runner の確認と起動

まず、この repo を見張る watch が既にあるか確かめる。

```sh
for p in $(pgrep -f '/bin/takt (watch|run)'); do lsof -a -p "$p" -d cwd -Fn | sed -n 's/^n//p'; done
```

出力に `<repo_root>` があれば、その runner が拾うので何も起動しない。takt は起動時に `running` のタスクを中断扱いで `failed` にするため、2 本目の runner は先の runner が実行中のタスクを潰す。

無ければ Orca の新しいターミナルタブで watch を起動する。出力はタブに出て、ユーザーが進行を見られる。takt はタブのシェルの子なので、エージェント側のコマンド上限で止まらない。パスは shell quote する。

```sh
orca terminal create --worktree active --title "takt watch <repo>" --json \
  --command "cd <repo_root> && takt watch"
```

- 出力はタブに出すだけで、ファイルには取らない。途中経過と失敗箇所は takt MCP と実行クローンの reports から読む。
- watch は全タスクが終わっても常駐し続ける。タブは閉じず、次に積んだタスクもこの watch が拾う。止めるのはユーザーが Ctrl+C したとき（実行中のタスクの完了を待って止まる）。
- Orca が無い環境では、継続可能な実行セッションで `cd <repo_root> && takt watch > <log> 2>&1` を起動する。Claude Code は `nohup … < /dev/null & echo $! > <pid>; disown` で切り離し（バックグラウンド実行に直接載せると、その上限で takt も止まる）、Codex はセッション ID を返す exec/TTY を使う。

watch は設定された concurrency で全 pending を拾う。依頼外の pending が混じっていないか、積む前に確認する。

## 待機

完了は対象タスクの状態で判定する（watch は終了しないので、プロセスの終了は待たない）。対象全件が `pending` / `running` を抜けるまで、repo root で回す。

```sh
until takt list --non-interactive --format json | jq -e --arg n <issue> \
  '[.tasks[] | select((.issueNumber|tostring)==$n)] | length>0 and all(.kind!="pending" and .kind!="running")' >/dev/null
do sleep 30; done
```

Claude Code はこれを `run_in_background: true` と `timeout: 7200000` で流し、上限で止まったらループだけ張り直す。`failed` で抜けたら 1 分後にもう一度状態を見る。`auto_requeue_max_attempts` による自動の積み直しで `pending` に戻ることがあり、戻ったら待機を続ける。応答待ちの timeout は takt の失敗の証拠ではなく、runner を立て直す理由にしない。

watch のタブが消えている・プロセスが無いのに `running` が残るときは、上の確認から起動し直す。起動時に `failed` へ書き換わったタスクは自動では積み直されないので、[gotchas.md](gotchas.md) の「外から止められたタスク」の手順で積み直す。

## 途中経過

聞かれたら `takt_list_tasks`（`cwd` = repo root の絶対パス）で状態・run slug・現在 step を返す。レビューの判定が要るときは、タスクの `worktreePath` 配下の `.takt/runs/<run_slug>/reports/` から `grep -rH -m1 '^## 結果'` で各レポートの判定行だけ読む。`takt_get_run`（`cwd` + `runSlug`）は指示書と全レポートを丸ごと返して数万トークンになるので、判定行で足りないときだけ使う。MCP ツールが見えない環境では `takt list --non-interactive --format json` で状態を読む。

止まっているかは、ファイルの更新時刻ではなく watch のプロセスツリーの CPU 累計で判断する。`pnpm run check` のような長いコマンドの実行中は、ログもファイルも数分動かない。間を置いて 2 回流し、伸びていれば動いている（`<pid>` は上の runner の確認で見つけた watch）。

```sh
ps -ax -o pid=,ppid=,time= | awk -v r=<pid> '{p[$1]=$2;t[$1]=$3} END{for(i in p){j=i;while(j!=""&&j!=r&&j!=0)j=p[j];if(j==r){n=split(t[i],a,":");s+=(n==3?a[1]*3600+a[2]*60+a[3]:a[1]*60+a[2])}} printf "%d 秒\n",s}'
```

## 実行中の追加指示

実行中のタスクに指示を足すよう頼まれたら、止めて積み直さず、次の step 境界で届ける `takt_tell_run`（`cwd` + `runSlug` + `content`）を使う。`runSlug` は送る直前に `takt_list_tasks` から読み直す。自動の積み直しで run が新しくなると、前に見た slug は「タスクにない」と断られる。送る前に対象 slug と指示文をユーザーに示して確認を取る。届くのは worktree クローンで running のタスクだけで、完了・slug 不一致なら書き込まず理由が返る。MCP が無ければ、人間が `takt list` → 対象の running タスク → **Interactive** → `/tell` で送る（TTY が要る）。

## 打ち切り

レビューと修正の周回は、収束しないまま step 予算を使い切ることがある。直近の周回の指摘が同じ受け入れ条件のすき間を言い換えて狭めるだけになったら、収束していない。修正の検証（fix-verifier など）の差し戻しが 2 周続き、2 周目の指摘が 1 周目と同じ箇所なら、ユーザーに打ち切りを提案する。打ち切ったら takt を止め、その時点の差分を引き取り、残った指摘を手で直す（リポジトリの fix の手順に従う）。issue 本文の受け入れ条件があいまいで周回が延びたなら、そのすき間を issue 本文に書き足しておく。

## 完了時の確認

待機ループを抜けたことはタスク成功の証拠ではない。対象全件の最終 status を確認する。

- `completed`: `pr_url`、または対象 branch の PR から成果を確認する。
- `pr_failed`: workflow は成功し、PR 作成／push だけが失敗している。branch の push 状態を確かめ、PR 作成から再開する。
- `failed` / `exceeded`: 失敗原因と未完了部分を調べる。`exceeded` は step 予算切れで、続けるなら `--ignore-exceed`（[gotchas.md](gotchas.md)）。
- `pending` / `running` 等が残る: 完了扱いせず、同じ実行の状態を確認する。

実行ログは `takt_get_run` で取る。MCP が無ければ `.takt/clone-meta/<name>.json` の `clonePath` から辿り、そのクローンの `.takt/runs/<run_slug>/reports/` を使う。メイン checkout のログだけで判断しない。trace や JSONL を全文表示せず、エラーや検証結果の周辺だけ読む。

status、PR URL、テスト結果、review verdict と未完了の理由を報告する。

## 後片付け

マージした後のクローンは、開発ログ（`/knowledge`）を書き終えるまで残す。報告書（`.takt/runs/*/reports/`）が開発ログの素材になる。書き終えたら `scripts/takt-cleanup.mjs <issue>...` で片付ける。takt の削除の操作と同じく、クローン・worktree-session・タスクの記録をまとめて消す。クローンだけを `rm -rf` すると、記録が消えたクローンを指したまま残り、`takt_list_tasks` が `Worktree directory does not exist` で使えなくなる。そうなったら `takt-cleanup.mjs --missing` で記録を消す。
