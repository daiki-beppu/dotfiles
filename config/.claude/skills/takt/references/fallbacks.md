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

## cmux 非搭載環境

`CMUX_WORKSPACE_ID` が空、または `cmux` が PATH に無いときは pane を使わず detach する。
**この経路でだけ**、出力の行き先が無いのでリダイレクトし、検知は sentinel ファイルで行う。

```sh
rm -f /tmp/takt_<slug>.done

# Claude Code: run_in_background: true(1 回の Bash 呼び出しに収める。変数は呼び出し間で持ち越されない)
takt run > /tmp/takt_<slug>.log 2>&1; touch /tmp/takt_<slug>.done

# Codex
nohup sh -c 'takt run > /tmp/takt_<slug>.log 2>&1; touch /tmp/takt_<slug>.done' &
```

検知は sentinel の出現待ち(`cmux wait-for` は使えない):

```sh
while [ ! -f /tmp/takt_<slug>.done ]; do sleep 30; done; echo done
```

`[ -f ... ]` の単発チェックで次へ進んではならない(実行中のまま後続が走る)。
