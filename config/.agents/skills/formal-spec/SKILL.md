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

3. **検証する。** `scripts/verify.sh <file.md>` を実行する。終了コードは passed=0 / failed=1 / error=2。
   - error: 構文か制約違反。`message` を見て直す。
   - failed: `message` の反例を読み、モデルの書き違いか、要件どうしの矛盾かを見分ける。矛盾ならユーザーの判断なので、反例を「この順で操作するとこうなる」と平易に示して確認する。要件が変わったら issue 本文も直す。

4. **残す。** passed したら、見出し `## Formal Spec（takt <版> の検証器で passed）` と、各ブロック、性質と要件の対応表を issue にコメントする。takt の版は `takt --version` で取る。本文を直して再検証したら、前の Formal Spec コメントを `gh issue comment <N> --edit-last` で書き換え、新しく足さない。takt は全コメントを order.md に入れるので、古い仕様が残ると実装役に矛盾が届く。
