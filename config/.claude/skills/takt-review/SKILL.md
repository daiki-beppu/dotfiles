---
name: takt-review
description: >-
  takt の review-takt-default で PR を 7 観点自動レビューし、REJECT なら worktree で fix → 再レビューを最大 3 周回す。
  CI 監視 → レビュー → 判定 → fix ループを一気通貫で実行する。
  「takt レビュー」「PR レビューして」「レビュー回して」など、takt 経由の PR レビュー意図で発動。
  takt-issue の完了後処理（Phase 2）からも呼ばれる。
---

# takt-review

## Overview

takt の `review-takt-default` workflow で PR を自動レビューし、指摘があれば worktree 内で修正 → 再レビューを繰り返すスキル。CI pass 確認からレビュー完了（APPROVE）または人手エスカレーション（3 周 REJECT）までを担当する。

takt-issue の Step 5-C〜5-F に相当するフェーズを独立スキルとして切り出したもの。takt-issue からの呼び出し、または単体での PR レビューに使える。

## When to Use

- takt-issue の完了後処理（Phase 2 dispatch）から呼ばれたとき
- ユーザーが「takt でレビューして」「PR #N をレビュー」「レビュー回して」と依頼したとき
- CI pass 済みの PR に対して takt の 7 観点レビューを手動で回したいとき

## 前提知識（必読）

| 項目 | 仕様 | 対処 |
|------|------|------|
| review workflow | `review-takt-default` は read-only 7 観点レビュー。コード修正は行わない | REJECT 時の fix はスキル側がサブエージェント or 直接実行 |
| fix に takt は不要 | `review-fix-takt-default` は使わない（takt 起動オーバーヘッドと Codex トークン消費の回避） | worktree 内で直接コード修正 → commit → push |
| token budget guard | takt の長い標準出力が token 消費の主因 | review ログは `tail -80` で末尾のみ。`review-summary.md` だけ全文読む |
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

GitHub Actions の完了まで待つ。background 実行 + 完了時 1 通知パターン。

```bash
PR_NUMBER=<PR#>

cat > /tmp/wait_ci_pr${PR_NUMBER}.sh <<EOF
#!/usr/bin/env bash
set -u
cd <repo_root>
echo "[wait_ci] start \$(date '+%H:%M:%S') PR=#${PR_NUMBER}"
gh pr checks ${PR_NUMBER} --watch --interval 30
EXIT=\$?
echo "[wait_ci] DONE \$(date '+%H:%M:%S') exit=\$EXIT"
gh pr checks ${PR_NUMBER}
exit \$EXIT
EOF
chmod +x /tmp/wait_ci_pr${PR_NUMBER}.sh
```

Claude Code では `Bash` の `run_in_background: true` で投げる（timeout `2400000ms` = 40 分）。

完了通知が来たら:

- **exit 0** → 全 check pass。Step 2 へ
- **exit ≠ 0** → 失敗 check を `gh pr checks ${PR_NUMBER}` で特定し、`gh run view <run-id> --log-failed` で失敗ログを取得。修正は worktree で行い、push 後に Step 1 を再実行

CI fail が対象 PR のスコープ外（flaky test など）と判断した場合は、ユーザーに報告して判断を仰ぐ。

### 2. 自動レビュー

CI pass 後、`review-takt-default` で 7 観点 read-only レビューを起動する。

```bash
PR_NUM=<PR#>
REVIEW_LOG="/tmp/takt_review_${PR_NUM}.log"
```

`run_in_background: true` で実行（timeout `3600000ms` = 60 分）:

```bash
cd <repo_root>
takt -q -t "#${PR_NUM}" -w review-takt-default > "$REVIEW_LOG" 2>&1
```

完了通知が届いたら `review-summary.md` を読む:

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

### 3. 判定 → fix ループ

`review-summary.md` の `## 総合判定:` を確認し、**APPROVE になるまで Step 4 → Step 2 を繰り返す**（最大 3 周。超えたら人手判断を仰ぐ）。

```
REVIEW_ROUND=1

loop:
  判定を読む
  ├─ APPROVE → ユーザーに報告（完了）
  └─ REJECT
       ├─ REVIEW_ROUND >= 3 → ユーザーに状況を報告し人手判断を仰ぐ
       └─ REVIEW_ROUND < 3
            → Step 4（fix）実行
            → Step 2（再レビュー）実行
            → REVIEW_ROUND++
            → loop に戻る
```

### 4. fix（REJECT 時）

`review-summary.md` の指摘事項に基づき、**worktree 内で直接コードを修正** する。

1. `review-summary.md` の全文を読む:

```bash
RUN_SLUG=$(ls -t .takt/runs/ | head -1)
cat .takt/runs/${RUN_SLUG}/reports/*review-summary.md
```

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
- 根本原因が特定できない場合は推測で patch せず、追加調査する。3 周以内に解けない不確実性は PR コメントで明示して人手判断に回す

コミット前に `git diff` を読み、各 REJECT について「原因 → 修正 → 検証」が説明できる状態にする。WARNING/INFO も同じ根本原因に属するものは合わせて処理する。

3. 修正をコミットして push:

```bash
git add -A
git commit -m "fix: address review findings round ${REVIEW_ROUND}"
git push
```

4. 修正内容を PR コメントに投稿:

```bash
gh pr comment "${PR_NUM}" --body "$(cat <<COMMENT
## 🔧 fix round ${REVIEW_ROUND}

review-summary の指摘事項に基づき、根本原因と同型箇所を確認して修正しました。

### 修正内容
- (修正した内容をリスト)

### 根本原因・横展開
- (主要な根本原因と、同型箇所を確認した範囲)

### 検証
- (実行した test / check / 手動確認)

再レビューを実行します。
COMMENT
)"
```

修正後、**Step 2 に戻って再レビュー**を実行する。

## Gotchas

- **`review-fix-takt-default` は使わない**: takt 起動オーバーヘッドと Codex トークン消費の回避のため、fix は worktree 内で直接実行する
- **review ログは全文読まない**: `tail -80` で末尾のみ。`review-summary.md` だけ全文読んでよい
- **worktree で修正**: repo root で修正すると main を汚染する。必ず worktree 内で `cd` してから編集
- **takt -q の位置**: `-q` はトップレベル option。`takt -q -t ...` の順で指定
- **レビューの takt ログ**: `.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない。`wc` / `du` / `tail -80` で絞る
- **APPROVE なら fix 不要**: Step 2 で APPROVE なら Step 4 は実行しない。即完了
- **表面的な修正は禁止**: 指摘行だけを直して終わらせず、根本原因・同型箇所・回帰検証まで確認する
- **CI fail がスコープ外の場合**: flaky test 等は修正せず、ユーザーに報告して判断を仰ぐ
- **クリーンアップは呼び出し元の責務**: このスキルは `takt list --action delete` を実行しない。takt-issue から呼ばれた場合は takt-issue 側で、単体実行の場合はユーザーが別途クリーンアップする
- **`npx` は不要**: `takt` を直接実行する

## Rules

- CI pass を確認してからレビューを開始する。CI をスキップしない
- `review-takt-default` で APPROVE ならそのまま完了。fix は実行しない
- REJECT 時は worktree 内で直接コード修正する。`review-fix-takt-default` は使わない
- REJECT 時は各指摘を「症状 → 根本原因 → 同型箇所 → 修正 → 検証」に分解してから直す
- 指摘文面だけを満たす hard-code や局所 patch を避け、同じ bug class が再レビューで別指摘にならないよう横展開確認する
- fix ループは最大 3 周。超えたら人手判断を仰ぐ
- review ログは `tail -80` で必要時のみ読む。全文表示禁止
- `.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない
- 修正は worktree 内で行う。repo root で修正しない
- レビュー結果と修正内容は PR コメントに投稿する
- `npx` は使わず `takt` を直接実行する
- このスキルはクリーンアップ（`takt list --action delete`）を実行しない。呼び出し元の責務
