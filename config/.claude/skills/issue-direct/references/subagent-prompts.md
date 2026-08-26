# subagent プロンプトテンプレート

実装用と CI-fix 用の 2 本。どちらも `## 前提(厳守)` / `## 着手前に読むもの` / `## 返す内容` の
骨格を共有する。`<...>` は呼び出し時に実際の値で埋める。フォーマットを崩すと親が STATUS 行を
機械的に読めなくなる。

## 実装用(Step 2-2)

```text
git worktree `<worktree の絶対パス>` で GitHub issue #<Ni> を実装してください。

## 前提(厳守)
- 最初に必ず `cd <worktree の絶対パス>` を実行し、以降のコマンドはすべてこのディレクトリで実行する
- 正しいブランチ(`<BRANCH>`)は既に checkout 済み。`git checkout` / `git switch` / `git branch` / `gh stack` 系のコマンドは一切実行しない。ブランチを移動するとスタックが壊れる
- `git push` / `gh pr` 系も実行しない。PR 作成は呼び出し元が行う
- このスタックの下段には別 issue の変更が既に載っている。それらは前提として使ってよいが、変更してはならない

## 実装対象
issue #<Ni>: <タイトル>

要件は `gh issue view <Ni> --json title,body,labels` で自分で取得してください。

## 着手前に読むもの(コードを書き始める前に必ず読む)
- <coding policy の絶対パス>
- <testing policy の絶対パス>

このリポジトリのコーディング規約であり、**issue の要件と同じ強制力を持つ**。自分の書き癖と食い違ったときは policy に従う。

policy と issue の要件が噛み合わない場合(policy に従うと要件を満たせない / 要件を満たすと policy に反する)は、**どちらを優先するか自分で決めずに** 実装を止め、STATUS: blocked で噛み合わない箇所を具体的に返す。**判断に迷う場合も blocked に倒す**。ここは人間が裁定する領域で、勝手に折り合いを付けた実装を出す方が手戻りが大きい。

## 進め方
- テストで固定できる挙動は `tdd` スキルを駆動し、赤→緑で1枚ずつ進める。どこを TDD の対象にするか(seam)は実装開始前に決める。設定変更やドキュメント更新のようにテストで固定する対象が無い場合のみ TDD を省く
- typecheck と、触っている範囲の単体テストはこまめに実行する。フルテストスイートと lint は commit 前に1回
- issue #<Ni> の要件だけを実装する。気づいた別の改善には手を出さず、下の NOTES に1行書く
- 完了したら `git add` して commit する(commit まで行う。push はしない)

## 返す内容(この形式のみ。作業ログや差分は返さない)
STATUS: done | blocked
FILES: <変更したファイルのパス一覧>
SUMMARY: <何を実装したか3行以内>
COMMIT: <コミットの subject>
NOTES: <スコープ外で気づいたこと。無ければ none>
```

## CI-fix 用(Step 3-1)

```text
git worktree `<worktree の絶対パス>` で、PR #<PR_NUM>(issue #<Ni>)の CI 失敗を修正してください。

## 前提(厳守)
- 最初に必ず `cd <worktree の絶対パス>` を実行し、以降のコマンドはすべてこのディレクトリで実行する
- 対象ブランチ(`<BRANCH>`)は既に checkout 済み。`git checkout` / `git switch` / `gh stack` 系は一切実行しない
- `git push` / `gh pr` 系も実行しない

## 失敗している check
<check 名と、gh run view --log-failed の該当部分>

## 着手前に読むもの(修正を書き始める前に必ず読む)
- <coding policy の絶対パス>
- <testing policy の絶対パス>
- <ai-antipattern policy の絶対パス>

ai-antipattern は**修正を出す前の自己点検基準**として使う。「テストを弱めて通す」「指摘行だけ書き換える」「使われない互換コードを足す」はここで弾かれる。

**CI を通す唯一の道が policy 違反になる場合は、policy を破って通さない。** STATUS: blocked で「何を通すために何を破る必要があるか」を返す(判断に迷う場合も blocked に倒す)。green を優先して規約を崩した修正は、CI が通っていても差し戻しになる。

## 進め方
- 指摘行だけを直さず「症状 → 根本原因 → 同型箇所 → 修正 → 検証」に分解してから直す
- 表面的な patch で揉み消さない(テストの削除・スキップ・期待値の書き換えで通すのは不可)
- 修正が issue #<Ni> のスコープ外(flaky test、既存の壊れ、インフラ起因)だと判断した場合は、直さず STATUS: out-of-scope で返す
- ローカルで該当テスト・typecheck・lint を通してから commit する(push はしない)

## 返す内容(この形式のみ)
STATUS: fixed | out-of-scope | blocked
CAUSE: <根本原因を1〜2行>
FILES: <変更したファイルのパス一覧>
COMMIT: <コミットの subject>
```
