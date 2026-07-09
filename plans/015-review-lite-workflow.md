# Plan 015: review-lite workflow を設計・導入しレビュー run のトークンを削減する（design/spike）

> **Executor instructions**: これは design/spike プラン — 「全部作って終わり」ではなく、
> 設計判断を確定させ、最小実装で効果測定の土台まで作るのがゴール。Follow the steps,
> run every verification, and honor STOP conditions. When done, update the status
> row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e0a2d44..HEAD -- config/.takt/workflows/ config/.claude/skills/takt-review/ docs/takt-usage-baseline.md`
> 差分があれば「Current state」と突合し、不一致は STOP。

## Status

- **Priority**: P2
- **Effort**: M（coarse — direction 由来のため見積り粗め）
- **Risk**: MED（レビュー観点統合による検出漏れの可能性。7 観点版を残すことで緩和）
- **Depends on**: 011（takt 系 docs が正確になってから触るのが安全。未実施でも実行可だが、011 が直す記述と衝突しない範囲に注意）
- **Category**: direction
- **Planned at**: commit `e0a2d44`, 2026-07-09

## Why this matters

`docs/takt-usage-baseline.md` の実測で、**レビュー系 step が全トークン消費の約 84%** を占める。同 docs の「削減施策の候補」1 番はこう明記している:

> **レビュー観点統合(review-lite 自作)** — gather → 統合レビュアー 1〜2 体 → supervise のカスタム workflow を `config/.takt/workflows/` に作成し、takt-review skill をこれに切替。観点数と同時に phase2_report 回数(= report ファイル数)も減るため、1 run 1,600万 → 400〜500万の見込み(**約 -70%**)。7 観点版は明示依頼時のみ。

つまり設計・実装先・見込み効果まで自分の docs が指定済みで、**意思決定だけが止まっている**。同型の施策（builtin `default-mini` → カスタム `lite`）は既に成功しており（commit `147856c`）、パターンは実証済み。計測ツール `config/.local/bin/takt-usage-report` も before/after 比較用に整備済み。

## Current state

- `config/.takt/workflows/` — `lite.yaml` / `fix.yaml` / `e2e-verify.yaml` の 3 つ。`review-lite.yaml` は無い。
- `config/.takt/workflows/lite.yaml` — カスタム workflow の exemplar。重要な設計要素（冒頭コメントより）:
  - rules が 1 個の step は状態判定（Phase 3）の LLM 呼び出しが発生しない
  - review step は `structured_output`（`schema_ref: review-verdict`）+ deterministic `when:` で Phase 3 を完全スキップ
  - 分岐は自然言語 condition ではなく `when:` 式（`structured.review.verdict == "approved"` 等）
  - 全 step `provider: codex` 明示
- `config/.takt/schemas/review-verdict.json` — verdict/feedback の structured output スキーマ（再利用候補）。
- `config/.claude/skills/takt-review/SKILL.md` — 現在 `review-takt-default`（builtin、read-only 7 観点）をハードコード。契約: CI pass 確認 → レビュー → `review-summary.md` の `## 総合判定: APPROVE / REJECT` を読む → REJECT なら worktree で fix 1 回 → 再レビュー → 2 回目 REJECT は人手エスカレーション。
- builtin `review-takt-default` の実体: `~/.bun/install/global/node_modules/takt/builtins/ja/workflows/review-takt-default.yaml`（takt 0.49.0）。7 レビュアーの report（`{architecture,security,qa,testing,ai-antipattern,pure,coding}-review.md`）+ `review-summary.md` を出力。
- `docs/takt-usage-baseline.md` — 計測記録と施策一覧（60〜95 行目付近）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| builtin レビュー workflow 読解 | `cat ~/.bun/install/global/node_modules/takt/builtins/ja/workflows/review-takt-default.yaml` | 7 観点の構成が読める |
| workflow 一覧確認 | `ls ~/.takt/workflows/` | symlink 経由で review-lite.yaml が見える（作成後） |
| 使用量計測 | `takt-usage-report --days 7` | run ごとのトークン集計 |

## Scope

**In scope**:
- `config/.takt/workflows/review-lite.yaml`（新規）
- `config/.claude/skills/takt-review/SKILL.md`（デフォルト workflow の切替 + 7 観点版の明示依頼経路の追記）
- `docs/takt-usage-baseline.md`（施策 1 を「実施済み（Plan 015、日付）」に更新し、効果測定の予定を追記）

**Out of scope**:
- builtin workflow の eject や改変
- 施策 2〜6（頻度ルール化、draft 内 1st レビュー除去、aborted 対策、phase2_report 構造、persona/model 振り分け）— 別の意思決定
- `takt-issue` スキル — takt-issue は CI green で完了する設計で、レビューは単体起動。takt-issue 側の記述変更は不要のはず（必要になったら STOP）
- 実 PR での本番レビュー実行（トークンを消費する）— 効果測定はユーザーの通常運用に委ねる

## Git workflow

- Branch: `feat/review-lite-workflow`（worktree 上で作業 — repo 規約）
- Commit message 例: `feat(takt): レビュー観点統合の review-lite workflow を追加し takt-review を切替`
- Push / PR 作成はユーザー指示があるまでしない

## Steps

### Step 1: builtin review-takt-default を読解し、統合設計を確定する

builtin YAML を読み、7 観点（architecture / security / qa / testing / ai-antipattern / pure / coding）の persona・instruction・output_contract を把握する。その上で統合案を決める。**推奨初期設計**（spike なので変更可、ただし逸脱理由を記録）:

- **統合レビュアー 1 体**: 7 観点のうち重複の大きい pure / coding / ai-antipattern / qa を 1 つの「コード品質」レビュアーに統合し、architecture / security / testing の要点を同じ instruction 内のチェック観点リストとして吸収する。
- **supervise 1 体**: レビュー結果の妥当性検証と verdict 集約。
- report ファイルは出力せず、`lite.yaml` の review step と同じく `structured_output`（`schema_ref: review-verdict`）+ `when:` 分岐にする — baseline docs が指摘する「phase2_report 回数の削減」はここで効く。verdict に加えて feedback に指摘一覧を持たせる。
- 全 step `provider: codex`、rules は 1 個 or `when:` のみ（Phase 3 スキップ）— lite.yaml のトークン設計メモを踏襲。

**Verify**: 設計メモ（統合の対応表: 7 観点 → 新レビュアーのどこへ）を review-lite.yaml の冒頭コメントに書けている

### Step 2: review-lite.yaml を実装する

`config/.takt/workflows/review-lite.yaml` を lite.yaml の構文スタイル（コメント含む）で作成。read-only レビュー（全 step `edit: false`）であること。max_steps は小さく（例: 4）。

**Verify**: `ls ~/.takt/workflows/review-lite.yaml` が解決する（symlink 経由）。takt に workflow の構文検証コマンドがあれば実行（`takt --help` で確認。無ければ YAML パース `python3 -c "import yaml,sys; yaml.safe_load(open('config/.takt/workflows/review-lite.yaml'))"` で代替）

### Step 3: takt-review スキルを切り替える

`takt-review/SKILL.md` を更新:

- デフォルトの workflow を `review-lite` に変更（frontmatter の description 含む）。
- レビュー結果の読み方を変更: report ファイル群 + `review-summary.md` ではなく、structured_output の verdict / feedback（run ログ）を読む手順に（lite.yaml の運用と同じ形。takt-issue/SKILL.md:505 に lite の structured_output の読み方の記述があるので参照）。
- **7 観点版の経路を残す**: 「7観点で」「フルレビュー」等の明示依頼時は従来どおり `review-takt-default` を使う節を追加。既存の 7 観点の記述は「フル版」節として温存。
- fix 1 回ルール・CI 監視・エスカレーションの契約は変えない。

**Verify**: `rg -n 'review-lite' config/.claude/skills/takt-review/SKILL.md` → デフォルト経路にヒット。`rg -n 'review-takt-default' 同` → フル版節にのみ残存

### Step 4: baseline docs に実施記録と測定プロトコルを書く

`docs/takt-usage-baseline.md` の施策 1 に「実施済み（Plan 015、2026-07-XX）」を付記し、効果測定の手順を 2〜3 行で追記: 次の 5〜10 回のレビュー run 後に `takt-usage-report --days 7` を実行し、レビュー系 run の平均トークンを baseline（1 run 約 1,600 万）と比較。目標は 500 万以下。未達なら統合構成を見直す。

**Verify**: `rg -n '実施済み' docs/takt-usage-baseline.md` → 施策 1 に付記されている

## Test plan

- YAML の構文/参照整合（Step 2 の Verify）。
- 可能なら**小さな試運転**: このリポジトリの任意のマージ済み PR に対して `review-lite` を 1 回だけ実行し、structured_output が verdict を返して COMPLETE/分岐が機能することを確認する（トークンを消費するため、実行前にユーザーへ 1 度確認するのが望ましい。確認できない環境なら試運転はスキップし、その旨を報告に明記）。
- 本番の効果測定は Step 4 のプロトコルどおりユーザー運用に委ねる。

## Done criteria

- [ ] `config/.takt/workflows/review-lite.yaml` が存在し、YAML としてパースでき、冒頭コメントに 7 観点 → 統合先の対応表がある
- [ ] 全 step が `edit: false` である（`rg -c 'edit: true' config/.takt/workflows/review-lite.yaml` → 0）
- [ ] takt-review スキルのデフォルトが review-lite、フル版経路が明示依頼で残っている
- [ ] baseline docs に実施記録と測定プロトコルがある
- [ ] `git status` で変更が in-scope の 3 ファイルのみ
- [ ] `plans/README.md` の 015 行を更新（試運転の実施有無も記録）

## STOP conditions

Stop and report back (do not improvise) if:

- takt がインストールされていない、またはバージョンが 0.49 系から大きく変わり builtin の構成が読解と食い違う。
- `review-verdict` スキーマが統合レビューの出力（複数観点の指摘一覧）を表現できず、スキーマ変更が必要になった場合 — スキーマは lite.yaml と共有しており、変更は lite の挙動に波及する。新スキーマを別名で作るか判断を仰ぐ。
- takt-issue スキル側の記述変更が必要だと判明した場合（レビュー経路の想定が絡んでいた等）。
- 試運転で workflow が ABORT ループする場合（2 回試して改善しなければ停止）。

## Maintenance notes

- 効果測定（Step 4 のプロトコル）の結果次第で: 目標未達なら統合構成の見直し、達成なら baseline docs の施策 2 以降が次の候補。
- Plan 017（契約整合チェック）は review-lite 導入後の workflow 名・契約を照合対象に含める — 015 を先に終わらせると 017 の allowlist が安定する。
- レビュー検出力の低下が疑われる事象（本番で見逃しが出た等）が起きたら、7 観点版へ切り戻すのは SKILL.md のデフォルト記述を戻すだけ。
