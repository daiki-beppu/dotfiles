# takt で ticket を流す

[仕様](../../GLOSSARY.md)から起票した ticket を takt（takt-sequence）で流すとき、ticket の本文を書くとき、run の結果を読むときに読む。案内役が takt-sequence に渡す流れは [案内役の知識文書](guide.md)。

## ticket の「前提」は起票した時点の写しなので、先の ticket がマージされると古くなる

to-tickets は、全 ticket の本文に同じ「前提（今の案内役）」を書く。takt-sequence は ticket を 1 本ずつ順に流すので、後の ticket が走る頃には、前の ticket のマージで前提が変わっている。仕様 #325 の #333 には「今は to-tickets・knowledge を `claude -p` で起動している」と書かれていたが、#335・#338 のマージで、どちらも既に `orca agent launch` に変わっていた。plan はコードの方に合わせて進めた。ticket の前提とコードが食い違ったら、コードを正とする。

## 実機の観測を受入条件にする ticket には、確かめ方まで書く

#331 は「本物の Orca で `agentWait` の値を確かめる」を受入条件にした。その結果、implement と replan を 2 往復して、9 iteration・約 40 分かかった。同じ仕様の他の ticket は 6〜7 iteration・17〜23 分で、どれも REJECT は 0 件だった。1 回目は既存のセッションを観測しただけで値が取れず、replan が「確認専用のセッションを自分で起動する」という未試行の手段を示して、ようやく取れた（[案内役の知識文書](guide.md#agentwait-の値は確認専用のセッションを自分で起動して取る)）。どのセッションを、どう起動して観測するかまで ticket に書いておけば、この往復は省ける。

## 実機のコマンドと検査ゲートの実行は、implement の工程にしか期待しない

takt の中のエージェントは、工程によってコマンドの実行承認が通らない。#330 と #331 の plan・replan では、`orca agent launch --help` も `orca terminal --help` も実行できなかった。review-adjudication でも `scripts/check.sh guide` を再実行できず、前の工程の報告を根拠に判定した。final-gate は、設計上テストを実行しない。そのため、受入条件の「`scripts/check.sh guide` が終了コード 0」を裏付けるのは、implement 系の工程の自己申告だけになる。実機での確認や数字は、implement の報告にコマンドと出力ごと書かせる。ただし、その報告が届くのは run の中の工程までで、PR の評価には届かない（次の節）。

implement でも実機を使えないことがある。依存先が exclude で外した外部スキルでクローンに無いとき（下の節）と、実機で動かすと外への作用が出るとき（#348 は live-mindmap に仕様 issue を作ることになるので、偽物のテストで止めた）。

## 実装レポートは PR の本文に写らないので、PR の評価からは見えない

PR の評価（`merge-review-automerge` の final-gate）が読むのは PR の本文・差分・コメントで、takt が作る PR の本文の Execution Report は `Workflow \`default\` completed successfully.` の 1 行だけ。implement の報告は takt の worktree の `.takt/runs/*/reports/` に残るだけになる。

#345（PR #356）は、受入条件 4「live-mindmap で `--dry-run` した結果を実装レポートに載せる」が「判定不能」で BLOCKED になった。コードの指摘は 0 件で、2 回目の implementation-report には同じ結果が載っていた。人が PR の head で dry-run を流し直し、結果を PR にコメントしてから手でマージした。

`takt/SKILL.md` の投入条件と `lint-issue-rules.mjs` は「実装レポートに載せる（PR の本文に写る）」と書くよう勧めているが、仕様 #306 の PR（#355・#356・#358・#365・#367〜#369）の本文には、どれも実装レポートが写っていない。`takt/references/run.md` の「takt の PR 本文には検証の結果が無い」の方が今の動きに合う。証跡を求める受入条件は、run の後に人か呼び出し側が PR に写す前提で書くか、テストで代えられる形にする。

## takt は ticket 本文の地の文も完了の義務として読む

review の裁定と final-gate は、order.md の What to build の文をチェックボックスでなくても要件として 1 行ずつ照合する。受入条件に無いことは、対象外にする根拠にならない。見込みや下流の結果を書いた一文が、takt の中では満たせない義務になる。

- #345 の 1 回目は「これで既存のセッションの停止の観測の対象になる」という見込みの一文を要件にされ、判断依頼の送り先が決められず ABORT した。人が本文に「この ticket では、起動したセッションの停止の観測と判断依頼は足さない」と 1 行書いて、2 回目は 6 iteration・約 24 分で通った
- #348 の 1 回目は、レビュー 4 件がすべて APPROVE、指摘 0 件だったのに、final-gate が「できた仕様 issue には `spec` ラベルが付き」を判定不能として BLOCKED にし、replan が ABORT した。2 回目の本文の差は「この ticket の完了は、偽の `orca` と偽の GitHub を使うテストまで。レビューでも、この実機の結果が無いことを BLOCKED の理由にしない」の 1 行と、`## マージ後に人が確かめること` の節だけだった

外部で起きる結果を本文に書くときは、この 2 つの形（完了の範囲を明記する 1 行と、マージ後に人が確かめる節）に入れる。lint-issue は未完了のチェック項目だけを見るので、地の文のこの書き方を拾わない。#348 の元の本文にかけても警告は 0 件だった。

## 人の答えや外部の結果を待って ABORT した run は、自動の再投入では直らないので、本文を直して最初から積み直す

`~/.takt/config.yaml` の `auto_requeue_max_attempts: 2` による再投入は、replan から同じ order.md で再開するので、同じ結論を繰り返す。#345 は `…-nppk9i`・`…-hdtf9k` が各約 3 分で同じ問いの回答待ちのまま、#348 は `…-pdhhtr`・`…-g2qa2i` が `[REPLAN:3]`（直前が BLOCKED で変化なし）で ABORT した。#348 は判断依頼が 08:23Z に出て、人が本文を直したのは約 6 時間後だった。#348 の ABORT は、依存の無い #349〜#351 を止めなかった。

最初から積み直した run は、前の run の reports を読まない。そのため、積み直す前に 2 つを本文に写す。

- 前の run の plan.md の「確認事項」と、裁定の「未解決の前提」への答え。#348 は「`## Not yet specified` 節が無い map は霧ありか」を 1 回目は霧あり、2 回目は霧なしと、逆に決めた
- 前の run が実機で確かめた事実。#345 の 1 回目は「issue 一覧の応答に `issue_dependencies_summary.blocked_by` が入る」を確かめていたが、2 回目の plan は確かめられていないとして、子ごとに `dependencies/blocked_by` を呼ぶ形を選んだ

止まったときの選択肢は replan の `plan.md` の「確認事項」にしか無いので、判断依頼を受けたらまずそこを読む。

## 文書を変える ticket では、テストは機械が読む形だけに絞る

takt はテストを先に書く工程を持つので、スキルの本文を変える ticket でも write_tests が言い回しを正規表現で固定し、implement が本文の方をテストに合わせる。#346 では `/データを失う|data loss|…/i` のようなテストが 20 件書かれ、implement は本文に `(data loss)` などの括弧書きを足して通した。review が REJECT し、テストを frontmatter と `## 仮決め` の形を確かめる 4 件に削った（約 9 分）。足した括弧書きは今も `grilling/SKILL.md` に残っている。#349 でも、SKILL.md の語句の順序を `indexOf` で確かめるテスト 3 本が companion の must_fix で消された。文書の ticket には「テストは案内役などが機械で読む形だけ。言い回しはレビューで確かめる」と書いておく。

## 実装レポートに自由な節を書く ticket は、Phase 2 の書き直しで節が消えることを前提にする

takt のレポート工程（Phase 2）は、implement が Phase 1 で書いた実装レポートを、テンプレートの節（完了契約・影響経路・品質ゲート・未確認範囲）に書き直す。#352 では、Phase 1 の 97 行の版にあった題材・条件・結果・限界の節が 06:52Z の Phase 2 で消え、消えた節を指す参照だけが残った。それが「存在しないものを書いた」として REJECT され（`AI-NEW-implementation-report-L11`）、直すのに約 17 分かかった。消える前の版は、reports の下の `.takt-report-internal/history/…/writer/implementation-report.md.<時刻>` に残る。実験の結果のような自由な節を求める ticket では、それを完了契約の表の中に書かせるか、別のファイルに出させる。

## exclude で外した外部スキルは、takt のクローンにも git の履歴にも無い

takt の worktree は `.git` を別に持つクローンなので、メインチェックアウトの `.git/info/exclude` で外したスキル（`to-spec` など）はそこに無い。#348 の plan は「この repo に to-spec スキルは無い」として実機の検証を諦めた。#352 は、#346 以前の grilling を `git show 82a73db^:config/.agents/skills/grilling/SKILL.md` で取れず、振り分けなしの条件を今の SKILL.md から節を消して作った。外部スキルの動きに頼る検証は takt の中ではできないので、ticket の外で人が行う。grilling と wayfinder を追跡に変えた理由はこれで、[ADR 0003](../adr/0003-fork-wayfinder-and-grilling.md) にある。

## 動作を変えない書き方でも REJECT されるので、implement の段階で避ける

#351 の REJECT は、処理を言い換えるだけのコメント（`// 閉じた issue を開き直す。`）と、`forEach` のコールバックが外側の `let` を書き換える形の 2 件だけで、実行時の欠陥は 0 件だった。それでも fix-plan・fix・fix-verifier・再レビュー・裁定で 5 iteration・約 16 分かかった。先にマージされた `discord.mjs` にも同じ形の `forEach` があるが、差分の外なので対象外にされた。既存のコードに同じ形があっても、新しく書く行では What を書くコメントを書かず、集計は戻り値で組み立てる。

## implement の報告に、文書の変更の確認を行番号まで書く

#333 の implement は、check を通したにもかかわらず、SKILL.md の変更を「未完了（文書の目視確認が未提示）」と自分で報告した。判定はこれを根拠に reimplement を走らせた。reimplement はファイルを 1 つも編集せず、文書を読み直して行番号を記録しただけで終わり、約 2 分を無駄にした。文書を変える ticket では、implement の報告に「確認済み」と行番号まで書けば、この手戻りは出ない。

## 出典

- 仕様 [#325](https://github.com/daiki-beppu/dotfiles/issues/325)、親 issue [#329](https://github.com/daiki-beppu/dotfiles/issues/329)
- [#330](https://github.com/daiki-beppu/dotfiles/issues/330) / [#335](https://github.com/daiki-beppu/dotfiles/pull/335)、[#331](https://github.com/daiki-beppu/dotfiles/issues/331) / [#337](https://github.com/daiki-beppu/dotfiles/pull/337)、[#332](https://github.com/daiki-beppu/dotfiles/issues/332) / [#338](https://github.com/daiki-beppu/dotfiles/pull/338)、[#333](https://github.com/daiki-beppu/dotfiles/issues/333) / [#339](https://github.com/daiki-beppu/dotfiles/pull/339)
- 各 PR の takt の run（`trace.md`・`meta.json`・`reports/`）
- 仕様 [#306](https://github.com/daiki-beppu/dotfiles/issues/306)、親 issue [#344](https://github.com/daiki-beppu/dotfiles/issues/344)
- [#345](https://github.com/daiki-beppu/dotfiles/issues/345) / [#356](https://github.com/daiki-beppu/dotfiles/pull/356)、[#346](https://github.com/daiki-beppu/dotfiles/issues/346) / [#355](https://github.com/daiki-beppu/dotfiles/pull/355)、[#348](https://github.com/daiki-beppu/dotfiles/issues/348) / [#369](https://github.com/daiki-beppu/dotfiles/pull/369)、[#349](https://github.com/daiki-beppu/dotfiles/issues/349) / [#365](https://github.com/daiki-beppu/dotfiles/pull/365)、[#351](https://github.com/daiki-beppu/dotfiles/issues/351) / [#368](https://github.com/daiki-beppu/dotfiles/pull/368)、[#352](https://github.com/daiki-beppu/dotfiles/issues/352)
- 各 ticket の takt の run（`takt-worktrees/20261017T0500-345-…`・`…0607-345-…`・`…0536-346-…`・`…0752-348-…`・`…1421-348-…`・`…0902-349-…`・`…1112-351-…`・`…0642-352-…` の `.takt/runs/*/`）と、PR #356 の評価の run（`.takt/runs/20261017-063239-evaluate-pull-request-356-usin/`）
