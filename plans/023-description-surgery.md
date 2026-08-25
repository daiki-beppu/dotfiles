# Plan 023: スキル description を context pointer として書き直す（eli5 / writing-for-agents 基準）

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat f9948f8..HEAD -- config/.claude/skills/takt/SKILL.md config/.claude/skills/issue-direct/SKILL.md config/.claude/skills/issue/SKILL.md config/.claude/skills/issue-organize/SKILL.md config/.claude/skills/goal-setter/SKILL.md config/.claude/skills/nix/SKILL.md config/.claude/skills/free-disk-space/SKILL.md config/.claude/skills/clean-branch/SKILL.md config/.claude/skills/cmux/SKILL.md config/.claude/skills/cmux-workspace/SKILL.md`
> 本プランは各ファイルの **frontmatter description のみ**を触る。他プラン（021 / 024 / 025 / 026）が
> 本文を変更していても、frontmatter が「Current state」と一致していれば続行してよい。
> frontmatter 自体が違っていたら STOP。

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none（同一ファイルの本文を触る 021 / 025 / 026 と同時実行しない）
- **Category**: dx
- **Planned at**: commit `f9948f8`, 2026-08-26（2026-08-26 改訂: eli5 / writing-for-agents 基準）

## Why this matters

description は常時ロードされる **context pointer** であり、その仕事は 2 つだけ —
「これが何か」を 1 文で言い、「どの分岐で読みに来るか」のトリガーを列挙する。
規範例は公式コミュニティの eli5 スキル（description 2 文・本文 2 行）:

> Explain a topic like I'm a 5 year old. Use when the user types /eli5 \<topic\> or asks for a dead-simple picture explainer of how something works.

現在の有効スキルの description は合計約 4,200 字（推定 1,950 トークン/セッションの常時払い。
CJK は 1 字 ≒ 1 トークン）で、pointer の規範に照らした欠陥が 4 種ある:

1. **境界の欠落**: 「issue #N を実装して PR まで」が takt と issue-direct の両方に合致するのに
   相互言及が無い（実行モデルが全く違う: キュー+別 pane vs 自セッション+subagent）。
   cmux / cmux-workspace も caller-scope という実際の境界が description に無い
2. **死んだ参照**: issue-organize が存在しない `/to-issues` を毎セッション案内
3. **同義語の山**: 1 つの分岐を言い換えで何度も書いている（issue-organize は 7 個のトリガー句、
   issue は 4 個 — 分岐はそれぞれ 2〜3 個しかない）。pointer 規範は「1 分岐 1 トリガー」
4. **本文が持つ identity の重複**: フラグ列挙（`--search / --add / ...`）や機能の詳説は
   起動後に本文が語ること。トリガー判定には寄与せず、毎セッション課金だけされる。
   goal-setter は「wants **Codex** to work…」と自己申告し、Claude Code セッションで
   「別エージェント用」と読めて不発になる

書き換えの原則（全 Step 共通）: **先頭に主語となる語**（発火の仕事は先頭語がする）、
**1 分岐 1 トリガー**、**本文が語る詳細は削る**、**否定境界（〜には使わない / 〜は別スキル）は
routing に効くので残す**。

## Current state

全 10 ファイルの frontmatter description の位置（f9948f8 時点）。YAML スタイル
（`>-` / `|` / `"..."`）は現状維持し、値だけ差し替える:

- `config/.claude/skills/takt/SKILL.md:3-13`（526 字、フラグ列挙 `:12-13`、トリガー句 6 個）
- `config/.claude/skills/issue-direct/SKILL.md:3-7`（takt への言及なし）
- `config/.claude/skills/issue/SKILL.md:3-11`（トリガー句 4 個、フラグ列挙 `:9-10`）
- `config/.claude/skills/issue-organize/SKILL.md:3-6`（トリガー句 7 個、`:6` に `/to-issues`）
- `config/.claude/skills/goal-setter/SKILL.md:3`（"wants Codex to work…" + 本文が語る Defines… の identity 文）
- `config/.claude/skills/nix/SKILL.md:3-5`（`:5` にフラグ 8 個）
- `config/.claude/skills/free-disk-space/SKILL.md:3-5`（`:5` にフラグ 5 個）
- `config/.claude/skills/clean-branch/SKILL.md:3-5`（`:5` にフラグ 6 個）
- `config/.claude/skills/cmux/SKILL.md:3`（"deterministic placement" 等ツール語彙のみ、境界なし）
- `config/.claude/skills/cmux-workspace/SKILL.md:3`（名詞の列挙のみ、caller-scope の境界なし）

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| description 抽出 | `awk '/^---$/{c++; next} c==1' <file>` | frontmatter が読める |
| 死参照確認 | `grep -rn 'to-issues' config/` | ヒット 0 件 |
| 全チェック | `bash scripts/check.sh` | exit 0 |

## Scope

**In scope**（各ファイルの frontmatter `description:` 値のみ）:

- 上記 10 スキルの SKILL.md
- `plans/README.md` — 自分の status 行

**Out of scope**:

- すべての本文（フラグの正は各スキルの Invocation variants として本文に残る）
- `name:` フィールド、`argument-hint` の新設（サポート未確認のため見送り — Maintenance notes）
- `disable-model-invocation` の導入 — 全 10 スキルとも会話文トリガーで発火させる運用のため
  model-invoked を維持する（検討済み。ユーザーが `/名前` でしか呼ばないスキルが将来できたら
  そのとき使う）
- chrome-devtools / troubleshooting / improve / gh-stack の description — 監査で
  「what + when が既に規範形」と判定済み。触らない

## Git workflow

- Branch: `docs/skill-description-surgery`（worktree: `$REPO_ROOT/.claude/worktrees/skill-description-surgery/`）
- コミット例: `docs(skills): description を context pointer 規範で書き直し`

## Steps

各 Step は「置き換え後の全文」。**この字面のまま**にする（executor の再創作をしない）。

### Step 1: takt（526 字 → 約 250 字）

分岐は 3 つ: 投入+実行 / 投入のみ / 既存 PR への積み増し。1 分岐 1 トリガーに圧縮し、
issue-direct への境界を足し、フラグ列挙と機構の詳説（内部 API 直呼び等 — 本文が語る）を削る:

```yaml
description: >-
  起票済みの GitHub issue を takt のタスクキューへ積み、cmux の別 pane で takt run を回して
  完了検知まで見守る。「#N を takt で回して」(投入+実行)、「タスクだけ積んでおいて」(投入のみ)、
  「PR に積み増して」(既存ブランチへ追加)で発動。
  自セッションで直接実装するのは issue-direct スキル。issue 未起票なら先に issue スキルで
  起票してから積む。PR のマージは対象外。--dry-run で投入直前の計画提示まで。
```

**Verify**: `awk '/^---$/{c++; next} c==1' config/.claude/skills/takt/SKILL.md | grep -c 'issue-direct'` → `1`

### Step 2: issue-direct（takt への境界を追加、詳説を圧縮）

```yaml
description: >-
  GitHub issue を自セッションで直接実装し、gh-stack で PR 化して全段 CI green まで走り切る。
  「issue #N を対応して」(単一 issue)、「親 issue #N をまとめて対応して」(子 issue を依存順の段として積む)で発動。
  takt のキューに任せて別 pane で回すのは takt スキル。レビューとマージは対象外(CI green + ready for review で完了)。
```

**Verify**: `awk '/^---$/{c++; next} c==1' config/.claude/skills/issue-direct/SKILL.md | grep -c 'takt スキル'` → `1`

### Step 3: issue（374 字 → 約 230 字）

トリガー 4 個 → 代表 2 個。takt 互換書式の説明は「そのまま order.md になる」の 1 句に圧縮:

```yaml
description: >-
  GitHub issue を会話コンテキストから新規作成する。1問ずつのインタビューで内容を合意し、
  リポジトリ調査に基づく検証可能な要件・完了契約を持つ本文を作る(takt の order.md として
  そのまま使える書式)。「issue にして」「バグ報告して」など新規起票の依頼で発動。
  --dry-run で作成の直前まで。閲覧・検索・クローズ・コメント追加には使わない。
```

**Verify**: `awk '/^---$/{c++; next} c==1' config/.claude/skills/issue/SKILL.md | grep -c '使わない'` → `1`、
同 `| grep -c -- '--no-interview'` → `0`

### Step 4: issue-organize（337 字 → 約 170 字、/to-issues 除去）

トリガー 7 個 → 分岐 3 つ（階層化 / 依存接続 / プレフィックス）を 1 トリガーずつ:

```yaml
description: |
  open な GitHub issue 群を sub-issue 階層 + addBlockedBy 依存チェーン + [category] プレフィックスに整理する。
  「issue 整理」「sub-issue 化」「プレフィックス付けて」で発動。
  既存 issue の再構造化専用 — 新規作成・分割起票は /issue(分割は --split)を使う。
```

**Verify**: `grep -rn 'to-issues' config/` → ヒット 0 件

### Step 5: goal-setter（387 字 → 約 250 字、Codex 中立化 + identity 文削除）

中間の "Defines Done, evidence, constraints, stop conditions, optional one-question-at-a-time
clarification, and only necessary worker use." は本文冒頭が同じことを語る identity の重複 — 削る:

```yaml
description: Draft, audit, or activate a compact /goal when the user asks for a persistent objective or wants the agent to work until a verifiable outcome is true. Not for ordinary implementation, Q&A, one-off edits, loose brainstorming, or subjective work with no rubric.
```

**Verify**: `awk '/^---$/{c++; next} c==1' config/.claude/skills/goal-setter/SKILL.md | grep -c 'Codex\|Defines Done'` → `0`

### Step 6: nix / free-disk-space / clean-branch（フラグ列挙を削る）

- `nix/SKILL.md:3-5` 全体を:

```yaml
description: >-
  macOS (nix-darwin) dotfiles の Nix 環境管理 — CLI ツール・GUI アプリ(cask)の追加削除、
  パッケージ検索、darwin-rebuild、flake update。「パッケージ追加」「ツール/アプリ入れたい」
  「brew install」「darwin-rebuild」の文脈で発動。--dry-run で編集も switch もせず計画だけ提示。
```

- `free-disk-space/SKILL.md:3-5` 全体を（「具体名が無くても発動」は routing に効くので残す）:

```yaml
description: >-
  macOS のディスク空き容量を回収する(ビルド成果物・パッケージキャッシュの掃除、nh での
  Nix 世代整理、外部ドライブへのメディア退避)。「ディスクがいっぱい」「空き容量を増やして」
  「No space left on device」など空き容量への不満があれば、対象の指定が無くても発動。
  --dry-run で計測レポートのみ。
```

- `clean-branch/SKILL.md:3-5` 全体を:

```yaml
description: >-
  マージ済み・不要になったローカル/リモートブランチと worktree 残骸を一括削除する。
  「ブランチ整理」「branch 掃除」で発動。--dry-run で分類一覧の提示のみ。
```

**Verify**: `awk '/^---$/{c++; next} c==1' config/.claude/skills/nix/SKILL.md | grep -c -- '--rollback'` → `0`、
`awk '/^---$/{c++; next} c==1' config/.claude/skills/clean-branch/SKILL.md | grep -c -- '--include-no-pr'` → `0`、
`awk '/^---$/{c++; next} c==1' config/.claude/skills/free-disk-space/SKILL.md | grep -c 'No space left'` → `1`

### Step 7: cmux / cmux-workspace（caller-scope 境界を書く）

- `cmux/SKILL.md:3`:

```yaml
description: Cross-workspace cmux control — windows, workspaces, panes/surfaces, moves, reorder, identify, flash. Use when rearranging or navigating cmux beyond the current workspace; for work scoped to the workspace that invoked the agent, use cmux-workspace.
```

- `cmux-workspace/SKILL.md:3`（takt が参照する Right-Side Helper Pane を発火語として載せる）:

```yaml
description: "Act inside the caller cmux workspace only — the workspace that invoked this agent. Use for helper panes/surfaces next to the caller terminal (Right-Side Helper Pane), non-interfering automation, and socket targeting; for cross-workspace control, use cmux."
```

**Verify**: `grep -c 'use cmux-workspace' config/.claude/skills/cmux/SKILL.md` → `1`、
`grep -c 'Right-Side Helper Pane' config/.claude/skills/cmux-workspace/SKILL.md` → 2 以上
（description + 本文見出し）

### Step 8: 合計サイズの確認と全チェック

```bash
for f in takt issue-direct issue issue-organize goal-setter nix free-disk-space clean-branch cmux cmux-workspace; do
  awk '/^---$/{c++; next} c==1' "config/.claude/skills/$f/SKILL.md" | sed 's/^ *description: *//; s/^ *//' | tr -d '\n' | wc -m
done | awk '{s+=$1} END {print s}'
bash scripts/check.sh
```

**Verify**: 対象 10 スキルの合計が **2,300 字以下**（現状 3,074 字 → 約 -25%。
非対象 4 スキル 1,130 字を含む全体では 4,204 → 約 3,400 字以下）。check.sh exit 0。

## Test plan

文書のみ。機械検証は各 Step の grep と Step 8 の合計字数。実効（「issue #N を対応して」で
issue-direct が選ばれる等）は次の数セッションの実運用で観察する（Maintenance notes）。

## Done criteria

- [ ] Step 1〜7 の Verify がすべて期待値どおり
- [ ] `grep -rn 'to-issues' config/` → 0 件
- [ ] 対象 10 スキルの description 合計 ≤ 2,300 字
- [ ] `bash scripts/check.sh` exit 0
- [ ] 各ファイルの diff が frontmatter に閉じている（`git diff` を目視）
- [ ] `plans/README.md` の status 行を更新済み

## STOP conditions

Stop and report back (do not improvise) if:

- いずれかのファイルの現 description が「Current state」の位置・内容と一致しない
- YAML スタイル（`>-` / `|` / `"`）を変えないと新文言が収まらない
- Step 8 の合計が 2,300 字を超えた（短縮案を添えて報告）

## Maintenance notes

- **新しいスキルの description はこの規範で書く**: 先頭に主語、what 1 文 + トリガー分岐
  （1 分岐 1 トリガー）+ 否定境界。フラグと機構の詳説は本文へ。規範例 = eli5
  （`~/.claude/plugins/cache/claude-community/eli5/1.0.0/skills/eli5/SKILL.md`、全 10 行）
- **観察ポイント**: takt ↔ issue-direct の選択が意図どおりになるか。誤選択が続くなら
  トリガー句をユーザーの実際の語彙に合わせて 1 個ずつ追加する（山盛りに戻さない）
- `argument-hint` は SKILL.md でのサポートを 1 スキルで実地確認できたら導入し、
  description の `--dry-run` 言及も移せる
- `troubleshooting` → `chrome-devtools-troubleshooting` 改名は引き続き deferred
  （やるなら `chrome-devtools/SKILL.md:18,84` の 2 参照も同時更新）
