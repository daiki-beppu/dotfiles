# Plan 003: takt 系スキルの 3 つの契約矛盾（＋1 つの未定義状態）を解消する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3dbd88e..HEAD -- config/.claude/skills/takt-issue/SKILL.md config/.claude/skills/issue/SKILL.md config/.claude/skills/takt/SKILL.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `3dbd88e`, 2026-07-09

## Why this matters

takt 系スキルはこのリポジトリの日常運用の中核で、AI エージェントが毎回読んで挙動を決める「実行される仕様書」。takt-issue/SKILL.md だけで直近 29 commit の churn があり、その代償として矛盾が 3 件残っている。①「迷ったらどの workflow か」が同一ファイル内で正反対（エージェントがどちらを読むかで 1 run あたり約 20-25% のトークン差が出る判断が毎回ブレる）。② 完了時に Read するレビューレポートのファイル名が誤りで、**アーキテクチャレビューの結果が毎回ユーザー報告から静かに欠落する**。③ provider 構成の説明が実際の config と食い違い、トークン枠の見積もりを誤らせる。いずれもテキスト修正のみで直る。

## Current state

対象 3 ファイルの役割:
- `config/.claude/skills/takt-issue/SKILL.md` — GitHub issue を takt workflow で実装する手順書（churn 最大のファイル）
- `config/.claude/skills/issue/SKILL.md` — issue 起票スキル。起票時に takt 適用判断（ラベル）を前倒しで行い、takt-issue がそれを踏襲する契約
- `config/.claude/skills/takt/SKILL.md` — takt CLI のリファレンス

### 矛盾 ①: 「迷ったら」の既定 workflow が 3 箇所で不一致

- `takt-issue/SKILL.md:16` — `default-mini` の説明: 「…**迷ったらこちら**（トークン節約優先）」
- `takt-issue/SKILL.md:157` — 判断表: 「判断に迷う場合 | `default-mini`（write_tests 1 ステップ分 + 後続レビュー対象の縮小で 1 run あたり約 20-25% 軽い。トークン節約を優先）」
- `takt-issue/SKILL.md:493` — Rules: 「…bugfix / chore / docs / 小規模 refactor は `default-mini`、feature / 中〜大規模は `default`、**迷ったら `default`**。」 ← 16/157 と正反対
- `issue/SKILL.md:169` — 判断表の `default` 行: 「feature / enhancement、複数ファイル、テスト先行で進めたい中〜大規模タスク。**迷ったらこれ（fail-safe）**」
- `issue/SKILL.md:262` — Rules: 「判定基準は `takt-issue` skill の workflow 判断表と整合させ、**迷ったら `default` に寄せる（fail-safe）**」
- `issue/SKILL.md:165` — 「判定基準は `takt-issue` skill の workflow 判断表と整合させる」と明記（現状この整合が破れている）

**統一先の決定（git 履歴による根拠、変更しないこと）**: 「迷ったら `default-mini`」に統一する。takt-issue:16/157 の default-mini 既定は commit `f276dda`（2026-06-12、"chore(claude): トークン消費削減の設定・スキル調整"）で導入された最新の意図。「迷ったら `default`」側は `859faab`（2026-05-22）と `85c9fad`（2026-05-31）由来の古い記述が残ったもの。

### 矛盾 ②: レビューレポートのファイル名が実物と不一致

- `takt-issue/SKILL.md:354` — 「レビューレポート（builtin の peer-review が出力する `architecture-review.md` / `ai-antipattern-review.md` / `supervisor-validation.md` など）を Read で読んで…」
- `takt-issue/SKILL.md:502` — 「レビュー結果は … レポート（builtin の peer-review が出力する `architecture-review.md` / `ai-antipattern-review.md` / `supervisor-validation.md` 等）に出力される。」
- 正しいファイル名は **`architect-review.md`**。物証:
  - リポジトリにコミット済みの実行痕跡 `.takt/runs/20260506-071342-issue-23-takt-default-extended/reports/architect-review.md` が実在する（`architecture-review.md` は存在しない）
  - `config/.claude/skills/takt/references/workflows.md:64` — 「`arch-review`（architecture-reviewer, `review-arch` instruction）→ `architect-review.md`」
  - `config/.claude/skills/takt/references/catalog.md:191` — 「`architecture-review` | アーキテクチャレビュー (`architect-review.md`)」
- 他 2 ファイル名（`ai-antipattern-review.md` / `supervisor-validation.md`）は正しい。変更するのは `architecture-review.md` → `architect-review.md` の置換のみ。

### 矛盾 ③: provider 構成の説明が実 config と不一致

- `takt-issue/SKILL.md:163` — 「`coder` persona のみ Codex、その他（`planner` / `supervisor` / reviewer 系 4 persona）は Claude。」
- 実際の config（`config/.takt/config.yaml:11-17`、これが `~/.takt/config.yaml` に symlink される実体）:

```yaml
persona_providers:
  coder:
    provider: codex
    model: gpt-5
  planner:
    provider: codex
    model: gpt-5
```

- `takt/SKILL.md:253-258` の例は coder のみで、:263-265 の説明文も「`coder` persona … を Codex の `gpt-5` に振り」とだけ書く（planner に言及なし）。
- **方針（変更しないこと）**: config（= 実挙動）を正とし、スキル記述を config に合わせる。config 側を変える判断は挙動変更でありこの plan のスコープ外。

### 未定義状態: `takt:manual` ラベル

- `issue/SKILL.md:171` が 3 値目の判定 `不要（手動）` / ラベル `takt:manual` を定義するが、`takt-issue/SKILL.md` の判断表（:153-157）と Rules（:493）は `default` / `default-mini` の 2 値しか扱わず、`takt:manual` 付き issue が takt-issue に渡ったときの扱いが未定義。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| 誤ファイル名の残存確認 | `rg -n 'architecture-review\.md' config/.claude/skills/` | マッチなし（exit 1） |
| 「迷ったら」全数確認 | `rg -n '迷ったら' config/.claude/skills/takt-issue/SKILL.md config/.claude/skills/issue/SKILL.md` | 全ヒットが `default-mini` を指す |
| provider 記述確認 | `rg -n 'coder.*のみ Codex|planner.*Claude' config/.claude/skills/takt-issue/SKILL.md` | マッチなし（exit 1） |

## Scope

**In scope**（変更してよいファイル）:
- `config/.claude/skills/takt-issue/SKILL.md`
- `config/.claude/skills/issue/SKILL.md`
- `config/.claude/skills/takt/SKILL.md`（persona_providers 節の例と説明文のみ）

**Out of scope**（触らない）:
- `config/.takt/config.yaml` — 実挙動。テキストを config に合わせるのであって逆ではない
- `config/.claude/skills/takt/references/workflows.md` / `catalog.md` — すでに正しい
- 上記 3 ファイルの、この plan が挙げた箇所以外のセクション（churn が激しいファイルなので、ついでの整理をしない）
- `.takt/runs/**` — 物証として参照するだけ（Plan 005 が削除するため、実行順が 005 の後になった場合は STOP conditions 参照）

## Git workflow

- **必ず worktree 上で作業**（`$REPO_ROOT/.worktrees/<slug>/`）
- Branch: `fix/takt-skill-contracts`
- Commit message 例: `fix(skills): takt 系スキルの workflow 既定・レポート名・provider 記述の矛盾を解消`
- push / PR 作成はオペレーターの指示があるときのみ

## Steps

### Step 1: 「迷ったら」を `default-mini` に統一する

- `takt-issue/SKILL.md:493` の「迷ったら `default`」→「迷ったら `default-mini`」（同じ行の「bugfix / chore / docs / 小規模 refactor は `default-mini`、feature / 中〜大規模は `default`」は変更しない）
- `issue/SKILL.md:169`（`default` 行）から「**迷ったらこれ（fail-safe）**」を削除し、:170 の `default-mini` 行の基準文末尾に「**迷ったらこちら**（takt-issue の判断表と同じ既定）」を追加
- `issue/SKILL.md:262` の「迷ったら `default` に寄せる（fail-safe）」→「迷ったら `default-mini` に寄せる（トークン節約優先。takt-issue の判断表と整合）」

**Verify**: `rg -n '迷ったら' config/.claude/skills/takt-issue/SKILL.md config/.claude/skills/issue/SKILL.md` → 全ヒット（4 箇所前後）がいずれも `default-mini` を既定として指している。`default` を既定と書く行がゼロ

### Step 2: レポートファイル名を実物に合わせる

`takt-issue/SKILL.md` 内の `architecture-review.md` を **すべて** `architect-review.md` に置換する（:354 と :502 の 2 箇所のはず。置換前に `rg -c` で件数確認）。

**Verify**: `rg -n 'architecture-review\.md' config/.claude/skills/` → マッチなし（exit 1）。`rg -c 'architect-review\.md' config/.claude/skills/takt-issue/SKILL.md` → 2

### Step 3: provider 構成の記述を実 config に合わせる

- `takt-issue/SKILL.md:163` を書き換え: 「`coder` と `planner` persona は Codex（gpt-5）、その他（`supervisor` / reviewer 系 4 persona）は Claude。実装とプランニングを Codex に振り、Claude Code Max のトークン枠をレビュー・監督に温存する構成。」（後続の「詳細と rate limit リカバリ手順は…」の文は残す）
- `takt/SKILL.md:253-258` の YAML 例に planner ブロックを追加して実 config と一致させ、:263-265 の説明文を「実装で最も動く `coder` とプランニングの `planner` を Codex の `gpt-5` に振り…」の形に更新

**Verify**: `rg -n 'coder.*のみ Codex' config/.claude/skills/takt-issue/SKILL.md` → マッチなし。`rg -A3 'persona_providers:' config/.claude/skills/takt/SKILL.md` に `planner:` が含まれる

### Step 4: `takt:manual` のスコープ外宣言を takt-issue に 1 行追加する

`takt-issue/SKILL.md` の判断表（:153-157 付近）の直後に 1 行追加:

> `takt:manual` ラベルの issue はこの skill のスコープ外（workflow を回さず手動実装が妥当と `issue` skill が判定済み）。起動せずその旨をユーザーに伝える。

**Verify**: `rg -n 'takt:manual' config/.claude/skills/takt-issue/SKILL.md` → 1 件以上ヒット

## Test plan

スキルは Markdown 仕様書でありテストスイートは無い。検証は Commands 表の rg assertion 3 本 + 各 Step の Verify がすべて。加えて最終確認として:

- `git diff` を通読し、変更が本 plan の挙げた行（とその近傍の文意調整）に限定されていること
- 変更行数の目安: 合計 10〜20 行程度。それを大きく超えたらやりすぎ（STOP して報告）

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `rg 'architecture-review\.md' config/.claude/skills/` がマッチなし（exit 1）
- [ ] `rg -n '迷ったら.*`default`[^-]' config/.claude/skills/` がマッチなし（default を既定に指す行の消滅）
- [ ] `rg 'takt:manual' config/.claude/skills/takt-issue/SKILL.md` が 1 件以上
- [ ] `rg 'coder.*のみ Codex' config/.claude/skills/takt-issue/SKILL.md` がマッチなし
- [ ] `git status` で in-scope 3 ファイル以外に変更がない
- [ ] `plans/README.md` のステータス行を更新した

## STOP conditions

Stop and report back (do not improvise) if:

- Current state に引用した行番号・文言が実ファイルと一致しない（drift。特にこの 3 ファイルは churn が激しい）
- `config/.takt/config.yaml` の `persona_providers` から `planner` ブロックが消えている（矛盾③の前提が変わった — その場合はスキル側でなく逆方向の修正が正しい可能性があるため報告）
- `.takt/runs/.../reports/architect-review.md` が存在しない（Plan 005 実行後の可能性。その場合はファイル名の根拠を `takt/references/workflows.md:64` と `catalog.md:191` に切り替えてよいが、その旨を報告に含める）
- Step 2 の置換対象が 2 箇所ちょうどでない（3 箇所以上 or 1 箇所なら想定とずれている）

## Maintenance notes

- **再発リスクが高い**: この 3 ファイルは今後も churn が続く。Plan 001 の Maintenance notes に挙げた「スキル整合性チェックの CI 化」（例: `rg -l 'architecture-review\.md'` が空であること）が恒久対策。この plan の done criteria の rg assertion はそのまま CI チェックに転用できる。
- レビュー注視点: 「迷ったら」統一で `default` 側の正当な使用条件（feature / 中〜大規模）まで書き換えていないこと。
- 意図的な見送り: `issue`/`takt-issue` の判断表を単一ソース化する構造的リファクタ（1 箇所に表を置き他方から参照）。効果はあるがスキルの独立可読性を下げるため、churn が落ち着いてから判断。
