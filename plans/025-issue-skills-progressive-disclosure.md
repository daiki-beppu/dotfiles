# Plan 025: issue / issue-direct を刈ってから開示する（prune → disclose）

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f9948f8..HEAD -- config/.claude/skills/issue config/.claude/skills/issue-direct`
> Plan 022（依存姿勢）と 023（frontmatter）の**後**に実行する。それらの差分は想定内 —
> 「Current state」の見出し・構造が現物と一致していれば続行してよい。構造ごと変わって
> いたら STOP。

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED（移動素材の大半はエージェントが逐語コピーするテンプレート — ポインタが
  弱いと出力契約が崩れる。削除は「no-op / 重複」判定を誤ると house rule を失う）
- **Depends on**: plans/022-addblockedby-parallel-first.md, plans/023-description-surgery.md
- **Category**: dx
- **Planned at**: commit `f9948f8`, 2026-08-26（2026-08-26 改訂: eli5 / writing-for-agents 基準で
  「逐語移動」から「刈ってから開示」へ転換。2026-08-26 dispatch 前レビューで issue-direct の行数ゲートを ≤300 → ≤370 に校正 — 実測 441 行から、移動 2 テンプレート（35+32）・削除（When to Use 5 / Rules 9）・ポインタ追記 +4 を差し引くと着地は約 362 行で、≤300 は本プラン自身の「残す」リストと両立しない達成不能ゲートだった）

## Why this matters

初版のこのプランは「内容を全部残して references/ へ移す」だった。eli5（全 10 行のスキル）と
writing-for-agents の規範に照らして方針を改める: **行が場所を稼ぐのは、モデルが放って
おくと間違える失敗を防ぐとき（実測知・house rule・安全境界）か、逐語コピーする
テンプレートであるときだけ**。それ以外 — モデルが既定でそうする指示（no-op）、同一ファイル
内・CLAUDE.md との重複、descriptionの再掲 — は移動でなく**削除**する。

そのうえで残った素材を情報階層に置く: **全 run が通る分岐は本文に**、**一部の run しか
通らない分岐（分割時のみ・段が 2 つ以上のときのみ）は references/ に**。

## Current state

### issue（`config/.claude/skills/issue/SKILL.md`、434 行）

**削除対象（no-op / 重複）** — 見出し・内容で特定する（022/023 適用後は行位置が前後する）:

- 実質なし — issue は密度が高く、削除で稼げる行は少ない。フェーズ 1〜6 の手順・落とし穴・
  Rules はいずれも house rule か実測知（`--body-file` の quoting 事故、ラベル実在確認等）。
  無理に削らない

**開示対象（分岐・階層の判定）**:

| 現行位置（f9948f8） | 内容 | 判定 |
|---|---|---|
| `:119-245` | 出力契約（60 行フェンス `:123-182`）+ 常置 3 セクションの理由（`:184-189`）+ 書式規約 / 要件・完了契約の書き方 | → `references/body-contract.md`。全 run が通る素材だが、127 行の塊が本文中央でフェーズ列を分断している — 階層保護のための開示（トークン節約ではない） |
| `:246-343` | 粒度ドクトリン / 分割後の形 / 準備段の例外 / addBlockedBy 手順 | → `references/splitting.md`。**分割する run しか通らない分岐** — 開示の本来型。判定の一文（`:252-256`）と「1 issue = 1 振る舞い = 1 PR = スタック1段」の原則だけ本文に残す |
| `:344-352` | expand–contract | → `references/splitting.md` |

**重要**: `:184-189` の「なぜ 概要/目的/受け入れ条件 を常置するか（takt followup-task の
上位集合を保つ）」は、テンプレートと**同じファイルに隣接して**移す。理由が剥がれると次の
編集者がセクションを削って takt 互換を壊す。

### issue-direct（`config/.claude/skills/issue-direct/SKILL.md`、442 行）

**削除対象（no-op / 重複）**:

| 現行位置 | 内容 | 削除理由 |
|---|---|---|
| `:22-25` | `## When to Use`（「issue #N を対応して」等 4 行） | description（023 適用後）の逐語重複。pointer が既に持つ identity |
| `:172` の説明文 | `worktree.baseRef: "head"` の仕組み解説（「**main を checkout してから作る理由**」段落の前半） | `config/.claude/CLAUDE.md` が常時ロードで同じ説明を持つ三重記述の 1 つ。**1 行のポインタ**（「理由は CLAUDE.md の worktree 節。他リポジトリでも main から切る」）に置き換える。`git log --oneline main..HEAD` の確認コマンドと `git merge main` の追いつき手順は**残す**（実行可能な手順であり説明ではない） |
| `:426-442` の `## Rules` のうち、Step 本文の逐語再掲になっている bullet | 例: subagent 設定（`run_in_background: false` / isolation 指定なし — `:212-216` と重複）、worktree 内で作業（`:150-172` と重複）、`gh stack submit --auto` で PR 作成（`:43` パラメータ表と重複）、policy を読ませる（`:174-188` と重複） | 同一ファイル内の重複。**本文に無い独自ルールだけ残す**: 着手順（段の列をトポロジカルソートで確定・循環なら停止。現物の bullet 冒頭は「着手前に**段の列**を確定させる」— `frontier` という語はファイル内に存在しない）、集合外 blocker の扱い（`:432`）、下段 red で積み増し停止（`:437`）、fix は下段から / 3 周上限（`:439`）、失敗段で停止（`:440`）、外部 CI の green 判定制約（`:441`） |

**開示対象**:

| 現行位置 | 内容 | 判定 |
|---|---|---|
| `:220-254` | 実装 subagent プロンプトテンプレート（35 行フェンス） | → `references/subagent-prompts.md`。**段が 2 つ以上の run しか通らない分岐**（1 段なら親が自分で実装しテンプレは使わない） |
| `:361-392` | CI-fix subagent プロンプトテンプレート（32 行フェンス） | → 同ファイル。同じ分岐条件 |

`:255-258` の運用注意（本文を親が読まない / policy はパスだけ / 段が 1 つなら親が実装）は
判断ルールなので本文に残す。`issue-direct/references/` は既存
（`resolve-policy.sh` / `watch-pr-actions.sh`）、`issue/references/` は新規作成。

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| 行数 | `wc -l config/.claude/skills/issue/SKILL.md config/.claude/skills/issue-direct/SKILL.md` | issue ≤ 250、issue-direct ≤ 370 |
| リンク実在 | Step 5 の for ループ | MISSING 0 件 |
| 全チェック | `bash scripts/check.sh` | exit 0 |

## Scope

**In scope**:

- `config/.claude/skills/issue/SKILL.md`、`config/.claude/skills/issue/references/{body-contract,splitting}.md`（新規）
- `config/.claude/skills/issue-direct/SKILL.md`、`config/.claude/skills/issue-direct/references/subagent-prompts.md`（新規）
- `plans/README.md` — 自分の status 行

**Out of scope**:

- frontmatter description（023 で確定済み）
- 開示素材の**内容の書き換え**（移す文面は 022 適用後のものを逐語で。削除と移動だけを行い、
  改善はしない）
- issue-organize / takt / gh-stack、`resolve-policy.sh` / `watch-pr-actions.sh`
- clean-branch の worktree 記述（CLAUDE.md との重複がもう 1 箇所あるが 3 行で無害 —
  deferred のまま）

## Git workflow

- Branch: `docs/issue-skills-prune-disclose`（worktree: `$REPO_ROOT/.claude/worktrees/issue-skills-prune-disclose/`）
- コミットは「削除」と「開示」を分ける（diff レビューのため）。スキルごと × 2 = 最大 4 コミット。
  message 例: `docs(skills): issue-direct の重複 Rules と no-op を削除`

## Steps

### Step 1: issue-direct — 削除パス

「Current state」の削除対象表のとおり: `## When to Use` セクション削除、`:172` 前半を
1 行ポインタ化、`## Rules` から本文再掲 bullet を削除（残す bullet は表に列挙した 6 種）。

**Verify**: `grep -c '## When to Use' config/.claude/skills/issue-direct/SKILL.md` → `0`、
`grep -c 'baseRef' config/.claude/skills/issue-direct/SKILL.md` → `0` または `1`（ポインタ行のみ）、
Rules セクションが 8 bullet 以下

### Step 2: issue-direct — 開示パス

`references/subagent-prompts.md` を作成し 2 テンプレートを逐語で移す。冒頭 2〜3 行:

```markdown
# subagent プロンプトテンプレート

実装用と CI-fix 用の 2 本。どちらも `## 前提(厳守)` / `## 着手前に読むもの` / `## 返す内容` の
骨格を共有する。`<...>` は呼び出し時に実際の値で埋める。フォーマットを崩すと親が STATUS 行を
機械的に読めなくなる。
```

本文の跡地（2-2 と 3-1）にポインタ:

```markdown
プロンプトは [references/subagent-prompts.md](references/subagent-prompts.md) の
該当テンプレートを**逐語コピー**し、`<...>` を埋めて渡す。委任のたびに必ず開く(記憶で再構成しない)。
```

**Verify**: `wc -l config/.claude/skills/issue-direct/SKILL.md` ≤ 370、
`grep -c 'subagent-prompts.md' config/.claude/skills/issue-direct/SKILL.md` → `2`

### Step 3: issue — 開示パス（削除パスは無し）

`references/body-contract.md`（出力契約 + 常置理由 + 書式規約 + 要件/完了契約の書き方）と
`references/splitting.md`（粒度詳細 + 分割後の形 + 準備段例外 + addBlockedBy + expand–contract）を
作成し逐語で移す。本文の跡地:

```markdown
## フェーズ 4: 本文を生成する

本文は [references/body-contract.md](references/body-contract.md) の出力契約に**逐語で従う**。
生成の前に必ず全文を読む(テンプレート・書式規約・要件/完了契約の書き方。
`概要` `目的` `受け入れ条件` を常置する理由もそこにある — 省くと takt 互換が壊れる)。
```

```markdown
### 粒度: 1 issue = 1 振る舞い

**1 issue = 1 振る舞い = 1 PR = スタック1段**。判定は次の一文で行う。

> この issue を完了させたとき、**利用者または呼び出し側から見て何が1つ変わるか**を1文で言い切れるか。

言い切れない・分割で合意した・`--split` 指定のときは、
[references/splitting.md](references/splitting.md) に従って分割を設計する
(分割後の形 / 準備段の例外 / expand–contract / addBlockedBy)。**分割するときは必ず読む**。
```

**Verify**: `wc -l config/.claude/skills/issue/SKILL.md` ≤ 250、
`ls config/.claude/skills/issue/references/` → `body-contract.md splitting.md`

### Step 4: 内容の欠落が無いことを確認する

```bash
grep -c '拒否すべき誤実装' config/.claude/skills/issue/references/body-contract.md
grep -c 'followup-task' config/.claude/skills/issue/references/body-contract.md
grep -c 'expand' config/.claude/skills/issue/references/splitting.md
grep -c 'STATUS: done | blocked' config/.claude/skills/issue-direct/references/subagent-prompts.md
grep -c 'STATUS: fixed | out-of-scope | blocked' config/.claude/skills/issue-direct/references/subagent-prompts.md
grep -c 'frontier\|集合外' config/.claude/skills/issue-direct/SKILL.md
```

**Verify**: すべて 1 以上（最後の grep は「独自ルールを消しすぎていない」ことの確認）。

### Step 5: リンク切れゼロと全チェック

```bash
for s in issue issue-direct; do
  for f in $(grep -o 'references/[a-z-]*\.\(md\|sh\)' "config/.claude/skills/$s/SKILL.md" | sort -u); do
    test -f "config/.claude/skills/$s/$f" && echo "OK $s/$f" || echo "MISSING $s/$f"
  done
done
bash scripts/check.sh
```

**Verify**: `MISSING` 0 件。check.sh exit 0。

## Test plan

Step 4 の grep が「コピー素材の核と独自ルールが生き残っている」ことを機械確認する。
実運用の確認: 次の `/issue` 起票で出力契約どおりの本文、次の issue-direct 複数段実行で
STATUS 形式が守られるかを観察する。

## Done criteria

- [ ] `wc -l`: issue ≤ 250、issue-direct ≤ 370
- [ ] Step 1 / 4 / 5 の Verify がすべて期待値どおり
- [ ] `bash scripts/check.sh` exit 0
- [ ] frontmatter description に diff が無い
- [ ] `plans/README.md` の status 行を更新済み

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 022 / 023 が未実施（README の status で確認）
- 削除対象の Rules bullet が本文と「再掲」かどうか判断できないものが 3 つ以上ある
  （判定リストを添えて報告 — 勝手に削らない）
- 「Current state」の見出しが現物に見つからない
- 行数目標に 2 回の調整で収まらない

## Maintenance notes

- **削る規準（今後の編集にも適用）**: 行が場所を稼ぐのは「モデルが放っておくと間違える
  失敗を防ぐ」（実測知・house rule・安全境界）か「逐語コピーするテンプレート」のときだけ。
  no-op（モデルが既定でそうする指示）と重複（description・CLAUDE.md・同一ファイル内の再掲）は
  削除。規範例 = eli5 スキル（全 10 行）
- **観察ポイント**: references 化の実リスクは「ポインタを無視して記憶でテンプレートを
  再構成する」こと。崩れたらポインタを強める（「読んだことを確認してから生成する」）
- issue の本文契約の正は今後 `references/body-contract.md`。takt の
  `OUTPUT_CONTRACT_STYLE_GUIDE.md` との対応関係は従来どおり
- Rules の削除で本文が唯一の正になった項目は、今後 Step 側を編集したら Rules に
  書き戻さない（重複の再発防止）
