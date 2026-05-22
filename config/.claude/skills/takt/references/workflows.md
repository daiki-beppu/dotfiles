# takt builtin workflow リファレンス

builtin workflow の step 構成と subworkflow 内訳。SKILL.md 本文の [Workflow](../SKILL.md#workflow) 節から参照される。

dotfiles 環境は **eject なし**（builtin の `default` / `default-mini` をそのまま使用）。カスタム workflow / instruction は持たない。

## 目次

- [default（テスト先行開発）](#default-テスト先行開発)
- [default-mini（テスト省略の軽量版）](#default-mini-テスト省略の軽量版)
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

## default-mini（テスト省略の軽量版）

`max_steps: 30`、親 step 数 3。`default` から `write_tests` を取り除いただけ。

| 順 | step | 種別 | persona / call |
|---|---|---|---|
| 1 | `plan` | edit: false | planner |
| 2 | `draft` | workflow_call | `default-draft`（args 既定） |
| 3 | `peer-review` | workflow_call | `default-peer-review` |

bugfix / chore / docs / 小規模 refactor など、新規テスト実装が不要なタスク向け。

## subworkflow: default-draft

実装フェーズ。`implement` step と `ai-antipattern-review` ↔ `ai-antipattern-fix` のループを内包する。0.40.0 のリネームで `ai_review` / `ai_fix` から `ai-antipattern-*` に統一されている。

主な step（builtin の `default-draft.yaml` 参照）:

- `implement`（coder, `impl_instruction` 引数で `implement-after-tests` などを差し替え）
- `ai-antipattern-review-1st`（ai-antipattern-reviewer）
- `ai-antipattern-fix`（coder）
- ループ判定の `loop_monitor`（supervisor judge、threshold 3）

`default` 側の `draft` step は `args.impl_instruction: implement-after-tests` を渡し、テスト先行後の本実装に切り替える。`default-mini` 側は引数を渡さず subworkflow の既定実装 instruction が使われる。

## subworkflow: default-peer-review

3 並列のレビューフェーズ。

- `arch-review`（architecture-reviewer, `review-arch` instruction）→ `architect-review.md`
- `ai-antipattern-review-2nd`（ai-antipattern-reviewer, `ai-antipattern-review` instruction）→ `ai-antipattern-review.md`
- `supervise`（supervisor, `supervise` instruction）→ `supervisor-validation.md` / `summary.md`

集約ルールで全 reviewer が approved なら `COMPLETE`、いずれかが needs_fix なら `fix` step に降りて修正ループを回す。`reviewers` ↔ `fix` の loop_monitor が「非生産的」と判定すると `ABORT`。

### スコープ外発見の自動起票は無い

builtin の `default` / `default-mini` には `report_spillover` 相当の step が **無い**。スコープ外発見は必ず人手で `issue` スキルに引き渡す（詳細は `takt-issue` SKILL.md の Step 7 を参照）。

### `self_review` / `ci_verify` も無い

PR 前のコード簡素化チェックやローカル CI 実行は builtin にない。必要なら `self-review` / `verify` などの user skill を別途叩く運用にする。

## auto-improvement-loop（参考）

`max_steps: infinite` の自己ループ workflow。`route_context` → `plan_from_issue` or `plan_fresh_improvement` → `enqueue_task` → `wait_before_next_scan`（`delay_before_ms: 60000`）→ `route_context` に戻る。

起動: `takt run --workflow auto-improvement-loop`（または `takt add` で workflow 選択）。カレントディレクトリの git リポジトリをスコープに、open Issue / PR / コードベースから改善機会を AI が抽出して新規 task を enqueue する。

dotfiles リポジトリで回す意味は薄い（Issue / PR ベースの開発リポジトリ向け機能）。

## プレビューと検証

```bash
takt prompt default             # default の各 step の prompt をプレビュー
takt prompt default-mini        # default-mini のプレビュー
takt workflow doctor            # 全 workflow を検証
takt workflow doctor default    # 特定 workflow のみ
```

カスタム workflow を作るときは `takt workflow init` で雛形 → `.takt/workflows/` 配下に置き、`takt workflow doctor` で検証する。builtin を改造したい場合は `takt eject default` で `.takt/workflows/default.yaml` に降ろしてから編集する（builtin 直接編集は禁止）。
