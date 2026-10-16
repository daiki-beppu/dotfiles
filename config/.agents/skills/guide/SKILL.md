---
name: guide
description: 仕様（spec ラベル）の承認依頼を Discord に送り、承認済み（spec-approved ラベル）の仕様を to-tickets から takt-sequence まで流す常駐スクリプト「案内役」を動かす依頼に使う。
---

# 案内役

ローカルに常駐する独立スクリプト（takt のワークフローではない）。一定の間隔で GitHub と takt から状態を読み、`scripts/decide.mjs` の純粋な関数（LLM を使わず、ラベルと状態だけで決める）で次の行動を決め、アダプタで実行する。

| 状態 | 行動 |
| --- | --- |
| open な `spec` があり、承認依頼をまだ送っていない | Discord に repo 名のチャンネル（無ければ作る）とスレッドを立て、題名と issue のリンクを送る |
| 承認依頼を送り済みで、本人の ✅ だけが付いている（`spec-approved` なし） | `spec-approved` ラベルを付ける |
| 承認依頼を送り済みで、本人の ❌ だけが付いている（差し戻しコメントなし。`spec-approved` の有無は問わない） | 差し戻しのコメントを書く |
| `spec` と `spec-approved` が付いた open な仕様があり、その親 issue（本文に `仕様: #n` だけの行があり、sub-issue を持つ）がない | `claude -p` で `to-tickets` を実行する（親 issue と sub-issue を起こす） |
| 親 issue と sub-issue がそろい、まだ takt に渡していない | open な sub-issue を `takt-sequence` に渡す（Orca の新しいタブ） |

## 使い方

対象 repo の root（main checkout）で流す。

```sh
node <skill>/scripts/guide.mjs <owner/repo> [--interval 60] [--dry-run]
```

- `--dry-run`: 1 周だけ読み、観測した要約と行動を表示して終わる。GitHub への書き込みも子プロセスの起動もしない。
- 前提: `gh` が認証済み。キーチェーン（アカウントは `$USER`）に `guide.discord.bot-token` / `guide.discord.guild-id` / `guide.discord.user-id` がある（`security find-generic-password -a "$USER" -s <名前> -w` で読む）。Bot は guild に参加し、チャンネルの管理・公開スレッドの作成・スレッド内の送信・メッセージ履歴の閲覧の権限を持つ。特権インテントは使わない。実行モードでは加えて `takt watch` が動いていて、`orca` と `claude` がある。
- cwd の repo が引数と違うか、キーチェーンの値がない（無い名前を表示する）と終了コード 2、行動の実行が失敗すれば終了コード 1 で止まる。

## 状態

state ファイルは持たない。済んだ行動は GitHub のコメント（`gh` の認証ユーザーが書き、本文が次の接頭辞で始まるもの）で表す。毎周読み直すので、止めて流し直しても続きから動く。

| コメント | 書く先 | 意味 |
| --- | --- | --- |
| `案内役: Discord に承認依頼を送る` | 仕様 | 承認依頼を送る前に書く。これがある仕様には再送しない |
| `案内役: Discord に承認依頼を送った（スレッド T / メッセージ M）` | 仕様 | 送り済み。T と M のメッセージのリアクションを毎周 REST で読む |
| `案内役: Discord で差し戻された` | 仕様 | 差し戻しを記録した。これがある仕様には繰り返さない |
| `案内役: to-tickets を起動した` | 仕様 | to-tickets を起動した。これがある仕様には to-tickets を出さない |
| `案内役: to-tickets が終わった（exit N）` | 仕様 | 終了。exit 0 になるまで、その仕様の親は takt に渡さない（一部だけの sub-issue を渡さないため） |
| `案内役: takt-sequence に渡した #a #b` | 親 | 渡した。これがある親は渡さない |

マーカーは起動より先に書く。起動が失敗しても二重に起動しないための順序で、失敗したら案内役は止まる。やり直すときは、該当のマーカーのコメントを消してから流し直す。

親 issue かどうかは、仕様以外の issue が、本文に `仕様: #n` だけの行を持ち、かつ sub-issue を 1 件以上持つかで決める。`to-tickets` を起動するときのプロンプトはこの行を書くよう指示する。人が作った親にも、この行と sub-issue が必要。本文で `#n` に言及するだけの issue は親として数えない。

承認は本人（`guide.discord.user-id`）の ✅ / ❌ だけを受け付ける。✅ と ❌ の両方が付いていれば何もしない。結果は必ず GitHub のラベルかコメントに書き戻し、案内役は GitHub から読む。

## 確認が取れていない点

- アーカイブされた公開スレッドのメッセージのリアクションを REST で読めるか。実 Discord で確かめていない（スレッドは 7 日で自動アーカイブ）。
- `claude -p "/to-tickets #<spec> …"` が `disable-model-invocation: true` のスキルを headless で起動でき、確認待ちにならず起票まで進むか。実起動で確かめていない。
- headless 実行の許可は `--allowedTools`（`gh`、`gh-subissues`、Read、Grep、Glob）で絞っている。足りなければ `scripts/to-tickets.mjs` を直す。
