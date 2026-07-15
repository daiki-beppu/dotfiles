---
name: takt-review
description: >-
  takt の builtin workflow `review-takt-default`（7観点個別レビュー + supervisor、report ファイル出力）で
  PR を自動レビューし、REJECT なら worktree で fix → 再レビューを 1 回だけ行う。
  CI 監視 → レビュー → 判定 → fix（1 回）を一気通貫で実行する。
  「takt レビュー」「PR レビューして」「レビュー回して」など、takt 経由の PR レビュー意図で発動。
  単体起動専用（takt-issue からの自動呼び出しは廃止。takt-issue は CI green で完了する）。
---

# takt-review

## Overview

takt の builtin workflow `review-takt-default`（gather → 7 観点 parallel review → supervise、
`review-summary.md` 等の report ファイル出力あり）で PR を自動レビューし、指摘があれば
worktree 内で修正 → 再レビューを 1 回だけ行うスキル。
CI pass 確認からレビュー完了（APPROVE）または人手エスカレーション（再レビューでも REJECT）までを担当する。

もともと takt-issue の完了後処理から切り出されたスキルだが、現在 takt-issue からの自動呼び出しは行われない（takt-issue は CI green + クリーンアップで完了する）。ユーザーが明示的にレビューを依頼したときに単体で起動する。

**worktree の再作成**: takt-issue は完了時に worktree を削除するため、takt-issue 経由の PR に対して本スキルを回す場合、fix 用の worktree が存在しないことが多い。REJECT で fix が必要になったら `git worktree add <repo-parent>/takt-worktrees/<slug> <branch>` で再作成してから修正する。

## When to Use

- ユーザーが「takt でレビューして」「PR #N をレビュー」「レビュー回して」と依頼したとき
- CI pass 済みの PR に対して takt の自動レビューを手動で回したいとき

## 前提知識（必読）

| 項目 | 仕様 | 対処 |
|------|------|------|
| review workflow | `review-takt-default` は read-only。7 観点個別レビュー + supervisor で、`review-summary.md` 等の report ファイルを出力する | REJECT 時の fix はスキル側がサブエージェント or 直接実行 |
| fix に takt は不要 | `review-fix-takt-default` は使わない（takt 起動オーバーヘッドと Codex トークン消費の回避） | worktree 内で直接コード修正 → commit → push |
| fix は 1 回のみ | REJECT でも fix → 再レビューは 1 周だけ。再レビューでも REJECT なら人手判断を仰ぐ | ループさせず、2 回目の REJECT は報告して終わる |
| token budget guard | takt の長い標準出力が token 消費の主因 | review ログは `tail -80` で末尾のみ。`review-summary.md` と個別レポートは全文読んでよい |
| takt -q の位置 | `-q` はトップレベル option | `takt -q -t ...` の順 |

## Context を収集

```bash
PR_NUM=<PR#>
WORKTREE=<worktree_path>
REPO_ROOT=<repo_root>

gh pr view ${PR_NUM} --json title,state,headRefName,url   # PR 情報
gh pr checks ${PR_NUM}                                      # 現在の CI 状態
```

## Task

### 1. CI チェック監視

`gh pr checks <PR#> --watch` は CI 完了までブロックして exit する。**wrapper スクリプトで包まず**、redirect 付きで直接 background に投げる（前景で `--watch` を読まない。stdout はログに逃がす）。

```bash
PR_NUMBER=<PR#>
```

**待機前に mergeable を確認する**。base とコンフリクトしていると checks がいつまでも揃わず `--watch` が終わらないまま伸び続けることがあるため、待つ前に弾く:

```bash
gh pr view ${PR_NUMBER} --json mergeable,mergeStateStatus -q '"mergeable=\(.mergeable) mergeStateStatus=\(.mergeStateStatus)"'
```

`mergeable=CONFLICTING`（または `mergeStateStatus=DIRTY`）なら、worktree が無ければ Overview の手順（`git worktree add <repo-parent>/takt-worktrees/<slug> <branch>`）で再作成し、base を merge/rebase してコンフリクトを解消してから CI 監視に進む。解消後は mergeable を再確認して `MERGEABLE` になってから次に進む。

- **Claude Code**: `Bash` の `run_in_background: true` で `gh pr checks ${PR_NUMBER} --watch --interval 30 > /tmp/ci_pr${PR_NUMBER}.log 2>&1` を投げる（timeout `2400000ms` = 40 分）。exit 時に自動再呼び出しされるので poll しない。exit code がそのまま合否（0=green）。
- **Codex / その他 CLI**: 自動再呼び出しが無いため、起動とブロッキング待機を 1 コマンドにまとめて実行する。`kill -0` を 1 回だけ確認して次に進むと CI 完了前に後続を実行してしまう:

  ```bash
  nohup gh pr checks ${PR_NUMBER} --watch --interval 30 > /tmp/ci_pr${PR_NUMBER}.log 2>&1 &
  echo $! > /tmp/ci_pr${PR_NUMBER}.pid
  while kill -0 "$(cat /tmp/ci_pr${PR_NUMBER}.pid)" 2>/dev/null; do sleep 30; done
  ```

  コマンドの実行環境に timeout があり `while` が途中で打ち切られた場合は、同じ `while kill -0 ...` の行だけ再実行すればよい（pid の生存確認のみでべき等）。

完了したら（Claude Code は再呼び出し / Codex は上記コマンドの return）、**まず mergeable を再確認してから** `gh pr checks ${PR_NUMBER}` を実行して結果を確認する（待機中に base が進んでコンフリクトが発生していることがあるため、checks の合否だけで判断しない）:

```bash
gh pr view ${PR_NUMBER} --json mergeable,mergeStateStatus -q '"mergeable=\(.mergeable) mergeStateStatus=\(.mergeStateStatus)"'
```

- **mergeable=CONFLICTING** → 上記の解消手順を行い、push 後に Step 1 を再実行する（checks の結果に関わらず優先して解消する）
- **mergeable=MERGEABLE** かつ **exit 0** → 全 check pass。Step 2 へ
- **mergeable=MERGEABLE** かつ **exit ≠ 0** → 失敗 check を `gh pr checks ${PR_NUMBER}` で特定し、`gh run view <run-id> --log-failed` で失敗ログを取得。修正は worktree で行い、push 後に Step 1 を再実行

CI fail が対象 PR のスコープ外（flaky test など）と判断した場合は、ユーザーに報告して判断を仰ぐ。

### 2. 自動レビュー（review-takt-default）

CI pass 後、builtin `review-takt-default` で 7 観点レビュー（read-only）を起動する。

```bash
PR_NUM=<PR#>
REVIEW_LOG="/tmp/takt_review_${PR_NUM}.log"
```

`review-takt-default` も完了までブロックして exit する。stdout はログに逃がし、background に投げる（timeout `3600000ms` = 60 分）:

- **Claude Code**: `Bash` の `run_in_background: true` で下記コマンドを投げる。exit 時に自動再呼び出しされるので poll しない。

```bash
cd <repo_root>
takt -q -t "#${PR_NUM}" -w review-takt-default > "$REVIEW_LOG" 2>&1
```

- **Codex / その他 CLI**: 自動再呼び出しが無いため、起動とブロッキング待機を 1 コマンドにまとめて実行する。起動だけして待たずに次へ進むと `review-summary.md` がまだ存在せず後続が失敗する:

```bash
cd <repo_root>
nohup takt -q -t "#${PR_NUM}" -w review-takt-default > "$REVIEW_LOG" 2>&1 &
echo $! > /tmp/takt_review_${PR_NUM}.pid
while kill -0 "$(cat /tmp/takt_review_${PR_NUM}.pid)" 2>/dev/null; do sleep 30; done
```

コマンドの実行環境に timeout があり `while` が途中で打ち切られた場合は、同じ `while kill -0 ...` の行だけ再実行すればよい（べき等）。

完了したら（Claude Code は再呼び出し / Codex は上記コマンドの return）`review-summary.md` を読む:

```bash
RUN_SLUG=$(ls -t .takt/runs/ | head -1)
cat .takt/runs/${RUN_SLUG}/reports/*review-summary.md
```

`tail -80 "$REVIEW_LOG"` で末尾も確認し、takt 自体のエラーがないか見る。

レビュー結果を PR コメントに投稿:

```bash
REVIEW_FILE=$(ls .takt/runs/${RUN_SLUG}/reports/*review-summary.md)
gh pr comment "${PR_NUM}" --body "$(cat <<COMMENT
## 🔍 takt review (review-takt-default)

$(cat "$REVIEW_FILE")
COMMENT
)"
```

### 3. 判定 → fix（1 回のみ）

`review-summary.md` の `## 総合判定:` を確認する。

```
判定を読む
├─ APPROVE → ユーザーに報告（完了）
└─ REJECT
     → Step 4（fix）を 1 回だけ実行
     → Step 2（再レビュー）を 1 回だけ実行
     → 再判定を読む
        ├─ APPROVE → ユーザーに報告（完了）
        └─ REJECT  → それ以上 fix せず、レビュー結果と実施した fix を
                     ユーザーに報告し、人手判断を仰ぐ（完了）
```

**fix は 1 回のみ**。再レビュー後は判定にかかわらずループしない。

### 4. fix（REJECT 時）

`review-summary.md` の指摘事項に基づき、**worktree 内で直接コードを修正** する。

1. `review-summary.md` の全文と、7 個別レポートの指摘部分を読む:

```bash
RUN_SLUG=$(ls -t .takt/runs/ | head -1)
cat .takt/runs/${RUN_SLUG}/reports/review-summary.md
# 個別レポート（各数 KB の Markdown。jsonl ログとは別物なので全文読んでよい）
cat .takt/runs/${RUN_SLUG}/reports/{architecture,security,qa,testing,ai-antipattern,pure,coding}-review.md
```

summary の指摘（new / persists）に加えて、個別レポートから次の 2 種を拾い、fix 対象リストに含める:

- **今回修正するファイルと同じファイルへの警告・非ブロッキング指摘** — 次ラウンドで新規指摘に昇格しやすい（実測: 再 REJECT の 77% が前回と同じファイルへの新規指摘）
- **改善提案のうち PR スコープ内で数分で対応できるもの** — スコープ外のものは対応せず、PR コメントで「対応しない理由」を 1 行ずつ明記する

存在しないレポートがあっても続行してよい（`cat` の個別失敗は無視）。

2. worktree 内でコードを修正（**必ず worktree で実行**。repo root で修正すると main を汚染する）:

```bash
cd <worktree_path>
```

指摘の重要度順（REJECT 原因 → WARNING → INFO）に該当ファイルを確認する。ただし、**レビュー文面をなぞった表面的な修正で終わらせない**。編集前に各指摘を次の形に分解する:

- レビューが観測した症状
- その症状を生んだ根本原因（壊れている不変条件、契約、責務分界、データフロー、テスト前提）
- 同じ原因で壊れうる同型箇所（`rg`、callsite 追跡、周辺テスト確認で探す）
- 根本原因を取り除く修正方針
- 回帰を防ぐ検証（既存テスト追加・更新、focused test、手動検証のいずれか）

修正時の判断基準:

- 指摘された行だけを変えるのではなく、同じ設計ミス・仮定漏れ・境界条件漏れが他にもないか探し、PR スコープ内なら一緒に直す
- hard-code、条件分岐の継ぎ足し、エラー握りつぶしなどでレビュー文面だけを満たす修正は避ける
- レビューが具体例を 1 件だけ挙げている場合でも、その具体例を bug class の代表として扱い、入力経路・状態遷移・公開 API・テスト期待値まで辿る
- 既存の設計や helper に沿った修正を優先し、新しい抽象化は重複や責務混在を実際に減らす場合だけ入れる
- 根本原因が特定できない場合は推測で patch せず、追加調査する。1 回の fix で解けない不確実性は PR コメントで明示して人手判断に回す

コミット前に `git diff` を読み、各 REJECT について「原因 → 修正 → 検証」が説明できる状態にする。WARNING/INFO も同じ根本原因に属するものは合わせて処理する。

3. **自己監査（再レビュー前ゲート）**: レビュアーは「マージベースからの累積差分全体 +
   関係箇所」を毎回再走査する。fix した行だけでなく、自分の fix を含めた累積差分全体を
   レビュアーと同じ視点で監査してから再レビューに出す:

   ```bash
   # レビュアーが見るのと同じ差分を取る
   git diff $(git merge-base origin/main HEAD)..HEAD
   ```

   - リポジトリに `.takt/facets/policies/pre-review-checklist.md` が存在する場合は、
     その監査 8 項目（挙動⇔テスト 1:1、兄弟入口の貫通、ドキュメント突き合わせ等）を
     累積差分全体に対して照合する。存在しないリポジトリでは次の最低限 4 点を照合する:
     1. 変更した観測可能な挙動それぞれに対応するテストがあるか
     2. 変更した契約（データ形式・config キー・API）が同責務の全入口に貫通しているか
     3. 変更内容と矛盾するドキュメント・コメント・CHANGELOG の旧記述が残っていないか
     4. fix で追加した catch / fallback が失敗を握りつぶしていないか
   - fix によって未使用になったコード（import・引数・変数）が残っていないか累積差分を確認する
   - リポジトリのテスト・lint を全実行して green を確認する（コマンドはリポジトリの
     CLAUDE.md / package.json / pyproject.toml から特定する）
   - 自己監査で見つけた問題は、この時点で fix に含める（再レビュー後に直す機会はない）

4. 修正をコミットして push:

```bash
git add -A
git commit -m "fix: address review findings"
git push
```

5. 修正内容を PR コメントに投稿:

```bash
gh pr comment "${PR_NUM}" --body "$(cat <<COMMENT
## 🔧 fix

### 指摘ごとの解消根拠
| finding_id | 原因 | 修正（ファイル:行 / commit） | 検証 |
|---|---|---|---|
| SUM-NEW-... | (根本原因 1 文) | \`path/to/file.ts:42\` | (追加・更新したテスト名 or 実行した確認) |

### 個別レポートの警告・改善提案への対応
- 対応済み: (同一ファイルの警告で fix に含めたもの)
- 対応しない: (改善提案のうちスコープ外としたもの — 理由を 1 行ずつ)

### 自己監査
- 累積差分（merge-base 起点）に対するチェックリスト照合: (結果)
- test / lint: (実行コマンドと結果)

再レビューを 1 回だけ実行します。
COMMENT
)"
```

表の finding_id は `review-summary.md` の表記をそのまま使うこと（`SUM-NEW-*` / `ARCH-*` / `PURE-*` などレビューごとに形式が異なるが、変換しない）。

修正後、**Step 2 に戻って再レビューを 1 回だけ**実行する。再レビューでも REJECT なら、それ以上 fix せず人手判断を仰ぐ。

## Gotchas

- **fix は 1 回のみ**: REJECT → fix → 再レビューは 1 周だけ。再レビューでも REJECT ならループさせず、結果を報告して人手判断に回す
- **`review-fix-takt-default` は使わない**: takt 起動オーバーヘッドと Codex トークン消費の回避のため、fix は worktree 内で直接実行する
- **review ログ（jsonl / trace.md）は全文読まない**: `tail -80` で末尾のみ。`reports/` 配下の Markdown（summary + 7 個別レポート）は各数 KB なので全文読んでよい
- **worktree で修正**: repo root で修正すると main を汚染する。必ず worktree 内で `cd` してから編集
- **takt -q の位置**: `-q` はトップレベル option。`takt -q -t ...` の順で指定
- **レビューの takt ログ**: `.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない。`wc` / `du` / `tail -80` で絞る
- **APPROVE なら fix 不要**: Step 2 で APPROVE なら Step 4 は実行しない。即完了
- **表面的な修正は禁止**: 指摘行だけを直して終わらせず、根本原因・同型箇所・回帰検証まで確認する
- **CI fail がスコープ外の場合**: flaky test 等は修正せず、ユーザーに報告して判断を仰ぐ
- **クリーンアップは呼び出し元の責務**: このスキルは `takt list --action delete` を実行しない。worktree（fix 用に再作成したものを含む）の削除はユーザーが別途行う（再作成した worktree は `git worktree remove` で片付ける）
- **`npx` は不要**: `takt` を直接実行する

## Rules

- CI pass を確認してからレビューを開始する。CI をスキップしない
- CI 監視は checks の合否だけで判断しない。待機の前後で `gh pr view --json mergeable,mergeStateStatus` を確認し、`CONFLICTING`/`DIRTY` なら checks の結果に関わらずコンフリクト解消を優先する（base とコンフリクトしていると checks がいつまでも揃わず待機が伸び続けることがあるため）
- レビューは builtin `review-takt-default` で実行する
- `review-takt-default` で APPROVE ならそのまま完了。fix は実行しない
- REJECT 時は worktree 内で直接コード修正する。`review-fix-takt-default` は使わない
- REJECT 時は各指摘を「症状 → 根本原因 → 同型箇所 → 修正 → 検証」に分解してから直す
- 指摘文面だけを満たす hard-code や局所 patch を避け、同じ bug class が再レビューで別指摘にならないよう横展開確認する
- fix は 1 回のみ。fix → 再レビューを 1 周だけ回し、再レビューでも REJECT なら人手判断を仰ぐ
- review ログは `tail -80` で必要時のみ読む。全文表示禁止
- `.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない
- 修正は worktree 内で行う。repo root で修正しない
- レビュー結果と修正内容は PR コメントに投稿する
- `npx` は使わず `takt` を直接実行する
- このスキルはクリーンアップ（`takt list --action delete`）を実行しない。呼び出し元の責務
