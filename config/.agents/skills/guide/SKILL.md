---
name: guide
description: 仕様（spec ラベル）の承認依頼を Discord に送り、承認済み（spec-approved ラベル）の仕様を to-tickets から takt-sequence まで流し、流れが止まったら（sub-issue の takt の run が ABORT、formal-spec の検証失敗、起動したセッションが結果を出さないまま停止、または takt-sequence が sub-issue を残したまま停止）仕様のスレッドへ判断依頼を送り、main の CI の必須チェックが落ちたら落ちた job を 1 回だけ再実行し、渡した sub-issue の open な PR の現在の head で takt のレビューが失敗したら head ブランチの worktree に修正のセッション（review-fix）を起動し、修正の起動が上限に達した・やり直しの後も失敗した・レビューそのものが落ちた・修正のセッションが結果を出さないまま止まったときは仕様のスレッドへ判断依頼を送り、open な wayfinder の map の frontier にある research・grilling・task の ticket ごとに `/wayfinder` のセッションを Orca のタブに起動し、晴れた map（霧が無く、子がすべて閉じている）からは `to-spec` を Orca のタブに起動し、map ごとの Discord スレッドへ prototype の ticket（人が見る ticket）を知らせ、起動した ticket のセッションが止まったらそのスレッドへ判断依頼を送り、grilling・task が resolution に書いた仮決めは 1 件ずつ map のスレッドへ流し、grilling の不可逆な判断の問い（AskUserQuestion）には問いつきの判断依頼を送って、本人の Discord の返信を ticket に書き戻し、止まっていたタブへ流し込む常駐スクリプト「案内役」を動かす依頼に使う。
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
| 親 issue と sub-issue がそろい、まだ takt に渡していない | open な sub-issue を `takt-sequence` に渡す（Orca の新しいタブ、題名 `takt sequence <owner/repo>`。repo に takt-sequence が既に動いていれば、新しく起動せずその並びに足し、そのペインの handle を起動の印に書く）。takt-sequence の後に `案内役: takt-sequence が終わった（exit N）` の行を出させる（タブはシェルに戻るだけで閉じないので、終わったことはこの行で見分ける） |
| 承認済みの open な仕様の親 issue の sub-issue がすべて closed で、学びの PR（viewer が作り、本文に `学びの元の仕様: #n` だけの行がある PR。状態は問わない）がまだなく、knowledge の起動の印もない | `orca agent launch --agent claude` で Orca のタブ（題名 `knowledge #n`）に `devlog` を対話セッションとして起動し、同じセッションで続けて `knowledge` がそのエントリを振り分ける。この仕様の devlog のエントリがすでにあれば、新しく書かずにそれを素材にする。開発ログと知識文書は 1 本の学びの PR にする。終わるまで待たない。学びの PR ができたら、次の周以降に下の行で自動マージを予約する |
| 同じ条件で、学びの PR が OPEN で自動マージが未予約（起動の印の有無は問わない。起動した周の次以降の通常の経路） | knowledge は起動せず、`gh pr merge <N> --auto --squash` だけを実行する |
| open な `wayfinder:map` の子（sub-issue）で、open・unblocked（open なブロッカーなし）・未 claim（assignee なし）の ticket が、`wayfinder:research`・`wayfinder:grilling`・`wayfinder:task` のどれかのラベルを持ち、viewer の wayfinder の印（`案内役: wayfinder を起動する` か `案内役: wayfinder を起動した…`）がない。印は、その ticket の最後の差し戻しの書き戻しの印（`案内役: Discord で仮決めが差し戻された（#t 仮決め n）`）より後のものだけを数える（開き直した回ごとに 1 度）。prototype の ticket には起動しない。frontier が複数なら同じ周でそれぞれに起動する | ticket ごとに新しいセッションを `orca agent launch --agent claude` で Orca のタブ（題名 `wayfinder #t`）に対話セッションとして起動する。プロンプトは `/wayfinder #<map> #<ticket>`。同じ回の二重起動は dispatched の key（初回 `wayfinder:t`、開き直した回は `wayfinder:t:k`。k は差し戻しの書き戻しの印の数）でも止める。task は `git fetch origin` の後に `orca worktree create --base-branch origin/main`（名前 `wayfinder-<ticket>`）で作った worktree で、research と grilling は対象 repo の main checkout で起動する。起動したセッションの停止は下の行で扱う |
| open な `wayfinder:map`（保留でない）に子（sub-issue）が 1 件以上あり、すべて closed で、本文の `## Not yet specified` 節に中身がなく（HTML コメントと空行は中身に数えない。節がなければ中身なし）、viewer の to-spec の印（`案内役: to-spec を起動する` か `案内役: to-spec を起動した…`）が map にない。frontier が空でも、claim 済み・ブロック中の ticket が open なら待つ。同じ周に差し戻し（下の差し戻しの行）で開き直す子がある map にも出さない（開き直した子が再び closed になってから出す）。子が 0 件の map には出さない | `orca agent launch --agent claude` で Orca のタブ（題名 `to-spec #m`）に `to-spec` を対話セッションとして、対象 repo の main checkout で起動する。プロンプトは `/to-spec #<map>` で、map の Decisions so far と閉じた子 ticket の resolution に仕様の切り方（数・範囲・順・前提の仕様）の決定があればそれに従い、無ければ 1 つ作ること、どの仕様にも `spec` ラベルと本文に `元の map: #m` だけの行を付けること、複数のときは前提の仕様を本文の Further Notes に `前提の仕様: #n` と書くことを指示する。map ごとに 1 度だけ（dispatched の key は `to-spec:m`）。できた仕様は、上の承認依頼の行以降の既存の遷移が拾う。結果の判定は 1 つできた時点で済みとし、残りの仕様はセッションが作り終えるのを人がタブで見る |
| open な `wayfinder:map`（保留でない）に子が 1 件以上あり、すべて closed なのに、本文の `## Not yet specified` 節に中身（霧）が残る。同じ周に差し戻しで開き直す子がある map には出さない | 霧を晴らす `wayfinder:grilling` の ticket（題名 `残った霧を晴らす（<map の題名>）`、本文の Question に霧の行）を起こし、map の sub-issue にする。起こす前に map へ `案内役: 霧の ticket を起こす（子 N 件）`（N はその時の子の数）を書く。次の周から上の wayfinder の行が起動し、不可逆な判断だけが grilling の判断依頼として人に届く。前の霧の ticket の後に別の ticket が増えていれば（N + 1 < 今の子の数）、霧が残っても起こし直す |
| 上の行の map で、前の霧の ticket の後に別の ticket が増えていない（霧の ticket だけが閉じて霧が残った、または起こせなかった） | 起こし直さず、map のスレッドに、map・霧の行・理由を送る（スレッドが無ければ先に立てる）。原因 `霧の残り`（N は map）で 1 度だけ。印は map に書く |
| open な `wayfinder:map` のスレッドがあり、viewer の handle つきの to-spec の起動の印が map にあり、結果の仕様（`spec` ラベルがあり、本文に `元の map: #m` だけの行がある issue。状態は問わない）がまだなく、セッションが止まった（wayfinder の停止と同じ ① 見つからない ② 入力待ち ③ `--stall-minutes` 経過の順） | map のスレッドに、map・タブの名前（`to-spec #m`）・画面の最後の 10 行・理由を送る。仕様がまだ無く承認依頼のスレッドも無いので、仕様のスレッドではなく map のスレッドへ送る（スレッドが無ければ先に立てる）。原因 `to-spec のセッションの停止`（N は map）で 1 度だけ。印は map に書く |
| open な `wayfinder:map` に、知らせること（prototype の通知・仮決め・停止の判断依頼のどれか）があり、viewer の map のスレッドの印（`案内役: Discord に map のスレッドを立てる` か `案内役: Discord に map のスレッドを立てた…`）がない | repo 名のチャンネル（承認依頼と同じ）に、題名 `#<map> <map の題名>` の公開スレッドを立て、スレッドの ID を map に印で残す。この周は通知も判断依頼も出さず、次の周以降に出す。1 段目の印だけがあるときは何も出さない |
| open な `wayfinder:map` のスレッドがあり、frontier（open・unblocked・未 claim）に `wayfinder:prototype` の ticket があり、map に `案内役: Discord に人が見る ticket を知らせる（#t）` がない。人が assign した prototype（frontier の外）には出さない。セッションは起動しない | map のスレッドに「人が見る ticket」として ticket の題名とリンクを送る。ticket ごとに 1 度だけ |
| open な `wayfinder:map` のスレッドがあり、その子 ticket（open・closed を問わない）の viewer の resolution コメントに `## 仮決め` 節があり、仮決め n（節の中の `### 問い` ごと。`- 答え:` `- 振り分け:`（⓪ か ③）`- 理由:` `- 根拠:` の 4 行がこの順）について、ticket に `案内役: Discord に仮決めを流す（#t 仮決め n）` も `案内役: Discord に仮決めを流した（#t 仮決め n / …）` もない。形に合わない resolution（1 件でも外れたコメント）と仮決めの無い resolution には出さない | map のスレッドに、仮決めごとに 1 件、ticket の題名・リンク・判断（問いと答え）・理由・根拠を送る。送る前に印を書き、送った後にスレッドとメッセージの ID つきの印を書く。仮決めごとに 1 度だけ。差し戻しの受け付けは下の差し戻しの行 |
| open な `wayfinder:map`（保留でない）の子 ticket が closed で、ticket に `案内役: Discord に仮決めを流した（#t 仮決め n / スレッド T / メッセージ M）` があり、同じ n の `案内役: Discord で仮決めが差し戻された（#t 仮決め n）` がなく、M への本人（`guide.discord.user-id`）の ❌ がある。本人以外の ❌・本人の ✅ だけでは出ない。ticket が open の間は出さず、閉じてから扱う（閉じた ticket の分だけ M のリアクションを毎周読む） | ticket に差し戻しの書き戻しのコメント（1 行目が印、続けて問いと答え）を仮決めごとに書き、ticket を開き直し（`state=open`）、assignee（claim）を外す。この順で、書き戻しの印は行動より先に書く。同じ ticket の複数の仮決めは 1 件にまとめ、開き直しは 1 回。開き直した ticket は frontier に戻り、上の wayfinder の行が新しい回として新しいセッションを 1 度だけ起動する。停止の観測も、最後の書き戻しより後の起動の印の handle だけを見る |
| open な `wayfinder:map` のスレッドがあり、その子で open の ticket に handle つきの wayfinder の起動の印があり、セッションが止まった（① handle のセッションが Orca に見つからない ② 入力待ち ③ 起動から `--stall-minutes` 分経った。この順で理由を 1 つ選ぶ。ticket が閉じていれば観測も判断依頼もしない。grilling が hook の入力待ちで止まっているときは下の 3 行で扱い、この行は出さない） | map のスレッドに、ticket・タブの名前（`wayfinder #t`）・画面の最後の 10 行・理由を送る。原因（`<ticket の種類> のセッションの停止`）ごとに 1 度だけ。印は map に書く |
| open な `wayfinder:map` のスレッドがあり、その子で open の `wayfinder:grilling` の ticket に handle つきの wayfinder の起動の印があり、そのセッションが hook の入力待ち（`orca terminal show` の `agentWait` が `{source:"hook", since:S}`。AskUserQuestion の問い）で、ticket に `案内役: Discord に判断依頼を送る（#t grilling の問い S）` も送った印もない。過去に `grilling のセッションの停止` の印が map にあっても出す。research・task、hook 以外の入力待ち、見つからない、時間切れは従来の停止の判断依頼のまま | map のスレッドに、ticket の題名・リンク・問いの中身（ticket の最後の `## 判断の問い` コメント。無ければ「（問いの記録が ticket に無い）」）・画面の最後の 10 行・タブの名前を送り、このメッセージへの返信で答えるよう促す（返信のメンション（@）をオンのまま返信するか、Bot をメンションする。メンションの無い返信は本文が届かない）。同じ停止（S）では 1 度だけ。同じ停止で停止の判断依頼は重ねて出さない。印は ticket に書く |
| 判断依頼を送った印（メッセージ M つき）があり、同じ S の書き戻しの印がなく、M への返信（`message_reference`）に本人（`guide.discord.user-id`）の本文が空でないものがある | 本人の最も古い返信の本文を、ticket のコメントとして書き戻す（1 行目が印、空行、回答）。本人以外の返信は書き戻さない。S ごとに 1 度だけ |
| 同じ S の書き戻しの印があり、流し込みの印がなく、起動の印の handle のタブがまだ同じ S の hook の入力待ちである | 書き戻しコメントの本文（GitHub だけを読む。Discord の返信は読まない）を、`orca terminal send --terminal H --text … --enter` でそのタブへ流し込む。改行は空白にして 1 行で送る。セッションは作り直さない。S ごとに 1 度だけ。タブが別の入力待ち（S が違う）になっていれば流し込まない |
| 承認依頼を送り済みの open な仕様で、承認済みなら親の open な sub-issue の最新の takt タスク（`createdAt` が最も新しいもの）が `failed`（ABORT）、または仕様の最後の Formal Spec コメントが failed | 承認依頼のスレッドに、止まった issue・理由・takt のレポートの場所（`<worktreePath>/.takt/runs`、検証失敗なら検証器の作業ディレクトリ）を送る。原因ごとに 1 度だけ |
| 承認依頼を送り済みの open な仕様で、起動の印に handle がある工程（to-tickets など）の結果が GitHub に無く、セッションが止まった（① handle のセッションが Orca に見つからない ②入力待ち（確認・許可）③ 起動から `--stall-minutes`（既定 60）分経った。この順で理由を 1 つ選ぶ） | 承認依頼のスレッドに、工程・仕様・タブの名前（`<工程> #n`）・画面の最後の 10 行・理由を送る。結果は to-tickets なら仕様を指す親 issue、knowledge なら学びの PR、formal-spec なら viewer の Formal Spec コメント。印に handle が無い工程は観測しない。原因（`<工程> のセッションの停止`）ごとに 1 度だけ |
| 承認依頼を送り済みの open な仕様の親に handle つきの takt-sequence の起動の印があり、渡した sub-issue のうち open なものが残り、そのどれにも takt の `pending`・`running` のタスクも最新が `failed` のタスクも無く、takt-sequence が止まった（① タブが Orca に見つからない ② 画面の最後の 10 行に `案内役: takt-sequence が終わった` の行がある。この順で理由を 1 つ選ぶ。時間切れと入力待ちは見ない） | 承認依頼のスレッドに、親・open のまま残った sub-issue・タブの名前・画面の最後の 10 行・理由を送る。自動で起動し直さない。原因 `takt-sequence のセッションの停止`（N は親）で 1 度だけ。handle の起動の印が無い（古い形の）親は観測しない |
| 承認依頼を送り済みの open な仕様の親に viewer の `案内役: takt-sequence に渡した …` の印があり、渡した sub-issue のうち open なものの最新の takt タスクの PR（`prUrl`）が OPEN で、その PR の現在の head H に viewer の `TAKT evaluation failed for head H:` で始まるコメントがあり、H の起動の印（1 段目か 2 段目）もやり直しの印（`案内役: レビューのやり直しを頼む for head H`）も無く、PR の起動回数（head を問わず viewer の 1 段目の印の数）が 2 未満 | `orca worktree create --base-branch origin/<head ブランチ>` で worktree（名前 `review-fix-<PR>-<H の先頭 7 桁>`）を作り、他の worktree が head ブランチを持っていなければ head ブランチを checkout し、持っていれば（前回の review-fix の worktree など）共有もリセットもせず `origin/<head ブランチ>` に detach して（push は `git push origin HEAD:<head ブランチ>`）、`orca agent launch --agent claude` で Orca のタブ（題名 `review-fix #<PR>`）に対話セッションとして起動する。プロンプトは PR・sub-issue・H・レポートの場所（H を扱った merge タスクの run。`<repo root>/.takt/runs/<runSlug>`）と `references/review-fix.md`（コードの指摘は直して push／証跡が無いなら PR に証跡を載せてやり直しの印を付ける／直せないなら理由を PR のコメントに書いて止まる。issue の本文・完了条件・ラベルは変えない）。上限に達した・やり直し後の失敗・レビューそのものが落ちた head には起動せず、次の 3 行の判断依頼を出す |
| 同じ PR の現在の head H に viewer の失敗のコメントがあり、H の起動の印（1 段目・2 段目）もやり直しの印も無く、PR の起動回数が 2 に達した | 仕様のスレッドへ、原因 `takt のレビュー失敗` の判断依頼（種類 `request-review-decision`）を送る。本文は PR・sub-issue・判定（BLOCKED・REJECT など）・判定できなかった理由・PR の URL・レポートの場所・理由。判定と判定できなかった理由は、H を扱った最新の merge タスクの run の `reports/` 以下（`.takt-report-internal` を除く、更新時刻が最も新しい）の `review-resolution.md` の `## 結果:` と `## 判定不能の理由` の節から読む。読めなければ「（レポートに判定が無い）」「（判定不能の理由の記録なし）」とする。印は仕様に書き、N は PR の番号。原因ごとに 1 度だけ |
| 同じ PR の現在の head H にやり直しの印があり、その印より後に viewer の `TAKT evaluation failed for head H:` のコメントがある | 上と同じ判断依頼を送る（review-fix は起動しない） |
| 同じ PR の現在の head H に viewer の完了のコメント（`TAKT review completed for head H;`）も、やり直しの印より後の失敗のコメントも無く、pending・running の merge タスクが無く、H を扱った failed の merge タスク（やり直しの印があればその印より後のもの。作成時刻で比べる）が 2 件以上ある（レビューそのものが落ちた。takt-sequence の stuck と同じ規則） | 上と同じ判断依頼を送る。failed の件数だけでは判定しない（成功・普通の失敗の merge タスクも failed と記録されるため） |
| PR の viewer の 2 段目の印（最後のもの）の handle のセッションが止まった（見つからない → 入力待ち → 起動時刻から `--stall-minutes` 分、の順）。結果が出ていれば観測も判断依頼もしない。結果とは、現在の head が印の head から変わったこと、または印の head にやり直しの印が付いたこと | 仕様のスレッドへ、原因 `review-fix のセッションの停止`、タブ `review-fix #<PR>`、画面の最後の行つきの判断依頼を送る。本文は PR・sub-issue・判定・判定できなかった理由・レポートの場所・理由・工程・タブ・画面の最後の行（判定と判定できなかった理由は、H を扱った最新の merge タスクの `review-resolution.md` から読み、読めなければ「（レポートに判定が無い）」「（判定不能の理由の記録なし）」、merge タスクが無ければレポートの場所は「（merge タスクの記録なし）」）。2000 文字を超えるときに切るのは理由・判定できなかった理由・画面だけ。印は仕様に書き、N は PR の番号。原因ごとに 1 度だけ |
| 扱う仕様か map（保留でない）に、判断依頼を送った後の印（メッセージ M つき。grilling の問いを除く）があり、同じ組の答えた印がなく、M への本人（`guide.discord.user-id`）の返信（本文が空でないもの）か ✅ がある | 判断依頼の印と同じ issue に答えた印を書く。状況の一覧の判断待ちから外すためだけで、他の行動は変えない。本人以外の返信・✅、❌ では書かない。答えた印の無い間だけ M の返信とリアクションを毎周読む |
| 起動の印に handle がある工程・takt-sequence・wayfinder の ticket・to-spec の結果が GitHub に出ていて（wayfinder は ticket が閉じた、to-spec は map の仕様ができた）、判断依頼を送っておらず、閉じた印が無い。タブの手が止まっている（工程は `orca terminal wait --for tui-idle` が満たされる、takt-sequence は画面に終わりの行がある） | `orca terminal close` でタブを閉じ、閉じた印を書く。タブが既に見つからなければ、閉じずに印だけ書く。判断依頼を送ったタブ、formal-spec の最後の結果が failed のタブ、入力待ちのタブは、人が答える場所なので閉じない |
| closed の `spec`（`--from` の範囲内）に viewer の承認依頼を送った印、または closed の `wayfinder:map` に viewer の map のスレッドを立てた印があり、そのスレッド T をアーカイブした印が無い | スレッド T をアーカイブし（`PATCH /channels/T` に `archived: true`。チャンネルの一覧から消える）、アーカイブした印を書く。スレッドが既に消されていれば（404）アーカイブせずに印だけ書く。人がアーカイブを戻しても、印があるので繰り返さない |
| main の最新の commit C（first-parent）の、ruleset の必須チェック（名前は `GET repos/{repo}/rules/branches/main` から読み、repo ごとに書き込まない）のどれかが failure・cancelled・timed_out で、落ちた run R の再実行の印が C に無い。必須チェックが実行中・未登録なら判定しない（次の周で読む）。必須でないチェックの失敗では動かない | 先に再実行の印を C の commit comment に書き、落ちた job を 1 回だけ再実行する（`gh run rerun R --failed`）。再実行で通れば何もしない。再実行でも落ちたままなら繰り返さない。main が赤い間は、状況の一覧のヘッダの次に `main: 赤（<落ちたチェック>）・再実行中` の 1 行を出す。判定は takt スキルの `scripts/main-state.mjs`（takt-sequence と共通）が行う |

`wayfinder:on-hold` ラベルの付いた map は保留として扱い、上の表の map の行（起動・スレッド・通知・観測・判断依頼・差し戻しの書き戻し）のどれも出さない。ラベルを外せば、次の周から扱う。保留中に起動済みのセッションは止めない。

## 使い方

対象 repo の root（main checkout）で流す。

```sh
node <skill>/scripts/guide.mjs <owner/repo> [--interval 60] [--from <仕様の issue 番号>] [--stall-minutes 60] [--dry-run]
```

- `--stall-minutes <n>`: 起動したセッションが結果を出さないまま、起動からこの分数が経ったら止まったとみなす（既定 60。正の数）。入力待ちと、セッションが見つからないときは時間によらず止まったとみなす。
- `--from <n>`: 番号が n 以上の仕様だけを扱い、それより前の仕様には承認依頼も後続の行動も出さない。手で起票し終えた仕様が残っている repo に向けるとき、新しい仕様だけを流すのに使う（指定しなければ open な仕様をすべて扱う）。

- `--dry-run`: 1 周だけ読み、観測した要約・状況の一覧・行動を表示して終わる。GitHub への書き込みも子プロセスの起動もしない。
- ペインの表示: 行動は `実行: <内容>` の 1 行ずつ。状況の一覧（仕様と map ごとに 1 行、`仕様 #n <段階> <詳細> <題名>`）は、行が前と変わった周だけ出し直す。TTY なら最下行に今の段階（読み取り中・判断中・実行中・次の周の時刻つきの待機中）を上書きで出す。段階の判定は `scripts/status.mjs` の表にある。
- 前提: `gh` が認証済み。main の修復は、main の ruleset・check-runs・commit comment を `gh api` で読み、`gh run rerun` を使う。review-fix は `git`、`orca worktree create`、`takt-node.sh`（merge タスクの記録を TaskRunner から読む）を使う。キーチェーン（アカウントは `$USER`）に `guide.discord.bot-token` / `guide.discord.guild-id` / `guide.discord.user-id` がある（`security find-generic-password -a "$USER" -s <名前> -w` で読む）。Bot は guild に参加し、チャンネルの管理・リアクションの追加・公開スレッドの作成・スレッド内の送信・メッセージ履歴の閲覧の権限を持つ。特権インテントは使わない。実行モードでは加えて `takt watch` が動いていて、`orca` と `claude` がある。Orca が起動していて、対象 repo の main checkout が Orca に登録済みで、`orca agent launch --agent claude` が使える（formal-spec・to-tickets・knowledge・wayfinder・to-spec の起動に使う。to-spec スキルが要る）。wayfinder の task の起動には `orca worktree create` と `git fetch origin` も使う。
- cwd の repo が引数と違うか、キーチェーンの値がない（無い名前を表示する）と終了コード 2、行動の実行が失敗すれば終了コード 1 で止まる。ただし `orca terminal close` の失敗は止まらず、`やり直し待ち:` の行を出して閉じた印を書かずに次の周で閉じ直す。

takt watch・align-behind と一緒に立てるときは、`guide.mjs` の代わりに `desk.mjs` を同じ場所で流す。Orca の新しいタブに、左に takt watch、右に案内役、案内役の下に align-behind のペインを作る。案内役の引数はそのまま案内役に渡す。`--no-guide` を付けると案内役を立てず、watch の右に align-behind を置く（takt スキルが案内役なしで runner を立てるとき）。

```sh
node <skill>/scripts/desk.mjs <owner/repo> [--interval 60] [--from <仕様の issue 番号>] [--stall-minutes 60]
```

- 案内役には自分のペインの handle を `--terminal <handle>` で渡す。`--terminal` を受けた案内役は、takt-sequence を新しいタブではなく、自分のペインを下へ分割して起動する（案内役と align-behind の間に入る）。応答の `result.split.handle` を起動の印に書く。
- 既に動いているものは二重に起動しない。cwd が repo root の takt watch があれば左のペインを作らず、案内役が最初のペインになる。align-behind があれば、そのペインを作らない。案内役が動いていれば何も作らず、PID を出して終了コード 2 で止まる（止めてから流し直す）。
- 分割の向きは `scripts/pane.mjs` の定数だけで決まる。並びが図と違えば、そこを直す。

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
| `案内役: Discord に判断依頼を送る（#N 原因）` | 仕様（wayfinder の ticket と to-spec の停止と霧の残りは map） | 判断依頼を送る前に書く。原因は `takt の ABORT`、`formal-spec の検証失敗`、または `takt のレビュー失敗`（PR の判断依頼。上限到達・やり直し後の失敗・レビューそのものが落ちた）、または `<工程> のセッションの停止`（例: `review-fix のセッションの停止`、 `to-tickets のセッションの停止`、`takt-sequence のセッションの停止`、`to-spec のセッションの停止`）、または `霧の残り`（子がすべて閉じたのに霧が残る map）。N は止まった issue（`takt のレビュー失敗` と `review-fix のセッションの停止` なら PR の番号、takt-sequence の停止なら親、wayfinder の ticket の停止ならその ticket、to-spec の停止と霧の残りならその map）。これがあれば同じ組は再送しない |
| `案内役: Discord に判断依頼を送った（#N 原因 / スレッド T / メッセージ M）` | 送る前の印と同じ issue | 送った後に書く（2 段目。grilling の問いの送った印と同じ形）。M への本人の返信と ✅ を、答えた印が付くまで毎周 REST で読む。送信と書き込みの間で止まった判断依頼にはこの印が無く、答えた印を手で書くまで判断待ちに残る |
| `案内役: 判断依頼に答えた（#N 原因）` | 送る前の印と同じ issue | 本人の返信か ✅ を受けて書く。最後の送る前の印より後にあれば、状況の一覧はその判断依頼を判断待ちに数えない（答えた印が無くても、対象が片付けば数えない）。本人が GitHub に手で書いてもよい（メッセージの ID が無い古い判断依頼もこれで外せる） |
| `## Formal Spec（takt <版> の検証器で failed）` で始まる 1 行目のコメント | 仕様 | formal-spec が失敗で止まるときに書く。viewer の最後の Formal Spec コメントが failed なら検証失敗とみなす。`検証器の作業ディレクトリ: <path>` の行をレポートの場所に使う |
| `案内役: takt-sequence に渡した #a #b` | 親 | 起動する前に書く（1 段目）。これがある親は渡さない。#a #b が停止の観測で「渡した sub-issue」になる |
| `案内役: <工程> のタブを閉じた（ターミナル H）` | 起動の印と同じ issue（工程は仕様、takt-sequence は親、wayfinder は ticket、to-spec は map） | 閉じた後に書く（閉じ直しは害が無いので、起動と逆に後に書く）。close が失敗したら書かず、次の周で閉じ直す。これがある handle は観測も close もしない |
| `案内役: takt-sequence を起動した（ターミナル H / T）` | 親 | 起動した後に書く（2 段目）。H は `orca terminal create --json` の応答の `result.terminal.handle`、T は起動時刻。これがある親だけ takt-sequence の停止を観測する。最後の印の handle を見る |
| `案内役: <工程> を起動した（ターミナル H / T）` | 仕様 | to-tickets 以外の工程でも、Orca のタブで起動して handle を印に書けば、同じ形で停止の観測の対象になる（H は handle、T は起動時刻。起動時刻はこの印から読む） |
| `案内役: 霧の ticket を起こす（子 N 件）` | wayfinder の map | 霧の ticket を起こす前に書く。N は起こす時点の子の数。最後のこの印の N + 1 が今の子の数以上なら（霧の ticket の後に ticket が増えていない）、起こし直さず霧の残りの判断依頼に回す |
| `案内役: wayfinder を起動する` | wayfinder の ticket | 起動する前に書く（1 段目）。map ではなく起動する ticket に書く。これがある ticket には起動を出さない。起動の成否が不明でも二重に起動しない |
| `案内役: wayfinder を起動した（ターミナル H / T）` | wayfinder の ticket | 起動した後に書く（2 段目）。H は `orca agent launch --json` の応答の `result.outcome.handle`、T は起動時刻（ISO 8601）。これがある ticket には起動を出さない。この印がある open な ticket は、停止の観測の対象になる（種類のラベルが research・grilling・task のもの。最後の印の handle を見る）。結果は ticket が閉じたこと |
| `案内役: to-spec を起動する` | wayfinder の map | 起動する前に書く（1 段目）。ticket ではなく晴れた map に書く。これがある map には to-spec を出さない。起動の成否が不明でも二重に起動しない |
| `案内役: to-spec を起動した（ターミナル H / T）` | wayfinder の map | 起動した後に書く（2 段目）。H は `orca agent launch --json` の応答の `result.outcome.handle`、T は起動時刻（ISO 8601）。handle が取れなければ書かずに案内役が止まる。これがある map には to-spec を出さない。結果の仕様（`spec` ラベル、本文に `元の map: #m` だけの行）ができるまで、停止の観測の対象になる（最後の印の handle を見る） |
| `案内役: Discord に仮決めを流す（#t 仮決め n）` | wayfinder の子 ticket（grilling・task） | 仮決めを送る前に書く。t は ticket、n は ticket の中の仮決めの通し番号（viewer のコメントの順に、形に合う仮決めへ 1 から振る）。閉じ括弧まで照合する。これがあれば同じ n には再送しない（送信が失敗しても再送しない） |
| `案内役: Discord に仮決めを流した（#t 仮決め n / スレッド T / メッセージ M）` | wayfinder の子 ticket（grilling・task） | 送った後に書く。M は差し戻しを受け付けるために残す。これがあれば同じ n には再送しない。ticket が閉じている間だけ、M への本人の ❌ を毎周読む（書き戻し前の間だけ）。掲載メッセージには Bot が ❌ を先付けし、本文で「差し戻すときは ❌」と案内する |
| `案内役: Discord で仮決めが差し戻された（#t 仮決め n）` | wayfinder の子 ticket（grilling・task） | 1 行目が印、空行の後に `- 問い:` `- 答え:` の行と、解き直す旨の 1 文。本人の ❌ を受けて、ticket を開き直す前に書く。t が一致する印だけを数える。これがあれば同じ n は書き戻さない。印の数が開き直した回の数で、最後の印より後の起動の印だけが今の回の起動の印になる（wayfinder の起動の key と停止の観測の境界）。承認の差し戻しの印（`案内役: Discord で差し戻された`）とは別 |
| `## 仮決め` 節（resolution コメントの中。印ではなく読み取る形） | wayfinder の子 ticket（grilling・task） | viewer のコメントだけを読む。コードフェンスの外の `## 仮決め` の行から、次の `## ` 見出しか末尾まで。`### <問い>` ごとに `- 答え:` `- 振り分け:`（⓪ か ③）`- 理由:` `- 根拠:` の 4 行がこの順。1 件でも形に合わなければ、そのコメントからは 1 件も読まない |
| `案内役: Discord に判断依頼を送る（#t grilling の問い S）` | wayfinder の grilling の ticket | 問いつきの判断依頼を送る前に書く。t は ticket、S は停止の識別子（`agentWait.since`）。閉じ括弧まで照合する。これがあれば同じ S には再送しない（送信が失敗しても再送しない） |
| `案内役: Discord に判断依頼を送った（#t grilling の問い S / スレッド T / メッセージ M）` | wayfinder の grilling の ticket | 送った後に書く。M への本人の返信を毎周 REST で読む（書き戻し前の間だけ） |
| `案内役: Discord の回答を書き戻した（#t grilling の問い S）` | wayfinder の grilling の ticket | 1 行目が印、空行の後が回答の本文。これがあれば書き戻さない。流し込みの回答はこのコメントの本文から作る |
| `案内役: 回答をタブに流し込む（#t grilling の問い S）` | wayfinder の grilling の ticket | `orca terminal send` の前に書く。これがあれば再送しない |
| `## 判断の問い` で始まる 1 行目のコメント | wayfinder の grilling の ticket | grilling のセッションが AskUserQuestion の前に書く（問い・選択肢・推奨）。判断依頼の本文に載せる。最後のものを読む |
| `案内役: Discord に map のスレッドを立てる` | wayfinder の map | スレッドを立てる前に書く（1 段目）。これがある map には再作成しない。作成の成否が不明でも二重に立てない |
| `案内役: Discord に map のスレッドを立てた（スレッド T）` | wayfinder の map | 立てた後に書く（2 段目）。T がスレッドの ID。通知と判断依頼の送り先 |
| `案内役: Discord に人が見る ticket を知らせる（#t）` | wayfinder の map | prototype の ticket t を知らせる前に書く。閉じ括弧まで照合する。これがあれば再送しない |
| `案内役: Discord のスレッドをアーカイブした（スレッド T）` | 閉じた仕様か map | スレッド T をアーカイブした後に書く（アーカイブし直しは害が無いので後に書く）。閉じ括弧まで照合する。これがあればアーカイブしない |
| `案内役: main の失敗した job を再実行する（run R）` | main の失敗した commit C の commit comment | 再実行する前に書く。R は落ちた必須チェックの Actions の run。閉じ括弧まで照合する。これがある run は再実行しない（issue も PR も持たない main の状態を毎周読み直すため、印は commit に置く） |
| `案内役: knowledge を起動する` | 仕様 | 起動する前に書く（1 段目）。これがある仕様には knowledge を出さない。起動の成否が不明でも二重に起動しない |
| `案内役: knowledge を起動した（ターミナル H / T）` | 仕様 | 起動した後に書く（2 段目）。H は `orca agent launch --json` の応答の `result.outcome.handle`、T は起動時刻（ISO 8601）。handle が応答から取れなければ書かずに案内役が止まる |
| `案内役: knowledge を起動した`（「（ターミナル」が続かない。古い版の印） | 仕様 | 読み取りだけ残す。これがある仕様には knowledge を出さない |
| `案内役: review-fix を起動する（head H）` | 修正する PR | 起動する前に書く（1 段目）。H は失敗した head（40 桁の 16 進）。文言の正本は `takt/scripts/review-stage.mjs`。これがある head には出さない。起動の成否が不明でも二重に起動しない。起動の回数は head を問わずこの印の数で数える（1 PR に 2 回まで） |
| `案内役: review-fix を起動した（head H / ターミナル T / 時刻）` | 修正する PR | 起動した後に書く（2 段目）。handle が応答から取れなければ書かずに案内役が止まる。これがある head には出さない（回数には数えない）。この印の handle と起動時刻が、修正のセッションの停止の観測の対象になる |
| `案内役: レビューのやり直しを頼む for head H` | 修正する PR | 修正のセッションが、証跡を載せた後に書く。案内役は読むだけ。これがある head には出さない。takt-sequence がレビューのやり直しを判断する |
| `TAKT evaluation failed for head H:` で始まるコメント | 修正する PR | takt が書く。案内役は読むだけ。現在の head のものがあるときだけ review-fix か判断依頼を出す。コメントの作成時刻（`createdAt`）も読む |
| PR 本文の `学びの元の仕様: #n` だけの行 | 学びの PR | knowledge に書かせる。viewer の PR にこの行があれば学びの PR ありとして、二度作らない |
| PR の `auto_merge`（REST。予約済みなら object、未予約なら null） | 学びの PR | 予約済みかどうかの判定に使う。state ファイルは持たず GitHub から読む |

マーカーは起動より先に書く。起動が失敗しても二重に起動しないための順序で、失敗したら案内役は止まる。やり直すときは、該当のマーカーのコメントを消してから流し直す。

親 issue かどうかは、仕様以外の issue が、本文に `仕様: #n` だけの行を持ち、かつ sub-issue を 1 件以上持つかで決める。`to-tickets` を起動するときのプロンプトはこの行を書くよう指示する。人が作った親にも、この行と sub-issue が必要。本文で `#n` に言及するだけの issue は親として数えない。

承認は本人（`guide.discord.user-id`）の ✅ / ❌ だけを受け付ける。押すだけで済むよう、Bot が承認依頼に ✅ / ❌ を先に付けておく（Bot の分は数えない）。✅ と ❌ の両方が付いていれば何もしない。結果は必ず GitHub のラベルかコメントに書き戻し、案内役は GitHub から読む。

判断依頼だけは先頭で本人をメンションし、通知を飛ばす。問いの無い判断依頼の末尾には、返信か ✅ で判断待ちから外れることを添える（Bot は ✅ を先付けしない）。同じスレッドに流れる仮決めに埋もれさせないためで、仮決め・承認依頼・人が見る ticket の知らせはメンションしない。どのメッセージも、題名などに含まれる `@everyone` やロールでは通知を飛ばさない。

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
- `orca agent launch --prompt "/devlog …"` から knowledge へ続く対話セッションが PR 作成まで進むかは、実際の起動で確かめていない。許可については上の記述（許可を絞らない対話セッションは確認待ちで止まりうる）のとおり。
- devlog への素材は、仕様・親・閉じた sub-issue の番号と、その sub-issue の takt の run のディレクトリ。run は、takt-sequence がクローンを片付ける前に写した main checkout の `.takt/runs/*-issue-<n>-*` と、まだ片付けていないクローンの `.takt/runs` から探す。写す前に人が `rm -rf` で消した run は渡せない（issue と PR だけが素材になる）。
- 閉じたタブの handle を `orca terminal show` すると、`terminal_handle_stale` ではなく `ok: true` のまま `connected: false` が返る（2026-10-17 に実機で確認）。観測はどちらも「見つからない」とする。`terminal_handle_stale` が返るのは Orca の再起動後などと見ているが、確かめていない。
- `orca worktree create --json` の応答の `result.worktree.path`（Orca の CLI の実装から読んだ形）と、`/wayfinder #<map> #<ticket>` の引数の解釈は、実機で確かめていない。
- 閉じるのは各工程・takt-sequence・to-spec の最後の起動の印の handle と、wayfinder の ticket の今の回の最後の起動の印の handle だけ。印を消して流し直す前の古いタブ、差し戻し前の回のタブ、手が止まる前に仕様・map が閉じられたか map が保留になったタブは残る（人が閉じる）。
- 対象は open な仕様だけ。sub-issue がすべて閉じる前に人が仕様を閉じると、学びの PR は作られない。
- review-fix: `orca worktree create --base-branch origin/<ブランチ>` が作るブランチ名と、その後の `git switch`（持ち主がいなければ `--track -C`、いれば `--detach`）の後の worktree の状態は、Orca が `<ブランチ>` と同名のローカルブランチを作らない前提（作る場合は 2 回目の create が失敗して起動しない）とともに、、実機で確かめていない。判定は `review-resolution.md` の `## 結果:` と `## 判定不能の理由` から読む。この形は takt 0.71.0 の builtin から読み取ったもので、実機では確かめていない。`takt-node.sh merge-tasks.mjs` の実際の出力（TaskRunner の `data.merge_task`・`data.pr_number`・`runSlug`）も実機では未確認（takt 0.71.0 のコードから読んだ形）。
