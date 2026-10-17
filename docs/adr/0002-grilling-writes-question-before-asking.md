# 不可逆な判断の問いは、grilling が AskUserQuestion の前に ticket へ書き、案内役はそこから読む

[案内役](../../GLOSSARY.md)が grilling のセッションの[不可逆な判断](../../GLOSSARY.md)を Discord に[判断依頼](../../GLOSSARY.md)として送るとき、問いの中身は Orca から取らない。grilling が AskUserQuestion を呼ぶ前に、1 行目が `## 判断の問い` のコメント（問い・選択肢・推奨）を ticket に書き、案内役は viewer の最後のそのコメントを本文に載せる（仕様 [#306](https://github.com/daiki-beppu/dotfiles/issues/306)、[#349](https://github.com/daiki-beppu/dotfiles/issues/349)）。`orca terminal show` の `agentWait` は `{source, since}` だけを返し、画面の最後の数行にも選択肢の画面は収まりきらない。Orca の CLI には AskUserQuestion の問いを取り出す口が無い。

## Considered Options

- **画面の最後の数行（`orca terminal read`）から問いを読む**: 選択肢の画面は TUI の描画で、数行に切ると問いが欠ける。読み取りの形も Orca の版に縛られる。
- **`## 判断の問い` のコメントが書かれるまで判断依頼を送らない**: 手順に従わなかったセッションが、人に気付かれないまま止まり続ける。そこで、コメントが無くても「（問いの記録が ticket に無い）」と書いて送る。

## Consequences

- 案内役の判断依頼は、grilling スキルの手順（書いてから聞く。後には書かない）に頼る。`grilling/SKILL.md` のこの一文を消すと、判断依頼から問いが消える。
- 案内役は GitHub を読んでから Orca を観測するので、その間に書かれた問いは見えない。hook の入力待ちを観測した ticket だけ、コメントを読み直す（[案内役の知識文書](../knowledge/guide.md#hook-の入力待ちを観測した-grilling-の-ticket-は判断の問いを読み直す)）。
- 問いが GitHub に残るので、回答の書き戻しと合わせて、判断の経緯を ticket だけで辿れる。
