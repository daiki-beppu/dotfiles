---
name: guide
description: 仕様（spec ラベル）の承認依頼を Discord に送り、承認済み（spec-approved ラベル）の仕様を to-tickets から takt-sequence まで流し、流れが止まったら（sub-issue の takt の run が ABORT、formal-spec の検証失敗、起動したセッションが結果を出さないまま停止、または takt-sequence が sub-issue を残したまま停止）仕様のスレッドへ判断依頼を送り、open な wayfinder の map の frontier にある research・grilling・task の ticket ごとに `/wayfinder` のセッションを Orca のタブに起動し、map ごとの Discord スレッドへ prototype の ticket（人が見る ticket）を知らせ、起動した ticket のセッションが止まったらそのスレッドへ判断依頼を送り、grilling の不可逆な判断の問い（AskUserQuestion）には問いつきの判断依頼を送って、本人の Discord の返信を ticket に書き戻し、止まっていたタブへ流し込む常駐スクリプト「案内役」を動かす依頼に使う。
---

# 案内役

ローカルに常駐する独立スクリプト（takt のワークフローではない）。一定の間隔で GitHub と takt から状態を読み、`scripts/decide.mjs` の純粋な関数（LLM を使わず、ラベルと状態だけで決める）で次の行動を決め、アダプタで実行する。

| 状態 | 行動 |
| --- | --- |
| open な `spec` があり、承認依頼をまだ送っていない | Discord に repo 名のチャンネル（無ければ作る）とスレッドを立て、題名と issue のリンクを送る |
| 承認依頼を送り済みで、本人の ✅ だけが付いている（`spec-approved` なし） | `spec-approved` ラベルを付ける（repo に無ければ GitHub が作る） |
| 承認依頼を送り済みで、本人の ❌ だけが付いている（差し戻しコメントなし。`spec-approved` の有無は問わない） | 差し戻しのコメントを書く |
| 承認依頼を送り済みの open な仕様で、viewer の formal-spec の印（`案内役: formal-spec を起動する` か `案内役: formal-spec を起動した…`）がなく、to-tickets を起動済み（起動の印か終了の印）でもない。承認（`spec-approved`）は待たない | `orca agent launch --agent claude` で Orca のタブ（題名 `formal-spec #n`）に `formal-spec` を対話セッションとして起動する。確認待ちにせず結果のコメントまで進める。毎回起動する。結果は仕様の Formal Spec コメントで判定する |
| `spec` と `spec-approved` が付いた open な仕様があり、その親 issue（本文に `仕様: #n` だけの行があり、sub-issue を持つ）がなく、viewer の最後の Formal Spec コメントが passed（1 行目が `## Formal Spec（… で passed）`）または対象外（1 行目が `## Formal Spec（対象外）`）。Formal Spec コメントが無いか最後が failed なら待つ。to-tickets を起動済みの古い仕様は従来どおり | `orca agent launch` で Orca のタブに `to-tickets` を対話セッションとして起動する（タブ題名 `to-tickets #n`）。親 issue と sub-issue ができたら終わりで、終了コードは見ない |
| 親 issue と sub-issue がそろい、まだ takt に渡していない | open な sub-issue を `takt-sequence` に渡す（Orca の新しいタブ、題名 `takt sequence <owner/repo>`）。takt-sequence の後に `案内役: takt-sequence が終わった（exit N）` の行を出させる（タブはシェルに戻るだけで閉じないので、終わったことはこの行で見分ける） |
| 承認済みの open な仕様の親 issue の sub-issue がすべて closed で、学びの PR（viewer が作り、本文に `学びの元の仕様: #n` だけの行がある PR。状態は問わない）がまだなく、knowledge の起動の印もない | `orca agent launch --agent claude` で Orca のタブ（題名 `knowledge #n`）に `knowledge` を対話セッションとして起動する（devlog は起動しない）。終わるまで待たない。学びの PR ができたら、次の周以降に下の行で自動マージを予約する |
| 同じ条件で、学びの PR が OPEN で自動マージが未予約（起動の印の有無は問わない。起動した周の次以降の通常の経路） | knowledge は起動せず、`gh pr merge <N> --auto --squash` だけを実行する |
| open な `wayfinder:map` の子（sub-issue）で、open・unblocked（open なブロッカーなし）・未 claim（assignee なし）の ticket が、`wayfinder:research`・`wayfinder:grilling`・`wayfinder:task` のどれかのラベルを持ち、viewer の wayfinder の印（`案内役: wayfinder を起動する` か `案内役: wayfinder を起動した…`）がない。prototype の ticket には起動しない。frontier が複数なら同じ周でそれぞれに起動する | ticket ごとに新しいセッションを `orca agent launch --agent claude` で Orca のタブ（題名 `wayfinder #t`）に対話セッションとして起動する。プロンプトは `/wayfinder #<map> #<ticket>`。task は `git fetch origin` の後に `orca worktree create --base-branch origin/main`（名前 `wayfinder-<ticket>`）で作った worktree で、research と grilling は対象 repo の main checkout で起動する。起動したセッションの停止は下の行で扱う |
| open な `wayfinder:map` に、知らせること（下の 2 行のどちらか）があり、viewer の map のスレッドの印（`案内役: Discord に map のスレッドを立てる` か `案内役: Discord に map のスレッドを立てた…`）がない | repo 名のチャンネル（承認依頼と同じ）に、題名 `#<map> <map の題名>` の公開スレッドを立て、スレッドの ID を map に印で残す。この周は通知も判断依頼も出さず、次の周以降に出す。1 段目の印だけがあるときは何も出さない |
| open な `wayfinder:map` のスレッドがあり、frontier（open・unblocked・未 claim）に `wayfinder:prototype` の ticket があり、map に `案内役: Discord に人が見る ticket を知らせる（#t）` がない。人が assign した prototype（frontier の外）には出さない。セッションは起動しない | map のスレッドに「人が見る ticket」として ticket の題名とリンクを送る。ticket ごとに 1 度だけ |
| open な `wayfinder:map` のスレッドがあり、その子で open の ticket に handle つきの wayfinder の起動の印があり、セッションが止まった（① handle のセッションが Orca に見つからない ② 入力待ち ③ 起動から `--stall-minutes` 分経った。この順で理由を 1 つ選ぶ。ticket が閉じていれば観測も判断依頼もしない。grilling が hook の入力待ちで止まっているときは下の 3 行で扱い、この行は出さない） | map のスレッドに、ticket・タブの名前（`wayfinder #t`）・画面の最後の 10 行・理由を送る。原因（`<ticket の種類> のセッションの停止`）ごとに 1 度だけ。印は map に書く |
| open な `wayfinder:map` のスレッドがあり、その子で open の `wayfinder:grilling` の ticket に handle つきの wayfinder の起動の印があり、そのセッションが hook の入力待ち（`orca terminal show` の `agentWait` が `{source:"hook", since:S}`。AskUserQuestion の問い）で、ticket に `案内役: Discord に判断依頼を送る（#t grilling の問い S）` も送った印もない。過去に `grilling のセッションの停止` の印が map にあっても出す。research・task、hook 以外の入力待ち、見つからない、時間切れは従来の停止の判断依頼のまま | map のスレッドに、ticket の題名・リンク・問いの中身（ticket の最後の `## 判断の問い` コメント。無ければ「（問いの記録が ticket に無い）」）・画面の最後の 10 行・タブの名前を送り、このメッセージへの返信で答えるよう促す。同じ停止（S）では 1 度だけ。同じ停止で停止の判断依頼は重ねて出さない。印は ticket に書く |
| 判断依頼を送った印（メッセージ M つき）があり、同じ S の書き戻しの印がなく、M への返信（`message_reference`）に本人（`guide.discord.user-id`）の本文が空でないものがある | 本人の最も古い返信の本文を、ticket のコメントとして書き戻す（1 行目が印、空行、回答）。本人以外の返信は書き戻さない。S ごとに 1 度だけ |
| 同じ S の書き戻しの印があり、流し込みの印がなく、起動の印の handle のタブがまだ同じ S の hook の入力待ちである | 書き戻しコメントの本文（GitHub だけを読む。Discord の返信は読まない）を、`orca terminal send --terminal H --text … --enter` でそのタブへ流し込む。改行は空白にして 1 行で送る。セッションは作り直さない。S ごとに 1 度だけ。タブが別の入力待ち（S が違う）になっていれば流し込まない |
| 承認依頼を送り済みの open な仕様で、承認済みなら親の open な sub-issue の最新の takt タスク（`createdAt` が最も新しいもの）が `failed`（ABORT）、または仕様の最後の Formal Spec コメントが failed | 承認依頼のスレッドに、止まった issue・理由・takt のレポートの場所（`<worktreePath>/.takt/runs`、検証失敗なら検証器の作業ディレクトリ）を送る。原因ごとに 1 度だけ |
| 承認依頼を送り済みの open な仕様で、起動の印に handle がある工程（to-tickets など）の結果が GitHub に無く、セッションが止まった（① handle のセッションが Orca に見つからない ②入力待ち（確認・許可）③ 起動から `--stall-minutes`（既定 60）分経った。この順で理由を 1 つ選ぶ） | 承認依頼のスレッドに、工程・仕様・タブの名前（`<工程> #n`）・画面の最後の 10 行・理由を送る。結果は to-tickets なら仕様を指す親 issue、knowledge なら学びの PR、formal-spec なら viewer の Formal Spec コメント。印に handle が無い工程は観測しない。原因（`<工程> のセッションの停止`）ごとに 1 度だけ |
| 承認依頼を送り済みの open な仕様の親に handle つきの takt-sequence の起動の印があり、渡した sub-issue のうち open なものが残り、そのどれにも takt の `pending`・`running` のタスクも最新が `failed` のタスクも無く、takt-sequence が止まった（① タブが Orca に見つからない ② 画面の最後の 10 行に `案内役: takt-sequence が終わった` の行がある。この順で理由を 1 つ選ぶ。時間切れと入力待ちは見ない） | 承認依頼のスレッドに、親・open のまま残った sub-issue・タブの名前・画面の最後の 10 行・理由を送る。自動で起動し直さない。原因 `takt-sequence のセッションの停止`（N は親）で 1 度だけ。handle の起動の印が無い（古い形の）親は観測しない |

## 使い方

対象 repo の root（main checkout）で流す。

```sh
node <skill>/scripts/guide.mjs <owner/repo> [--interval 60] [--from <仕様の issue 番号>] [--stall-minutes 60] [--dry-run]
```

- `--stall-minutes <n>`: 起動したセッションが結果を出さないまま、起動からこの分数が経ったら止まったとみなす（既定 60。正の数）。入力待ちと、セッションが見つからないときは時間によらず止まったとみなす。
- `--from <n>`: 番号が n 以上の仕様だけを扱い、それより前の仕様には承認依頼も後続の行動も出さない。手で起票し終えた仕様が残っている repo に向けるとき、新しい仕様だけを流すのに使う（指定しなければ open な仕様をすべて扱う）。

- `--dry-run`: 1 周だけ読み、観測した要約と行動を表示して終わる。GitHub への書き込みも子プロセスの起動もしない。
- 前提: `gh` が認証済み。キーチェーン（アカウントは `$USER`）に `guide.discord.bot-token` / `guide.discord.guild-id` / `guide.discord.user-id` がある（`security find-generic-password -a "$USER" -s <名前> -w` で読む）。Bot は guild に参加し、チャンネルの管理・リアクションの追加・公開スレッドの作成・スレッド内の送信・メッセージ履歴の閲覧の権限を持つ。特権インテントは使わない。実行モードでは加えて `takt watch` が動いていて、`orca` と `claude` がある。Orca が起動していて、対象 repo の main checkout が Orca に登録済みで、`orca agent launch --agent claude` が使える（formal-spec・to-tickets・knowledge・wayfinder の起動に使う）。wayfinder の task の起動には `orca worktree create` と `git fetch origin` も使う。
- cwd の repo が引数と違うか、キーチェーンの値がない（無い名前を表示する）と終了コード 2、行動の実行が失敗すれば終了コード 1 で止まる。

## 状態

state ファイルは持たない。済んだ行動は GitHub のコメント（`gh` の認証ユーザーが書き、本文が次の接頭辞で始まるもの）で表す。毎周読み直すので、止めて流し直しても続きから動く。

| コメント | 書く先 | 意味 |
| --- | --- | --- |
| `案内役: Discord に承認依頼を送る` | 仕様 | 承認依頼を送る前に書く。これがある仕様には再送しない |
| `案内役: Discord に承認依頼を送った（スレッド T / メッセージ M）` | 仕様 | 送り済み。T と M のメッセージのリアクションを毎周 REST で読む |
| `案内役: Discord で差し戻された` | 仕様 | 差し戻しを記録した。これがある仕様には繰り返さない |
| `案内役: formal-spec を起動する` | 仕様 | 起動する前に書く（1 段目）。これがある仕様には formal-spec を出さない。起動の成否が不明でも二重に起動しない |
| `案内役: formal-spec を起動した（ターミナル H / T）` | 仕様 | 起動した後に書く（2 段目。H は handle、T は起動時刻）。結果は Formal Spec コメントで判定し、結果が無いままセッションが止まれば停止の観測の対象になる |
| `## Formal Spec（takt <版> の検証器で passed）` で始まる 1 行目のコメント | 仕様 | 検証が通った。viewer の最後の Formal Spec コメントがこれなら to-tickets を出せる |
| `## Formal Spec（対象外）` で始まる 1 行目のコメント | 仕様 | 形式化する価値が無い仕様。理由が 2 行目以降に続く。viewer の最後の Formal Spec コメントがこれでも to-tickets を出せる |
| `案内役: to-tickets を起動する` | 仕様 | 起動する前に書く（1 段目）。これがある仕様には to-tickets を出さない。起動の成否が不明でも二重に起動しない |
| `案内役: to-tickets を起動した（ターミナル H / T）` | 仕様 | 起動した後に書く（2 段目）。H は `orca agent launch --json` の応答の `result.outcome.handle`、T は起動時刻（ISO 8601）。handle が応答から取れなければ書かずに案内役が止まる。終わりはこの印ではなく、仕様を指す親 issue ができたかで判定する（判定は時刻を読まない） |
| `案内役: to-tickets を起動した`（「（ターミナル」が続かない。古い版の印） | 仕様 | 読み取りだけ残す。これがある仕様には to-tickets を出さず、親は takt に渡さない |
| `案内役: to-tickets が終わった（exit N）`（古い版の印） | 仕様 | 読み取りだけ残す。exit 0 の親は takt に渡し、exit 0 以外の親は渡さない。to-tickets は出さない |
| `案内役: Discord に判断依頼を送る（#N 原因）` | 仕様（wayfinder の ticket の停止は map） | 判断依頼を送る前に書く。原因は `takt の ABORT`、`formal-spec の検証失敗`、または `<工程> のセッションの停止`（例: `to-tickets のセッションの停止`、`takt-sequence のセッションの停止`）。N は止まった issue（takt-sequence の停止なら親、wayfinder の ticket の停止ならその ticket）。これがあれば同じ組は再送しない |
| `## Formal Spec（takt <版> の検証器で failed）` で始まる 1 行目のコメント | 仕様 | formal-spec が失敗で止まるときに書く。viewer の最後の Formal Spec コメントが failed なら検証失敗とみなす。`検証器の作業ディレクトリ: <path>` の行をレポートの場所に使う |
| `案内役: takt-sequence に渡した #a #b` | 親 | 起動する前に書く（1 段目）。これがある親は渡さない。#a #b が停止の観測で「渡した sub-issue」になる |
| `案内役: takt-sequence を起動した（ターミナル H / T）` | 親 | 起動した後に書く（2 段目）。H は `orca terminal create --json` の応答の `result.terminal.handle`、T は起動時刻。これがある親だけ takt-sequence の停止を観測する。最後の印の handle を見る |
| `案内役: <工程> を起動した（ターミナル H / T）` | 仕様 | to-tickets 以外の工程でも、Orca のタブで起動して handle を印に書けば、同じ形で停止の観測の対象になる（H は handle、T は起動時刻。起動時刻はこの印から読む） |
| `案内役: wayfinder を起動する` | wayfinder の ticket | 起動する前に書く（1 段目）。map ではなく起動する ticket に書く。これがある ticket には起動を出さない。起動の成否が不明でも二重に起動しない |
| `案内役: wayfinder を起動した（ターミナル H / T）` | wayfinder の ticket | 起動した後に書く（2 段目）。H は `orca agent launch --json` の応答の `result.outcome.handle`、T は起動時刻（ISO 8601）。これがある ticket には起動を出さない。この印がある open な ticket は、停止の観測の対象になる（種類のラベルが research・grilling・task のもの。最後の印の handle を見る）。結果は ticket が閉じたこと |
| `案内役: Discord に判断依頼を送る（#t grilling の問い S）` | wayfinder の grilling の ticket | 問いつきの判断依頼を送る前に書く。t は ticket、S は停止の識別子（`agentWait.since`）。閉じ括弧まで照合する。これがあれば同じ S には再送しない（送信が失敗しても再送しない） |
| `案内役: Discord に判断依頼を送った（#t grilling の問い S / スレッド T / メッセージ M）` | wayfinder の grilling の ticket | 送った後に書く。M への本人の返信を毎周 REST で読む（書き戻し前の間だけ） |
| `案内役: Discord の回答を書き戻した（#t grilling の問い S）` | wayfinder の grilling の ticket | 1 行目が印、空行の後が回答の本文。これがあれば書き戻さない。流し込みの回答はこのコメントの本文から作る |
| `案内役: 回答をタブに流し込む（#t grilling の問い S）` | wayfinder の grilling の ticket | `orca terminal send` の前に書く。これがあれば再送しない |
| `## 判断の問い` で始まる 1 行目のコメント | wayfinder の grilling の ticket | grilling のセッションが AskUserQuestion の前に書く（問い・選択肢・推奨）。判断依頼の本文に載せる。最後のものを読む |
| `案内役: Discord に map のスレッドを立てる` | wayfinder の map | スレッドを立てる前に書く（1 段目）。これがある map には再作成しない。作成の成否が不明でも二重に立てない |
| `案内役: Discord に map のスレッドを立てた（スレッド T）` | wayfinder の map | 立てた後に書く（2 段目）。T がスレッドの ID。通知と判断依頼の送り先 |
| `案内役: Discord に人が見る ticket を知らせる（#t）` | wayfinder の map | prototype の ticket t を知らせる前に書く。閉じ括弧まで照合する。これがあれば再送しない |
| `案内役: knowledge を起動する` | 仕様 | 起動する前に書く（1 段目）。これがある仕様には knowledge を出さない。起動の成否が不明でも二重に起動しない |
| `案内役: knowledge を起動した（ターミナル H / T）` | 仕様 | 起動した後に書く（2 段目）。H は `orca agent launch --json` の応答の `result.outcome.handle`、T は起動時刻（ISO 8601）。handle が応答から取れなければ書かずに案内役が止まる |
| `案内役: knowledge を起動した`（「（ターミナル」が続かない。古い版の印） | 仕様 | 読み取りだけ残す。これがある仕様には knowledge を出さない |
| PR 本文の `学びの元の仕様: #n` だけの行 | 学びの PR | knowledge に書かせる。viewer の PR にこの行があれば学びの PR ありとして、二度作らない |
| PR の `auto_merge`（REST。予約済みなら object、未予約なら null） | 学びの PR | 予約済みかどうかの判定に使う。state ファイルは持たず GitHub から読む |

マーカーは起動より先に書く。起動が失敗しても二重に起動しないための順序で、失敗したら案内役は止まる。やり直すときは、該当のマーカーのコメントを消してから流し直す。

親 issue かどうかは、仕様以外の issue が、本文に `仕様: #n` だけの行を持ち、かつ sub-issue を 1 件以上持つかで決める。`to-tickets` を起動するときのプロンプトはこの行を書くよう指示する。人が作った親にも、この行と sub-issue が必要。本文で `#n` に言及するだけの issue は親として数えない。

承認は本人（`guide.discord.user-id`）の ✅ / ❌ だけを受け付ける。押すだけで済むよう、Bot が承認依頼に ✅ / ❌ を先に付けておく（Bot の分は数えない）。✅ と ❌ の両方が付いていれば何もしない。結果は必ず GitHub のラベルかコメントに書き戻し、案内役は GitHub から読む。

## 確認が取れていない点

- Orca の CLI には AskUserQuestion の問いの本文を取り出す口が無い（`agentWait` は source と since だけ）。そのため問いは grilling が ticket に書く `## 判断の問い` のコメントから読む。
- Discord への返信の本文を、特権インテントなしで（Bot をメンションする返信として）REST で読めるか。実 Discord で確かめていない。
- AskUserQuestion の選択画面に `orca terminal send --text … --enter` で送った文字が、回答として通るか。実機で確かめていない。
- 1 つの入力待ちのあいだ `agentWait.since` が変わらないか。実機で確かめていない（変わると同じ停止に判断依頼を重ねうる）。
- アーカイブされた公開スレッドのメッセージのリアクションを REST で読めるか。実 Discord で確かめていない（スレッドは 7 日で自動アーカイブ）。
- アーカイブされた公開スレッドへ判断依頼を Bot が送信できるか。実 Discord で確かめていない。
- 検証器の作業ディレクトリは、takt が 1 時間以上使われていないものを次の検証で消す。判断依頼を読む時点で残っていないことがある。
- `orca agent launch --prompt "/to-tickets #<spec> …"` で渡したスラッシュコマンドが、対話セッションで `disable-model-invocation: true` のスキルとして起動し、起票まで進むか。実起動で確かめていない。
- Orca の Chat UI の設定でチャット（`outcome.kind` が `structured`）として起動したとき、`orca terminal rename` がそのタブに効くか。実機で確かめていない。
- 許可を絞らない対話セッションなので、許可の確認待ちで止まりうる。止まった場合は人がタブで答える（入力待ちは `orca terminal show` の `agentWait` で、手が止まっているか（idle。停止の条件ではない）は `orca terminal wait --for tui-idle` で観測し、時間切れは起動から `--stall-minutes` 分で検知し、仕様のスレッドへ判断依頼を送る。`agentWait` は、Claude が確認の質問（AskUserQuestion）を出している間は `{source:"hook", since}` で、ターンを終えて次の入力を待つだけのときは `null`。後者は入力待ちとして扱わず、時間切れで拾う。ツール実行の許可確認（`prompt-text`・`title` の source）は、許可スキップ設定の環境では出せず未確認）。
- `orca agent launch --prompt "/knowledge …"` の対話セッションが PR 作成まで進むかは、実際の起動で確かめていない。許可については上の記述（許可を絞らない対話セッションは確認待ちで止まりうる）のとおり。
- knowledge への素材は、仕様・親・閉じた sub-issue の番号と、takt list の `worktreePath` 配下の `.takt/runs`。worktree を片付けた後の run は渡せない（issue と PR だけが素材になる）。
- 閉じたタブの handle を `orca terminal show` すると、`terminal_handle_stale` ではなく `ok: true` のまま `connected: false` が返る（2026-10-17 に実機で確認）。観測はどちらも「見つからない」とする。`terminal_handle_stale` が返るのは Orca の再起動後などと見ているが、確かめていない。
- `orca worktree create --json` の応答の `result.worktree.path`（Orca の CLI の実装から読んだ形）と、`/wayfinder #<map> #<ticket>` の引数の解釈は、実機で確かめていない。
- 対象は open な仕様だけ。sub-issue がすべて閉じる前に人が仕様を閉じると、学びの PR は作られない。
