# Plan 003: takt 系スキルの契約矛盾を解消する（refresh 済み）

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat eaeb7ff..HEAD -- config/.claude/skills/takt-issue/SKILL.md config/.claude/skills/takt/SKILL.md`
> If any in-scope file changed since this plan was refreshed, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3dbd88e`, 2026-07-09 / **refreshed at commit `eaeb7ff`, 2026-07-09**

## Refresh note（2026-07-09, commit `eaeb7ff`）

初版（`3dbd88e` 時点）が挙げた 4 項目のうち 2 つは、その後の `default-mini` → カスタム `lite` workflow 移行で独立に解消済み:

- ~~矛盾①「迷ったら」の既定 workflow 不一致~~ → 解消済み。全箇所が「迷ったら `lite`」で一貫（takt-issue:16/157/494、issue:188/293）。**触らないこと**
- ~~矛盾③のうち takt-issue 側の provider 記述~~ → 解消済み。takt-issue:164 は「`planner` / `coder` persona を Codex（gpt-5）」と正しく記述。**触らないこと**

残作業は以下の 3 点のみ。

## Why this matters

takt 系スキルは AI エージェントが毎回読んで挙動を決める「実行される仕様書」。残る矛盾のうち、レビューレポートのファイル名誤り（②）は **`default` workflow 実行後、アーキテクチャレビューの結果が毎回ユーザー報告から静かに欠落する** 実害がある。provider 例の不一致（③）はトークン枠の見積もりを誤らせ、`takt:manual` の未定義（④）はラベル付き issue が takt-issue に渡ったときの挙動を運任せにする。いずれもテキスト修正のみで直る。

## Current state

### 矛盾②: レビューレポートのファイル名が実物と不一致

- `config/.claude/skills/takt-issue/SKILL.md:355` — 「…レビューレポート（builtin の peer-review が出力する `architecture-review.md` / `ai-antipattern-review.md` / `supervisor-validation.md` など）を Read で読んで…」
- `config/.claude/skills/takt-issue/SKILL.md:503` — 「…`default` は `.takt/runs/<run_slug>/reports/` 配下のレポート（peer-review が出力する `architecture-review.md` / `ai-antipattern-review.md` / `supervisor-validation.md` 等）…」
- 正しいファイル名は **`architect-review.md`**。物証:
  - `.takt/runs/20260506-071342-issue-23-takt-default-extended/reports/architect-review.md` が実在（`architecture-review.md` は存在しない）
  - `config/.claude/skills/takt/references/workflows.md` — `arch-review` → `architect-review.md`
  - `config/.claude/skills/takt/references/catalog.md` — `architecture-review` | アーキテクチャレビュー (`architect-review.md`)
- 他 2 ファイル名（`ai-antipattern-review.md` / `supervisor-validation.md`）は正しい。変更は `architecture-review.md` → `architect-review.md` の置換のみ（2 箇所）。

### 矛盾③（残り）: takt/SKILL.md の persona_providers 例が実 config と不一致

実際の config（`config/.takt/config.yaml:11-17`、`~/.takt/config.yaml` に symlink される実体）:

```yaml
persona_providers:
  coder:
    provider: codex
    model: gpt-5
  planner:
    provider: codex
    model: gpt-5
```

一方 `config/.claude/skills/takt/SKILL.md:254-257` の例は coder のみ:

```yaml
persona_providers:
  coder:
    provider: codex
    model: gpt-5
```

続く説明文（:263-265 付近）も「上の例は実装で最も動く `coder` persona（write_tests / implement / ai_fix / fix 等）を Codex の `gpt-5` に振り…」と coder のみに言及。planner が無い。

**方針（変更しないこと）**: config（= 実挙動）を正とし、スキル記述を config に合わせる。config 側を変える判断は挙動変更でありこの plan のスコープ外。

### 未定義状態④: `takt:manual` ラベル

- `config/.claude/skills/issue/SKILL.md:189` が 3 値目の判定 `不要（手動）` / ラベル `takt:manual` を定義（:229/:236/:293 も参照）するが、`config/.claude/skills/takt-issue/SKILL.md` の workflow 判断表（:149-160 付近、`default` / `lite` の 2 値）と Rules（:494）は `takt:manual` を扱わず、そのラベル付き issue が takt-issue に渡ったときの扱いが未定義。
- 判断表の直後（:159-160 付近）には「`default` / `lite` のいずれも **スコープ外発見の自動 issue 起票機能を持たない**。…」の段落がある。追記はこの段落の後が自然。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| 誤ファイル名の残存確認 | `rg -n 'architecture-review\.md' config/.claude/skills/` | マッチなし（exit 1） |
| 正ファイル名の件数確認 | `rg -c 'architect-review\.md' config/.claude/skills/takt-issue/SKILL.md` | `2` |
| planner 例の確認 | `rg -A7 'persona_providers:' config/.claude/skills/takt/SKILL.md` | 例に `planner:` ブロックが含まれる |
| takt:manual 確認 | `rg -n 'takt:manual' config/.claude/skills/takt-issue/SKILL.md` | 1 件以上ヒット |

## Scope

**In scope**（変更してよいファイル）:
- `config/.claude/skills/takt-issue/SKILL.md`（②の置換 2 箇所 + ④の 1 行追加のみ）
- `config/.claude/skills/takt/SKILL.md`（persona_providers 節の例と説明文のみ）

**Out of scope**（触らない）:
- `config/.claude/skills/issue/SKILL.md` — 現状すでに一貫している（refresh で対象から外れた）
- `config/.takt/config.yaml` — 実挙動。テキストを config に合わせるのであって逆ではない
- `config/.claude/skills/takt/references/workflows.md` / `catalog.md` — すでに正しい
- 上記 2 ファイルの、この plan が挙げた箇所以外のセクション（churn が激しいファイルなので、ついでの整理をしない）
- `.takt/runs/**` — 物証として参照するだけ

## Git workflow

- **必ず worktree 上で作業**
- Branch: `fix/takt-skill-contracts`
- Commit message 例: `fix(skills): takt 系スキルのレポート名・provider 例・takt:manual の扱いを修正`
- push / PR 作成はオペレーターの指示があるときのみ

## Steps

### Step 1: レポートファイル名を実物に合わせる

`config/.claude/skills/takt-issue/SKILL.md` 内の `architecture-review.md` を **すべて** `architect-review.md` に置換する（:355 と :503 の 2 箇所のはず。置換前に `rg -c 'architecture-review\.md' config/.claude/skills/takt-issue/SKILL.md` で件数が 2 であることを確認）。

**Verify**: `rg -n 'architecture-review\.md' config/.claude/skills/` → マッチなし（exit 1）。`rg -c 'architect-review\.md' config/.claude/skills/takt-issue/SKILL.md` → `2`

### Step 2: takt/SKILL.md の persona_providers 例と説明文を実 config に合わせる

- `config/.claude/skills/takt/SKILL.md:254-257` の YAML 例に planner ブロックを追加し、実 config（上記 Current state の引用）と一致させる
- :263-265 付近の説明文を、coder と planner の両方に言及する形に更新。例: 「上の例は実装で最も動く `coder` persona（write_tests / implement / ai_fix / fix 等）とプランニングの `planner` を Codex の `gpt-5` に振り、Claude Code Max のトークン枠をレビュー・監督に温存しつつ…」（既存の文意・後続の「reviewer 系 4 persona…他構成も可能」の文は残す）

**Verify**: `rg -A7 'persona_providers:' config/.claude/skills/takt/SKILL.md` の例に `planner:` が含まれる

### Step 3: `takt:manual` のスコープ外宣言を takt-issue に 1 行追加する

`config/.claude/skills/takt-issue/SKILL.md` の workflow 判断表直後の「`default` / `lite` のいずれも **スコープ外発見の自動 issue 起票機能を持たない**。…」段落（:159-160 付近）の後に 1 行追加:

> `takt:manual` ラベルの issue はこの skill のスコープ外（workflow を回さず手動実装が妥当と `issue` skill が判定済み）。起動せずその旨をユーザーに伝える。

**Verify**: `rg -n 'takt:manual' config/.claude/skills/takt-issue/SKILL.md` → 1 件以上ヒット

## Test plan

スキルは Markdown 仕様書でありテストスイートは無い。検証は Commands 表の rg assertion + 各 Step の Verify がすべて。加えて最終確認として:

- `git diff` を通読し、変更が本 plan の挙げた行（とその近傍の文意調整）に限定されていること
- 変更行数の目安: 合計 10 行前後。それを大きく超えたらやりすぎ（STOP して報告）

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `rg 'architecture-review\.md' config/.claude/skills/` がマッチなし（exit 1）
- [ ] `rg -c 'architect-review\.md' config/.claude/skills/takt-issue/SKILL.md` → `2`
- [ ] `rg -A7 'persona_providers:' config/.claude/skills/takt/SKILL.md` に `planner:` が含まれる
- [ ] `rg 'takt:manual' config/.claude/skills/takt-issue/SKILL.md` が 1 件以上
- [ ] `git status` で in-scope 2 ファイル以外に変更がない
- [ ] `plans/README.md` のステータス行を更新した（reviewer が index を管理する場合は不要）

## STOP conditions

Stop and report back (do not improvise) if:

- Current state に引用した行番号・文言が実ファイルと一致しない（drift。特に takt-issue/SKILL.md は churn が激しい）
- `config/.takt/config.yaml` の `persona_providers` から `planner` ブロックが消えている（③の前提が変わった — その場合はスキル側でなく逆方向の修正が正しい可能性があるため報告）
- Step 1 の置換対象が 2 箇所ちょうどでない（3 箇所以上 or 1 箇所なら想定とずれている）
- 「迷ったら」の既定が `lite` 以外を指す記述を見つけた（refresh の前提が崩れている）

## Maintenance notes

- **再発リスクが高い**: この 2 ファイルは今後も churn が続く。Plan 001 の Maintenance notes に挙げた「スキル整合性チェックの CI 化」（例: `rg -l 'architecture-review\.md'` が空であること）が恒久対策。この plan の done criteria の rg assertion はそのまま CI チェックに転用できる。
- レビュー注視点: takt/SKILL.md の説明文更新で「reviewer 系 4 persona を Codex に振るなど他構成も可能」の文まで消していないこと。
- 意図的な見送り: `issue`/`takt-issue` の判断表を単一ソース化する構造的リファクタ。効果はあるがスキルの独立可読性を下げるため、churn が落ち着いてから判断。
