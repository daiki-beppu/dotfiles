---
name: issue-direct
description: >-
  takt を使わず Claude Code だけで GitHub issue を実装する(worktree 作成 → 実装 → PR 作成 → CI green まで監視 →
  fix ループ)。「takt なしで issue対応」「issue #N を対応 takt なし」「takt 使わずに issue やって」「PR作成とCI
  greenまで」など、takt 経由ではなく直接実装する意図が読み取れる発話で発動。7観点自動レビューやマージは対象外(CI green で完了)。
---

# issue-direct

## Overview

takt CLI を一切使わず、Claude Code のみで GitHub issue を実装し PR 化するスキル。worktree 作成・実装・PR 作成・CI 監視・fix ループを一気通貫で行う。**CI green を確認し PR を ready for review 化した時点で完了**とし、takt-review 相当の 7 観点自動レビューやマージは行わない。追加レビューが必要な場合はユーザーが別途 `/code-review` や `takt-review` を依頼する。

## When to Use

- 「takt なしで issue #N 対応して」「issue #N を pr 作成と ci green まで」といった依頼
- 対象リポジトリに takt が未導入、または今回は takt を使いたくない場合

## 前提知識

| 項目 | 対処 |
|---|---|
| worktree 置き場 | `$REPO_ROOT/.worktrees/<slug>/`(dotfiles CLAUDE.md 規約)。`.gitignore` に `.worktrees/` が無ければ追加 |
| worktree の重複作成 | 作成前に `git worktree list` で確認。Codex / Claude Desktop 等が対象 issue 用に既に作成済みならそれを再利用し新規作成をスキップ |
| main 最新化 | 新規に worktree を作る場合のみ、作成前に必ず `main` で `git pull --ff-only` |
| CI 監視 | 前景で `--watch` を直接叩かない。`gh pr checks --watch` を wrapper なしで redirect 付き background 投げ。完了は Claude Code=自動再呼び出し / Codex=`while kill -0 ...; do sleep 30; done` の1コマンドブロッキング待機(単発チェックでは不可) |
| fix ループ | 最大 3 周。超えたら人手判断を仰ぐ |
| スコープ | PR 作成 → CI green まで。レビュー・マージ・worktree 削除はスコープ外 |

## Task

### 0. Context 収集

```bash
gh issue view <N> --json title,body,labels,state,url
gh repo view --json nameWithOwner
```

### 1. 既存 worktree の確認 → (無ければ)main 最新化 → worktree 作成

Codex CLI や Claude Desktop など他のクライアントが同じ issue に対して先に worktree を作成している場合があるため、**新規作成の前に必ず確認する**。

```bash
git worktree list
```

ブランチ名やパスに issue 番号(`<N>`)や issue タイトルの slug を含む worktree が既に存在する場合は、**その worktree をそのまま使い、以下の新規作成手順をスキップして Step 2 に進む**(main の最新化・`git worktree add` は行わない)。

存在しない場合のみ、以下で新規作成する:

```bash
cd <repo_root>
git checkout main && git pull --ff-only
SLUG="issue-<N>-<short-slug>"
git worktree add ".worktrees/${SLUG}" -b "${SLUG}"
```

`.gitignore` に `.worktrees/` が無ければ main 側で追加してコミットする。

### 2. 実装

worktree(`.worktrees/${SLUG}`)内で issue の要件を実装する。リポジトリ既存の lint / test / typecheck を実行してから commit する。テスト先行が有効な新規 feature なら `tdd` スキルの活用を検討してよいが必須ではない。

### 3. commit → push → PR 作成

```bash
cd ".worktrees/${SLUG}"
git add -A && git commit -m "<message>"
git push -u origin "${SLUG}"
gh pr create --draft --title "<title>" --body "$(cat <<'EOF'
## Summary
...

Closes #<N>
EOF
)"
```

PR は常に **draft** で作成する(CI 通過前にレビュアーへ通知を飛ばさないため)。CI green を確認した後、Step 6 で自動的に ready for review 化する。

### 4. CI 監視(background、poll しない)

`gh pr checks <PR#> --watch` は CI 完了までブロックして exit する。takt-review Step 1 と同じく **wrapper スクリプトで包まず** redirect 付きで直接 background に投げる(前景で `--watch` しない。stdout はログに逃がす)。

```bash
PR_NUM=<PR#>
```

- **Claude Code**: `Bash` の `run_in_background: true` で `gh pr checks ${PR_NUM} --watch --interval 30 > /tmp/ci_pr${PR_NUM}.log 2>&1` を投げる(timeout 目安 `2400000ms` = 40 分)。exit 時に自動再呼び出しされるので poll しない。exit code がそのまま合否(0=green)。wrapper を作らないので `chmod` も不要。待っている間は他作業に context を使ってよい(前景で sleep 待ちしない)。
- **Codex / その他 CLI**: 自動再呼び出しが無いため、起動とブロッキング待機を1コマンドにまとめて実行する。`kill -0` を1回だけ確認して次に進むと CI 完了前に後続を実行してしまう:

  ```bash
  nohup gh pr checks ${PR_NUM} --watch --interval 30 > /tmp/ci_pr${PR_NUM}.log 2>&1 &
  echo $! > /tmp/ci_pr${PR_NUM}.pid
  while kill -0 "$(cat /tmp/ci_pr${PR_NUM}.pid)" 2>/dev/null; do sleep 30; done
  ```

  コマンドの実行環境に timeout があり `while` が途中で打ち切られた場合は、同じ `while kill -0 ...` の行だけ再実行すればよい(pid の生存確認のみでべき等)。

### 5. 判定 → fix ループ(最大 3 周)

- **exit 0**(全 green) → Step 6 へ
- **exit ≠ 0** → `gh pr checks <PR#>` で失敗 check を特定し、`gh run view <run-id> --log-failed` で失敗ログを取得
  - worktree 内で修正する。指摘行だけを直さず「症状 → 根本原因 → 同型箇所 → 修正 → 検証」に分解してから直す
  - commit → push → Step 4 を再実行、ラウンド +1
  - **3 周を超えたら**ユーザーに状況を報告し人手判断を仰ぐ(自動で回し続けない)
  - CI fail が対象 issue のスコープ外(flaky test 等)と判断した場合もユーザーに報告し判断を仰ぐ

### 6. 完了報告

CI green を確認したら `gh pr ready <PR#>` で ready for review 化し、PR URL・変更概要・fix ラウンド数を報告して終了する。worktree は残す(PR がまだ merge されていないため)。ローカルブランチ・worktree の削除は PR merge 後に `clean-branch` スキルへ委譲する。追加のコードレビューが必要なら `/code-review` またはユーザーの判断で `takt-review`(要 takt 導入)を別途依頼する。

## Gotchas

- takt 関連コマンド(`takt add` / `takt run` / `takt list` 等)は一切使わない
- CI 監視ログは全文表示しない。`gh pr checks` の要約と失敗時の `--log-failed` の該当部分のみ読む
- fix ループ中も表面的な patch で指摘を揉み消さない。根本原因と同型箇所を確認してから直す
- 実装・修正は必ず worktree 内で行う。repo root で直接編集しない
- レビュー・マージ・worktree 削除はこのスキルの範囲外

## Rules

- worktree 作成前に `git worktree list` で対象 issue に対応する worktree が既に存在しないか確認する。Codex / Claude Desktop 等が作成済みならそれを再利用し、新規作成しない
- 新規に worktree を作る場合のみ、作成前に必ず main を `git pull --ff-only` で最新化する
- worktree は `$REPO_ROOT/.worktrees/<slug>/` に作成し、`.gitignore` に `.worktrees/` が無ければ追加する
- PR は常に `--draft` で作成し、本文に `Closes #<N>` を含める
- CI green を確認したら `gh pr ready <PR#>` で自動的に ready for review 化する(ユーザー確認は不要)
- CI 監視は前景で `--watch` しない。`gh pr checks --watch` を wrapper なしで redirect 付き background 投げし、Claude Code は exit の自動再呼び出しで完了を受ける(poll しない)。Codex は `while kill -0 "$(cat pidfile)" 2>/dev/null; do sleep 30; done` を1コマンドとして実行しプロセス終了までブロックする(`kill -0` の単発チェックで次に進んではならない)
- CI red 時は worktree 内で直接修正し、根本原因ベースで直す。fix ループは最大 3 周、超過したら人手判断を仰ぐ
- CI fail がスコープ外(flaky 等)と判断した場合はユーザーに報告し判断を仰ぐ
- CI green の確認と ready for review 化で完了とする。レビュー・マージ・worktree 削除は行わない
