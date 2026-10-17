# wayfinder と grilling のスキル

`config/.agents/skills/wayfinder/` と `config/.agents/skills/grilling/` に手を入れるとき、特に[判断の振り分け](../../GLOSSARY.md)の段や[不可逆な判断](../../GLOSSARY.md)の範囲、[仮決め](../../GLOSSARY.md)・[判断の問い](../../GLOSSARY.md)の書き方を変えるとき、振り分けの効き目を測り直すときに読む。この 2 つをフォークとして追跡する理由は [ADR 0003](../adr/0003-fork-wayfinder-and-grilling.md)、判断の問いを ticket に書かせる理由は [ADR 0002](../adr/0002-grilling-writes-question-before-asking.md)。案内役がこの書き方を読む側の話は [案内役の知識文書](guide.md)。

## フォークにした grilling と wayfinder には、外部 installer の名残が 2 つある

PR #355 で追跡ファイルにしたが、ローカルの後片付けは済んでいない（2026-10-18 時点）。

- メインチェックアウトの `.git/info/exclude` に `/config/.agents/skills/grilling` と `/config/.agents/skills/wayfinder` が残っている。追跡済みの `SKILL.md` には効かないが、この 2 つのディレクトリに新しく足したファイルは `git status` に出ず、黙ってコミットから漏れる
- `~/.agents/.skill-lock.json` に、2 つとも `mattpocock/skills` の版として残っている。`npx skills update` を流すと上流の版で上書きされる

新しいファイルを足したら、`git status --ignored config/.agents/skills/wayfinder` で無視されていないかを見る。

```sh
grep -n 'grilling\|wayfinder' .git/info/exclude
jq '.skills | {grilling, wayfinder} | map_values(.source)' ~/.agents/.skill-lock.json
```

## `triage-skills.test.mjs` はどの検査からも呼ばれないので、手で流す

`scripts/check.sh` の `check_guide` はテストのファイルを glob ではなく 1 本ずつ列挙していて、`config/.agents/skills/wayfinder/triage-skills.test.mjs` は入っていない。#346 の fix-plan が「order は配線を求めていない」として登録しなかった。#345 の `wayfinder.test.mjs` は、review の指摘を受けて列挙に足した。2 つのスキルを変えたら、このテストを手で流す。

```sh
node --test config/.agents/skills/wayfinder/triage-skills.test.mjs
```

このテストが確かめるのは frontmatter と `## 仮決め` の形だけにしてある。言い回しを固定するテストは足さない（[takt の知識文書](takt.md#文書を変える-ticket-ではテストは機械が読む形だけに絞る)）。

## ⓪ が ③ より先にあるので、公開済みの契約に触れる問いも、互換を残す設計にすれば人に聞かれない

振り分けは最初に決着した段で止まる。⓪「設計で戻せる判断に変える」が先にあるので、CLI の引数を消すかという問いも、旧フラグを別名で残す設計にすれば仮決めになる。#352 の実験では、振り分けありの 3 試行すべてが「`--json` を `--format json` に置き換え、旧フラグを消すか」を ⓪ で仮決めし、うち 1 試行はコマンド名の変更も「変えない選択は戻せる」として自分で決めた。

これは仕様 #306 の決定どおりの動きで、人への問いが減る代わりに、互換を保つ負担と、確かめていない呼び出し元を抱え込む。`grilling/SKILL.md` の ⓪ には「呼び出し元の有無を確かめていない」ことを仮決めの根拠に書かせる指示が無く、3 試行のうち 1 つは書いていなかった。足すかはまだ決めていない。

## 振り分けの効き目を測るときは、正解ラベルを ⓪ の変換の後の問いに付け、共通の指示に測りたい挙動を書かない

#352 は `double-blind-test` で、振り分けあり（W）となし（N）を各 3 試行比べた。題材は `takt-usage-report` に CSV 出力を足す grilling の ticket（7 問。不可逆 3・戻せる 2・事実 2）。

| 条件 | pass | 人に聞いた問い | うち不可逆でない |
| --- | --- | --- | --- |
| W（振り分けあり） | 0/3 | 5 | 0 |
| N（振り分けなし） | 3/3 | 9 | 0 |

W が fail になったのは「不可逆な問いをすべて人に聞く」の基準だけで、原因は上の節の ⓪ の動きだった。正解ラベルを問いの元の文面（旧フラグを消すか）に付けたので、⓪ で戻せる形に変えるというスキルどおりの動きが不正解になった。また、N にも共通の指示「人に聞くべき問いだけ書く」が入っていたため、不可逆でない問いを聞かなかったのは両条件とも同じで、「絞る効き目」の差は測れなかった。

測り直すときは、次の 3 つを先に決める。

- ⓪ の余地がある問いは、互換を残す設計を認めたうえで不可逆かどうかを決めてラベルを付ける。余地をなくしたいなら、問いの文面に「別名で残せない」などの制約を書く
- 両条件に共通する指示には、測りたい挙動（人に聞く問いを絞る）を書かない
- #346 以前の grilling は git の履歴に無い（外部 installer の版だったため）。振り分けなしの条件は、今の `SKILL.md` から振り分けの節を除いて作る

## 出典

- 仕様 [#306](https://github.com/daiki-beppu/dotfiles/issues/306)、親 issue [#344](https://github.com/daiki-beppu/dotfiles/issues/344)
- [#346](https://github.com/daiki-beppu/dotfiles/issues/346) / [#355](https://github.com/daiki-beppu/dotfiles/pull/355)（判断の振り分けをスキルに足した）と takt の run `20261017-053614-…-wdudfg`
- [#345](https://github.com/daiki-beppu/dotfiles/issues/345) / [#356](https://github.com/daiki-beppu/dotfiles/pull/356)（`wayfinder.test.mjs` の登録）
- [#352](https://github.com/daiki-beppu/dotfiles/issues/352) の resolution コメントと takt の run `20261017-064222-…-alwakr`（double-blind-test の実験）
