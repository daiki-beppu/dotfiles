# takt workflow リファレンス

> takt 0.49.0 の builtin と照合済み（2026-07-09）

運用 workflow（用途別カスタム 7 本 + 補助）の step 構成。SKILL.md 本文の [Workflow](../SKILL.md#workflow) 節から参照される。

dotfiles 環境は **eject なし**・用途別カスタム構成。カスタム資産: workflow `feature`（builtin `default` の代替）/ `improve` / `diagnose-fix` / `docs` / `lite`（builtin `default-mini` の代替）/ `solid`（lite の一段上の堅牢版）/ `fix` / `review-lite` / `e2e-verify`、persona `diagnoser`、policy `pre-review-checklist`、schema `review-verdict` / `diagnosis-verdict`。実体は dotfiles の `config/.takt/` 配下（git 管理）、`~/.takt/workflows/` 等への symlink 経由で全プロジェクトから解決される。

用途と workflow の対応（判定表の正本は `takt-issue` SKILL.md）:

| 用途 | workflow |
|---|---|
| 新規 feature / セキュリティ・認証系 / interface・スキーマ変更 | `feature` |
| 既存機能の意図的な挙動変更・拡張（interface 変更なし） | `improve` |
| 原因不明のバグ | `diagnose-fix` |
| 原因特定済みの小さな修正 | `fix` |
| ドキュメント・skill のみの変更 | `docs` |
| refactor / chore / 迷ったら | `lite` |
| lite で完了できなかった task の再走 | `solid` |
| 技術調査（実装なし） | builtin `research` |

## 共通 preflight / blocked 契約

feature / improve / diagnose-fix / docs / lite / solid は、先頭の `preflight` で対象リポジトリの通常ファイル `.takt/quality-gates/preflight.sh` を検査する。ファイルがなければ実行せず approved として各 workflow の次 step へ進む。通常ファイルがある場合は `bash .takt/quality-gates/preflight.sh` を実行し、終了 0 は approved、終了非 0 は障害出力を feedback に記録した `blocked` として **ABORT** する。

同じ 6 workflow の review（diagnose-fix は supervise）は、daemon 不達・ネットワーク・権限などコード変更では解消できない環境障害で受け入れ基準を検証できない場合、`needs_fix` ではなく `blocked` を返して **ABORT** する。通常の実装不備・記述不備などコード変更で解消可能な失敗は `needs_fix` の既存帰路を使う。

## 目次

- [feature（新規開発・custom）](#feature-新規開発custom)
- [improve（機能改善・custom）](#improve-機能改善custom)
- [diagnose-fix（診断つき修正・custom）](#diagnose-fix-診断つき修正custom)
- [docs（ドキュメント改善・custom）](#docs-ドキュメント改善custom)
- [lite（軽量版・custom）](#lite-軽量版custom)
- [solid（lite 失敗再走・custom）](#solid-lite-失敗再走custom)
- [fix（軽量修正・custom）](#fix-軽量修正custom)
- [default（テスト先行開発・退役）](#default-テスト先行開発退役)
- [プレビューと検証](#プレビューと検証)

## feature（新規開発・custom）

`max_steps: 30`、step 数 7 + loop_monitor。builtin `default` の代替（実体は `config/.takt/workflows/feature.yaml`）。default の骨格（テスト先行）を保ちつつ、peer-review の 7 観点並列を統合レビュアー 1 体に置き換え、write_tests の前にテスト設計の独立レビューを追加した厳格版。

| 順 | step | 種別 | persona | provider | 出力 |
|---|---|---|---|---|---|
| 1 | `preflight` | edit: false | coder | codex | structured_output |
| 2 | `plan` | edit: false | planner | codex | `plan.md` |
| 3 | `test_design` | edit: false | planner | codex | `test-design.md` |
| 4 | `test_design_review` | edit: false | coding-reviewer | codex | structured_output |
| 5 | `write_tests` | edit: true | coder | codex | （red 実証を応答に貼付） |
| 6 | `implement` | edit: true | coder（promotion: Luna→Terra→Sol） | codex | セルフ監査 8 項目 |
| 7 | `review` | edit: false | coding-reviewer | codex | structured_output |
| - | `scope_review`（空転時のみ） | edit: false | planner | codex | `scope-review.md` |

### 遷移

- `preflight` → `plan`（approved または preflight.sh 不在） / **ABORT**（blocked）
- `plan` → `test_design` → `test_design_review` → `write_tests`（approved） / `test_design`（needs_fix）
- `write_tests` → `implement`（全ケース red を実行出力で確認）
- `implement` → `review` → `COMPLETE`（approved） / `implement`（needs_fix） / **ABORT**（blocked・その他）
- loop_monitor（`implement` ⇄ `review`、threshold 3）が「非生産的」と判定 → `scope_review` → **ABORT**（正常系。分割提案を `scope-review.md` に残す。分割起票は Claude Code 層が `to-issues` / `issue` skill で行う）

### 設計上のポイント

- review は統合 1 体（policy: review / qa / coding / ai-antipattern + アーキ・**セキュリティ**・テスト品質のインラインチェックリスト）。セキュリティ・認証系タスクの受け皿なので security 観点を明示
- test_design_review が「受入条件のテスト捕捉漏れ」「実装に都合のいいテスト」をテスト作成前に止める
- レビュー系分岐は structured_output + `when:` で Phase 3 をスキップ（lite と同じ設計）

## improve（機能改善・custom）

`max_steps: 12`、step 数 4。preflight と lite の骨格に**回帰保護**を注入した機能改善（既存機能の挙動変更・拡張）用（実体は `config/.takt/workflows/improve.yaml`）。

step 構成・provider は lite と同一（preflight → plan → implement → review、全 codex、promotion あり）。preflight は上記共通仕様に従う。差分は instruction:

- `plan` が**挙動変更影響表**（変わる挙動 before/after / 変わってはならない隣接挙動 / 影響を受ける呼び出し元）を義務化。interface・スキーマ変更が必要と判明したら停止（feature の領分）
- `implement` が**両側の実証**を義務化: 変わる側のテスト green + 隣接挙動の既存テスト green（既存テストが無い隣接挙動は変更前に現状固定テストを書く）
- `review` が影響表を独立照合し、**影響表に載っていない挙動変更を含む diff は needs_fix**（スコープ逸脱 or 無自覚な回帰）
- `preflight` → `plan`（approved または preflight.sh 不在） / **ABORT**（blocked）、`review` → `COMPLETE`（approved） / `implement`（needs_fix） / **ABORT**（blocked・その他）

## diagnose-fix（診断つき修正・custom）

`max_steps: 15`、step 数 4。原因不明バグ用（実体は `config/.takt/workflows/diagnose-fix.yaml`）。診断で「原因確定 + 修正小規模」の場合のみ自動 fix に進む条件付き自動化。

| 順 | step | 種別 | persona | provider / model | 出力 |
|---|---|---|---|---|---|
| 1 | `preflight` | edit: false | coder | codex | structured_output |
| 2 | `diagnose` | edit: true | **diagnoser** | codex / Sol | structured_output（schema `diagnosis-verdict`） |
| 3 | `fix`（条件付き） | edit: true | coder（promotion: Luna→Terra→Sol） | codex | red→green 実証を応答に貼付 |
| 4 | `supervise` | edit: false | supervisor | codex / gpt-5 | structured_output |

### 遷移

- `preflight` → `diagnose`（approved または preflight.sh 不在） / **ABORT**（blocked）
- `diagnose` → `fix`（`verdict == "root_cause_confirmed" && fix_scope == "small"`） / **ABORT**（それ以外。正常系 — 診断レポートは structured_output の `report_md`。起票・振り替えは Claude Code 層）
- `fix` → `supervise` → `COMPLETE`（approved） / `fix`（needs_fix） / **ABORT**（blocked・その他）

### 設計上のポイント

- **ゲートは実コマンドの red/green**（テストのみの再現は不可）。diagnose は実コマンドで red を確認し、fix は修正前 red / 修正後 green を実証、supervise は同じ repro_command を**自分で再実行**して検証する
- `fix_scope: small` は 4 条件（≤3 ファイル / interface 変更なし / 受入 = repro green / 修正方針 1 つ）すべてに根拠を書けた場合のみ。迷ったら large に倒す非対称設計
- diagnose は edit: true（一時計測コード・throwaway スクリプト可。プロダクションコードの恒久変更は禁止、fix step が残骸を除去）

## docs（ドキュメント改善・custom）

`max_steps: 9`、step 数 3。ドキュメント・skill 改善用の最軽量 workflow（実体は `config/.takt/workflows/docs.yaml`）。plan なし、pre-review-checklist なし。

| 順 | step | 種別 | persona | provider |
|---|---|---|---|---|
| 1 | `preflight` | edit: false | coder | codex |
| 2 | `implement` | edit: true | coder | codex |
| 3 | `review` | edit: false | coding-reviewer | codex |

- `preflight` → `implement`（approved または preflight.sh 不在） / **ABORT**（blocked）
- `implement` → `review` → `COMPLETE`（approved） / `implement`（needs_fix） / **ABORT**（blocked・その他）
- review は**整合の実証が必須**: パス・シンボル・読み取り系コマンドは実際に実行して確認する。副作用のあるコマンド例は実行せず `--help` / dry-run / ソース突合で確認する（対象の多くが SKILL.md 系 = LLM が従う実行仕様のため、記述と実挙動の乖離は即バグ）

## default（テスト先行開発・退役）

**運用から外した**（カスタム `feature` が代替。以下は builtin の参考情報として残す）。`max_steps: 30`、親 step 数 4。**`initial_step: plan`** から始まる。

| 順 | step | 種別 | persona / call | 出力 report |
|---|---|---|---|---|
| 1 | `plan` | edit: false | planner | `plan.md` |
| 2 | `write_tests` | edit: true | coder | `test-report.md` |
| 3 | `draft` | workflow_call | `default-draft`（`impl_instruction: implement-after-tests`） | （subworkflow 内で出力） |
| 4 | `peer-review` | workflow_call | `default-peer-review` | （subworkflow 内で出力） |

### 遷移

- `plan` → `write_tests`（要件明確） / `COMPLETE`（質問のみ） / `ABORT`（要件不足）
- `write_tests` → `draft`（テスト作成完了 or テスト対象未実装でスキップ） / `ABORT` / `write_tests`（user input 要）
- `draft` → `peer-review`（COMPLETE） / `plan`（need_replan） / `ABORT`
- `peer-review` → `COMPLETE`（COMPLETE） / `plan`（need_replan） / `ABORT`

PR 作成は workflow step では行わず、workflow 完了後に takt CLI 本体の `postExecutionFlow` が自動で `autoCommitAndPush` → `pushBranch` → `gh pr create`（既存 PR があれば `gh pr comment`）を実行する。

## lite（軽量版・custom）

`max_steps: 12`、step 数 4。builtin `default-mini` の代替として採用したカスタム workflow（実体は `config/.takt/workflows/lite.yaml`、02-yt/00-automation での運用実績を全体採用）。小〜中規模 issue のトークン消費削減が目的。

| 順 | step | 種別 | persona | provider | policy |
|---|---|---|---|---|---|
| 1 | `preflight` | edit: false | coder | codex | — |
| 2 | `plan` | edit: false | planner | codex | — |
| 3 | `implement` | edit: true | coder | codex | `pre-review-checklist` |
| 4 | `review` | edit: false | architecture-reviewer | codex | `pre-review-checklist` |

### 遷移

- `preflight` → `plan`（approved または preflight.sh 不在） / **ABORT**（blocked）
- `plan` → `implement`（実装計画が確定）
- `implement` → `review`（実装・テスト・セルフ監査 8 項目の照合完了）
- `review` → `COMPLETE`（`structured.review.verdict == "approved"`） / `implement`（`needs_fix`） / **ABORT**（`blocked`・その他）
- **loop_monitor**（cycle: `implement` ⇄ `review`、threshold: 3）: 3 周目に supervisor judge が review feedback の推移から収束性を判定し、健全（指摘減少・新規指摘の解消）なら `implement` へ戻し、非生産的（同一指摘の繰り返し）なら **ABORT**。judge の LLM 呼び出しは threshold 到達時のみで、通常経路のトークン特性は不変（builtin default-peer-review / solid と同型）

### 設計上のポイント

- **状態判定の LLM 呼び出しを削減**: plan / implement は rules が 1 個のため Phase 3（状態判定）が発生しない。review は `structured_output`（schema `review-verdict`）+ deterministic な `when:` 式で Phase 3 を完全にスキップする。分岐を増やすときは自然言語 condition ではなく `when:` 式を使うこと
- **自己監査 8 項目**: implement が policy `pre-review-checklist` の 8 項目（受入条件充足表 / 挙動差分↔テスト 1:1 / 実経路テスト / 兄弟入口の貫通 / ドキュメント突き合わせ / 失敗の可視化 / 既存契約の退行禁止 / スコープ検査）を根拠付きで自己監査し、review が同じチェックリストを独立に再照合する。post-hoc レビューの REJECT 再走を減らすための意図的なコスト（policy 約 5KB）
- **全 step `provider: codex` を明示**: グローバル config のハイブリッド方針（レビュー系 = Claude）はこの workflow には適用しない（02-yt と挙動・トークン特性を揃える）

refactor / chore など、重量級のレビューが不要なタスク向け（docs のみの変更は `docs`、既存機能の挙動変更は `improve` が専用の受け皿）。セキュリティ・認証系や interface 変更は `feature` を使う。

## solid（lite 失敗再走・custom）

`max_steps: 18`、step 数 5 + loop_monitor。lite の一段上の堅牢版（実体は `config/.takt/workflows/solid.yaml`）。主用途は **lite で完了できなかった task の再走**（needs_fix 空転 / max_steps 超過 / ABORT）で、まっさらな worktree でゼロから再実装する（lite の部分実装は引き継がない）。最初から堅牢に回すための直接投入も可。

| 順 | step | 種別 | persona | provider / model | 出力 |
|---|---|---|---|---|---|
| 1 | `preflight` | edit: false | coder | codex | structured_output |
| 2 | `plan` | edit: false | planner | codex | `plan.md` |
| 3 | `implement` | edit: true | coder | codex / **gpt-5.6-sol（最初から）** | セルフ監査 8 項目 |
| 4 | `review` | edit: false | architecture-reviewer | codex | structured_output |
| - | `scope_review`（条件付き） | edit: false | planner | codex | `scope-review.md` |

### 遷移

- `preflight` → `plan`（approved または preflight.sh 不在） / **ABORT**（blocked）
- `plan` → `implement`（1 回の workflow 実行で完遂可能な規模） / `scope_review`（スコープ過大）
- `implement` → `review` → `COMPLETE`（approved） / `implement`（needs_fix） / **ABORT**（blocked・その他）
- loop_monitor（`implement` ⇄ `review`、threshold 3）が「非生産的」と判定 → `scope_review`
- `scope_review` → **ABORT**（正常系。分割提案を `scope-review.md` に残す。分割起票は Claude Code 層）

### 設計上のポイント

- **失敗原因分析が plan の第一手順**: 前回 lite 失敗の情報（review feedback / 中断理由 / 空転した論点）は **元 issue へのコメント**として渡す。`takt add '#<N>'` の issue 展開（`formatIssueAsTask`）は本文に加えて `### Comments` も task 記述に含めるため、plan step がコメントの失敗サマリを読める。plan は失敗原因への対策を計画に明示し、review が「同じ欠陥の再発は needs_fix」で照合する
- **スコープゲート**: plan が「要件 8 件以上 / 影響ファイル 10 超 / 独立機能領域の混在 / 失敗原因がスコープ過大」のいずれかに該当すると判定したら実装に進まず `scope_review` へ。`scope_review` は plan の早期ゲートと loop_monitor の空転脱出の共通着地点
- **plan は自然言語 condition が 2 つ**あり Phase 3（状態判定）の LLM 呼び出しが 1 回発生する（スコープゲートに必要な意図的コスト）。implement は rules 1 個、review は structured_output（schema `review-verdict`）+ `when:` 式で lite と同じ設計
- implement は promotion を待たず最初から `gpt-5.6-sol`（lite は 3 巡目でようやく昇格）
- 振り替えの運用手順（失敗情報の回収 → issue コメント → 前回 task 破棄 → 再 add）は `takt-issue` SKILL.md の Step 4 を参照

## fix（軽量修正・custom）

`max_steps: 15`、step 数 3（最大）。builtin に対応物が無い最軽量 workflow（実体は `config/.takt/workflows/fix.yaml`）。原因特定済みの小さなバグ修正・軽微な指摘対応を 1 回の coder 実装 + supervisor 検証で終わらせる。plan・テスト先行・並列レビューは一切行わない。

| 順 | step | 種別 | persona | provider / model | policy |
|---|---|---|---|---|---|
| 1 | `fix` | edit: true | coder | codex / gpt-5 | `coding`, `testing` |
| 2 | `supervise` | edit: false | supervisor | codex / gpt-5 | `review` |
| 3 | `fix_supervisor`（条件付き） | edit: true | coder | codex / gpt-5 | `coding`, `testing` |

### 遷移

- `fix` → `supervise`（修正完了） / `ABORT`（判断できない・情報不足）
- `supervise` → `COMPLETE`（すべて問題なし） / `fix_supervisor`（要求未達成・テスト失敗・ビルドエラー）
- `fix_supervisor` → `supervise`（監督者の指摘に対する修正が完了した、または修正を進行できない場合も `supervise` に戻り再判定させる）

### 設計上のポイント

- 全 step `provider: codex` / `model: gpt-5` を明示。plan / write_tests / 並列レビューを持たず、`default` / `lite` に比べ最小のトークン消費で回る
- `supervise` の output_contracts は `supervisor-validation.md` / `summary.md`（`fix` / `fix_supervisor` step 自体は report を出力しない）
- 原因特定済みの小さなバグ修正で、plan/テスト先行/並列レビューが過剰なケース向け。要件が曖昧・設計判断が必要な場合は `lite` や `default` を使う

## subworkflow: default-draft

実装フェーズ。`implement` step と `ai-antipattern-review` ↔ `ai-antipattern-fix` のループを内包する。0.40.0 のリネームで `ai_review` / `ai_fix` から `ai-antipattern-*` に統一されている。

主な step（builtin の `default-draft.yaml` 参照）:

- `implement`（coder, `impl_instruction` 引数で `implement-after-tests` などを差し替え）
- `ai-antipattern-review-1st`（ai-antipattern-reviewer）
- `ai-antipattern-fix`（coder）
- ループ判定の `loop_monitor`（supervisor judge、threshold 3）

`default` 側の `draft` step は `args.impl_instruction: implement-after-tests` を渡し、テスト先行後の本実装に切り替える（`lite` は subworkflow を使わず単一の `implement` step で完結する）。

## subworkflow: default-peer-review

**5 並列**のレビューフェーズ（0.49.0 で `pure-review` / `coding-review` が追加され、旧構成の並列数から拡張された）。

- `arch-review`（architecture-reviewer, `review-arch` instruction）→ `architect-review.md`
- `ai-antipattern-review-2nd`（ai-antipattern-reviewer, `ai-antipattern-review` instruction）→ `ai-antipattern-review.md`
- `pure-review`（pure-reviewer, `review-pure` instruction）→ `pure-review.md`
- `coding-review`（coding-reviewer, `review-coding` instruction）→ `coding-review.md`
- `supervise`（supervisor, `supervise` instruction）→ `supervisor-validation.md` / `summary.md`

集約ルールで全 reviewer が approved（該当なしは可）なら `COMPLETE`、いずれかが needs_fix なら `fix` step に降りて修正ループを回す。`reviewers` ↔ `fix` の loop_monitor が「非生産的」と判定すると `ABORT`。

### スコープ外発見の自動起票は無い

どの workflow にも `report_spillover` 相当の step が **無い**（起票の品質ゲートを `issue` スキルに一元化する意図的な設計）。カスタム workflow の review / supervise / diagnose step はスコープ外発見を structured_output の **`followups`**（title / description / evidence）に構造化して残すので、run 完了後に Claude Code 層が `issue` スキルに引き渡して起票する（詳細は `takt-issue` SKILL.md の Step 7 を参照）。

### `self_review` / `ci_verify` も無い

PR 前のコード簡素化チェックやローカル CI 実行は builtin にない。必要なら built-in の `/review` や `verify` skill を別途叩く運用にする。

## auto-improvement-loop（参考）

`max_steps: infinite` の自己ループ workflow。`route_context` → `plan_from_issue` or `plan_fresh_improvement` → `enqueue_task` → `wait_before_next_scan`（`delay_before_ms: 60000`）→ `route_context` に戻る。

起動: `takt run --workflow auto-improvement-loop`（または `takt add` で workflow 選択）。カレントディレクトリの git リポジトリをスコープに、open Issue / PR / コードベースから改善機会を AI が抽出して新規 task を enqueue する。

dotfiles リポジトリで回す意味は薄い（Issue / PR ベースの開発リポジトリ向け機能）。

## プレビューと検証

```bash
takt prompt feature             # feature の各 step の prompt をプレビュー
takt prompt lite                # lite のプレビュー
takt workflow doctor            # 全 workflow を検証
takt workflow doctor feature    # 特定 workflow のみ
```

なお、自然言語 condition を持つ step があるとプレビュー（`takt prompt`）の Phase 3 に
`[ERROR] reportContent is required for report-based judgment` が 1 行出るが、これは
プレビュー時にレポートが未生成なことによる既知の表示で、実行時の問題ではない
（実運用中の `lite` / `fix` でも同様に出る）。

カスタム workflow を作るときは `takt workflow init` で雛形 → `.takt/workflows/` 配下に置き、`takt workflow doctor` で検証する。builtin を改造したい場合は `takt eject default` で `.takt/workflows/default.yaml` に降ろしてから編集する（builtin 直接編集は禁止）。
