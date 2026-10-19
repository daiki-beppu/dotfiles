# 実行と完了回収

実行を依頼された場合だけ読む。runner は repo ごとに常駐させる `takt watch` 1 本で、積まれたタスクを順に拾う。

## runner の確認と起動

案内役と一緒に使うときは、guide スキルの `scripts/desk.mjs` で立てる（repo の main checkout で `node <guide>/scripts/desk.mjs <owner/repo>`）。1 つのタブに takt watch・案内役・align-behind のペインを並べ、既に動いているものは起動しない。以下は watch を単独で立てるときの手順。

まず、この repo を見張る watch が既にあるか確かめる。

```sh
for p in $(pgrep -f '/bin/takt (watch|run)'); do lsof -a -p "$p" -d cwd -Fn | sed -n 's/^n//p'; done
```

出力に `<repo_root>` があれば、その runner が拾うので何も起動しない。同じ repo に 2 本目を起動しても `TAKT run is already running for this project (PID N)` で断られる（0.71.0）。

無ければ Orca の新しいターミナルタブで watch を起動する。出力はタブに出て、ユーザーが進行を見られる。takt はタブのシェルの子なので、エージェント側のコマンド上限で止まらない。パスは shell quote する。`--worktree` は `path:<repo_root>` で指す。`active` だと、その時点で前面にある別の worktree にタブができ、ユーザーが見つけられない。タブのシェルは指した worktree で始まるので `cd` は要らない。

```sh
orca terminal create --worktree path:<repo_root> --title "takt watch <repo>" --json \
  --command "takt watch"
```

- タブの出力は `orca terminal read --terminal <handle> --json` で読む。handle は create の `.result.terminal.handle`。読んだ結果は `.result.terminal` の `tail[]`（行の配列）・`nextCursor`（次に `--cursor` へ渡すと新しい行だけ返る）・`status`（`running` など）。
- 出力はタブに出すだけで、ファイルには取らない。途中経過と失敗箇所は takt MCP と実行クローンの reports から読む。
- watch は並列数（`concurrency`・`TAKT_CONCURRENCY`）を起動時に一度だけ読む。途中で上げるには立て直すしかない。`kill -INT <watch の pid>` を外から送ると、実行中のタスクの完了を待たずに止まる（0.68.0、2026-10-10 に #663 が write_tests の途中で止まった）。立て直すときは、実行中のタスクが無いときに行うか、止まったタスクを [gotchas.md](gotchas.md) の「外から止められたタスク」の手順で `resume-checkpoint` から積み直す
- watch は全タスクが終わっても常駐し続ける。タブは閉じず、次に積んだタスクもこの watch が拾う。止めるのはユーザーが Ctrl+C したとき（実行中のタスクの完了を待って止まる）。
- Orca が無い環境では、継続可能な実行セッションで `cd <repo_root> && takt watch > <log> 2>&1` を起動する。Claude Code は `nohup … < /dev/null & echo $! > <pid>; disown` で切り離し（バックグラウンド実行に直接載せると、その上限で takt も止まる）、Codex はセッション ID を返す exec/TTY を使う。

watch は設定された concurrency で全 pending を拾う。依頼外の pending が混じっていないか、積む前に確認する。

## 待機

完了は対象タスクの状態で判定する（watch は終了しないので、プロセスの終了は待たない）。repo root で次を流し、対象全件が `pending` / `running` を抜けるまで待つ。

```sh
node <skill>/scripts/takt-wait.mjs <issue>...
```

状態が変わったときだけ 1 行出し、全件 `completed` なら 0、それ以外で終われば 1 で終わる。`failed` で抜けても `auto_requeue_max_attempts` による自動の積み直しで `pending` に戻ることがあるので、猶予（`--grace`、既定 60 秒）をおいて見直してから終える。チェックが 1 件も付かないまま `--checks-after` 分（既定 10）たった PR は警告する。クローンの場所は `takt-path.mjs <issue>`（`--push` で remote の無いクローンから push するコマンド）。

Claude Code はこれを `run_in_background: true` と `timeout: 7200000` で流し、上限で止まったら張り直す。応答待ちの timeout は takt の失敗の証拠ではなく、runner を立て直す理由にしない。

watch のタブが消えている・プロセスが無いのに `running` が残るときは、上の確認から起動し直す。起動時に `failed` へ書き換わったタスクは自動では積み直されないので、[gotchas.md](gotchas.md) の「外から止められたタスク」の手順で積み直す。

区切りの見出しは `---` で書く（zsh は `echo ====` を EQUALS 展開して `== not found` で落ちる）。待つときは前景の `sleep` ではなく Monitor か `run_in_background` を使う。

## 順に回してマージまで

複数の issue を 1 件ずつ積み、PR の自動マージまで見届けて次を積むよう頼まれたら、`takt-wait.mjs` の代わりに repo root で次を流して takt-sequence を起動する。watch は別に動いている前提。

```sh
node <skill>/scripts/start-sequence.mjs <issue>... [--workflow <name>] [--base main] [--fix-wait 10]
```

repo root で案内役が desk のペイン（コマンド行に `--terminal <handle>`）で動いていれば、そのペインの下に分割して開き、そうでなければ Orca の新しいタブ（題名 `takt sequence <owner/repo>`）に開く。どちらで開いたかと handle を 1 行出して終わる。

takt-sequence は、開いたペインかタブで、起動直後に対象の issue をタイトルと今の段階つきで 1 行ずつ出し、あとは出来事が起きたときだけ `2026/10/13 18:01:40 自動マージ予約: #701 <タイトル> <PR URL>` の形で 1 行出す（投入・レビュー開始・レビュー修正待ち・レビュー失敗・自動マージ予約・main に揃うのを待つ・マージ完了・CI失敗・競合修正待ち・タスク失敗）。タスクが PR を作ると、`takt merge <PR>` を [merge-review-automerge.yaml](../workflows/merge-review-automerge.yaml) で流す（global の `~/.takt/config.yaml` の `merge.workflow` で指す。起動時に確かめ、別の workflow なら止まる）。base と同期し（競合は AI が解く）、査読と修正を push し、PR に `TAKT review completed` とコメントしたら自動マージを予約する。takt はマージ前に終わる merge タスクを failed と記録するので、成否は takt list でなく PR のコメントで判断する。レビューの出力は `$TMPDIR/takt-sequence-review-<PR>.log` に出る。レビュー失敗（`TAKT evaluation failed for head <sha>` のコメント）はすぐには止めず、案内役が PR に書く修正の起動の印を待つ。現在の head に起動の印（`案内役: review-fix を起動する（head <sha>）` か `…を起動した（head <sha> / …）`）があれば「レビュー修正待ち」で待ち、PR に push されて head が変われば新しい head をレビューする。印が無いまま失敗のコメントから `--fix-wait` 分（既定 10 分）を過ぎるか、起動の印が PR に 2 回分あるのに現在の head に印が無いと「レビュー失敗」で止まる。印は案内役が書き、シーケンスは読むだけ。修正のセッションが `案内役: レビューのやり直しを頼む for head <sha>` を書くと、それより前の同じ head の失敗と落ちた回数を数えずレビューし直す（やり直しは head ごとに 1 回。やり直しの後にまた失敗したら止まる）。takt merge が現在の head で 2 回落ちたときも止まる（落ちた回数は head ごとに数える）。止まったら直して PR に push してから流し直すと、レビューからやり直す。印の文言は [review-stage.mjs](../scripts/review-stage.mjs) が正本。自動マージを予約した PR が main に遅れて（BEHIND）も、シーケンスは揃えずに待つ。揃えるのは別のタブに常駐させる `node <skill>/scripts/align-behind.mjs`（repo root で。作者を問わず、予約済みの BEHIND を予約の古い順に 1 件ずつ揃え、揃えた 1 件がマージされるか落ちるまで次を揃えない。DIRTY の PR には head ごとに 1 回コメントで知らせる。`--dry-run` で 1 周の判定だけ見られる）。シーケンスを流すときは、これも動いていることを確かめる。競合（CONFLICTING）なら、シーケンスは今までどおり競合修正待ちで止まる。次に積むのは、並びの先頭から見て blocked_by が全部閉じ、`help wanted` の無い issue。タスクが失敗した issue を手で引き取るときは、PR 本文に `Closes #<issue>` を書く。その issue に閉じる予定の open な PR があれば「手で対応中」と出して積み直さず、ほかの issue を先に進め、その PR のマージを待つ（自動マージは予約しない）。CI 失敗や競合で進めなくなったら「停止」を出して 1 で終わるので、直してから同じコマンドを流し直す。状態は毎周 takt と GitHub から読み直すので、流し直しても二重には積まない。自動マージを予約するので、マージの許可を受けたときだけ使う。

## 途中経過

聞かれたら `takt_list_tasks`（`cwd` = repo root の絶対パス）で状態・run slug・現在 step を返す。レビューの判定が要るときは、タスクの `worktreePath` 配下の `.takt/runs/<run_slug>/reports/` から `grep -rH -m1 '^## 結果'` で各レポートの判定行だけ読む。`takt_get_run`（`cwd` + `runSlug`）は指示書と全レポートを丸ごと返して数万トークンになるので、判定行で足りないときだけ使う。MCP ツールが見えない環境では `takt list --non-interactive --format json` で状態を読む。このときは JSON を一度ファイル（セッションのスクラッチパッド）に書いてから jq に渡す。パイプに直接流すと、タスクが 100 件を超えたあたりで出力が途中で切れる（0.68.0 で 64KB 付近、`jq: parse error: Unfinished string`）。

止まっているかは、2 つの手がかりを順に見て判断する。

1. 実行クローンの `.takt/runs/<run_slug>/logs/*.jsonl` の更新時刻と、`reports/` の増え方。エージェントが動いていれば、ログは数分おきに伸び、レポートは工程ごとに増える。エージェントはモデルの応答を待つあいだ CPU をほとんど使わないので、ここが第一の手がかりになる。
2. ログが数分動かないときは、watch のプロセスツリーの CPU 累計を、間を置いて 2 回見る。`pnpm run check` のような手元のコマンドが走っているあいだは、ログは動かないが CPU 累計は伸びる（`<pid>` は上の runner の確認で見つけた watch）。

ログが 10〜15 分以上動かず、CPU 累計も伸びていないときに初めて止まりを疑う。

```sh
ps -ax -o pid=,ppid=,time= | awk -v r=<pid> '{p[$1]=$2;t[$1]=$3} END{for(i in p){j=i;while(j!=""&&j!=r&&j!=0)j=p[j];if(j==r){n=split(t[i],a,":");s+=(n==3?a[1]*3600+a[2]*60+a[3]:a[1]*60+a[2])}} printf "%d 秒\n",s}'
```

## 実行中の追加指示

実行中のタスクに指示を足すよう頼まれたら、止めて積み直さず、次の step 境界で届ける `takt_tell_run`（`cwd` + `runSlug` + `content`）を使う。`runSlug` は送る直前に `takt_list_tasks` から読み直す。自動の積み直しで run が新しくなると、前に見た slug は「タスクにない」と断られる。送る前に対象 slug と指示文をユーザーに示して確認を取る。届くのは worktree クローンで running のタスクだけで、完了・slug 不一致なら書き込まず理由が返る。MCP が無ければ、人間が `takt list` → 対象の running タスク → **Interactive** → `/tell` で送る（TTY が要る）。

## 打ち切り

レビューと修正の周回は、収束しないまま step 予算を使い切ることがある。直近の周回の指摘が同じ受け入れ条件のすき間を言い換えて狭めるだけになったら、収束していない。修正の検証（fix-verifier など）の差し戻しが 2 周続き、2 周目の指摘が 1 周目と同じ箇所なら、ユーザーに打ち切りを提案する。打ち切ったら takt を止め、その時点の差分を引き取り、残った指摘を手で直す（リポジトリの fix の手順に従う）。takt-sequence で回しているなら、PR 本文に `Closes #<issue>` を書けば、ラベルを付けたり並びから抜いたりしなくても積み直されない。issue 本文の受け入れ条件があいまいで周回が延びたなら、そのすき間を issue 本文に書き足しておく。

## 完了時の確認

待機ループを抜けたことはタスク成功の証拠ではない。対象全件の最終 status を確認する。

- `completed`: `pr_url`、または対象 branch の PR から成果を確認する。takt の PR 本文には検証の結果が無いので、リポジトリが PR 本文にテストの層と結果を求めるなら、repo root で `node <skill>/scripts/pr-tests.mjs <issue>` を流して「## Tests」を足す（`--dry-run` で足す内容だけ出す）。実装レポートの検証の表と、査読の最新の判定を写す。takt の `pr_body_template` は `--pipeline` でしか効かず、watch / run の PR には使えない（0.68.0）。
- `pr_failed`: workflow は成功し、PR 作成／push だけが失敗している。branch の push 状態を確かめ、PR 作成から再開する。
- `failed` / `exceeded`: 失敗原因と未完了部分を調べる。`exceeded` は step 予算切れで、続けるなら `--ignore-exceed`（[gotchas.md](gotchas.md)）。
- `pending` / `running` 等が残る: 完了扱いせず、同じ実行の状態を確認する。

実行ログは `takt_get_run` で取る。MCP が無ければ `.takt/clone-meta/<name>.json` の `clonePath` から辿り、そのクローンの `.takt/runs/<run_slug>/reports/` を使う。メイン checkout のログだけで判断しない。trace や JSONL を全文表示せず、エラーや検証結果の周辺だけ読む。

status、PR URL、テスト結果、review verdict と未完了の理由を報告する。

## 後片付け

マージした後のクローンは、開発ログ（`/devlog`）を書き終えるまで残す。報告書（`.takt/runs/*/reports/`）が開発ログの素材になる。書き終えたら `<skill>/scripts/takt-node.sh <skill>/scripts/takt-cleanup.mjs <issue>...` で片付ける（takt の内部 API を読むので、`node` で直に流すと `ERR_MODULE_NOT_FOUND` で落ちる）。takt の削除の操作と同じく、クローン・worktree-session・タスクの記録をまとめて消す。クローンだけを `rm -rf` すると、記録が消えたクローンを指したまま残り、`takt_list_tasks` が `Worktree directory does not exist` で使えなくなる。そうなったら `takt-cleanup.mjs --missing` で、クローンが無いタスク（completed・failed・pr_failed・exceeded）の記録を消す。
