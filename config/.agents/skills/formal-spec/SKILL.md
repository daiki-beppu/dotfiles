---
name: formal-spec
description: 仕様 issue の要件を Quint / Alloy で書き、takt の /verify と同じ検証器にかけて、通った形式仕様を issue にコメントで残す。to-spec の後、to-tickets の前に使う。
---

takt の対話モードの `/verify` から、検証器だけを会話なしで借りる。要件を詰める役は grill / to-spec が担うので、このスキルは形式化と検証だけをする。

## 手順

1. **形式化する価値があるか決める。** `gh issue view <N> --json title,body,comments` で仕様 issue を読む。状態遷移・排他・順序・権限のような「常に成り立つべき性質」が無い仕様（CRUD の追加、docs、設定変更）なら、その旨を伝えて終える。

2. **書く。** takt 同梱の制約を先に読む。検証器はこの制約を前提に判定する。

   ```sh
   cat "$(dirname "$(dirname "$(realpath "$(command -v takt)")")")/lib/node_modules/takt/dist/shared/prompts/ja/parts/formal_spec_verifier_constraints.md"
   ```

   scratchpad の Markdown に ```` ```quint ```` / ```` ```alloy ```` のブロックで書く。issue に書かれた要件だけを形式化し、要件を足さない。各 `inv*` / `prop*` / `check` の直前のコメントに、どのユーザーストーリー・実装上の決定を表すかを書く。

   Quint は TLC で全状態を調べる形に書く。verify.sh の lint は、次の 2 つを守っていないと検証前に error を返す。
   - `temporal propSafety = always(invA and invB)` のように、不変条件をまとめた `prop*` を 1 つ置く。`prop*` が無いと検証器は Apalache を使い、20 手の記号探索が時間切れになる。
   - 代入の右辺は 1 つの項にする。論理式なら `x' = (a and b)` と括弧で囲む。前提条件は `all { 条件, x' = … }` の要素に分ける。括弧が無いと `(x' = a) and b` と読まれ、検査が前提条件にすり替わって性質が空振りする。

   状態空間は小さく保つ。PR やユーザーなどの実体は 2 個から始め、3 者の関係を語る性質があるときだけ 3 個にする。`int` は「上限 + 1」までの範囲に収める。名前は `headRev`・`prList` のように 2 語以上にして、`head`・`size` などの組み込み名と重ねない。

3. **検証する。** `scripts/verify.sh <file.md>` を Bash の timeout 600000 で実行する。終了コードは passed=0 / failed=1 / error=2。モデル検査の上限は既定 180 秒で、`FORMAL_SPEC_TIMEOUT_SECONDS` で変えられる。
   - error: lint・構文・制約違反か時間切れ。`message` を見て直す。時間切れなら実体の数と値の範囲を減らす。
   - failed: `violated` に破れた性質の名前が入る。`message` の反例を読み、モデルの書き違いか、要件どうしの矛盾かを見分ける。矛盾ならユーザーの判断なので、反例を「この順で操作するとこうなる」と平易に示して確認する。要件が変わったら issue 本文も直す。
   - 矛盾でユーザーの判断を待って止まるときは、仕様 issue に次を含むコメントを書く（案内役が読み、仕様の Discord スレッドへ判断依頼を送る）。1 行目は見出し `## Formal Spec（takt <版> の検証器で failed）`、続けて `violated` の性質名、最後に `検証器の作業ディレクトリ: <artifacts.runDirectory>` の行。再検証で passed になったら、手順 5 のとおり、このコメントをコメント ID を指定して書き換える。

4. **空振りでないことを確かめる。** passed したら、`inv*` ごとに mutant を作る。mutant は、モデル側（action の前提条件や代入）を 1 か所だけ壊し、その性質が守っている要件を破った版のこと。性質の式そのものは変えない。`scripts/verify.sh --expect-violation <invX> <mutant.md>` が 0 を返せば、その性質は効いている。`always(inv…)` で不変条件をまとめただけの `prop*` は、`inv*` の mutant で足りる。それ以外の `prop*` と Alloy の `check` も、同じように 1 つずつ red にする（Alloy は終了コード 1 と、その `check` の message で確かめる）。すべての性質が red になったら次へ進む。どの mutant でも破れない性質は、モデルか性質の書き違いなので、手順 2 に戻る。

5. **残す。** 本体が passed し、mutant ですべての性質が red になったら、見出し `## Formal Spec（takt <版> の検証器で passed）` と、各ブロック、性質と要件の対応表を issue にコメントする。takt の版は `takt --version` で取る。本文を直して再検証したら、前の Formal Spec コメントをコメント ID を指定して書き換え、新しく足さない（案内役が同じ認証ユーザーで `案内役: …` のコメントを後ろに書くので、最後のコメントは Formal Spec とは限らない）。手順は次のとおり。
   - (a) `gh api user --jq .login` で認証ユーザー（`<viewer>`）を取る。
   - (b) `gh api "repos/{owner}/{repo}/issues/<N>/comments" --paginate --jq '.[] | select(.user.login == "<viewer>" and (.body | startswith("## Formal Spec（"))) | .id' | tail -n 1` で、`<viewer>` が書き 1 行目が `## Formal Spec（` で始まる最後のコメントの ID を取る（`--paginate` はページごとに jq が走るので `tail -n 1` で選ぶ）。
   - (c) ID があれば `gh api -X PATCH "repos/{owner}/{repo}/issues/comments/<id>" -F body=@<file>` で本文を書き換える。
   - (d) ID が無い初回は、従来どおり `gh issue comment <N>` で新しく足す。

   takt は全コメントを order.md に入れるので、古い仕様が残ると実装役に矛盾が届く。
