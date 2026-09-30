# Fallbacks

このスキルの通常経路(内部 API 直呼び)が使えないときの代替手順。
**フォールバックに落ちたことを報告に必ず含める**(このスキル側の修正が要るサイン)。

## 内部 API が壊れたとき

`import` が失敗する(takt 更新で `dist/` の構造が変わった)ときは、**握りつぶさずユーザーに
告げてから**従来の対話経路に落ちる。対話には TTY が要るので、ユーザーに自分のターミナルで
次を実行してもらう。

```sh
cd <repo_root> && takt -w <workflow> add "#<N>"
```

このとき応答してもらう対話は 6 つ。**3 の `Branch name` と 5 の draft は既定のままだと意図と
食い違う**ので、入れる値を送信時に必ず添える(空欄で送らせない)。

| 順 | プロンプト | 既定 | 備考 |
| --- | --- | --- | --- |
| 1 | `Base branch として <現ブランチ> を使いますか？` | Yes | main / master にいるときは聞かれない |
| 2 | `Worktree path (Enter for auto)` | auto | 空 Enter でよい |
| 3 | `Branch name (Enter for auto)` | auto | **積み増し先があるならここに入れる値を明示する** |
| 4 | `Auto-create PR?` | Yes | |
| 5 | `Create as draft?` | **Yes** | Enter 連打すると **draft PR** になる。通常の PR が欲しければ No |
| 6 | 最終確認 | Yes | |
