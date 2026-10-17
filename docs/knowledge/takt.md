# takt で ticket を流す

[仕様](../../GLOSSARY.md)から起票した ticket を takt（takt-sequence）で流すとき、ticket の本文を書くとき、run の結果を読むときに読む。案内役が takt-sequence に渡す流れは [案内役の知識文書](guide.md)。

## ticket の「前提」は起票した時点の写しなので、先の ticket がマージされると古くなる

to-tickets は、全 ticket の本文に同じ「前提（今の案内役）」を書く。takt-sequence は ticket を 1 本ずつ順に流すので、後の ticket が走る頃には、前の ticket のマージで前提が変わっている。仕様 #325 の #333 には「今は to-tickets・knowledge を `claude -p` で起動している」と書かれていたが、#335・#338 のマージで、どちらも既に `orca agent launch` に変わっていた。plan はコードの方に合わせて進めた。ticket の前提とコードが食い違ったら、コードを正とする。

## 実機の観測を受入条件にする ticket には、確かめ方まで書く

#331 は「本物の Orca で `agentWait` の値を確かめる」を受入条件にした。その結果、implement と replan を 2 往復して、9 iteration・約 40 分かかった。同じ仕様の他の ticket は 6〜7 iteration・17〜23 分で、どれも REJECT は 0 件だった。1 回目は既存のセッションを観測しただけで値が取れず、replan が「確認専用のセッションを自分で起動する」という未試行の手段を示して、ようやく取れた（[案内役の知識文書](guide.md#agentwait-の値は確認専用のセッションを自分で起動して取る)）。どのセッションを、どう起動して観測するかまで ticket に書いておけば、この往復は省ける。

## 実機のコマンドと検査ゲートの実行は、implement の工程にしか期待しない

takt の中のエージェントは、工程によってコマンドの実行承認が通らない。#330 と #331 の plan・replan では、`orca agent launch --help` も `orca terminal --help` も実行できなかった。review-adjudication でも `scripts/check.sh guide` を再実行できず、前の工程の報告を根拠に判定した。final-gate は、設計上テストを実行しない。そのため、受入条件の「`scripts/check.sh guide` が終了コード 0」を裏付けるのは、implement 系の工程の自己申告だけになる。実機での確認や数字は、implement の報告にコマンドと出力ごと書かせる。

## implement の報告に、文書の変更の確認を行番号まで書く

#333 の implement は、check を通したにもかかわらず、SKILL.md の変更を「未完了（文書の目視確認が未提示）」と自分で報告した。判定はこれを根拠に reimplement を走らせた。reimplement はファイルを 1 つも編集せず、文書を読み直して行番号を記録しただけで終わり、約 2 分を無駄にした。文書を変える ticket では、implement の報告に「確認済み」と行番号まで書けば、この手戻りは出ない。

## 出典

- 仕様 [#325](https://github.com/daiki-beppu/dotfiles/issues/325)、親 issue [#329](https://github.com/daiki-beppu/dotfiles/issues/329)
- [#330](https://github.com/daiki-beppu/dotfiles/issues/330) / [#335](https://github.com/daiki-beppu/dotfiles/pull/335)、[#331](https://github.com/daiki-beppu/dotfiles/issues/331) / [#337](https://github.com/daiki-beppu/dotfiles/pull/337)、[#332](https://github.com/daiki-beppu/dotfiles/issues/332) / [#338](https://github.com/daiki-beppu/dotfiles/pull/338)、[#333](https://github.com/daiki-beppu/dotfiles/issues/333) / [#339](https://github.com/daiki-beppu/dotfiles/pull/339)
- 各 PR の takt の run（`trace.md`・`meta.json`・`reports/`）
