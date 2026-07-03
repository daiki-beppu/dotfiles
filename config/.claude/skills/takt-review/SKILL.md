---
name: takt-review
description: >-
  takt の review-takt-default で PR を 7 観点自動レビューし、結果を PR コメントに投稿して報告する（read-only）。
  CI 監視 → レビュー → 判定報告を一気通貫で実行する。fix は行わない（REJECT はユーザーに報告して判断を仰ぐ）。
  「takt レビュー」「PR レビューして」「レビュー回して」など、takt 経由の PR レビュー意図で発動。
  単体起動専用（takt-issue からの自動呼び出しは廃止。takt-issue は CI green で完了する）。
---

# takt-review

## Overview

takt の `review-takt-default` workflow で PR を自動レビューし、結果を PR コメントに投稿して報告する read-only スキル。CI pass 確認からレビュー結果の報告までを担当する。

**fix は行わない**。APPROVE ならそのまま完了、REJECT ならレビュー結果をユーザーに報告して判断を仰ぐ。修正が必要な場合はユーザーが `/code-review` や別スキル、あるいは手動で対応する。

もともと takt-issue の完了後処理から切り出されたスキルだが、現在 takt-issue からの自動呼び出しは行われない（takt-issue は CI green + クリーンアップで完了する）。ユーザーが明示的にレビューを依頼したときに単体で起動する。

## When to Use

- ユーザーが「takt でレビューして」「PR #N をレビュー」「レビュー回して」と依頼したとき
- CI pass 済みの PR に対して takt の 7 観点レビューを手動で回したいとき

## 前提知識（必読）

| 項目 | 仕様 | 対処 |
|------|------|------|
| review workflow | `review-takt-default` は read-only 7 観点レビュー。コード修正は行わない | 本スキルも fix はしない。REJECT はユーザーに報告 |
| token budget guard | takt の長い標準出力が token 消費の主因 | review ログは `tail -80` で末尾のみ。`review-summary.md` だけ全文読む |
| takt -q の位置 | `-q` はトップレベル option | `takt -q -t ...` の順 |

## Context を収集

```bash
PR_NUM=<PR#>
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
- **exit ≠ 0** → CI が fail している。レビューはスコープ外なので、失敗 check を `gh pr checks ${PR_NUMBER}` で特定し、`gh run view <run-id> --log-failed` で失敗ログの要点を確認したうえで、ユーザーに報告して判断を仰ぐ（本スキルは修正しない）

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

### 3. 判定を報告

`review-summary.md` の `## 総合判定:` を確認し、結果をユーザーに報告して完了する。

- **APPROVE** → レビュー通過。PR URL と判定をユーザーに報告して完了
- **REJECT** → レビュー結果（指摘事項の要点）をユーザーに報告する。**fix は行わない**。修正が必要かどうか、どう修正するかはユーザーの判断に委ねる（ユーザーが `/code-review` や手動修正、別途対応を選ぶ）

いずれの場合も、投稿済みの PR コメントへのリンクと総合判定を明示して報告する。

## Gotchas

- **fix は行わない**: 本スキルは read-only。REJECT でもコード修正・再レビューはしない。レビュー結果を報告して終わる
- **`review-fix-takt-default` は使わない**: fix 自体を本スキルの責務としないため、fix 系 workflow は起動しない
- **review ログは全文読まない**: `tail -80` で末尾のみ。`review-summary.md` だけ全文読んでよい
- **takt -q の位置**: `-q` はトップレベル option。`takt -q -t ...` の順で指定
- **レビューの takt ログ**: `.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない。`wc` / `du` / `tail -80` で絞る
- **CI fail の場合**: レビュー前に CI が fail していたらレビューはスコープ外。ユーザーに報告して判断を仰ぐ
- **クリーンアップは呼び出し元の責務**: このスキルは `takt list --action delete` を実行しない。worktree の削除はユーザーが別途行う
- **`npx` は不要**: `takt` を直接実行する

## Rules

- CI pass を確認してからレビューを開始する。CI をスキップしない
- レビューは read-only。APPROVE でも REJECT でもコード修正・再レビューは行わない
- REJECT 時はレビュー結果をユーザーに報告して判断を仰ぐ。自動で fix しない
- review ログは `tail -80` で必要時のみ読む。全文表示禁止
- `.takt/runs/**/logs/*.jsonl` と `trace.md` は全文表示しない
- レビュー結果は PR コメントに投稿し、総合判定をユーザーに報告する
- `npx` は使わず `takt` を直接実行する
- このスキルはクリーンアップ（`takt list --action delete`）を実行しない。呼び出し元の責務
