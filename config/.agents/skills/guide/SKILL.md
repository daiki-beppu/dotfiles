---
name: guide
description: 仕様（spec ラベル）の承認依頼を Discord に送り、承認済み（spec-approved ラベル）の仕様を to-tickets から takt-sequence まで流し、流れが止まったら（sub-issue の takt の run が ABORT、または formal-spec の検証失敗）仕様のスレッドへ判断依頼を送る常駐スクリプト「案内役」を動かす依頼に使う。
---

# 案内役

ローカルに常駐する独立スクリプト（takt のワークフローではない）。一定の間隔で GitHub と takt から状態を読み、`scripts/decide.mjs` の純粋な関数（LLM を使わず、ラベルと状態だけで決める）で次の行動を決め、アダプタで実行する。

| 状態 | 行動 |
| --- | --- |
| open な `spec` があり、承認依頼をまだ送っていない | Discord に repo 名のチャンネル（無ければ作る）とスレッドを立て、題名と issue のリンクを送る |
| 承認依頼を送り済みで、本人の ✅ だけが付いている（`spec-approved` なし） | `spec-approved` ラベルを付ける（repo に無ければ GitHub が作る） |
| 承認依頼を送り済みで、本人の ❌ だけが付いている（差し戻しコメントなし。`spec-approved` の有無は問わない） | 差し戻しのコメントを書く |
| `spec` と `spec-approved` が付いた open な仕様があり、その親 issue（本文に `仕様: #n` だけの行があり、sub-issue を持つ）がない | `orca agent launch` で Orca のタブに `to-tickets` を対話セッションとして起動する（タブ題名 `to-tickets #n`）。親 issue と sub-issue ができたら終わりで、終了コードは見ない |
| 親 issue と sub-issue がそろい、まだ takt に渡していない | open な sub-issue を `takt-sequence` に渡す（Orca の新しいタブ） |
| 承認済みの open な仕様の親 issue の sub-issue がすべて closed で、学びの PR（viewer が作り、本文に `学びの元の仕様: #n` だけの行がある PR。状態は問わない）がまだない | `claude -p` で `knowledge` だけを実行し（devlog は起動しない）、できた PR に `gh pr merge <N> --auto --squash` で自動マージを予約する |
| 同じ条件で、学びの PR が OPEN で自動マージが未予約（起動マーカーの有無は問わない。予約の前に止まった後の流し直し） | knowledge は起動せず、`gh pr merge <N> --auto --squash` だけを実行する |
| 承認依頼を送り済みの open な仕様で、承認済みなら親の open な sub-issue の最新の takt タスク（`createdAt` が最も新しいもの）が `failed`（ABORT）、または仕様の最後の Formal Spec コメントが failed | 承認依頼のスレッドに、止まった issue・理由・takt のレポートの場所（`<worktreePath>/.takt/runs`、検証失敗なら検証器の作業ディレクトリ）を送る。原因ごとに 1 度だけ |

## 使い方

対象 repo の root（main checkout）で流す。

```sh
node <skill>/scripts/guide.mjs <owner/repo> [--interval 60] [--from <仕様の issue 番号>] [--dry-run]
```

- `--from <n>`: 番号が n 以上の仕様だけを扱い、それより前の仕様には承認依頼も後続の行動も出さない。手で起票し終えた仕様が残っている repo に向けるとき、新しい仕様だけを流すのに使う（指定しなければ open な仕様をすべて扱う）。

- `--dry-run`: 1 周だけ読み、観測した要約と行動を表示して終わる。GitHub への書き込みも子プロセスの起動もしない。
- 前提: `gh` が認証済み。キーチェーン（アカウントは `$USER`）に `guide.discord.bot-token` / `guide.discord.guild-id` / `guide.discord.user-id` がある（`security find-generic-password -a "$USER" -s <名前> -w` で読む）。Bot は guild に参加し、チャンネルの管理・リアクションの追加・公開スレッドの作成・スレッド内の送信・メッセージ履歴の閲覧の権限を持つ。特権インテントは使わない。実行モードでは加えて `takt watch` が動いていて、`orca` と `claude` がある。Orca が起動していて、対象 repo の main checkout が Orca に登録済みで、`orca agent launch --agent claude` が使える（to-tickets の起動に使う。`claude` は knowledge の `claude -p` にも使う）。
- cwd の repo が引数と違うか、キーチェーンの値がない（無い名前を表示する）と終了コード 2、行動の実行が失敗すれば終了コード 1 で止まる。

## 状態

state ファイルは持たない。済んだ行動は GitHub のコメント（`gh` の認証ユーザーが書き、本文が次の接頭辞で始まるもの）で表す。毎周読み直すので、止めて流し直しても続きから動く。

| コメント | 書く先 | 意味 |
| --- | --- | --- |
| `案内役: Discord に承認依頼を送る` | 仕様 | 承認依頼を送る前に書く。これがある仕様には再送しない |
| `案内役: Discord に承認依頼を送った（スレッド T / メッセージ M）` | 仕様 | 送り済み。T と M のメッセージのリアクションを毎周 REST で読む |
| `案内役: Discord で差し戻された` | 仕様 | 差し戻しを記録した。これがある仕様には繰り返さない |
| `案内役: to-tickets を起動する` | 仕様 | 起動する前に書く（1 段目）。これがある仕様には to-tickets を出さない。起動の成否が不明でも二重に起動しない |
| `案内役: to-tickets を起動した（ターミナル H / T）` | 仕様 | 起動した後に書く（2 段目）。H は `orca agent launch --json` の応答の `result.outcome.handle`、T は起動時刻（ISO 8601）。handle が応答から取れなければ書かずに案内役が止まる。終わりはこの印ではなく、仕様を指す親 issue ができたかで判定する（判定は時刻を読まない） |
| `案内役: to-tickets を起動した`（「（ターミナル」が続かない。古い版の印） | 仕様 | 読み取りだけ残す。これがある仕様には to-tickets を出さず、親は takt に渡さない |
| `案内役: to-tickets が終わった（exit N）`（古い版の印） | 仕様 | 読み取りだけ残す。exit 0 の親は takt に渡し、exit 0 以外の親は渡さない。to-tickets は出さない |
| `案内役: Discord に判断依頼を送る（#N 原因）` | 仕様 | 判断依頼を送る前に書く。原因は `takt の ABORT` か `formal-spec の検証失敗`。N は止まった issue。これがあれば同じ組は再送しない |
| `## Formal Spec（takt <版> の検証器で failed）` で始まる 1 行目のコメント | 仕様 | formal-spec が失敗で止まるときに書く。viewer の最後の Formal Spec コメントが failed なら検証失敗とみなす。`検証器の作業ディレクトリ: <path>` の行をレポートの場所に使う |
| `案内役: takt-sequence に渡した #a #b` | 親 | 渡した。これがある親は渡さない |
| `案内役: knowledge を起動した` | 仕様 | knowledge を起動した。これがある仕様には knowledge を出さない |
| PR 本文の `学びの元の仕様: #n` だけの行 | 学びの PR | knowledge に書かせる。viewer の PR にこの行があれば学びの PR ありとして、二度作らない |
| PR の `auto_merge`（REST。予約済みなら object、未予約なら null） | 学びの PR | 予約済みかどうかの判定に使う。state ファイルは持たず GitHub から読む |

マーカーは起動より先に書く。起動が失敗しても二重に起動しないための順序で、失敗したら案内役は止まる。やり直すときは、該当のマーカーのコメントを消してから流し直す。

親 issue かどうかは、仕様以外の issue が、本文に `仕様: #n` だけの行を持ち、かつ sub-issue を 1 件以上持つかで決める。`to-tickets` を起動するときのプロンプトはこの行を書くよう指示する。人が作った親にも、この行と sub-issue が必要。本文で `#n` に言及するだけの issue は親として数えない。

承認は本人（`guide.discord.user-id`）の ✅ / ❌ だけを受け付ける。押すだけで済むよう、Bot が承認依頼に ✅ / ❌ を先に付けておく（Bot の分は数えない）。✅ と ❌ の両方が付いていれば何もしない。結果は必ず GitHub のラベルかコメントに書き戻し、案内役は GitHub から読む。

## 確認が取れていない点

- アーカイブされた公開スレッドのメッセージのリアクションを REST で読めるか。実 Discord で確かめていない（スレッドは 7 日で自動アーカイブ）。
- アーカイブされた公開スレッドへ判断依頼を Bot が送信できるか。実 Discord で確かめていない。
- 検証器の作業ディレクトリは、takt が 1 時間以上使われていないものを次の検証で消す。判断依頼を読む時点で残っていないことがある。
- `orca agent launch --prompt "/to-tickets #<spec> …"` で渡したスラッシュコマンドが、対話セッションで `disable-model-invocation: true` のスキルとして起動し、起票まで進むか。実起動で確かめていない。
- Orca の Chat UI の設定でチャット（`outcome.kind` が `structured`）として起動したとき、`orca terminal rename` がそのタブに効くか。実機で確かめていない。
- 許可を絞らない対話セッションなので、許可の確認待ちで止まりうる。止まった場合は人がタブで答える（案内役は時刻で止まりを検知しない）。
- `claude -p "/knowledge …"` が headless で PR 作成まで進むか、許可（`git`、`gh`、`orca`、Read、Grep、Glob、Edit、Write）で足りるか。実起動で確かめていない。足りなければ `scripts/knowledge.mjs` を直す。
- knowledge への素材は、仕様・親・閉じた sub-issue の番号と、takt list の `worktreePath` 配下の `.takt/runs`。worktree を片付けた後の run は渡せない（issue と PR だけが素材になる）。
- 対象は open な仕様だけ。sub-issue がすべて閉じる前に人が仕様を閉じると、学びの PR は作られない。
