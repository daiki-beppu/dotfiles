---
name: issue-direct
description: >-
  GitHub issue を直接実装する(分割検討 → worktree 作成 → 実装 → PR 作成 → CI green まで監視 → fix ループ)。
  「issue #N を対応して」「PR作成とCI greenまで」など、issue の実装からPR準備までを一気通貫で依頼されたときに使う。
  追加のコードレビューやマージは対象外(CI green で完了)。
---

# issue-direct

## Overview

GitHub issue を実装し PR 化するスキル。分割検討・worktree 作成・実装・PR 作成・CI 監視・fix ループを一気通貫で行う。着手前に issue が 1 PR で完結する粒度か検討し、大きすぎる場合は sub-issue に分割して最初の子 issue のみを実装する。**CI green を確認し PR を ready for review 化した時点で完了**とし、追加のコードレビューやマージは行わない。追加レビューが必要な場合はユーザーが別途 `/code-review` を依頼する。

## When to Use

- 「issue #N を対応して」「issue #N を PR 作成と CI green まで」といった依頼

## 実行スタイル

- **自分で実装する**: 実装・修正・CI 対応を subagent に委任しない。委任してよいのは、対象 issue が独立した複数ファイル群にまたがり並行調査が明確に速い場合だけで、そのときも1体に留める。自分が書いたコードを点検させるために subagent を立てない
- **実況しない**: 着手時に1文で方針を述べる。以降は方針が変わったとき(分割提示・blocker 検出・コンフリクト解消・fix ラウンド突入)だけ短く報告し、コマンド1つずつの進捗は書かない
- **完了報告は結論から**: PR URL → CI 結果 → fix ラウンド数の順に述べる。変更内容の詳細は PR 本文に持たせ、会話には1〜3行の要約だけ置く
- **スコープを広げない**: issue の要件だけを実装する。作業中に気づいた別の改善は実装せず、完了報告に1行添えるに留める

## パラメータ

| 項目 | 値 |
|---|---|
| 分割基準 | 要件3件以上 / 影響ファイル4件以上 / 独立した関心事2つ以上 / 複数 PR 見込み(issue スキルと同一、迷う場合は分割提示側に倒す) |
| 分割時の実装対象 | 最初の子 issue のみ(残りには着手しない) |
| worktree 置き場 | `$REPO_ROOT/.claude/worktrees/<slug>/`(CLAUDE.md 規約) |
| fix ループ上限 | 3 周 |
| 完了条件 | CI green + `gh pr ready` |
| スコープ外 | レビュー・マージ・worktree 削除 |

## Task

### 0. Context 収集

```bash
gh issue view <N> --json title,body,labels,state,url
gh repo view --json nameWithOwner
```

**`Blocked by` を確認する。** GitHub ネイティブの blocking 関係を照会する(本文の記述は見ない。正はネイティブ側)。

```bash
gh api graphql -f query='
query($owner:String!,$repo:String!,$num:Int!){
  repository(owner:$owner,name:$repo){
    issue(number:$num){ blockedBy(first:50){ nodes{ number title state url } } }
  }
}' -F owner=<owner> -F repo=<repo> -F num=<N>
```

`state` が `OPEN` の blocker が1件でも残っていれば未完了とみなす。

- **未完了の blocker がある** → 実装に着手しない。blocker の一覧を提示し、「先に blocker を実装するか / この issue を強行するか」をユーザーに確認する
- **blocker がすべて close 済み、または依存なし** → そのまま Step 1 へ進む

親 issue に複数の子がぶら下がっていて対象が指定されていない場合は、**frontier**(blocker がすべて完了した子 issue)から選ぶ。複数該当するときは一覧を提示してユーザーに選ばせる。

### 1. 分割検討

Step 0 で取得した issue の内容から、**1 issue = 1 要件 + α(その要件に密接に付随する小要件のみ)の粒度に収まっているか**を実装に着手する前に判定する。基準はパラメータ表のとおり。

いずれにも該当しなければ、ユーザーに確認せずそのまま Step 2 に進む。

いずれかに該当する場合(判断に迷う場合も分割提示側に倒す)は、以下を行う:

1. 子 issue の一覧(タイトルと各スコープ)を含む分割案を作り、AskUserQuestion で「分割する / このまま実装する」をユーザーに確認する
2. **分割で合意した場合**: 対象 issue `<N>` を親とし、子 issue の作成と GraphQL `addSubIssue` での親子接続は issue-organize スキルの手順に従う。作成後、**最初の子 issue を新たな対象 `<N>` として** Step 2 以降を実行する(PR の `Closes #<N>` も子 issue を指す)。残りの子 issue には着手しない
3. **このまま実装を選んだ場合**: 元の issue `<N>` のまま Step 2 に進む

### 2. 既存 worktree の確認 → (無ければ)main 最新化 → worktree 作成

Codex CLI や Claude Desktop など他のクライアントが同じ issue に対して先に worktree を作成している場合があるため、**新規作成の前に必ず確認する**。

```bash
git worktree list
```

ブランチ名やパスに issue 番号(`<N>`)や issue タイトルの slug を含む worktree が既に存在する場合は、**その worktree をそのまま使い、以下の新規作成手順をスキップして Step 3 に進む**(main の最新化・`git worktree add` は行わない)。

存在しない場合のみ、以下で新規作成する:

```bash
cd <repo_root>
git checkout main && git pull --ff-only
git status -sb                      # diverged していないこと(ff できたこと)を確認
SLUG="issue-<N>-<short-slug>"
git worktree add ".claude/worktrees/${SLUG}" -b "${SLUG}"

# .worktreeinclude は Claude が作る worktree にしか効かないため、手動 add では自分でコピーする
if [ -f .worktreeinclude ]; then
  rg -v '^\s*(#|$)' .worktreeinclude | while read -r p; do
    [ -e "$p" ] || continue
    mkdir -p ".claude/worktrees/${SLUG}/$(dirname "$p")"
    cp -R "$p" ".claude/worktrees/${SLUG}/$p"
  done
fi
```

`.gitignore` に `.claude/worktrees/` が無ければ main 側で追加してコミットする。

**main を checkout してから作る理由**: Claude Code の `--worktree` / EnterWorktree は `worktree.baseRef: "head"`(= セッションの cwd の HEAD)から分岐する。feature ブランチにいればそこから分岐してしまうため、どのブランチにいるかがそのままベースになる。`git worktree add` も同様にローカル HEAD 基準。既存 worktree を再利用する場合はベースが古い可能性があるので、`git log --oneline main..HEAD` で想定外のコミットが載っていないか確認し、必要なら `git merge main` で追いつかせる。

### 3. 実装

worktree(`.claude/worktrees/${SLUG}`)内で issue の要件を実装する。

**テストで固定できる挙動は `tdd` スキルを駆動して赤→緑で1枚ずつ進める。** どこを TDD の対象にするか(seam)は実装開始前に決めてから着手する。設定変更やドキュメント更新のようにテストで固定する対象が無い場合のみ、TDD を省いてよい。

検証は次のリズムで回す。まとめて最後に1回ではなく、壊れた位置が特定できる粒度で挟む。

- **typecheck**: こまめに実行する
- **単体テストファイル**: 触っている範囲のものをこまめに実行する
- **フルテストスイート**: 最後に1回実行する
- **lint**: commit 前に実行する

### 4. commit → push → PR 作成

```bash
cd ".claude/worktrees/${SLUG}"
git add -A && git commit -m "<message>"
git push -u origin "${SLUG}"
gh pr create --draft --title "<title>" --body "$(cat <<'EOF'
## Summary
...

Closes #<N>
EOF
)"
```

PR は常に **draft** で作成する(CI 通過前にレビュアーへ通知を飛ばさないため)。CI green を確認した後、Step 7 で自動的に ready for review 化する。

PR 本文は変更の実質だけを書く。テンプレートの空セクション、変更点の再掲、定型の締め文で膨らませない。

### 5. CI 監視(background、poll しない)

`gh pr checks <PR#> --watch` は CI 完了までブロックして exit する。**wrapper スクリプトで包まず** redirect 付きで直接 background に投げる(前景で `--watch` しない。stdout はログに逃がす)。

```bash
PR_NUM=<PR#>
```

**待機前に mergeable を確認する**。base とコンフリクトしていると checks がいつまでも揃わず `--watch` が終わらないまま伸び続けることがあるため、待つ前に弾く:

```bash
gh pr view ${PR_NUM} --json mergeable,mergeStateStatus -q '"mergeable=\(.mergeable) mergeStateStatus=\(.mergeStateStatus)"'
```

`mergeable=CONFLICTING`(または `mergeStateStatus=DIRTY`)なら、worktree(`.claude/worktrees/${SLUG}`)内で base を merge/rebase してコンフリクトを解消し、`MERGEABLE` になってから CI 監視に進む。

- **Claude Code**: `Bash` の `run_in_background: true` で `gh pr checks ${PR_NUM} --watch --interval 30 > /tmp/ci_pr${PR_NUM}.log 2>&1` を投げる(timeout 目安 `2400000ms` = 40 分)。exit 時に自動再呼び出しされるので poll しない。exit code がそのまま合否(0=green)。wrapper を作らないので `chmod` も不要。待っている間は他作業に context を使ってよい(前景で sleep 待ちしない)。
- **Codex / その他 CLI**: 自動再呼び出しが無いため、起動とブロッキング待機を1コマンドにまとめて実行する。`kill -0` を1回だけ確認して次に進むと CI 完了前に後続を実行してしまう:

  ```bash
  nohup gh pr checks ${PR_NUM} --watch --interval 30 > /tmp/ci_pr${PR_NUM}.log 2>&1 &
  echo $! > /tmp/ci_pr${PR_NUM}.pid
  while kill -0 "$(cat /tmp/ci_pr${PR_NUM}.pid)" 2>/dev/null; do sleep 30; done
  ```

  コマンドの実行環境に timeout があり `while` が途中で打ち切られた場合は、同じ `while kill -0 ...` の行だけ再実行すればよい(pid の生存確認のみでべき等)。

### 6. 判定 → fix ループ(最大 3 周)

完了したら、**まず mergeable を確認してから** `gh pr checks <PR#>` で結果を確認する(待機中に base が進んでコンフリクトが発生していることがあるため、checks の合否だけで判断しない):

```bash
gh pr view ${PR_NUM} --json mergeable,mergeStateStatus -q '"mergeable=\(.mergeable) mergeStateStatus=\(.mergeStateStatus)"'
```

- **mergeable=CONFLICTING** → Step 5 の解消手順を行い、push 後に Step 5 を再実行する(checks の結果に関わらず優先して解消する)
- **mergeable=MERGEABLE** かつ **exit 0**(全 green) → Step 7 へ
- **mergeable=MERGEABLE** かつ **exit ≠ 0** → `gh pr checks <PR#>` で失敗 check を特定し、`gh run view <run-id> --log-failed` で失敗ログを取得
  - worktree 内で修正する。指摘行だけを直さず「症状 → 根本原因 → 同型箇所 → 修正 → 検証」に分解してから直す
  - commit → push → Step 5 を再実行、ラウンド +1
  - **3 周を超えたら**ユーザーに状況を報告し人手判断を仰ぐ(自動で回し続けない)
  - CI fail が対象 issue のスコープ外(flaky test 等)と判断した場合もユーザーに報告し判断を仰ぐ

### 7. 完了報告

CI green を確認したら `gh pr ready <PR#>` で ready for review 化し、PR URL・変更概要・fix ラウンド数を報告して終了する。worktree は残す(PR がまだ merge されていないため)。ローカルブランチ・worktree の削除は PR merge 後に `clean-branch` スキルへ委譲する。追加のコードレビューが必要なら `/code-review` を別途依頼する。

## Rules

- 実装・修正は必ず worktree 内で行う。repo root で直接編集しない
- 着手前の分割検討と `blockedBy` 照会を飛ばさない。`OPEN` の blocker が残っていれば実装に入らずユーザーに確認する
- テストで固定できる挙動は `tdd` スキルを駆動する。seam は実装開始前に決める
- PR は常に `--draft` で作成し、本文に `Closes #<N>` を含める。CI green を確認したら確認を取らずに `gh pr ready` する
- CI 監視は前景で `--watch` せず、poll もしない。ログは全文表示せず、要約と `--log-failed` の該当部分だけ読む
- CI red は表面的な patch で揉み消さず根本原因から直す。fix ループは最大 3 周、超過したら人手判断を仰ぐ
- CI green の確認と ready for review 化で完了とする。レビュー・マージ・worktree 削除は行わない
