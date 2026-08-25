# Plan 022: addBlockedBy の既定姿勢を「並列優先」で issue / issue-organize 間で統一する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f9948f8..HEAD -- config/.claude/skills/issue/SKILL.md config/.claude/skills/issue-organize/SKILL.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `f9948f8`, 2026-08-26

## Why this matters

issue（起票時に依存を張る）と issue-organize（既存 issue に依存を張る）は同じ
`addBlockedBy` 運用を独立に文書化しており、**既定姿勢が逆方向にドリフト**している。
issue は「直列に置けるものは直列にする」、issue-organize は「順序の必然性が無いものを
直列化しない」。この判断は gh-stack のスタック段数に直結し（依存チェーン = 積み順）、
どちらのスキルを最後に走らせたかで同じ issue 群のスタック形状が変わってしまう。

**ユーザーの決定（2026-08-26）: 並列優先で統一する。** 根拠: gh-stack のスタックは線形で、
下段がマージされるたび上段全体が rebase される。不要な直列化は 1 マージごとの rebase
コストとして跳ね返る — issue 側自身が `:340`（段を積みすぎない）でこのコストを認めている。

あわせて、node ID の取得方法も 2 流儀に割れている（機能的にはどちらも正しいが、
読み比べたエージェントが「違いに意味があるのか」を考えるノイズになる）ので片方に寄せる。

## Current state

- `config/.claude/skills/issue/SKILL.md:327-342` — 「依存チェーンはそのままスタックの
  積み順になる」セクション。ドリフトの当事者は `:338`:

```markdown
- **直列に置けるものは直列にする**: 並列な blocker は積み順が一意に決まらず、スタックに落とす時点で順序を決め直すことになる。実装順に意味があるなら直列の依存を張る
- **1つのスタックは1つのストーリーに保つ**: 同じ目的へ向かう issue 群だけを1本の依存チェーンにまとめる。無関係な作業を同じチェーンに混ぜない(別スタックになる)
- **段を積みすぎない**: 下段がマージされるたび上段すべてが rebase される。チェーンが伸びるほど1回のマージで動く範囲が広がるため、独立して出せる塊があれば別チェーンに分ける
```

- `config/.claude/skills/issue-organize/SKILL.md:133-138` — こちらが採用する側の姿勢:

```markdown
- **親 issue には `blockedBy` を張らない**。親は器であって PR を持たず、スタックの段にならない
- **依存が無い子同士は並列**であり、別々のスタックになる。gh-stack のスタックは線形（1つの段が持てる子は1つ）なので、順序の必然性が無いものを直列化しない
- 依存関係は**本文に `Blocked by` と書かない**。ネイティブ側を唯一の正とする（2箇所に持つと食い違う）
- 誤って張った依存は `removeBlockedBy` を同じ引数で呼べば外せる
```

- node ID 取得の 2 流儀:
  - `config/.claude/skills/issue/SKILL.md:300-301`:
    `BLOCKED_ID=$(gh issue view <塞がれる側の番号> --json id --jq .id)`
  - `config/.claude/skills/issue-organize/SKILL.md:117-118`:
    `local blocked_id=$(gh api repos/$OWNER/$REPO/issues/$blocked --jq '.node_id')`
  - issue 側は根拠コメント付き（`:299` 「gh issue view の id がそのまま GraphQL node ID」）。
    **issue 側の流儀（`gh issue view --json id`）に統一する**（1 コマンドで済み、
    `$OWNER/$REPO` の解決が不要）
- `addBlockedBy` mutation 本体は両ファイルでほぼ同一（`issue:304-309` / `issue-organize:119-124`）—
  これは**意図した重複として残す**（各スキルは単独で完結する必要がある。共有 references 化は
  却下: スキル間 `../` 参照は Plan 019 で掃除したばかりの壊れやすい結合）
- issue-direct はこのチェーンの消費側（`subIssues` + `blockedBy` を読んでトポロジカルソート）で、
  本プランの影響を受けない

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| node ID 等価確認 | `gh issue view <open な issue 番号> --json id --jq .id` と `gh api repos/daiki-beppu/dotfiles/issues/<同番号> --jq .node_id` | 同一の値 |
| 検証 grep | 各 Step の Verify | 期待値どおり |
| 全チェック | `bash scripts/check.sh` | exit 0 |

## Scope

**In scope**:

- `config/.claude/skills/issue/SKILL.md` — `:327-342` の姿勢書き換えのみ
- `config/.claude/skills/issue-organize/SKILL.md` — `:115-124` の node ID 取得の統一のみ
- `plans/README.md` — 自分の status 行

**Out of scope**:

- 両スキルの他のセクション（本文契約・分割ドクトリン等 — Plan 025 が issue の
  分割セクションを references/ へ移すので、範囲を重ねない）
- frontmatter description（Plan 023 の担当）
- mutation スニペット自体の共通化（上記のとおり意図して重複を残す）
- issue-direct / gh-stack スキル

## Git workflow

- Branch: `docs/addblockedby-parallel-first`（worktree: `$REPO_ROOT/.claude/worktrees/addblockedby-parallel-first/`）
- コミット例: `docs(skills): addBlockedBy の既定を並列優先で issue / issue-organize 間で統一`

## Steps

### Step 1: node ID の 2 流儀が同じ値を返すことを実地確認する

open な issue を 1 つ選び（`gh issue list --limit 1 --json number --jq '.[0].number'`）、
Commands の 2 コマンドを実行して同値を確認する。open issue が 0 件なら closed でよい。

**Verify**: 2 つの出力が一致する（`I_kwDO...` 形式）。

### Step 2: issue/SKILL.md の既定姿勢を並列優先に書き換える

`config/.claude/skills/issue/SKILL.md:338` の
`- **直列に置けるものは直列にする**: ...` の行を次で置き換える:

```markdown
- **依存が無いものは並列にする**: `addBlockedBy` は実装順の必然性(下段の成果物を上段が使う)があるときだけ張る。gh-stack のスタックは線形なので、必然性の無い直列化は下段マージごとの上段 rebase コストになる。並列な子同士は別々のスタックになり、積み順は実装時に決めてよい
```

`:339-341` の 2 bullet（1 ストーリー / 段を積みすぎない）は並列優先と整合しているので
そのまま残す。

**Verify**: `grep -c '直列に置けるものは直列にする' config/.claude/skills/issue/SKILL.md` → `0`、
`grep -c '依存が無いものは並列にする' config/.claude/skills/issue/SKILL.md` → `1`

### Step 3: issue-organize/SKILL.md の node ID 取得を統一する

`config/.claude/skills/issue-organize/SKILL.md:117-118` の

```bash
  local blocked_id=$(gh api repos/$OWNER/$REPO/issues/$blocked --jq '.node_id')
  local blocker_id=$(gh api repos/$OWNER/$REPO/issues/$blocker --jq '.node_id')
```

を次で置き換える（issue スキル `:299-301` と同じ流儀。コメントも揃える）:

```bash
  # gh issue view の id がそのまま GraphQL node ID
  local blocked_id=$(gh issue view "$blocked" --json id --jq .id)
  local blocker_id=$(gh issue view "$blocker" --json id --jq .id)
```

関数内でこれ以降 `$OWNER` / `$REPO` を使う箇所が残っていないかを確認し、残っていなければ
それらの変数定義（関数の外にある場合は他の用途を確認してから）はそのまま触らない。

**Verify**: `grep -c 'node_id' config/.claude/skills/issue-organize/SKILL.md` → `0`
（他の箇所で `node_id` を使っていたら STOP — このプランの前提より使用箇所が多い）

### Step 4: 姿勢の矛盾が残っていないことを横断確認する

```bash
grep -n '直列' config/.claude/skills/issue/SKILL.md config/.claude/skills/issue-organize/SKILL.md
```

**Verify**: ヒットする行がすべて「並列優先・必然性があるときだけ直列」と整合する内容である
こと（機械判定できないので、各ヒット行を読み、逆方向の既定を述べる行が 0 件であることを
確認する。判断に迷う行があれば STOP して行を引用して報告）。

### Step 5: 全チェック

```bash
bash scripts/check.sh
```

**Verify**: `all checks passed`、exit 0

## Test plan

文書のみの変更で自動テスト対象外。Step 1 の実地確認（node ID 等価）と Step 2-4 の
grep ゲートが検証を担う。

## Done criteria

- [ ] Step 2 / Step 3 の grep がすべて期待値どおり
- [ ] Step 4 で逆方向の既定を述べる行が 0 件
- [ ] `bash scripts/check.sh` exit 0
- [ ] 変更が 2 ファイル + plans/README.md に限られる（`git status`）
- [ ] `plans/README.md` の status 行を更新済み

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 で 2 流儀の値が一致しない（`gh` の挙動が変わっている — 統一先の選定根拠が崩れる）
- Step 3 で `node_id` の使用箇所が issue-organize 内に 3 箇所以上ある
  （このプランの現状把握とドリフトしている）
- 「Current state」の抜粋と実ファイルが一致しない

## Maintenance notes

- 今後どちらかのスキルで依存運用のルールを変えるときは、**両ファイルを同時に**変える。
  重複は意図的（スキルの自己完結性のため）であり、その代償がこの同時更新義務
- Plan 025 が issue の分割セクション（`:246-343`）を references/splitting.md へ移す。
  本プランが先に実行されていれば、移動する内容は統一後の姿勢になっている（それが
  実行順を 022 → 025 とする理由）
- レビュアーの注視点: Step 2 の置き換えが「実装順に意味があるなら直列」という
  正当な直列化の余地まで消していないか（新文言は「必然性があるときだけ張る」で残している）
