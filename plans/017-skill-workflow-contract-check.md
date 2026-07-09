# Plan 017: skill ↔ takt workflow の契約整合チェックを check.sh に追加する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e0a2d44..HEAD -- scripts/ config/.takt/ config/.claude/skills/takt-issue config/.claude/skills/takt-review config/.claude/skills/takt`
> 015 実施済みなら review-lite が存在し takt-review の参照が変わっているはず —
> それは想定内 drift（このプランはその状態を照合対象にする）。

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW（read-only チェックの追加のみ。主なコストは false positive の調整）
- **Depends on**: 011（docs が正確になってから）、012（check.sh 基盤）、015（workflow 構成が確定してから — 未実施でも実行可だが、015 実施後に allowlist 再調整が要る）
- **Category**: direction / dx
- **Planned at**: commit `e0a2d44`, 2026-07-09

## Why this matters

takt 系スキルの散文が workflow 名・レポートファイル名・facet/schema 参照をハードコードしており、実体とのドリフトが**既に 2 回**修正されている（Plan 003 / commit `5da9385` で契約矛盾 3 件、Plan 011 で typo・虚偽 Gotcha・目録漏れ等 5 種）。takt-issue だけで 29 commit という churn を考えると再発は確実。ズレは実行時（takt run の起動失敗、または存在しないレポートを探して空回り）まで発覚しない。機械照合できる部分 — 「スキルが参照する workflow 名が実在するか」「ローカル workflow の内部参照（schema/policy）が解決するか」— を CI に入れて、PR 時点で止める。

## Current state

- `scripts/check.sh` — Plan 012 で作成済みの前提（nix-eval / shellcheck / link-manifest の 3 検査、位置引数でサブセット実行可）。
- `config/.takt/workflows/*.yaml` — ローカル workflow（`lite` / `fix` / `e2e-verify`、015 実施後は `review-lite` も）。各 YAML は `name:` フィールドを持つ（例: `lite.yaml` の 14 行目 `name: lite`）。step が `schema_ref:`（→ `config/.takt/schemas/<name>.json`）や `policy:`（→ `config/.takt/facets/policies/<name>.md`、無ければ builtin facet）を参照する。
- スキル側の workflow 名参照: `config/.claude/skills/takt-issue/SKILL.md`（判断表と本文に `default` / `lite` / `fix`）、`config/.claude/skills/takt-review/SKILL.md`（`review-takt-default`、015 後は `review-lite`）、`config/.claude/skills/takt/SKILL.md` と `references/workflows.md`（目録）。
- builtin workflow（`default`, `default-mini`, `review-takt-default`, `review-fix-takt-default` 等）の実体は `~/.bun/install/global/node_modules/takt/builtins/ja/workflows/` にあり、**CI 環境には存在しない**。
- CI: `.github/workflows/ci.yml` が check.sh を呼ぶ構成（Plan 012 後）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| ローカル workflow 名一覧 | `rg -No '^name: (.+)' -r '$1' config/.takt/workflows/*.yaml` | lite / fix / e2e-verify (+ review-lite) |
| 契約チェック実行 | `bash scripts/check.sh contracts` | exit 0 |
| インストール済み builtin 照合（ローカルのみ） | `ls ~/.bun/install/global/node_modules/takt/builtins/ja/workflows/` | allowlist と一致 |

## Scope

**In scope**:
- `scripts/check.sh`（`contracts` 検査の追加）
- `scripts/takt-builtin-workflows.txt`（新規 — builtin workflow 名の allowlist、takt バージョン注記付き）
- `.github/workflows/ci.yml`（contracts 検査が既存 job で走ることの確認。012 の構成なら check.sh 経由で自動的に走るはず — 変更不要が理想）

**Out of scope**:
- レポートファイル名や見出し（`## 総合判定` 等)の散文契約の照合 — 散文からの抽出は false positive が多すぎる。workflow 名と YAML 内部参照に限定するのが今回の線引き
- builtin workflow の**内容**の照合（CI に takt が無い。ローカル実行時のみの補助チェックに留める）
- スキル本文の修正 — チェックが赤を出したら、それは別の修正作業

## Git workflow

- Branch: `feat/skill-contract-check`（worktree 上で作業 — repo 規約）
- Commit message 例: `feat(ci): skill が参照する takt workflow 名の実在チェックを check.sh に追加`
- Push / PR 作成はユーザー指示があるまでしない

## Steps

### Step 1: workflow 名の抽出方法を確定する

散文全体から workflow 名を推測するのは false positive の温床なので、**抽出対象を構造化された箇所に限定**する:

1. `config/.claude/skills/takt-issue/SKILL.md` の workflow 判断表（Markdown テーブル）の workflow 列
2. 全 takt 系スキル（takt / takt-issue / takt-review）内の `takt run` コマンド例・`-w <name>` 指定（`rg -o 'takt run[^`]*'` と `-w ([a-z0-9-]+)` で抽出）
3. `` `<name>` workflow`` / ``workflow `<name>` `` という定型句のコード span

実際に rg で抽出を試し、期待の名前集合（`default` / `lite` / `fix` / `review-takt-default`、015 後は `review-lite`）が過不足なく取れるパターンを確定する。取れない名前が出たら抽出パターンを直すのではなく、**対象箇所の書式を定型に寄せる**方向も可（その場合はスキル md の該当行の書式変更のみ許可 — 意味は変えない）。

**Verify**: 抽出コマンド単体の出力が期待集合と一致

### Step 2: allowlist ファイルを作る

`scripts/takt-builtin-workflows.txt` — 1 行 1 workflow 名。冒頭コメントに「takt 0.49.0 の builtins/ja/workflows/ と照合（2026-07-XX）。takt 更新時に要再照合」。内容はローカルの installed takt から実測で生成:

```bash
ls ~/.bun/install/global/node_modules/takt/builtins/ja/workflows/ | sed 's/\.yaml$//'
```

**Verify**: ファイルが存在し、`review-takt-default` と `default` を含む

### Step 3: check.sh に contracts 検査を実装する

`scripts/check.sh` に 4 つ目の検査 `contracts` を追加:

1. **skill → workflow 実在**: Step 1 の抽出結果の各名前が、ローカル `config/.takt/workflows/*.yaml` の `name:` 集合 ∪ allowlist に含まれること。
2. **ローカル YAML 内部参照**: 各 `config/.takt/workflows/*.yaml` の `schema_ref: <s>` が `config/.takt/schemas/<s>.json` に解決すること。`policy: <p>` は `config/.takt/facets/policies/<p>.md` に解決するか、builtin facet の可能性があるため**ローカルに無ければ warning のみ**（exit code に影響させない）。
3. **YAML name/filename 一致**: `<f>.yaml` の `name:` が `<f>` と一致すること。
4. **（ローカル実行時のみ）allowlist 鮮度**: `~/.bun/install/global/node_modules/takt/builtins/ja/workflows/` が存在する環境では、allowlist との差分を warning 表示（CI では自動スキップ）。

**Verify**: `bash scripts/check.sh contracts` → exit 0。負テスト: takt-issue の判断表に一時的に架空 workflow `zzz-test` の行を足して exit 非 0 を確認し、**必ず戻す**（`git diff` で復元確認）

### Step 4: CI で走ることを確認する

Plan 012 の構成（引数なし check.sh = 全検査）なら ci.yml は変更不要のはず。shellcheck job が check.sh 自体も検査対象に含むこと（shebang 検出で自動的に入る）も確認。

**Verify**: `rg -n 'check.sh' .github/workflows/ci.yml` の呼び出しが contracts を含む実行形態になっている（引数なし or 明示）

## Test plan

- Step 3 の負テスト（架空 workflow 名 → fail → 復元 → pass）が本体。
- 3 種の warning 経路（builtin policy 参照、allowlist 鮮度）が exit 0 のまま stderr に出ることを 1 ケースずつ目視確認。

## Done criteria

- [ ] `bash scripts/check.sh contracts` が exit 0
- [ ] 負テストで exit 非 0、復元後 exit 0（`git diff` クリーン）
- [ ] `scripts/takt-builtin-workflows.txt` が存在し、takt バージョン注記がある
- [ ] YAML name/filename 一致チェックが全ローカル workflow で pass
- [ ] `git status` で変更が in-scope のみ
- [ ] `plans/README.md` の 017 行を更新

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 012 が未実施（`scripts/check.sh` が無い）— 依存順序が崩れている。
- Step 1 で、期待集合を過不足なく抽出できるパターンが 3 回の試行で確定しない — スキル側の書式が不定形すぎる。どの箇所がどう不定形かを列挙して報告（書式の統一自体が先行作業になる）。
- チェック実装後、現状のスキルに**未知の契約違反**が見つかった場合（011 の修正漏れ等）— チェックは正しい。違反の内容を報告し、修正はスコープ外とする。

## Maintenance notes

- takt をバージョンアップしたら `scripts/takt-builtin-workflows.txt` を再生成する（Step 2 のコマンド）。ローカル実行時の鮮度 warning が更新忘れを検知する。
- 新しいスキルが takt workflow を参照し始めたら、Step 1 の抽出対象ファイル一覧に追加する。
- 将来 takt 側に workflow の機械可読な export（`takt list --json` 等）が入ったら、散文抽出をそれに置き換えるのが本筋。fork（daiki-beppu/takt）への提案候補。
