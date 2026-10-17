# wayfinder と grilling は外部 installer の版をやめ、このリポジトリで追跡するフォークにする

`wayfinder` と `grilling` のスキルは `mattpocock/skills` から `npx skills` で入れ、ローカルの Git exclude で追跡対象から外していた（`AGENTS.md` の「外部 installer のスキルは共通ディレクトリで保持し、ローカルの Git exclude で追跡対象から外す」）。仕様 [#306](https://github.com/daiki-beppu/dotfiles/issues/306) の [#346](https://github.com/daiki-beppu/dotfiles/issues/346) で、grilling・task を[判断の振り分け](../../GLOSSARY.md)で進めるよう書き換えたとき、この 2 つは `config/.agents/skills/` の追跡ファイルにした（PR [#355](https://github.com/daiki-beppu/dotfiles/pull/355)）。この規則の例外になる。takt の worktree は `.git` を別に持つクローンで、メインチェックアウトの `.git/info/exclude` で外したスキルはそこに無い。書き換えを PR に載せて takt で流すには、追跡するしかなかった。

## Considered Options

- **上流に PR を出して取り込んでもらう**: 判断の振り分けと `## 仮決め` の形は、案内役との契約でこのリポジトリ固有のもの。他人の repo への発信でもある。
- **外部の版のまま、案内役のプロンプトで振り分けを指示する**: `/wayfinder` を人が直接呼んだときに効かない。`grilling` を人が直接呼んだときの対話型の進め方とも、1 つのスキルの中で書き分けられない。

## Consequences

- 上流の更新は自動では入らない。取り込むときは差分を手で見る。
- `~/.agents/.skill-lock.json` には、2 つとも `mattpocock/skills` の版として残っている。`npx skills update` を流すと上流の版で上書きされ、追跡ファイルの差分として現れる。
- メインチェックアウトの `.git/info/exclude` に `/config/.agents/skills/grilling` と `/config/.agents/skills/wayfinder` が残っている。追跡済みのファイルには効かないが、この 2 つのディレクトリに新しく足したファイルは黙って無視される（[wayfinder の知識文書](../knowledge/wayfinder.md#フォークにした-grilling-と-wayfinder-には外部-installer-の名残が-2-つある)）。
- 案内役の判断依頼・仮決めの読み取りは、このフォークの本文の形（`## 判断の問い`、`## 仮決め`）に頼る（[ADR 0002](0002-grilling-writes-question-before-asking.md)）。
