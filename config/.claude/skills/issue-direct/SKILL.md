---
name: issue-direct
description: >-
  GitHub issue を直接実装する(段の列を決める → worktree 作成 → 段ごとに実装 → gh-stack で PR 作成 → CI green まで監視 → fix ループ)。
  「issue #N を対応して」「親 issue #N をまとめて対応して」「PR作成とCI greenまで」など、issue の実装から PR 準備までを一気通貫で依頼されたときに使う。
  親 issue を渡すと子 issue を依存順に段として積み、スタック全体が CI green になるまで走り切る。
  追加のコードレビューやマージは対象外(CI green で完了)。
---

# issue-direct

## Overview

GitHub issue を実装し PR 化するスキル。**最終状態は「gh-stack のスタックが積み上がり、全段の CI が green で ready for review」**である。

対象が親 issue なら子 issue を依存順に並べて**全段を積む**。対象が単一 issue なら1段だけ積む。この2つは別のフローではなく、**先に「段の列」を確定させれば同じループ**になる。列の長さが 1 か N かの違いしかない。

段が複数ある場合、**各段の実装と CI fix は subagent に委任する**。親(このスキルを実行しているエージェント)は gh-stack 操作・submit・PR 本文・CI 監視・判定だけを担い、段の実装内容をファイル単位で追わない。これは好みではなく必要な措置で、段ごとのテスト出力・失敗ログ・デバッグの試行錯誤を親のコンテキストに載せると、5段目あたりで判断に必要な情報(どの段がどの PR で今どこが red か)が押し流される。

**全段 CI green + ready for review 化した時点で完了**とし、追加のコードレビューやマージは行わない。

## When to Use

- 「issue #N を対応して」「issue #N を PR 作成と CI green まで」
- 「親 issue #N をまとめて対応して」「#N の子 issue を全部やって」

## 実行スタイル

- **段の実装は subagent に委任し、親は司令塔に徹する**: 段が2つ以上あるとき、実装・CI fix は必ず subagent に渡す。親が自分で書くのは**段が1つだけのとき**。親が握るのは gh-stack 操作 / submit / `gh pr edit` / CI 監視 / 段の進行判定に限る
- **subagent の出力を再点検しない**: 返ってきた要約を信じて次の段に進む。自分が書かせたコードを検算させるために別の subagent を立てない。品質の担保は各段の TDD と CI であって、親による再読ではない
- **実況しない**: 着手時に段の列(何段積むか / 各段が何の issue か)を1回提示する。以降は方針が変わったとき(分割提示・blocker 検出・段の red 検出・fix ラウンド突入・停止)だけ短く報告する。段ごとの「実装しました」「submit しました」は書かない
- **完了報告は結論から**: スタック全体の PR URL 一覧(下段→上段) → CI 結果 → fix ラウンド数の順。変更内容の詳細は各 PR 本文に持たせ、会話には段ごと1行の要約だけ置く
- **スコープを広げない**: 各段は担当 issue の要件だけを実装する。作業中に気づいた別の改善は実装せず、完了報告に1行添えるに留める

## パラメータ

| 項目 | 値 |
|---|---|
| 分割基準 | 振る舞いが2つ以上(issue スキルと同一。要件2件以上 / 独立した関心事2つ以上 / 影響ファイル4件以上は代理指標。迷う場合は分割提示側に倒す) |
| 段数 | 上限なし。確定した列の全段を積む |
| 段の実装 | 段が2つ以上なら subagent に委任。1つだけなら親が自分で実装する |
| 実装 policy | takt の facet を読ませる。実装 = `coding` + `testing`、CI fix = さらに `ai-antipattern`(takt の `implement` / `ai-antipattern-fix` step と同じ割当)。takt 未導入のリポジトリでは省略する |
| PR 作成方式 | `gh stack submit --auto`(既定で draft) |
| submit のタイミング | 段の commit 直後。CI 完了は待たずに次段の実装へ進む(パイプライン) |
| worktree 置き場 | `$REPO_ROOT/.claude/worktrees/<slug>/`(CLAUDE.md 規約)。1スタック = 1 worktree |
| fix ループ上限 | 段ごとに 3 周 |
| 完了条件 | 全段 CI green + 全段 `gh pr ready` |
| スコープ外 | レビュー・マージ・worktree 削除 |

## Task

### 0. Context 収集 → 段の列を決める

```bash
gh issue view <N> --json title,body,labels,state,url
gh repo view --json nameWithOwner
```

**子 issue と依存関係を1クエリで取る。** `subIssues` の中に `blockedBy` をネストできるので、子ごとに照会して往復を増やさない。GitHub ネイティブの blocking 関係が正で、本文の記述は見ない。

```bash
gh api graphql -f query='
query($owner:String!,$repo:String!,$num:Int!){
  repository(owner:$owner,name:$repo){
    issue(number:$num){
      number title
      blockedBy(first:20){ nodes{ number title state url } }
      subIssues(first:50){
        totalCount
        nodes{
          number title state url
          blockedBy(first:20){ nodes{ number title state } }
        }
      }
    }
  }
}' -F owner=<owner> -F repo=<repo> -F num=<N>
```

結果から**段の列**(実装順に並んだ issue のリスト)を作る。

#### 0-a. 子 issue がある場合(親 issue) → 全段を積む

1. `state` が `CLOSED` の子は除外する(実装済み)
2. 残った子の `blockedBy` のうち、**同じ親の子集合に含まれるものだけ**を依存エッジとして扱う(集合外の blocker は 0-c で扱う)
3. トポロジカルソートして1本の列にする。**スタックは線形にしか積めない**ため、依存が分岐していても1本に直列化する(依存を満たす順序であれば、独立な段をどちらの順に積んでも正しい)。blocker を持たない子が複数あるときは issue 番号の昇順で並べる
4. 循環を検出したら積まずに停止し、循環している issue 番号を提示してユーザーに判断を仰ぐ(issue 側の依存設定が壊れている)

直列化によって**本来は独立している段が前後関係を持った**場合は、完了報告にその旨を1行添える(レビュー時に順序の入れ替えが可能であることを伝えるため)。

#### 0-b. 子 issue が無い場合(単一 issue) → 分割を検討する

**1 issue = 1 振る舞い(= 1 PR = スタック1段)の粒度に収まっているか**を判定する。「この issue を完了させたとき、利用者または呼び出し側から見て何が1つ変わるか」を1文で言い切れるかで測る。基準はパラメータ表のとおり。

- **収まっている** → 列は要素1つ(その issue のみ)。ユーザーに確認せず Step 1 へ
- **収まっていない**(判断に迷う場合も分割提示側に倒す) → 子 issue の一覧(タイトルと各スコープ)を含む分割案を作り、AskUserQuestion で「分割する / このまま1段で実装する」を確認する
  - **分割で合意** → 対象 issue `<N>` を親とし、子 issue の作成・GraphQL `addSubIssue` での親子接続・`addBlockedBy` での依存接続を issue-organize スキルの手順に従って行う。作成後 0-a に戻って列を作り、**全段を積む**(以降ユーザーへの確認なしで完走する)
  - **このまま実装** → 列は要素1つのまま Step 1 へ

#### 0-c. 集合外の blocker を確認する

段の列の各 issue について、**同じ親の子集合に含まれない** blocker が `OPEN` で残っていないか確認する。blocker が `OPEN` でも、**その blocker の PR がすでに存在するなら着手してよい**。その PR の上に段を積むのがスタックの目的であり、下段のマージを待つ必要はない。判定は blocker の state ではなく **blocker の PR の有無**で行う。

```bash
# blocker が PR を持っているかを確認する(<B> は blocker の issue 番号)
gh pr list --search "<B> in:body" --state open --json number,headRefName,url
```

- **blocker に PR がある(OPEN / MERGED どちらでも)** → その PR のブランチの上に積む。Step 1 で該当スタックを特定する
- **blocker が close 済み、または依存なし** → 新規スタックとして Step 1 へ
- **blocker が `OPEN` かつ PR が無い** → 積む先が存在しないため実装に着手しない。blocker の一覧を提示し、「先に blocker を実装するか / この issue を強行するか」をユーザーに確認する

親 issue に複数の子がぶら下がっていて**対象が明示的に1つ指定されている**場合(「#N だけやって」)は、その issue のみを列とする。

### 1. スタックを決める → worktree を用意する

**1スタック = 1 worktree** とする。段はブランチで表し、段ごとに worktree を分けない。`gh stack` のナビゲーション(`up` / `down` / `top` / `checkout`)は同一チェックアウト内でブランチを移動する前提のため、段を worktree に分けると使えなくなる。委任先の subagent も**この同じ worktree で作業する**(subagent に `isolation: worktree` を使わない — 別チェックアウトになりスタックが壊れる)。

#### 1-a. 既存スタックに積む(0-c で blocker の PR が見つかった場合)

blocker の PR のブランチを含む worktree を特定する。

```bash
git worktree list
gh stack view --json    # そのブランチが属するスタックの構造を確認
```

```bash
cd "<スタックの worktree>"
gh stack sync                                  # 下段がマージ済みなら追随させる
gh stack top                                   # 最上段へ移動(add は topmost でしか実行できない。それ以外は exit code 5)
```

worktree が見つからない場合は、blocker のブランチを checkout した worktree を作ってから同じ手順を行う。以降 Step 2 の段ループでは、**1段目も `gh stack init` ではなく `gh stack add` で作る**。

**blocker が複数あってそれぞれ別の PR を持つ場合**、1本のスタックには収まらない。最も密接に依存する1本を選んでその上に積み、残りは別スタックとして扱う。どちらに積むか自明でなければユーザーに確認する。

#### 1-b. 新しいスタックを起こす

Codex CLI や Claude Desktop など他のクライアントが同じ issue に対して先に worktree を作成している場合があるため、**新規作成の前に必ず確認する**。

```bash
git worktree list
```

ブランチ名やパスに issue 番号や issue タイトルの slug を含む worktree が既に存在する場合は、**その worktree をそのまま使い、以下の新規作成手順をスキップして Step 2 に進む**(main の最新化・`git worktree add` は行わない)。

存在しない場合のみ、以下で新規作成する。**worktree のディレクトリ名はスタック全体を表す名前**(親 issue があれば `issue-<親N>-<slug>`、単一 issue なら `issue-<N>-<slug>`)、**切るブランチは列の1段目の名前**にする。1スタック = 1 worktree = N ブランチなので、両者は一致しない。

```bash
cd <repo_root>
git checkout main && git pull --ff-only
git status -sb                      # diverged していないこと(ff できたこと)を確認
STACK_SLUG="issue-<親N>-<short-slug>"      # worktree のディレクトリ名
BRANCH1="issue-<1段目のNi>-<short-slug>"   # 列の1段目のブランチ名
git worktree add ".claude/worktrees/${STACK_SLUG}" -b "${BRANCH1}"

# .worktreeinclude は Claude が作る worktree にしか効かないため、手動 add では自分でコピーする
if [ -f .worktreeinclude ]; then
  rg -v '^\s*(#|$)' .worktreeinclude | while read -r p; do
    [ -e "$p" ] || continue
    mkdir -p ".claude/worktrees/${STACK_SLUG}/$(dirname "$p")"
    cp -R "$p" ".claude/worktrees/${STACK_SLUG}/$p"
  done
fi
```

ここで切った `${BRANCH1}` は Step 2-1 の `gh stack init "${BRANCH1}"` が**既存ブランチとしてそのまま adopt する**(仮ブランチを作って捨てる必要はない)。

`.gitignore` に `.claude/worktrees/` が無ければ main 側で追加してコミットする。

**main を checkout してから作る理由**: Claude Code の `--worktree` / EnterWorktree は `worktree.baseRef: "head"`(= セッションの cwd の HEAD)から分岐する。feature ブランチにいればそこから分岐してしまうため、どのブランチにいるかがそのままベースになる。`git worktree add` も同様にローカル HEAD 基準。既存 worktree を再利用する場合はベースが古い可能性があるので、`git log --oneline main..HEAD` で想定外のコミットが載っていないか確認し、必要なら `git merge main` で追いつかせる。

#### 1-c. 実装 policy を解決する

worktree が決まったら、**その worktree の中で** policy のパスを1回だけ解決する。段ごとに引き直さない(同じスタックなら結果は変わらない)。

```bash
cd "<worktree の絶対パス>"
~/.claude/skills/issue-direct/references/resolve-policy.sh coding testing ai-antipattern
```

出力された絶対パスを控え、Step 2-2 / 3-1 の subagent プロンプトにそのまま埋め込む。**親はこのファイルを開かない**(段が1つで親自身が実装する場合を除く)。3 本で 60KB 超あり、司令塔のコンテキストを圧迫する。

- 解決順は takt 本体と同じ **プロジェクト `.takt/facets/policies/` → global `~/.takt/facets/policies/` → builtin**。カスタム policy を持つリポジトリではそちらが返るので、リポジトリ固有の規約が自動的に効く
- **takt が未導入のリポジトリでは何も出力されない**(stderr に not found が出て exit 0)。その場合は policy 無しで進む。ここでスキルを止めない
- リポジトリ固有の policy が他にもないかは `resolve-policy.sh --list` で見える。issue の領域に合致するもの(例: `terraform`、`screen-api`)があれば実装 subagent の一覧に足してよい
- Codex から実行している場合、スキルの置き場は `~/.agents/skills/issue-direct/references/resolve-policy.sh`（dotfiles 内の同じ実体への symlink）

### 2. 段ループ(パイプライン)

段の列を下から順に処理する。**CI の完了は待たない。** submit したら background に投げたまま次の段の実装へ進む。CI 待ちが段をまたいで重なることで、スタック全体の所要時間が「最も遅い1段の CI」に近づく。

各段 `i`(担当 issue `<Ni>`)について:

#### 2-1. 段のブランチを作る

```bash
BRANCH="issue-<Ni>-<short-slug>"

# 列の1段目 かつ 1-b で新しいスタックを起こした場合
# (1-b で既に同名ブランチを切ってあるので、init はそれを adopt する)
gh stack init "${BRANCH}"

# それ以外(2段目以降、または 1-a で既存スタックに積む場合)
gh stack top                # topmost でないと exit code 5
gh stack add "${BRANCH}"
```

#### 2-2. 実装する

**段が2つ以上ある場合は subagent に委任する。** `Agent` ツールを次の設定で呼ぶ:

- `subagent_type`: `general-purpose`
- `run_in_background`: **`false`(必須)**。既定は background で、指定を忘れると実装完了前に次の段へ進んでスタックが壊れる
- `isolation`: **指定しない**。worktree isolation は同一 worktree 共有の前提を壊す

プロンプトは次の形にする(`<...>` を実際の値で埋める)。

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

**issue 本文を親が読んで埋め込まない。** 番号だけ渡して subagent 側に `gh issue view` させる。親が本文を読むと段数分の要件テキストが親のコンテキストに積み上がり、委任の効果が半減する。policy も同じ理由で**中身ではなくパスだけ**を渡す(1-c で控えた絶対パスをそのまま貼る)。1-c で何も解決できなかった場合は「## 着手前に読むもの」の節ごと省く。

**段が1つだけの場合**は委任せず親が自分で実装する(進め方は上記「## 進め方」と同じ)。往復のコストに見合わないため。この場合は**親自身が着手前に policy を読む**(段が1つなら CI 監視の負荷も軽く、41KB を抱えても司令塔の判断は鈍らない)。

subagent が `STATUS: blocked` を返した、あるいは commit が作られていない場合は、**そこで段ループを止める**。理由を添えてユーザーに報告し、そこまでの段は submit 済みのまま残す(上段は下段に依存するため、失敗した段を飛ばして先へ進むことはできない)。

#### 2-3. submit → PR 本文 → CI を background へ

```bash
gh stack submit --auto
```

`gh pr create` は使わない。スタックの連結は `submit` が行うため、個別に PR を作るとその段がスタックの外に落ちる。**`--auto` は必須**(付けないと PR タイトルを対話で聞かれ、ハングする)。PR は既定で **draft** として作られる。CI 通過前にレビュアーへ通知を飛ばさないため `--open` は使わず、Step 4 で ready 化する。

`submit` はスタック全体を対象にするが、既存 PR は同期されるだけなので**段ごとに毎回呼んでよい**(冪等)。新しい段の PR だけが作られる。

**タイトルと本文は submit 後に `gh pr edit` で上書きする。** `submit` にはタイトル・本文を指定するフラグが無く、`--auto` の自動生成は**そのブランチのコミットが1個だけのとき**しか commit subject / body を使わない。Step 3 の fix でコミットが増えた時点で、タイトルはブランチ名を humanize しただけのものに変わり body は落ちる。`Closes #<Ni>` を失わないよう次を必ず行う。

```bash
PR_NUM=$(gh stack view --json | jq -r '.branches[] | select(.isCurrent) | .pr.number')
gh pr edit "${PR_NUM}" --title "<title>" --body "$(cat <<'EOF'
## Summary
...

Closes #<Ni>
EOF
)"
```

PR 本文は変更の実質だけを書く。テンプレートの空セクション、変更点の再掲、定型の締め文で膨らませない。

**`gh stack submit` が exit code 9 を返した場合**、そのリポジトリは stacked PR が有効になっていない。非対話では自動フォールバックしないため、段を積む運用自体が成立しない。段が1つなら `gh pr create --draft --title "<title>" --body "..."` で通常の PR を作り、その旨を完了報告に1行添える。段が複数なら停止してユーザーに報告する(依存する PR を非スタックで並べても base が正しく張れない)。

CI を **待たずに** background へ投げる。段番号と PR 番号を控えて次の段へ進む。

CI 監視には同梱の `references/watch-pr-actions.sh` を使う。このスクリプトは PR の head SHA に紐づく `pull_request` の GitHub Actions run を `gh run list` で監視し、Checks API を呼ばない。そのため、リポジトリ限定の fine-grained PAT では `Actions: read`、PR・push 操作には `Contents: write` と `Pull requests: write` があればよい。`gh pr checks` / `gh run watch` は fine-grained PAT で利用できないため使わない。

実行前にクライアント別のスキル配置から監視スクリプトを解決する。

```bash
CI_WATCH="$HOME/.agents/skills/issue-direct/references/watch-pr-actions.sh"
[ -x "$CI_WATCH" ] || CI_WATCH="$HOME/.claude/skills/issue-direct/references/watch-pr-actions.sh"
```

- **Claude Code**: `Bash` の `run_in_background: true` で `"$CI_WATCH" "${PR_NUM}" 30 2400 > /tmp/ci_pr${PR_NUM}.log 2>&1` を投げる(timeout 目安 `2400000ms` = 40 分)。exit 時に自動再呼び出しされるので poll しない。exit code がそのまま合否(0=green、1=red、8=timeout / run 未検出)
- **Codex / その他 CLI**: 自動再呼び出しが無いため、段ループ中は投げるだけにして、Step 3 でまとめて待つ:

  ```bash
  nohup "$CI_WATCH" "${PR_NUM}" 30 2400 > /tmp/ci_pr${PR_NUM}.log 2>&1 &
  echo $! > /tmp/ci_pr${PR_NUM}.pid
  ```

この監視で判定できるのは GitHub Actions の run だけである。外部 CI の required check を使うリポジトリでは fine-grained PAT だけで完全な green 判定はできないため、classic PAT / OAuth 認証へ切り替えるか、外部 CI の専用 API で補完できるまで完了扱いにしない。

#### 2-4. 下段の red を検出したら次段へ進まない

段ループの途中で**既に submit した下段の CI が red だと判明した**場合(Claude Code なら background の完了通知、Codex なら Step 3 での回収時)、**次の段の実装には進まず、先にその段を fix する**。壊れた土台の上に段を積み増すと、後続の全段が巻き添えで red になり切り分けが効かなくなる。

fix は 3-1 / 3-2 の手順で行い、完了後に段ループの続き(次の段の 2-1)へ戻る。

### 3. CI 結果の回収 → fix ループ(段ごとに最大 3 周)

全段を積み終えたら、各段の CI 結果を回収する(Codex では、控えておいた pid を古い段から順にブロッキング待機する)。

```bash
# 各段について。待機中に base が進んでコンフリクトしていることがあるため、checks の合否だけで判断しない
gh pr view ${PR_NUM} --json mergeable,mergeStateStatus -q '"mergeable=\(.mergeable) mergeStateStatus=\(.mergeStateStatus)"'
```

- **mergeable=CONFLICTING**(または `mergeStateStatus=DIRTY`) → **`gh stack sync` で解消する**。手動で `git merge` / `git rebase` しない — 段の base は下段のブランチであり、手で動かすとスタックの追跡状態と食い違う

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

  解消後、その段の CI を投げ直す。

- **mergeable=MERGEABLE** かつ **全段 exit 0** → Step 4 へ
- **mergeable=MERGEABLE** かつ **exit ≠ 0** → 下の fix 手順へ

#### 3-1. red の段を fix する

**下から順に**直す(下段の修正が上段の red を解消することがあるため、上段から直すと無駄になる)。

```bash
gh stack checkout "<red の段のブランチ>"     # または gh stack down で降りる
HEAD_SHA=$(gh pr view "${PR_NUM}" --json headRefOid --jq '.headRefOid')
gh run list --commit "$HEAD_SHA" --event pull_request \
  --json databaseId,workflowName,status,conclusion,url \
  --jq '.[] | select(.conclusion != null and (.conclusion | IN("success", "neutral", "skipped") | not))'
gh run view <run-id> --log-failed             # 失敗ログを取得
```

**段が2つ以上ある場合は fix も subagent に委任する。** `run_in_background: false`、`isolation` 指定なしは 2-2 と同じ。

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

段が1つだけの場合は親が自分で直す(進め方は同じ)。

#### 3-2. 修正を上段へ伝播させる

```bash
gh stack rebase --upstack     # この段より上の全段を、修正を取り込んだ状態へ追随させる
gh stack push                 # git push を直接使わない
gh stack top                  # 最上段へ戻る
```

修正した段と、rebase で内容が変わった上段の CI を投げ直し、Step 3 の回収に戻る。ラウンド +1。

- **同じ段で 3 周を超えたら**ユーザーに状況を報告し人手判断を仰ぐ(自動で回し続けない)
- **`STATUS: out-of-scope`** / **`STATUS: blocked`** が返った場合もユーザーに報告し判断を仰ぐ。**親が代わりに裁定して自分で修正しない**(policy と要件の噛み合わなさは人間が決める領域で、親が引き取って直すと同じ判断を記録なしで通すことになる)

### 4. 完了報告

全段の CI green を確認したら、**段ごとに** `gh pr ready ${PR_NUM}` で ready for review 化する(`gh stack submit --open` はスタック**全体**を ready 化するが、green でない段まで巻き込むため使わない)。

```bash
gh stack view --json | jq -r '.branches[] | select(.isMerged | not) | "\(.name) #\(.pr.number) \(.pr.url)"'
```

報告するもの:

1. スタックの全 PR を**下段から順に**(段番号 / issue 番号 / PR URL / 1行要約)
2. CI 結果と fix ラウンド数(段ごと)
3. 直列化によって本来は独立している段に前後関係を付けた場合はその旨
4. subagent が `NOTES` で挙げたスコープ外の気づき(あれば)

worktree はスタックごと残す(PR が未 merge であることに加え、上に段を積むとき同じ worktree を再利用するため)。ローカルブランチ・worktree の削除は PR merge 後に `clean-branch` スキルへ委譲する。追加のコードレビューが必要なら `/code-review` を別途依頼する。

## Rules

- 着手前に**段の列**を確定させる。親 issue なら子 issue を `subIssues` + `blockedBy` の1クエリで取り、トポロジカルソートして線形化する。循環があれば積まずに停止する
- 実装・修正は必ず worktree 内で行う。repo root で直接編集しない。1スタック = 1 worktree とし、段ごとに worktree を分けない
- 段が2つ以上なら実装と CI fix を subagent に委任する。`run_in_background: false` を必ず指定し、`isolation: worktree` は使わない(同一 worktree を共有する)。委任先には `git checkout` / `gh stack` / `git push` を禁じる
- subagent の返した実装を親が読み直して点検しない。品質の担保は各段の TDD と CI であって親の再読ではない
- 集合外の blocker が `OPEN` でも **PR があればその上に積んで着手する**。PR が無い blocker が残っている場合だけ実装に入らずユーザーに確認する
- 実装・fix の前に takt の policy を読ませる(実装 = `coding` + `testing`、fix = さらに `ai-antipattern`)。パスは worktree 内で `references/resolve-policy.sh` を1回実行して解決し、プロンプトには**中身ではなくパス**を埋める。親は開かない(段が1つで自分が実装するときだけ読む)。takt 未導入なら省略して進み、スキルは止めない
- **policy と issue の要件が噛み合わない場合、委任先は独断で優先順位を決めず `blocked` で返す。親も自分で裁定せずユーザーに報告する**(迷う場合も止める側に倒す)。CI green のために policy を破ることは許さない
- テストで固定できる挙動は `tdd` スキルを駆動する。seam は実装開始前に決める
- PR は `gh stack submit --auto` で作る。`gh pr create` を直接使わない(段が1つで exit code 9 のときだけ例外)。既定の draft のまま出し、タイトルと本文(`Closes #<Ni>` を含む)は作成後に `gh pr edit` で設定する
- 段の CI は待たずに background へ投げ、次の段へ進む。ただし**下段が red と分かった時点で段の積み増しを止め、先に fix する**
- スタックの追随・コンフリクト解消は `gh stack sync` / `gh stack rebase` / `gh stack push` で行い、手で `git merge` / `git rebase` / `git push` しない。下段を直したら `gh stack rebase --upstack` で上段へ伝播させる
- fix は下の段から順に行う。CI red は表面的な patch で揉み消さず根本原因から直す。fix ループは段ごとに最大 3 周、超過したら人手判断を仰ぐ
- 段の実装が失敗したらそこで止める。上段は下段に依存するため、失敗した段を飛ばして先へ進まない。そこまでの段は submit 済みのまま残す
- CI 監視は Checks API 非依存の `references/watch-pr-actions.sh` を background で実行する。親は poll せず、ログは全文表示せず、要約と `gh run view --log-failed` の該当部分だけ読む。外部 CI を使う場合は別の認証または専用 API が無い限り green と判定しない
- 全段 CI green の確認と ready for review 化で完了とする。レビュー・マージ・worktree 削除は行わない
