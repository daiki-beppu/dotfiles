# takt workflow リファレンス

運用 workflow（builtin `default` + カスタム `lite`）の step 構成と subworkflow 内訳。SKILL.md 本文の [Workflow](../SKILL.md#workflow) 節から参照される。

dotfiles 環境は **eject なし**（builtin の `default` はそのまま使用）。カスタム資産は新規作成で持つ: workflow `lite`（builtin `default-mini` の代替）/ `e2e-verify`、policy `pre-review-checklist`、schema `review-verdict`。実体は dotfiles の `config/.takt/` 配下（git 管理）、`~/.takt/workflows/` 等への symlink 経由で全プロジェクトから解決される。

## 目次

- [default（テスト先行開発）](#default-テスト先行開発)
- [lite（軽量版・custom）](#lite-軽量版custom)
- [subworkflow: default-draft](#subworkflow-default-draft)
- [subworkflow: default-peer-review](#subworkflow-default-peer-review)
- [プレビューと検証](#プレビューと検証)

## default（テスト先行開発）

`max_steps: 30`、親 step 数 4。**`initial_step: plan`** から始まる。

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

`max_steps: 8`、step 数 3。builtin `default-mini` の代替として採用したカスタム workflow（実体は `config/.takt/workflows/lite.yaml`、02-yt/00-automation での運用実績を全体採用）。小〜中規模 issue のトークン消費削減が目的。

| 順 | step | 種別 | persona | provider | policy |
|---|---|---|---|---|---|
| 1 | `plan` | edit: false | planner | codex | — |
| 2 | `implement` | edit: true | coder | codex | `pre-review-checklist` |
| 3 | `review` | edit: false | architecture-reviewer | codex | `pre-review-checklist` |

### 遷移

- `plan` → `implement`（実装計画が確定）
- `implement` → `review`（実装・テスト・セルフ監査 8 項目の照合完了）
- `review` → `COMPLETE`（`structured.review.verdict == "approved"`） / `implement`（`needs_fix`） / `ABORT`（その他）

### 設計上のポイント

- **状態判定の LLM 呼び出しを削減**: plan / implement は rules が 1 個のため Phase 3（状態判定）が発生しない。review は `structured_output`（schema `review-verdict`）+ deterministic な `when:` 式で Phase 3 を完全にスキップする。分岐を増やすときは自然言語 condition ではなく `when:` 式を使うこと
- **自己監査 8 項目**: implement が policy `pre-review-checklist` の 8 項目（受入条件充足表 / 挙動差分↔テスト 1:1 / 実経路テスト / 兄弟入口の貫通 / ドキュメント突き合わせ / 失敗の可視化 / 既存契約の退行禁止 / スコープ検査）を根拠付きで自己監査し、review が同じチェックリストを独立に再照合する。post-hoc レビューの REJECT 再走を減らすための意図的なコスト（policy 約 5KB）
- **全 step `provider: codex` を明示**: グローバル config のハイブリッド方針（レビュー系 = Claude）はこの workflow には適用しない（02-yt と挙動・トークン特性を揃える）

bugfix / chore / docs / 小規模 refactor など、重量級の並列レビューが不要なタスク向け。セキュリティ・認証系やスキル横断の変更は `default` を使う。

## subworkflow: default-draft

実装フェーズ。`implement` step と `ai-antipattern-review` ↔ `ai-antipattern-fix` のループを内包する。0.40.0 のリネームで `ai_review` / `ai_fix` から `ai-antipattern-*` に統一されている。

主な step（builtin の `default-draft.yaml` 参照）:

- `implement`（coder, `impl_instruction` 引数で `implement-after-tests` などを差し替え）
- `ai-antipattern-review-1st`（ai-antipattern-reviewer）
- `ai-antipattern-fix`（coder）
- ループ判定の `loop_monitor`（supervisor judge、threshold 3）

`default` 側の `draft` step は `args.impl_instruction: implement-after-tests` を渡し、テスト先行後の本実装に切り替える（`lite` は subworkflow を使わず単一の `implement` step で完結する）。

## subworkflow: default-peer-review

3 並列のレビューフェーズ。

- `arch-review`（architecture-reviewer, `review-arch` instruction）→ `architect-review.md`
- `ai-antipattern-review-2nd`（ai-antipattern-reviewer, `ai-antipattern-review` instruction）→ `ai-antipattern-review.md`
- `supervise`（supervisor, `supervise` instruction）→ `supervisor-validation.md` / `summary.md`

集約ルールで全 reviewer が approved なら `COMPLETE`、いずれかが needs_fix なら `fix` step に降りて修正ループを回す。`reviewers` ↔ `fix` の loop_monitor が「非生産的」と判定すると `ABORT`。

### スコープ外発見の自動起票は無い

`default` / `lite` のいずれにも `report_spillover` 相当の step が **無い**。スコープ外発見は必ず人手で `issue` スキルに引き渡す（詳細は `takt-issue` SKILL.md の Step 7 を参照）。`lite` の review はスコープ外の改善提案を feedback 末尾に follow-up 候補として残すので、そこも起票の材料にする。

### `self_review` / `ci_verify` も無い

PR 前のコード簡素化チェックやローカル CI 実行は builtin にない。必要なら built-in の `/review` や `verify` skill を別途叩く運用にする。

## auto-improvement-loop（参考）

`max_steps: infinite` の自己ループ workflow。`route_context` → `plan_from_issue` or `plan_fresh_improvement` → `enqueue_task` → `wait_before_next_scan`（`delay_before_ms: 60000`）→ `route_context` に戻る。

起動: `takt run --workflow auto-improvement-loop`（または `takt add` で workflow 選択）。カレントディレクトリの git リポジトリをスコープに、open Issue / PR / コードベースから改善機会を AI が抽出して新規 task を enqueue する。

dotfiles リポジトリで回す意味は薄い（Issue / PR ベースの開発リポジトリ向け機能）。

## プレビューと検証

```bash
takt prompt default             # default の各 step の prompt をプレビュー
takt prompt lite                # lite のプレビュー
takt workflow doctor            # 全 workflow を検証
takt workflow doctor default    # 特定 workflow のみ
```

カスタム workflow を作るときは `takt workflow init` で雛形 → `.takt/workflows/` 配下に置き、`takt workflow doctor` で検証する。builtin を改造したい場合は `takt eject default` で `.takt/workflows/default.yaml` に降ろしてから編集する（builtin 直接編集は禁止）。
