# 案内役（guide スキル）

`config/.agents/skills/guide/` の[案内役](../../GLOSSARY.md)に手を入れるとき、特に[工程](../../GLOSSARY.md)の起動・[印](../../GLOSSARY.md)の形・[セッションの停止](../../GLOSSARY.md)の観測・Orca CLI の呼び方を変えるとき、wayfinder の [map](../../GLOSSARY.md) の遷移（ticket の起動・判断依頼・仮決めの掲載と差し戻し）を変えるとき、takt のレビューが失敗した PR の[修正のセッション](../../GLOSSARY.md)（review-fix）と、その判断依頼を変えるときに読む。工程を Orca の対話セッションで起動する理由は [ADR 0001](../adr/0001-guide-steps-run-as-orca-sessions.md)、判断の問いを ticket から読む理由は [ADR 0002](../adr/0002-grilling-writes-question-before-asking.md)。遷移と印の一覧は `config/.agents/skills/guide/SKILL.md` にある。

## 動いている案内役はマージしたコードを読み直さないので、工程の変更をマージしたら再起動する

`~/.claude/skills` はメインチェックアウトの `config/.agents/skills` への symlink なので、マージすればファイルは届く。しかし常駐中の `node guide.mjs` は、起動したときに読み込んだモジュールのまま動き続ける。

仕様 #325 では、案内役が 01:11Z に起動したまま、#335（to-tickets の Orca 起動）が 01:45Z、#339（formal-spec）が 03:40Z にマージされた。#325 の knowledge は 03:41Z に起動されたが、古いコードのままだった。そのため Orca のタブではなく `claude -p` で起動され、印も handle の無い古い形（`案内役: knowledge を起動した`）になった。仕様の Formal Spec コメントも無いまま流れた。今の印の形で動いているかは、起動時刻とマージの時刻を突き合わせれば分かる。

```sh
ps -eo pid,lstart,command | grep '[g]uide.mjs'
gh pr view <N> --json mergedAt
```

## 起動の印は 2 段に分け、2 段目は必ず `launchedMarker` で組み立てる

印は起動より先に書く決まりだが、handle は `orca agent launch --json` の応答からしか取れない。そこで、起動の前に `案内役: <工程> を起動する` を書き、起動の後に `案内役: <工程> を起動した（ターミナル <handle> / <ISO 8601>）` を書く。承認依頼の「送る」「送った」と同じ形。1 段目だけが残った仕様（起動の失敗、応答が JSON でない、handle が無い）は、次の周でも再起動しない。

2 段目を手で組み立てると、`decide.mjs` の `LAUNCHED` 正規表現（`^案内役: (\S+) を起動した（ターミナル (\S+) \/ ([^）]+)）`）に一致しなくなる。そうなると停止の観測から黙って漏れる。逆に、仕様に書いた印なら、この形で書けば工程名を問わず `sessionsToObserve` の対象になる。#333 の formal-spec は、観測側に手を入れずに停止の検知が効いた。

## 印を同じ形にそろえても、観測されるのは観測側が読む issue の印だけ

`sessionsToObserve` が見るのは、承認依頼を送り済みの open な仕様の印だけ。wayfinder の ticket に同じ形の起動の印を書いても、それだけでは観測されない。ticket の観測は `ticketSessionsToObserve` として別に足した（#347 以降）。

#345 の 1 回目の本文には「これで既存のセッションの停止の観測の対象になる」という見込みの一文があった。review はこれを要件として読み、fix-plan は「判断依頼の送り先（承認依頼のスレッド）が ticket には無い」として続行不能にした（[takt の知識文書](takt.md#takt-は-ticket-本文の地の文も完了の義務として読む)）。印を新しい issue に書く ticket では、観測側のどの関数が読むかまで本文に書く。

## 新しい印が古い印と前方一致することを前提に、抑止と gate を分けて判定する

新しい 2 段目の `案内役: to-tickets を起動した（ターミナル …` は、handle の無い古い印 `案内役: to-tickets を起動した` と前方一致する。二重起動の抑止には、この前方一致（`startsWith`）をそのまま使う。古い印・1 段目・2 段目のすべてを 1 つの接頭辞で止められるからで、`===` に変えると 2 段目で止まらなくなる。

一方、「古い版で起動した仕様かどうか」（exit 0 の親しか takt に渡さない gate）を同じ前方一致で判定してはいけない。新しい印まで古い印と読まれ、gate が閉じて、takt-sequence にも knowledge にも永遠に進まなくなる。#330 では、古い印を「`起動した` で終わり、`（ターミナル ` が続かないもの」と定義して分けた。

## 印を書く前に、失敗しうる読み取りを済ませる

1 段目の印を書いた後に例外が出ると、起動しないまま印だけが残る。その仕様の工程は、印を手で消すまで先へ進まない。knowledge に渡す takt の run の場所（`taktRunDirs`。takt list の `worktreePath`）の収集は、読み取りだけで繰り返しても安全なので、印より前に行う（#332）。承認依頼でチャンネルを用意してから印を書くのと同じ考え方。

## 入力待ちとして拾えるのは確認の質問だけで、ターンを終えた後の待ちは時間切れでしか拾えない

`orca terminal show --terminal <h> --json` の `result.terminal.agentWait` は、`null` か `{source: "prompt-text" | "title" | "hook", reason?, since?}` のどちらか。#331 で実測した値は次のとおり。

| セッションの状態 | `agentWait` |
| --- | --- |
| 作業中 | `null` |
| ターンを終えて次の入力を待つだけ | `null` |
| AskUserQuestion で確認を求めている | `{source: "hook", since}` |
| ツール実行の許可確認 | 未確認（ユーザー設定が bypass permissions で、許可確認が出なかった） |

ターンを終えて止まったセッション（「進めてよいですか」と書いて終わる、など）は `waiting: false` のままで、`--stall-minutes`（既定 60 分）でしか拾えない。手が止まっているか（`orca terminal wait --for tui-idle`）は観測に入れているが、停止の条件には使っていない。仕様が停止の条件を入力待ち（確認・許可）と定めているため。許可確認の値を確かめるには、許可スキップを外した環境で起動して許可確認を出させ、`orca terminal show` を取る。

## セッションが見つからないと判定するのは `terminal_handle_stale` と `connected: false` のときだけにする

見つからないセッションの返り方は 2 通りある。

- 閉じたタブの handle: `orca terminal show` は `ok: true` のまま `result.terminal.connected: false` を返す（2026-10-17 に実機で確認。`orca terminal close` の後 15 秒待っても同じ）
- 存在しない handle: 終了コード 1 で、**stdout** に `{"ok":false,"error":{"code":"terminal_handle_stale"}}` が出る（Orca の再起動後などと見ているが、閉じたタブでは出なかった）

案内役はこの 2 つのときだけ `found: false` にする（`orca-agent.mjs` の `observeSession`）。Orca が動いていない、別の code、JSON でない応答などはすべて例外にして、`loop.mjs` の再試行（3 回）に任せる。Orca 側の一時的な失敗まで `found: false` にすると、判断依頼が誤って飛ぶ。

テスト用の偽物の `orca` も、`execFileSync` と同じく `e.stdout` に JSON を載せて投げる形にする。`orca terminal wait` が待ちきれなかったときも、同じ形で `error.code: "timeout"` が返る。

## `agentWait` の値は、確認専用のセッションを自分で起動して取る

既存のセッションを眺めても値は分からない。#331 の 1 回目の実装では実機の 26 セッションを観測したが、すべて `agentWait: null` だった。replan で「確認専用のセッションを自分で起動する」手段を指摘され、それで初めて `hook` の値が取れた。

起動するときのはまりどころが 2 つある。

- takt の worktree は Orca に登録されていない。`orca agent launch --worktree path:<takt の worktree>` は `selector_not_found` になる。Orca に登録済みの repo の main checkout で起動する。
- 確認用のタブを閉じるとき、`orca terminal close --tab …` は `terminal_handle_stale` で失敗する。`--tab` を付けない `orca terminal close --terminal <h>` なら `ptyKilled: true` で閉じる。

## `orca agent launch` の応答の形は `--help` に載っていない

`orca agent launch --help` に載っているのは引数（`--agent`・`--worktree <selector>`・`--prompt`・`--json` など）だけで、`--title` は無い。応答 JSON の形も載っていない。#330 では、`/Applications/Orca.app` の bundle（`orcad-template/out/cli/index.js`）を読んで handle の場所（`result.outcome.handle`）を決めた。タブの題名は、起動の後に `orca terminal rename --terminal <h> --title <題名>` で付ける。

Orca の Chat UI の設定によっては `outcome.kind` が `structured`（チャット）になる。そのときに rename が効くかは確かめていない。形が違っていても、案内役は `停止:` のログを出して止まるだけで、誤って動き続けることはない。

## 偽の `orca` は、呼び出しを argv の配列のまま記録する

プロンプトは空白と改行を含むので、呼び出しを文字列につないで記録すると argv に戻せない。#330 では、これでテストが 3 件落ちた。テストでは、PATH に偽物を置くのではなく、`launchAgent` / `observeSession` の第 2 引数 `run` に注入する。`scripts/check.sh` の PATH には `orca` が無いため。

## 行動の種類を足したら、`loop.mjs` の `DESCRIBE` と `guide.mjs` の注入も足す

`loop.mjs` は `DESCRIBE[a.kind](a)` で行動を表示するので、種類を登録し忘れると dry-run が TypeError で止まる。起動の関数（`launchFormalSpec` など）は、`guide.mjs` で `createExecute` に注入しないと呼ばれない。`guide.mjs` は読み込むだけで gh やキーチェーンを呼ぶので、単体テストが無い。この 2 か所は差分を読んで確かめる。引数の解析だけは、テストできるよう `args.mjs` の `parseArgs` に切り出してある（#331）。

## Formal Spec の gate は、to-tickets を出す分岐にだけ掛ける

[Formal Spec コメント](../../GLOSSARY.md)は、viewer の最後のコメントの 1 行目だけを `lastFormalSpec` で一度だけ分類する。判断依頼（failed）と to-tickets の条件（passed・対象外）は、どちらもこの結果を読む。2 か所で別々に解釈させないため。

この条件は to-tickets を出す遷移にだけ足し、takt-sequence・knowledge・merge-auto には足していない（#333）。人が作った親 issue の仕様を、Formal Spec コメントが無いという理由で止めないため。to-tickets を起動済みの古い仕様にも、formal-spec を起動しない。

## hook の入力待ちを観測した grilling の ticket は、判断の問いを読み直す

スナップショットは GitHub を読んでから（`snapshot.mjs` の `readIssues`）Orca を観測する（`observeSession`）。grilling は「[判断の問い](../../GLOSSARY.md)を書く → AskUserQuestion」の順に動くので、この 2 つが GitHub の読み取りと Orca の観測のあいだに起きると、判断依頼には古い問いか「（問いの記録が ticket に無い）」が載る。送った印が残るので、同じ停止には二度と送り直されない。

#349 では ai-antipattern-review がこれを見つけ（裁定で GR-Q-STALE）、`grillingQuestionsToRefresh` で「grilling で、hook の入力待ちで、まだ送っていない停止」の ticket だけコメントを読み直す形にした。この修正だけで 5 iteration・約 19 分かかった。その前の replan は「手順に従ったセッションなら問いは既にある」と判断したが、取得順のためにその前提は成り立っていなかった。2 つの情報源を順に読む遷移を足すときは、間に書かれたものを取りこぼさないかを先に確かめる。問いを Orca から取らない理由は [ADR 0002](../adr/0002-grilling-writes-question-before-asking.md)。

## 判断の回答は判断依頼への返信で受け、仮決めの差し戻しは ❌ で受ける

Bot は特権インテント（MESSAGE_CONTENT）を持たないので、Bot をメンションしていないメッセージの本文は読めない。回答は本文が要るので、判断依頼のメッセージ M への返信（`GET /channels/<thread>/messages?after=<M>&limit=100` を `message_reference.message_id === M` で絞る）として受け、判断依頼の本文に「メンションの無い返信は読めません」と書く。map のスレッドは共有で 100 件を超えうるので、100 件返る間は最後の ID から続きを読む。[仮決めの差し戻し](../../GLOSSARY.md)は本文が要らないので、承認と同じくリアクション（本人の ❌）にし、Bot が ❌ を先に付けておく（#349・#351）。

どちらも実 Discord では確かめていない。#349〜#351 のテストはすべて偽の `fetch`・`execFile`・`orca` で通したもので、`guide/SKILL.md` の「確認が取れていない点」に残っている。

## 回答の流し込みは、`agentWait.since` と 1 行の `orca terminal send` に頼っていて、どちらも実機で確かめていない

判断依頼・書き戻し・流し込みの印は、hook の入力待ちの `agentWait.since` を停止の識別子 S にしている（`案内役: Discord に判断依頼を送る（#t grilling の問い S）`、閉じ括弧まで照合）。同じ入力待ちのあいだに since が変わると、判断依頼が重なる。

流し込みは `orca terminal send --terminal <h> --text <回答> --enter --json` で、回答の改行は空白にして 1 行で送る（`execute.mjs`）。改行のまま送ると TUI の入力が途中で確定するおそれがあるため。改行つきの元の回答は、GitHub の書き戻しのコメントに残る。AskUserQuestion の選択画面に送った文字が回答として通るかは、まだ確かめていない。live-mindmap で 1 回流すときは、この 2 点を最初に見る。

## 仮決めは閉じた ticket に載るので、map の子のコメントは状態を問わず読む

wayfinder は resolution コメントを書いた直後に ticket を閉じる。#350 の前の `github.mjs` は open な子のコメントしか読まず、テストも「closed な子の comments は読まない」を固定していたので、そのままでは[仮決め](../../GLOSSARY.md)が 1 件も読めなかった。今は、コメントは全ての子から、blocked_by は open な子だけから読む。閉じた子の数だけ読み取りが増えるので、差し戻しのリアクションも閉じた ticket の分だけ毎周読む。

## 仮決めの読み取りは、1 件でも形から外れたらそのコメントからは 1 件も読まない

`## 仮決め` 節は、`### <問い>` ごとに `- 答え:`・`- 振り分け:`（⓪ か ③）・`- 理由:`・`- 根拠:` の 4 行がこの順に並ぶ（正本は `wayfinder/SKILL.md`）。#350 では、形から外れた仮決めを部分的に拾うより、そのコメントを丸ごと掲載しない方を選んだ。誤った仮決めを流すと、人が差し戻すかどうかの判断を誤るため。最初の `###` より前に本文がある節、閉じていないコードフェンス（開いた記号と同じ記号でだけ閉じたと数える）も 0 件にする。Discord の 2000 文字に収めるため、短い項目から順に文字数を割り当て、題名・リンク・番号は切らない。

## 開き直した ticket は、差し戻しの書き戻しの印で回を区切り、起動と観測の両方を切り替える

開き直した ticket には前の回の起動の印が残っているので、そのままでは新しいセッションが起動しない。前の回の handle を観測すると、閉じたタブとして `found: false` になり、「見つからない」の誤った判断依頼が出る。#351 では、最後の `案内役: Discord で仮決めが差し戻された（#t 仮決め n）` より後の印だけを今の[回](../../GLOSSARY.md)として数える `currentCycle` を作り、起動の判定（dispatched の key は初回 `wayfinder:t`、開き直した後は `wayfinder:t:k`）と `ticketSessionsToObserve` の両方がこれを使う。境界を 2 か所で別々に数えると食い違う。開き直しの印を別に設ける案は、解き直して再び閉じた状態と区別できないので捨てた。

差し戻しは「書き戻しの印 → `state=open` → assignee を外す」を 1 つの行動にし、同じ ticket の複数の仮決めは 1 回にまとめる。1 件ずつ扱うと 2 件目が次の回に回り、新しいセッションがその差し戻しを知らないまま解いてしまう。

## task の ticket を開き直すと、worktree 名 `wayfinder-<ticket>` が前の回と衝突しうる

task のセッションは `orca worktree create --name wayfinder-<ticket>` で作った worktree で起動する（`wayfinder.mjs`）。開き直した task を新しい回で起動すると、前の回の worktree が残っていれば同じ名前になる。`orca worktree create` が既にある名前で失敗するのか、別名で作るのか、再利用するのかは確かめていない。#351 の companion が should_fix として指摘したが、implement は「設計判断が要る」として直さず、マージ後に追う issue も無い。task の差し戻しを初めて流すときに、`orca worktree create` の応答を見る。

## 差分の無い takt の run は PR ができず、別の ABORT があると takt-sequence の停止も知らせない

実験や調査だけの ticket は、takt の run が completed でも repo に差分が無く、PR が作られない。takt-sequence はこれを `PR なし`（人の手が要る）として扱い、閉じるのは人になる。案内役の `decideSequenceStalls` は、open な sub-issue のどれかが実行中か、最新のタスクが failed なら何も出さない。#352 は 07:15Z に completed で終わったが、同じ親の #348 が failed だったので判断依頼は出ず、人が報告をコメントに写して閉じたのは約 7 時間後の 14:22Z だった。成果物（`dbt/`）は `.takt/runs/…/reports` の中にしか無く、takt-cleanup で消える。差分の無い ticket は、報告を issue のコメントに写して閉じるところまでを本文に書いておく。

## review-fix は実機で 1 度も起動していないので、最初の 1 回は確かめる点を先に決めておく

仕様 #357 の 4 本の PR（#366・#370・#373・#374）は、どれも PR の評価を通った。#374 は評価が REJECT したが、評価の中の fix で直して push し、そのまま通った（[takt の知識文書](takt.md#同じ規則を別のファイルにもう一度書く-ticket-では正本の場所を本文に書く)）。`TAKT evaluation failed` のコメントが付くのは、評価が自分の fix のループで直しきれなかったときだけなので、[修正のセッション](../../GLOSSARY.md)が起動する場面は、仕様が想定したより少ない。親 issue #359 の完了条件 2（修正の push かやり直しの印で、レビューし直してマージまで進むのを 1 回確かめる）は、2026-10-18 時点で満たしていない。

確かめていないのは次の点で、`guide/SKILL.md` の「確認が取れていない点」にも一部が残っている。

- `orca worktree create --base-branch origin/<branch>` が作るローカルブランチの名前。Orca は worktree のブランチを改名することがあり、同名のローカルブランチを作るなら 2 回目の create が失敗する
- `orca worktree create --json` の応答の `result.worktree.path`（`wayfinder.test.mjs` と同じ形だと仮定しただけ）
- `takt-node.sh merge-tasks.mjs` の出力（TaskRunner の `data.merge_task`・`data.pr_number`・`runSlug`）。1 度も実行しておらず、takt 0.71.0 のコードを読んだだけ。空を返すと、判断依頼とプロンプトのレポートの場所が常に「（merge タスクの記録なし）」になる
- 実際の run の `review-resolution.md` の `## 結果:` と `## 判定不能の理由` の形
- `gh pr view --json comments` の `createdAt`。欠けると takt-sequence の待ち時間の比較が NaN になり、段階が stuck に倒れる

review-fix の worktree（`review-fix-<PR>-<head の先頭 7 桁>`）を片付ける処理はどこにも無く、起動のたびに残る。

## 証跡を PR に載せてやり直しを頼む分岐は、PR の評価が PR を読めない今は、判断依頼で終わる見込み

`references/review-fix.md` の「証跡が無い」の分岐は、証跡を PR の本文かコメントに載せ、[やり直しの印](../../GLOSSARY.md)を付ける。takt-sequence はそれを見てレビューを起動し直す。ところが、PR の評価は `gh` を実行できず、PR の本文もコメントも読んでいない（[takt の知識文書](takt.md#pr-の評価は-gh-を実行できずpr-の本文もコメントも読まないので証跡は差分に入れる)）。そのため、やり直しても同じ理由で失敗し、「やり直し後の失敗」として判断依頼になると読める。実機ではまだ起きていない。この分岐を効かせるには、評価の run で `gh pr view` を許可するか、証跡を差分（テストやファイル）に入れる形に分岐を変える。

## review-fix の印と照合は `takt/scripts/review-stage.mjs` が正本で、案内役は書き直さずに import する

印の文言（`fixLaunchingMarker`・`fixLaunchedMarker`・`redoMarker`）、照合（`fixLaunchingHead`・`fixLaunchedHead`・`redoHead`）、上限（`FIX_LAUNCH_LIMIT` = 2）は、takt 側の `review-stage.mjs` に置き、`decide.mjs` が import する（#360・#361）。依存の向きは、もとから案内役 → takt（`takt.mjs` が `takt-list.mjs` を import していた）なので、逆向きを作らない。`decide.mjs` の「import を持たない」原則はここで崩していて、冒頭のコメントもそう書き直してある。

印をどれで数えるかは、印ごとに違う。

| 印 | 数え方 |
| --- | --- |
| やり直しの印 | head ごとに最初の 1 つ（`find` / `findIndex`） |
| 2 段目の起動の印（観測する handle） | 最後のもの（`.at(-1)`） |
| 起動の回数（上限） | head を問わず、1 段目の印の数。2 段目は数えない |

`reviewStage`（takt-sequence）と `classifyReviewPullRequest`（案内役）は、やり直しの印の規則を別々に持っている。#374 では、案内役の側だけが `findLastIndex` で、「やり直し → 失敗 → やり直し」のときに takt-sequence は stuck で止まるのに、案内役は判断依頼を出さなくなっていた。PR の評価が見つけて直した（`CODE-NEW-decide-L987`）。片方を変えたら、もう片方とテストもそろえる。

## review-fix の worktree は、ほかの worktree が head ブランチを持っていれば detach する。偽の git ではこの欠陥が見えない

同じ PR に 2 回目の review-fix を起動すると、前回の worktree が同じローカルブランチを checkout したまま残っている。#361 の最初の実装は `git switch --ignore-other-worktrees --track -C` を無条件に流していたので、2 つの worktree がブランチを共有し、前回の worktree の HEAD と index がずれ、未 push の commit も `-C` のリセットで消えるところだった（`ARCH-NEW-review-fix-L51`。この修正のループに約 24 分）。

今の `launchReviewFix` は、`git worktree list --porcelain` に `branch refs/heads/<branch>` と完全に一致する行があるかで持ち主を判定する。持ち主がいなければ `git switch --track -C <branch> origin/<branch>`、いれば `git switch --detach origin/<branch>` にする。detach のときの push は `git push origin HEAD:<branch>` でしか通らないので、`review-fix.mjs` のプロンプトの頭書きと `references/review-fix.md` の push の指示をそろえておく。

この欠陥は、偽の `git` を注入するテストでは出ない。worktree の作り方を変えるときは、`review-fix.test.mjs` の SCN-P2 の形（本物の git の一時リポジトリ）で確かめる。そのテストは、`GIT_CONFIG_GLOBAL` と `GIT_CONFIG_SYSTEM` を `/dev/null` にし、`commit.gpgsign=false` と `core.hooksPath=/dev/null` を渡して、ユーザーの git の設定を持ち込まない。

## 判断依頼の判定は最新の `review-resolution.md` から読むが、それは final-gate の版のことがある

`takt.mjs` の `readReviewReport` は、merge タスクの run の `reports/` を `.takt-report-internal` を飛ばしてたどり、更新時刻が最も新しい `review-resolution.md` から `## 結果:` と `## 判定不能の理由` を抜く。final-gate は裁定と同じ名前のファイルに書くので、#362 で見た 2 つの run では、読まれるのは final-gate の「# 最終検証結果」だった（[takt の知識文書](takt.md#裁定の原文はfinal-gate-が同じ名前のファイルを上書きするのでhistory-から読む)）。失敗した run の final-gate の版に `## 判定不能の理由` の節があるかは確かめていない。無ければ判断依頼には「（判定不能の理由の記録なし）」が載る。

PR の判断依頼の行動は、`issue` に PR の番号を持ち（URL は `/issues/<PR>`）、sub-issue は `subIssue` で渡す。`execute.mjs` は `action.pr` があるときだけレポートを読み、`discord.mjs` も `pr` の有無で本文を切り替える。#362 の plan は、本文の項目（sub-issue・判定・判定できなかった理由・レポートの場所）を 3 つのレビュー失敗の経路だけにかかると狭め、companion の指摘も範囲外にしていた。review が 3 観点で REJECT し、review-fix のセッションの停止の判断依頼にも同じ項目を足した。「既存の停止の観測にそろえる」は観測のことで、本文の項目を省く根拠にはならない。

## 出典

- 仕様 [#306](https://github.com/daiki-beppu/dotfiles/issues/306)、親 issue [#344](https://github.com/daiki-beppu/dotfiles/issues/344)
- [#345](https://github.com/daiki-beppu/dotfiles/issues/345) / [#356](https://github.com/daiki-beppu/dotfiles/pull/356)（frontier の ticket の起動）、[#347](https://github.com/daiki-beppu/dotfiles/issues/347) / [#358](https://github.com/daiki-beppu/dotfiles/pull/358)（map のスレッドと人が見る ticket）、[#349](https://github.com/daiki-beppu/dotfiles/issues/349) / [#365](https://github.com/daiki-beppu/dotfiles/pull/365)（判断依頼と流し込み）、[#350](https://github.com/daiki-beppu/dotfiles/issues/350) / [#367](https://github.com/daiki-beppu/dotfiles/pull/367)（仮決めの掲載）、[#351](https://github.com/daiki-beppu/dotfiles/issues/351) / [#368](https://github.com/daiki-beppu/dotfiles/pull/368)（仮決めの差し戻し）、[#352](https://github.com/daiki-beppu/dotfiles/issues/352)（振り分けの効き目の実験）
- 各 PR の takt の run（`takt-worktrees/20261017T0500-345-…`・`…0607-345-…`・`…0715-347-…`・`…0902-349-…`・`…1018-350-…`・`…1112-351-…`・`…0642-352-…` の `.takt/runs/*/`）
- 仕様 [#325](https://github.com/daiki-beppu/dotfiles/issues/325)、親 issue [#329](https://github.com/daiki-beppu/dotfiles/issues/329)
- [#330](https://github.com/daiki-beppu/dotfiles/issues/330) / [#335](https://github.com/daiki-beppu/dotfiles/pull/335)（to-tickets の Orca 起動）
- [#331](https://github.com/daiki-beppu/dotfiles/issues/331) / [#337](https://github.com/daiki-beppu/dotfiles/pull/337)（セッションの停止の観測）
- [#332](https://github.com/daiki-beppu/dotfiles/issues/332) / [#338](https://github.com/daiki-beppu/dotfiles/pull/338)（knowledge の Orca 起動）
- [#333](https://github.com/daiki-beppu/dotfiles/issues/333) / [#339](https://github.com/daiki-beppu/dotfiles/pull/339)（formal-spec と to-tickets の gate）
- 各 PR の takt の run（`takt-worktrees/20261017T0114-330-…`・`…0146-331-…`・`…0237-332-…`・`…0306-333-…` の `.takt/runs/*/reports/`）
- 仕様 [#357](https://github.com/daiki-beppu/dotfiles/issues/357)、親 issue [#359](https://github.com/daiki-beppu/dotfiles/issues/359)
- [#360](https://github.com/daiki-beppu/dotfiles/issues/360) / [#370](https://github.com/daiki-beppu/dotfiles/pull/370)、[#361](https://github.com/daiki-beppu/dotfiles/issues/361) / [#373](https://github.com/daiki-beppu/dotfiles/pull/373)、[#362](https://github.com/daiki-beppu/dotfiles/issues/362) / [#374](https://github.com/daiki-beppu/dotfiles/pull/374)、[#363](https://github.com/daiki-beppu/dotfiles/issues/363) / [#366](https://github.com/daiki-beppu/dotfiles/pull/366)
- 各 ticket の takt の run（`takt-worktrees/20261017T0821-360-…`・`…1443-360-…`・`…0950-363-…`・`…1519-361-…`・`…1631-362-…` の `.takt/runs/*/`）と、PR の評価の run（`.takt/runs/20261017-*-evaluate-pull-request-{356,366,370,373,374}-usin/`）
