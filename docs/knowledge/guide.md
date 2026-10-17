# 案内役（guide スキル）

`config/.agents/skills/guide/` の[案内役](../../GLOSSARY.md)に手を入れるとき、特に[工程](../../GLOSSARY.md)の起動・[印](../../GLOSSARY.md)の形・[セッションの停止](../../GLOSSARY.md)の観測・Orca CLI の呼び方を変えるときに読む。工程を Orca の対話セッションで起動する理由は [ADR 0001](../adr/0001-guide-steps-run-as-orca-sessions.md)。遷移と印の一覧は `config/.agents/skills/guide/SKILL.md` にある。

## 動いている案内役はマージしたコードを読み直さないので、工程の変更をマージしたら再起動する

`~/.claude/skills` はメインチェックアウトの `config/.agents/skills` への symlink なので、マージすればファイルは届く。しかし常駐中の `node guide.mjs` は、起動したときに読み込んだモジュールのまま動き続ける。

仕様 #325 では、案内役が 01:11Z に起動したまま、#335（to-tickets の Orca 起動）が 01:45Z、#339（formal-spec）が 03:40Z にマージされた。#325 の knowledge は 03:41Z に起動されたが、古いコードのままだった。そのため Orca のタブではなく `claude -p` で起動され、印も handle の無い古い形（`案内役: knowledge を起動した`）になった。仕様の Formal Spec コメントも無いまま流れた。今の印の形で動いているかは、起動時刻とマージの時刻を突き合わせれば分かる。

```sh
ps -eo pid,lstart,command | grep '[g]uide.mjs'
gh pr view <N> --json mergedAt
```

## 起動の印は 2 段に分け、2 段目は必ず `launchedMarker` で組み立てる

印は起動より先に書く決まりだが、handle は `orca agent launch --json` の応答からしか取れない。そこで、起動の前に `案内役: <工程> を起動する` を書き、起動の後に `案内役: <工程> を起動した（ターミナル <handle> / <ISO 8601>）` を書く。承認依頼の「送る」「送った」と同じ形。1 段目だけが残った仕様（起動の失敗、応答が JSON でない、handle が無い）は、次の周でも再起動しない。

2 段目を手で組み立てると、`decide.mjs` の `LAUNCHED` 正規表現（`^案内役: (\S+) を起動した（ターミナル (\S+) \/ ([^）]+)）`）に一致しなくなる。そうなると停止の観測（`sessionsToObserve`）から黙って漏れる。逆に、この形で書けば工程名を問わず観測の対象になる。#333 の formal-spec は、観測側に手を入れずに停止の検知が効いた。

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

## セッションが見つからないと判定するのは `terminal_handle_stale` のときだけにする

存在しない handle に `orca terminal show` を打つと、終了コード 1 で、**stdout** に `{"ok":false,"error":{"code":"terminal_handle_stale"}}` が出る。案内役はこの code のときだけ `found: false` にする。Orca が動いていない、別の code、JSON でない応答などはすべて例外にして、`loop.mjs` の再試行（3 回）に任せる。Orca 側の一時的な失敗まで `found: false` にすると、判断依頼が誤って飛ぶ。

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

## 出典

- 仕様 [#325](https://github.com/daiki-beppu/dotfiles/issues/325)、親 issue [#329](https://github.com/daiki-beppu/dotfiles/issues/329)
- [#330](https://github.com/daiki-beppu/dotfiles/issues/330) / [#335](https://github.com/daiki-beppu/dotfiles/pull/335)（to-tickets の Orca 起動）
- [#331](https://github.com/daiki-beppu/dotfiles/issues/331) / [#337](https://github.com/daiki-beppu/dotfiles/pull/337)（セッションの停止の観測）
- [#332](https://github.com/daiki-beppu/dotfiles/issues/332) / [#338](https://github.com/daiki-beppu/dotfiles/pull/338)（knowledge の Orca 起動）
- [#333](https://github.com/daiki-beppu/dotfiles/issues/333) / [#339](https://github.com/daiki-beppu/dotfiles/pull/339)（formal-spec と to-tickets の gate）
- 各 PR の takt の run（`takt-worktrees/20261017T0114-330-…`・`…0146-331-…`・`…0237-332-…`・`…0306-333-…` の `.takt/runs/*/reports/`）
