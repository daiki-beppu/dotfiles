# main は、マージの前に止めず、マージの後に検証して直す

takt で回す repo は、ruleset の「マージ前に main に揃える」（strict）を必須にしない。main の push の CI を[案内役](../../GLOSSARY.md)が見張り、落ちたら、落ちた job の再実行 → [main-fix](../../GLOSSARY.md)（main から切った修正のセッションが、修正の PR を出して自動マージを予約する） → [判断依頼](../../GLOSSARY.md)の順に直す（[main の修復](../../GLOSSARY.md)、仕様 [#407](https://github.com/daiki-beppu/dotfiles/issues/407)）。main が赤い間に同じチェックで落ちた PR は、PR の不具合として扱わない。takt-sequence の並列数を上げても、strict のもとでは、予約済みで BEHIND の PR を `align-behind.mjs` が 1 件ずつ揃えるので、出口で 1 件ずつに戻っていた。Anthropic の Scion の記事（[Redesigning source control](https://www.anthropic.com/research/redesigning-source-control)）も、1 日 3 万件のマージで、マージキューに全体のロックをかけず、同時に入った変更の競合はマージ後とデプロイ前のテストで捕まえて直している。

## Considered Options

- **strict と align-behind で 1 件ずつ揃える（今の live-mindmap）**: main は壊れにくいが、takt-sequence の並列数が出口で 1 件ずつに戻る。
- **GitHub の merge queue**: 個人アカウントの repo では使えない。
- **何もせず、main が赤くなったら人が直す**: 並列数を上げるほど、人が気づく前に壊れの上に PR が積まれる。

## Consequences

- main は一時的に赤くなりうる。長くて、再実行と main-fix の修正の PR がマージされるまで。
- その間にマージされる PR は、壊れた main の上の評価になる。
- align-behind は、strict の repo が無くなれば役目を終える。
- dotfiles の ruleset「main: CI を必須にする」は、この判断の前から strict が `false` になっている。
