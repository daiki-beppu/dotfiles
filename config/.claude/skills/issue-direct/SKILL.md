---
name: issue-direct
description: >-
  GitHub issue を直接実装する(分割検討 → worktree 作成 → 実装 → gh-stack で PR 作成 → CI green まで監視 → fix ループ)。
  「issue #N を対応して」「PR作成とCI greenまで」など、issue の実装からPR準備までを一気通貫で依頼されたときに使う。
  追加のコードレビューやマージは対象外(CI green で完了)。
---

# issue-direct

## Overview

GitHub issue を実装し PR 化するスキル。分割検討・worktree 作成・実装・PR 作成・CI 監視・fix ループを一気通貫で行う。作る PR は **gh-stack のスタック1段**であり、blocker の PR があればその上に積む。着手前に issue が 1 振る舞い(= 1 PR = 1段)で完結する粒度か検討し、大きすぎる場合は sub-issue に分割して最初の子 issue のみを実装する。**CI green を確認し PR を ready for review 化した時点で完了**とし、追加のコードレビューやマージは行わない。追加レビューが必要な場合はユーザーが別途 `/code-review` を依頼する。

## When to Use

- 「issue #N を対応して」「issue #N を PR 作成と CI green まで」といった依頼

## 実行スタイル

- **自分で実装する**: 実装・修正・CI 対応を subagent に委任しない。委任してよいのは、対象 issue が独立した複数ファイル群にまたがり並行調査が明確に速い場合だけで、そのときも1体に留める。自分が書いたコードを点検させるために subagent を立てない
- **実況しない**: 着手時に1文で方針を述べる。以降は方針が変わったとき(分割提示・blocker 検出・コンフリクト解消・fix ラウンド突入)だけ短く報告し、コマンド1つずつの進捗は書かない
- **完了報告は結論から**: PR URL → スタック上の位置 → CI 結果 → fix ラウンド数の順に述べる。変更内容の詳細は PR 本文に持たせ、会話には1〜3行の要約だけ置く
- **スコープを広げない**: issue の要件だけを実装する。作業中に気づいた別の改善は実装せず、完了報告に1行添えるに留める

## パラメータ

| 項目 | 値 |
|---|---|
| 分割基準 | 振る舞いが2つ以上(issue スキルと同一。要件2件以上 / 独立した関心事2つ以上 / 影響ファイル4件以上は代理指標。迷う場合は分割提示側に倒す) |
| 分割時の実装対象 | 最初の子 issue のみ(残りには着手しない) |
| PR 作成方式 | `gh stack submit --auto`(既定で draft。スタック1段として作られる) |
| worktree 置き場 | `$REPO_ROOT/.claude/worktrees/<slug>/`(CLAUDE.md 規約)。1スタック = 1 worktree |
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

blocker が `OPEN` でも、**その blocker の PR がすでに存在するなら着手してよい**。その PR の上に段を積むのがスタックの目的であり、下段のマージを待つ必要はない。判定は blocker の state ではなく **blocker の PR の有無**で行う。

```bash
# blocker が PR を持っているかを確認する(<B> は blocker の issue 番号)
gh pr list --search "<B> in:body" --state open --json number,headRefName,url
```

- **blocker に PR がある(OPEN / MERGED どちらでも)** → その PR のブランチの上に積む。Step 2 で該当スタックを特定する
- **blocker が close 済み、または依存なし** → 新規スタックとして Step 1 へ進む
- **blocker が `OPEN` かつ PR が無い** → 実装に着手しない。積む先が存在しないため。blocker の一覧を提示し、「先に blocker を実装するか / この issue を強行するか」をユーザーに確認する

親 issue に複数の子がぶら下がっていて対象が指定されていない場合は、**frontier**(blocker が無い、または全 blocker が PR を持つ子 issue)から選ぶ。複数該当するときは一覧を提示してユーザーに選ばせる。

### 1. 分割検討

Step 0 で取得した issue の内容から、**1 issue = 1 振る舞い(= 1 PR = スタック1段)の粒度に収まっているか**を実装に着手する前に判定する。「この issue を完了させたとき、利用者または呼び出し側から見て何が1つ変わるか」を1文で言い切れるかで測る。基準はパラメータ表のとおり。

いずれにも該当しなければ、ユーザーに確認せずそのまま Step 2 に進む。

いずれかに該当する場合(判断に迷う場合も分割提示側に倒す)は、以下を行う:

1. 子 issue の一覧(タイトルと各スコープ)を含む分割案を作り、AskUserQuestion で「分割する / このまま実装する」をユーザーに確認する
2. **分割で合意した場合**: 対象 issue `<N>` を親とし、子 issue の作成と GraphQL `addSubIssue` での親子接続は issue-organize スキルの手順に従う。作成後、**最初の子 issue を新たな対象 `<N>` として** Step 2 以降を実行する(PR の `Closes #<N>` も子 issue を指す)。残りの子 issue には着手しない
3. **このまま実装を選んだ場合**: 元の issue `<N>` のまま Step 2 に進む

### 2. スタックを決める → worktree を用意する

このスキルが作る PR は **gh-stack のスタック1段**になる。既存スタックに積むのか、新しいスタックを起こすのかを Step 0 の結果から決める。

**1スタック = 1 worktree** とする。段はブランチで表し、段ごとに worktree を分けない。`gh stack` のナビゲーション(`up` / `down` / `top` / `checkout`)は同一チェックアウト内でブランチを移動する前提のため、段を worktree に分けると使えなくなる。

#### 2-a. 既存スタックに積む(Step 0 で blocker の PR が見つかった場合)

blocker の PR のブランチを含む worktree を特定する。

```bash
git worktree list
gh stack view --json    # そのブランチが属するスタックの構造を確認
```

その worktree で段を追加する。`gh stack add` は **topmost でしか実行できない**(それ以外は exit code 5)。

```bash
cd "<スタックの worktree>"
gh stack sync                                  # 下段がマージ済みなら追随させる
gh stack top                                   # 最上段へ移動
SLUG="issue-<N>-<short-slug>"
gh stack add "${SLUG}"                         # 新しい段を作って checkout
```

worktree が見つからない場合は、blocker のブランチを checkout した worktree を作ってから同じ手順を行う。作成後 Step 3 に進む(以下の 2-b はスキップする)。

**スタックは線形にしか積めない**(1つの段が持てる子は1つだけ)。blocker が複数あってそれぞれ別の PR を持つ場合、1本のスタックには収まらない。最も密接に依存する1本を選んでその上に積み、残りは別スタックとして扱う。どちらに積むか自明でなければユーザーに確認する。

#### 2-b. 新しいスタックを起こす

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

Step 2 で用意した worktree 内で issue の要件を実装する(2-a なら既存スタックの worktree、2-b なら `.claude/worktrees/${SLUG}`)。

**テストで固定できる挙動は `tdd` スキルを駆動して赤→緑で1枚ずつ進める。** どこを TDD の対象にするか(seam)は実装開始前に決めてから着手する。設定変更やドキュメント更新のようにテストで固定する対象が無い場合のみ、TDD を省いてよい。

検証は次のリズムで回す。まとめて最後に1回ではなく、壊れた位置が特定できる粒度で挟む。

- **typecheck**: こまめに実行する
- **単体テストファイル**: 触っている範囲のものをこまめに実行する
- **フルテストスイート**: 最後に1回実行する
- **lint**: commit 前に実行する

### 4. commit → スタックへ submit

```bash
cd "<スタックの worktree>"
git add -A && git commit -m "<message>"

# 2-b で新しいスタックを起こした場合のみ実行する(既存ブランチはそのまま adopt される)
# 2-a では gh stack add 済みなので不要
gh stack init "${SLUG}"

# push + PR 作成 + GitHub 上でのスタック連結までを1コマンドで行う
gh stack submit --auto
```

`gh pr create` は使わない。スタックの連結は `submit` が行うため、個別に PR を作るとその段がスタックの外に落ちる。

**`--auto` は必須**(付けないと PR タイトルを対話で聞かれ、ハングする)。PR は既定で **draft** として作られる(`--open` を付けたときだけ ready になる)。CI 通過前にレビュアーへ通知を飛ばさないため、ここでは `--open` を使わず、Step 7 で ready 化する。

**タイトルと本文は submit 後に `gh pr edit` で上書きする。** `submit` にはタイトル・本文を指定するフラグが無く、`--auto` の自動生成は**そのブランチのコミットが1個だけのとき**しか commit subject / body を使わない。Step 6 の fix ループでコミットが増えた時点で、タイトルはブランチ名を humanize しただけのものに変わり body は落ちる。`Closes #<N>` を失わないよう次を必ず行う。

```bash
PR_NUM=$(gh stack view --json | jq -r '.branches[] | select(.isCurrent) | .pr.number')
gh pr edit "${PR_NUM}" --title "<title>" --body "$(cat <<'EOF'
## Summary
...

Closes #<N>
EOF
)"
```

PR 本文は変更の実質だけを書く。テンプレートの空セクション、変更点の再掲、定型の締め文で膨らませない。

**`gh stack submit` が exit code 9 を返した場合**、そのリポジトリは stacked PR が有効になっていない。非対話では自動フォールバックしないため、`gh pr create --draft --title "<title>" --body "..."` で通常の PR を作り、スタックを使えなかった旨を完了報告に1行添える。

### 5. CI 監視(background、poll しない)

`gh pr checks <PR#> --watch` は CI 完了までブロックして exit する。**wrapper スクリプトで包まず** redirect 付きで直接 background に投げる(前景で `--watch` しない。stdout はログに逃がす)。

```bash
# Step 4 で取得済み。別セッションから再開する場合はスタックから引き直す
PR_NUM=$(gh stack view --json | jq -r '.branches[] | select(.isCurrent) | .pr.number')
```

**待機前に mergeable を確認する**。base とコンフリクトしていると checks がいつまでも揃わず `--watch` が終わらないまま伸び続けることがあるため、待つ前に弾く:

```bash
gh pr view ${PR_NUM} --json mergeable,mergeStateStatus -q '"mergeable=\(.mergeable) mergeStateStatus=\(.mergeStateStatus)"'
```

`mergeable=CONFLICTING`(または `mergeStateStatus=DIRTY`)なら **`gh stack sync` で解消する**。手動で `git merge` / `git rebase` しない — この PR の base は下段のブランチであり、手で動かすとスタックの追跡状態と食い違う。

```bash
gh stack sync
```

`gh stack sync` が **exit code 3** を返した場合はコンフリクトで、全ブランチは rebase 前の状態に復元されている。`gh stack rebase` を実行し直して解消する。

```bash
gh stack rebase                      # exit 3 で停止する
# stderr のコンフリクトファイルを読み、<<<<<<< / ======= / >>>>>>> を解消する
git add <解決したファイル>
gh stack rebase --continue           # 再度コンフリクトしたら繰り返す
# 解決できない場合: gh stack rebase --abort で全ブランチを rebase 前へ戻す
```

`MERGEABLE` になってから CI 監視に進む。

- **Claude Code**: `Bash` の `run_in_background: true` で `gh pr checks ${PR_NUM} --watch --interval 30 > /tmp/ci_pr${PR_NUM}.log 2>&1` を投げる(timeout 目安 `2400000ms` = 40 分)。exit 時に自動再呼び出しされるので poll しない。exit code がそのまま合否(0=green)。wrapper を作らないので `chmod` も不要。待っている間は他作業に context を使ってよい(前景で sleep 待ちしない)。
- **Codex / その他 CLI**: 自動再呼び出しが無いため、起動とブロッキング待機を1コマンドにまとめて実行する。`kill -0` を1回だけ確認して次に進むと CI 完了前に後続を実行してしまう:

  ```bash
  nohup gh pr checks ${PR_NUM} --watch --interval 30 > /tmp/ci_pr${PR_NUM}.log 2>&1 &
  echo $! > /tmp/ci_pr${PR_NUM}.pid
  while kill -0 "$(cat /tmp/ci_pr${PR_NUM}.pid)" 2>/dev/null; do sleep 30; done
  ```

  コマンドの実行環境に timeout があり `while` が途中で打ち切られた場合は、同じ `while kill -0 ...` の行だけ再実行すればよい(pid の生存確認のみでべき等)。

### 6. 判定 → fix ループ(最大 3 周)

完了したら、**まず mergeable を確認してから** `gh pr checks ${PR_NUM}` で結果を確認する(待機中に base が進んでコンフリクトが発生していることがあるため、checks の合否だけで判断しない):

```bash
gh pr view ${PR_NUM} --json mergeable,mergeStateStatus -q '"mergeable=\(.mergeable) mergeStateStatus=\(.mergeStateStatus)"'
```

- **mergeable=CONFLICTING** → Step 5 の解消手順を行い、push 後に Step 5 を再実行する(checks の結果に関わらず優先して解消する)
- **mergeable=MERGEABLE** かつ **exit 0**(全 green) → Step 7 へ
- **mergeable=MERGEABLE** かつ **exit ≠ 0** → `gh pr checks ${PR_NUM}` で失敗 check を特定し、`gh run view <run-id> --log-failed` で失敗ログを取得
  - worktree 内で修正する。指摘行だけを直さず「症状 → 根本原因 → 同型箇所 → 修正 → 検証」に分解してから直す
  - commit → `gh stack push` → Step 5 を再実行、ラウンド +1(PR は既にあるので `submit` は不要。`git push` を直接使わない)
  - **3 周を超えたら**ユーザーに状況を報告し人手判断を仰ぐ(自動で回し続けない)
  - CI fail が対象 issue のスコープ外(flaky test 等)と判断した場合もユーザーに報告し判断を仰ぐ

### 7. 完了報告

CI green を確認したら `gh pr ready ${PR_NUM}` で **その段だけ** ready for review 化する(`gh stack submit --open` はスタック**全体**を ready 化してしまうため使わない)。

PR URL・スタック上の位置(何段目 / base ブランチ)・変更概要・fix ラウンド数を報告して終了する。worktree はスタックごと残す(PR が未 merge であることに加え、上に段を積むとき同じ worktree を再利用するため)。ローカルブランチ・worktree の削除は PR merge 後に `clean-branch` スキルへ委譲する。追加のコードレビューが必要なら `/code-review` を別途依頼する。

## Rules

- 実装・修正は必ず worktree 内で行う。repo root で直接編集しない。1スタック = 1 worktree とし、段ごとに worktree を分けない
- 着手前の分割検討と `blockedBy` 照会を飛ばさない。blocker が `OPEN` でも **PR があればその上に積んで着手する**。PR が無い blocker が残っている場合だけ実装に入らずユーザーに確認する
- テストで固定できる挙動は `tdd` スキルを駆動する。seam は実装開始前に決める
- PR は `gh stack submit --auto` で作る。`gh pr create` を直接使わない(exit code 9 でスタックが使えないときだけ例外)。既定の draft のまま出し、タイトルと本文(`Closes #<N>` を含む)は作成後に `gh pr edit` で設定する
- スタックの追随・コンフリクト解消は `gh stack sync` / `gh stack rebase` で行い、手で `git merge` / `git rebase` / `git push` しない
- CI green を確認したら確認を取らずに `gh pr ready` する(その段だけ。スタック全体を ready 化しない)
- CI 監視は前景で `--watch` せず、poll もしない。ログは全文表示せず、要約と `--log-failed` の該当部分だけ読む
- CI red は表面的な patch で揉み消さず根本原因から直す。fix ループは最大 3 周、超過したら人手判断を仰ぐ
- CI green の確認と ready for review 化で完了とする。レビュー・マージ・worktree 削除は行わない
