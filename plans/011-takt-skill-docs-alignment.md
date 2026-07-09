# Plan 011: takt 系スキル docs を takt 0.49.0 の実体に整合させる

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e0a2d44..HEAD -- config/.claude/skills/takt-issue/SKILL.md config/.claude/skills/takt/SKILL.md config/.claude/skills/takt/references/ config/.claude/skills/to-issues/SKILL.md config/.claude/skills/setup-matt-pocock-skills/SKILL.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `e0a2d44`, 2026-07-09

## Why this matters

takt 系スキルは AFK 自動化（issue → 実装 → PR → レビュー）の運転手であり、エージェントは書かれた契約を文字どおり信じて動く。現在 5 種類のドリフトがある: (1) 失敗診断パスが存在しないディレクトリ `.takt/tasks/` を指す、(2) 「to-issues 製 issue は takt 非互換」という Gotcha が**現在は虚偽**で、不要な正規化往復を誘発する、(3) カスタム workflow `fix` が目録に存在せず、エージェントは選択できないし、将来の掃除で「未参照」として消されるリスクがある、(4) builtin workflow のパス記載が誤っている、(5) installed takt は 0.49.0 で peer-review が **5 並列**になったのに docs は 3 並列のままで、レビューレポート 2 件（`pure-review.md` / `coding-review.md`）が読み落とされる。過去に同種の契約矛盾 3 件を修正した実績があり（commit `5da9385`）、これは再発クラス。

## Current state

前提: この作業マシンには takt が `~/.bun/install/global/node_modules/takt/` にグローバルインストールされている（バージョン確認は Step 0）。builtin workflow の実体は `~/.bun/install/global/node_modules/takt/builtins/ja/workflows/*.yaml`。

修正対象の現状（全て planned-at 時点で実測済み）:

1. `config/.claude/skills/takt-issue/SKILL.md:284` — 失敗時の診断手順:
   `` `.takt/tasks/<run_slug>/reports/` のレポートを確認 ``
   同ファイルの 291 / 357 / 505 行は正しく `.takt/runs/...` を使っている。正は `runs`。

2. `config/.claude/skills/takt-issue/SKILL.md:473`（Gotchas 先頭）:
   > **to-issues / 手動作成の issue は takt 非互換**: `to-issues` スキルは `## What to build` / `## Acceptance criteria` テンプレートを使い、takt の plan.md が期待する `## 参照資料` / `## 要件` / `## スコープ外` を持たない。
   しかし `config/.claude/skills/to-issues/SKILL.md:89-142` の現行テンプレートは `## 参照資料` / `## 影響ファイル` / `## 要件` / `## スコープ外` / `## 実装方針（takt）` を出力し、**takt 互換**。63 行目付近の Step 0 前文にも同様に to-issues を非互換の producer として挙げる記述がある。

3. `config/.takt/workflows/fix.yaml` — 実在し活発に保守されている（commit `ae90b06`、2026-07-05「fix workflow の supervisor ステップも Codex 実行に統一」）のに:
   - `config/.claude/skills/takt/SKILL.md:330`: 「運用する workflow は builtin の `default` とカスタムの `lite` … の 2 種類」
   - `config/.claude/skills/takt/SKILL.md:378` と `config/.claude/skills/takt/references/workflows.md:5`: カスタム資産目録が `lite` / `e2e-verify` / `pre-review-checklist` / `review-verdict` のみで `fix` が無い
   - takt-issue の Step 1 workflow 判断表にも `fix` の行が無い

4. `config/.claude/skills/takt/SKILL.md:25`（層テーブル）: builtin workflow の実体を
   `~/.bun/install/global/node_modules/takt/builtins/ja/*.yaml` と記載。正しくは `.../builtins/ja/workflows/*.yaml`（`ja/` 直下にあるのは `config.yaml` / `workflow-categories.yaml` / スタイルガイド / `facets/` / `workflows/`）。

5. `config/.claude/skills/takt/references/workflows.md:74` 付近: 「subworkflow: default-peer-review — **3 並列**のレビューフェーズ」として arch / ai-antipattern / supervise の 3 つを列挙。installed takt 0.49.0 の `builtins/ja/workflows/default-peer-review.yaml` は **5 並列**（`pure-review` → `pure-review.md`、`coding-review` → `coding-review.md` が追加）。`takt-issue/SKILL.md:145` の「reviewers（arch / ai-antipattern / supervise）の並列レビュー」、357 / 505 行のレポート列挙（「など/等」付き）も同様に 3 並列前提。
   また `config/.claude/skills/takt/references/catalog.md` の builtin facet 数（persona 25 / policy 11 / knowledge 13 / output-contract 29 と記載）は 0.49.0 実体（29 / 12 / 14 / 43）とズレている。

6. `config/.claude/skills/setup-matt-pocock-skills/SKILL.md:39` — 存在しない `qa` スキルに言及（`config/.claude/skills/qa/` は無く、skills-lock.json にも無い）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| takt バージョン確認 | `jq -r .version ~/.bun/install/global/node_modules/takt/package.json` | `0.49.x` |
| builtin peer-review 確認 | `cat ~/.bun/install/global/node_modules/takt/builtins/ja/workflows/default-peer-review.yaml` | 並列 step 数と report 名が読める |
| facet 数の実測 | `for d in ~/.bun/install/global/node_modules/takt/builtins/ja/facets/*/; do echo "$d: $(ls "$d" \| wc -l)"; done` | 種別ごとの実数 |
| 残存チェック | `rg -n 'tasks/<run_slug>' config/.claude/skills/` | 0 件 |

## Scope

**In scope**:
- `config/.claude/skills/takt-issue/SKILL.md`
- `config/.claude/skills/takt/SKILL.md`
- `config/.claude/skills/takt/references/workflows.md`
- `config/.claude/skills/takt/references/catalog.md`
- `config/.claude/skills/setup-matt-pocock-skills/SKILL.md`（`qa` の 1 語のみ）

**Out of scope**:
- `config/.takt/workflows/*.yaml` の実体 — YAML は正、docs を YAML に合わせる（逆ではない）
- `config/.claude/skills/takt-review/SKILL.md` — 7 観点の契約は 0.49.0 と一致確認済み。review-lite への切替は Plan 015
- `config/.claude/skills/to-issues/SKILL.md` — 現行テンプレートが正
- skills-lock.json — 既知の deferred 事項

## Git workflow

- Branch: `docs/takt-skill-alignment`（worktree 上で作業 — repo 規約）
- Commit message 例: `docs(skills): takt 系スキルを takt 0.49.0 と fix workflow の実体に整合`
- Push / PR 作成はユーザー指示があるまでしない

## Steps

### Step 0: installed takt の実体を確認する

バージョンが `0.49.x` であること、`default-peer-review.yaml` の並列 step 名と output レポート名、facet 種別ごとの実数を取得してメモする。**docs に書く数字・名前は必ずこの実測値を使う**（このプランに書かれた数字も再確認する — takt が更新されていれば実測が優先）。

**Verify**: バージョンと step 一覧が取得できた

### Step 1: `.takt/tasks/` typo を修正

`takt-issue/SKILL.md:284` の `tasks` → `runs`。

**Verify**: `rg -n 'tasks/<run_slug>' config/.claude/skills/` → 0 件

### Step 2: to-issues 非互換という虚偽 Gotcha を書き換える

- 473 行の Gotcha を「**旧 to-issues / 手動作成の issue は takt 非互換のことがある**」という趣旨に書き換え、現行 to-issues テンプレートは takt 互換（`## 参照資料` / `## 要件` / `## スコープ外` を出力する）と明記。Step 0 正規化は「構造が欠けている場合の防御的 fallback」という位置付けに変える。
- 63 行目付近の producer 列挙から `to-issues` を外す（または「旧形式の」と限定する）。
- Step 0 の正規化手順そのものは**削除しない**（手動 issue への防御として残す）。

**Verify**: `rg -n 'to-issues' config/.claude/skills/takt-issue/SKILL.md` の各ヒットを読み、「現行 to-issues が非互換」と主張する文が残っていない

### Step 3: `fix` workflow を目録に載せる

`fix.yaml` は活発に保守されており（`git log --oneline -3 -- config/.takt/workflows/fix.yaml` で確認できる）、**削除ではなく文書化**する:

- `takt/SKILL.md:330`: 「2 種類」→ `fix` を加えた記述に（`fix` の一言説明は `fix.yaml` の中身を読んで書く — 単一パスの coder + supervisor 構成の軽量修正フロー）。
- `takt/SKILL.md:378` と `workflows.md:5` のカスタム資産目録に `fix` を追加。
- `workflows.md` に `fix` のセクションを追加（`lite` セクションの構成を exemplar として、step 構成を YAML から転記）。
- `takt-issue/SKILL.md` の Step 1 workflow 判断表に `fix` の行を追加（適用条件の文言は fix.yaml の設計意図から起こす。例: 「原因特定済みの小さなバグ修正で、plan/テスト先行が過剰な場合」）。

**Verify**: `rg -c 'fix' config/.claude/skills/takt/references/workflows.md` → 1 以上、判断表に fix 行がある

### Step 4: builtin パスと peer-review 5 並列を反映する

- `takt/SKILL.md:25`: パスを `~/.bun/install/global/node_modules/takt/builtins/ja/workflows/*.yaml` に修正。
- `workflows.md` の default-peer-review 節: Step 0 の実測に基づき並列数とレビュアー一覧・レポート名を全て列挙し直す（0.49.0 なら 5 並列 + `pure-review.md` / `coding-review.md` 追加）。
- `takt-issue/SKILL.md:145` / `:357` / `:505` のレビュアー・レポート列挙を同じ実測に合わせる。
- `catalog.md`: facet 種別ごとの数を実測値に更新し、不足している facet があれば表に追記。ファイル冒頭（タイトル直下）に `> takt 0.49.0 の builtin と照合済み（2026-07-09）` のような検証スタンプ行を追加。`workflows.md` にも同じスタンプを入れる。

**Verify**: `rg -n '3 並列' config/.claude/skills/takt/references/workflows.md` → 0 件、`rg -n 'pure-review.md' config/.claude/skills/` → workflows.md と takt-issue の列挙にヒット、`rg -n '照合済み' config/.claude/skills/takt/references/` → 2 件

### Step 5: setup-matt-pocock-skills の `qa` 言及を除去

`setup-matt-pocock-skills/SKILL.md:39` の skill 列挙から `qa` を外す（他は変えない）。

**Verify**: `rg -n '\`qa\`' config/.claude/skills/setup-matt-pocock-skills/SKILL.md` → 0 件

## Test plan

docs 変更のため自動テストは無い。検証は各 Step の rg チェック + Step 0 実測との突合。最終確認として、takt-issue の Step 1 判断表 → workflow 名 → `config/.takt/workflows/` or builtin の YAML、という参照連鎖を全 workflow 名（default / lite / fix / review-takt-default）について手で辿り、全て実在することを確認する。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `rg -n 'tasks/<run_slug>' config/.claude/skills/` → 0 件
- [ ] `rg -n '3 並列' config/.claude/skills/takt/references/workflows.md` → 0 件
- [ ] workflows.md / catalog.md に takt バージョンの検証スタンプがある
- [ ] takt-issue 判断表に fix 行、目録 2 箇所に fix がある
- [ ] `rg -n '\`qa\`' config/.claude/skills/setup-matt-pocock-skills/SKILL.md` → 0 件
- [ ] 判断表の全 workflow 名が実在 YAML（ローカル or builtin）に解決する
- [ ] `git status` で変更が in-scope の 5 ファイルのみ
- [ ] `plans/README.md` の 011 行を更新

## STOP conditions

Stop and report back (do not improvise) if:

- `jq -r .version ~/.bun/install/global/node_modules/takt/package.json` が 0.49 系でない（0.50+ なら実測し直せばよいが、大幅に構造が変わっていたら停止して差分を報告）。
- takt がグローバルインストールされていない（builtin と照合できないため作業不能）。
- `fix.yaml` が参照する facet/schema が解決しないと判明した場合 — 文書化の前に YAML 側の修正が要る話になるので、状況を報告。
- to-issues テンプレート（`to-issues/SKILL.md:89-142`）が「Current state」の記述と異なる形に変わっていた場合。

## Maintenance notes

- この種のドリフトは 2 回目（前回: Plan 003 / `5da9385`）。恒久対策の契約整合チェック CI は Plan 017。
- takt を major/minor バージョンアップしたら、workflows.md / catalog.md の検証スタンプを目印に再照合すること。
- Plan 015（review-lite）が workflow 構成を変えるため、015 実行後は takt-review まわりの記述も再度触られる。競合を避けたければ 011 → 015 の順で。
