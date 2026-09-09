# Fallbacks

このスキルの通常経路(内部 API 直呼び / cmux pane)が使えないときの代替手順。
どちらも**フォールバックに落ちたことを報告に必ず含める**(このスキル側の修正が要るサイン)。

## 内部 API が壊れたとき

`import` が失敗する(takt 更新で `dist/` の構造が変わった)ときは、**握りつぶさずユーザーに
告げてから**従来の対話経路に落ちる。pane の確保は
[cmux-workspace](../../cmux-workspace/SKILL.md) の
**Right-Side Helper Pane** ポリシーに従う(フェーズ 5 と同じ helper pane でよい)。

```sh
cmux send --surface surface:<N> "cd <repo_root> && takt -w <workflow> add \"#<N>\"\n"
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

fallback に落ちたことは報告に必ず含める(このスキル側の修正が要るサイン)。

## cmux を利用できない環境

`CMUX_WORKSPACE_ID` が空、`cmux` が PATH に無い、または socket アクセスが拒否された場合は、ホストの継続可能な実行セッションを使う。利用不能な pane の設定変更はこのタスクの前提にしない。

```sh
takt run > /tmp/takt_<slug>.log 2>&1
```

- Claude Code は `run_in_background: true`、Codex はセッション ID を返す exec/TTY を使い、同じ実行の完了結果を回収する。大量の stdout は読まず、必要なログだけ抽出する。
- セッションが実行中なら待機を続ける。応答待ち timeout は失敗・終了の証拠ではない。
- セッションを回収できないときはプロセスとタスク状態を確認する。古いログや sentinel の存在だけで成功扱い・再起動しない。
- 完了後の成果確認は SKILL.md の「完了時の確認」に従う。継続実行できる手段が無ければ、投入済み／実行未完了を分けて報告する。
