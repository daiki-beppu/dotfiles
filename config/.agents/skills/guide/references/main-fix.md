## 進め方

確認を省いて結果まで進める。途中でユーザーに質問せず、下の 2 つの分岐のどちらかで終える。

1. 上の「失敗した run」の落ちた job のログを読む（`gh run view <run> --log-failed`）。
2. 「最後に緑だった commit」から C までの差分（`git diff <最後に緑だった commit> <C>`）と、範囲の PR を読み、落ちた原因を特定する。
3. 原因と直し方で、次の 2 つのどちらかに進む。

### 分岐 1: 直せる場合

今の worktree（origin/main から切ってある）で、直す変更を作る。手元で、落ちたチェックに相当する検査を、repo の運用文書（AGENTS.md・`docs/agents/` など）の手順で通す。

commit して push し、main 向けの PR を出して、`gh pr merge <PR> --squash --auto` で自動マージを予約する。修正も、ほかの PR と同じ CI の門を通る。PR の本文には次を書く。

- 落ちたチェック
- 失敗した run の URL
- 原因の PR とその issue（範囲の PR のうち、壊した PR と、その PR が閉じた issue）
- 直し方

### 分岐 2: 直せない場合

原因が分からない、直し方に判断が要る、revert すべきと判断した、のどれかなら、C の commit comment に上の「直せなかった印」の形で理由を書いて止まる。

```sh
gh api repos/<owner/repo>/commits/<C>/comments -f body='案内役: main-fix が直せなかった（commit <C>）: <理由>'
```

revert の PR は出さない。revert するかは人が決める。

## 変えないもの

原因の PR の issue の本文・完了条件・ラベルを変えない。変える必要があるなら、直せないものとして分岐 2 で止まる。
