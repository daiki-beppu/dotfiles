# takt builtin workflow リファレンス

builtin workflow の step 構成・ループ制御・dotfiles カスタマイズの詳細。
SKILL.md 本文の [Workflow](../SKILL.md#workflow) 節から参照される。

## 目次

- [default-extended（テスト先行開発）](#default-extended テスト先行開発)
- [default-mini（テスト省略の軽量版）](#default-mini テスト省略の軽量版)
- [loop_monitor の挙動](#loop_monitor-の挙動)
- [dotfiles 内のカスタマイズ](#dotfiles-内のカスタマイズ)

## default-extended（テスト先行開発）

`max_steps: 60`、step 数 15。**`initial_step: plan`** から始まり、7 つのフェーズで進む。
各 review ↔ fix のループには `loop_monitor` が仕込まれており、threshold（既定 3）を超えると
supervisor が「健全 / 非生産的」を判定して次の遷移先を決める。

### フェーズ別 step 一覧

| フェーズ | step | persona | instruction | 出力 report |
|----------|------|---------|-------------|-------------|
| **計画** | `plan` | planner | `plan` | `plan.md` |
| 計画レビュー | `plan_review` | requirements-reviewer | `review-requirements` | `requirements-review.md` |
| 計画修正 | `plan_fix` | planner | `plan` | `plan.md` |
| **テスト実装** | `write_tests` | coder | `write-tests-first` | `test-report.md` |
| テスト実装レビュー | `write_tests_review` | testing-reviewer | `review-test` | `testing-review.md` |
| テスト実装修正 | `write_tests_fix` | coder | `write-tests-first` | `test-report.md` |
| **本実装** | `implement` | coder | `implement-after-tests` | `coder-scope.md` / `coder-decisions.md` |
| **AI レビュー** | `ai_review` | ai-antipattern-reviewer | `ai-review` | `ai-review.md` |
| AI レビュー修正 | `ai_fix` | coder | `ai-fix` | （edit のみ） |
| **並列レビュー** | `reviewers` | （`arch-review` + `supervise` を並列実行） | `review-arch` / `supervise` | `architect-review.md` / `supervisor-validation.md` / `summary.md` |
| 修正 | `fix` | coder | `fix` | （edit のみ） |
| **スコープ外起票** | `report_spillover` | supervisor | `report-scope-spillover` (user override) | （`gh issue create` を実行） |
| **PR 前品質チェック** | `self_review` | coder | `self-review` (user override) | `self-review.md` |
| CI ローカル検証 | `ci_verify` | coder | `ci-verify` (user override) | `ci-verify.md` |
| **PR 作成** | `finalize_pr` | coder | `finalize-pr` (user override) | `finalize-pr.md` |

### 遷移ルール

各 step は `rules:` で次 step を決める。主な遷移:

- `plan` → `plan_review`（要件明確） / `COMPLETE`（質問のみで実装不要） / `ABORT`（要件不足）
- `plan_review` → `write_tests`（approved） / `plan_fix`（needs_fix）
- `write_tests` → `write_tests_review`（テスト Red 完了） / `implement`（テスト対象未実装でスキップ）
- `implement` → `ai_review`（実装完了 / 未着手 / 判断不能、いずれも進む）
- `ai_review` → `reviewers`（AI 問題なし） / `ai_fix`（AI 問題あり）
- `reviewers` の集約: 全 reviewer が approved → `report_spillover`、いずれかが needs_fix → `fix`
- `fix` → `reviewers`（修正完了） / `plan`（情報不足、計画からやり直し）
- `report_spillover` → `self_review`（起票完了 / 起票不能どちらも次へ進む）
- `self_review` → `ci_verify`（self-review 完了） / `fix`（main / master ブランチ上で実行された）
- `ci_verify` → `finalize_pr`（全コマンド成功） / `fix`（1 つ以上失敗）
- `finalize_pr` → `COMPLETE`（PR 作成完了 / 既存 PR 検出）

### `reviewers` step の並列構成

`reviewers` は単一 step だが内部で 2 つの reviewer を並列起動する。

| サブ reviewer | persona | instruction | 出力 |
|---------------|---------|-------------|------|
| `arch-review` | architecture-reviewer | `review-arch` | `architect-review.md` |
| `supervise`   | supervisor | `supervise` | `supervisor-validation.md` / `summary.md` |

集約ルールは `all("approved", "すべて問題なし")` で `report_spillover` へ進む。

## default-mini（テスト省略の軽量版）

`max_steps: 30`、step 数 6。**テスト実装フェーズを省略**した軽量版。

```
plan → implement → ai_review ⇄ ai_fix → reviewers (arch-review + supervise) ⇄ fix → COMPLETE
```

- bugfix / chore / docs / 小規模 refactor など、新規テスト実装が不要なタスク向け
- `report_spillover` step が **ない**ため、スコープ外発見の自動起票は走らない。
  takt-issue skill では mini 選択時に人手 spillover チェックが強制される
- `self_review` / `ci_verify` step も **ない**ため、`finalize_pr` 内で self-review・CI ローカル検証・commit/push・PR 作成を一括実行する（default-extended と異なり責務が分離されていない）

詳細な builtin 内容は `takt prompt default-mini` でプレビューできる。

## loop_monitor の挙動

`default-extended` には 4 つの loop_monitor が定義されている。いずれも **threshold: 3**。

| 監視対象ループ | judge | 「健全」時の next | 「非生産的」時の next |
|---------------|-------|------------------|---------------------|
| `plan_review` ↔ `plan_fix` | supervisor | `plan_review`（継続） | `write_tests`（強制前進） |
| `write_tests_review` ↔ `write_tests_fix` | supervisor | `write_tests_review`（継続） | `implement`（強制前進） |
| `ai_review` ↔ `ai_fix` | supervisor | `ai_review`（継続） | `reviewers`（強制前進） |
| `reviewers` ↔ `fix` | supervisor | `reviewers`（継続） | `ABORT` |

判断基準は各 monitor の `judge.instruction` に書かれており、共通テンプレートは
**「指摘が反映されているか」「同じ指摘の繰り返しになっていないか」「設計／実装の不備が
解消されているか」** の 3 軸で評価する。

`reviewers` ↔ `fix` のループだけ「非生産的」時に `ABORT` になる点に注意。
他のループは強制前進だが、最後の reviewers でループが収束しないときはタスク中断扱い。

## dotfiles 内のカスタマイズ

`~/01-dev/dotfiles/config/.takt/` 配下に eject 済みのカスタマイズが置かれている。
`~/.takt/` 配下の workflows / facets ディレクトリ自体は dotfiles 側からコピー or 個別 symlink
で同期される構成。

### カスタマイズされている facet

| 種類 | 名前 | 位置付け |
|------|------|----------|
| workflow | `default-extended` | builtin と同名でローカル版を維持。優先される |
| instruction | `report-scope-spillover` | スコープ外起票指示のカスタム版（`gh issue create` 連携） |
| instruction | `self-review` | PR 前のコード簡素化・セキュリティ点検・CLAUDE.md 同期（finalize-pr から分離） |
| instruction | `ci-verify` | CI ローカル検証（typecheck / lint / test / build）。finalize-pr から分離 |
| instruction | `finalize-pr` | commit + push + PR 作成（積み上げ判定含む）。品質チェックは self-review / ci-verify に委譲 |

`takt catalog instructions` で `[user]` ラベルが付いているものがカスタム版。builtin と
同名の facet を上書きするので、workflow YAML 側は変更不要で挙動だけ差し替わる。

### カスタマイズの編集対象

- 編集場所は `~/01-dev/dotfiles/config/.takt/` 一択。`~/.takt/config.yaml` は symlink 経由
- 新しい facet を追加するときは `takt eject <type> <name>` で取り出し、dotfiles に commit
- workflow を新しく作るときは `takt workflow init` で雛形 → `.takt/workflows/` 配下に置き、
  `takt workflow doctor` で検証

## 参考: workflow YAML の構造

参考までに `default-extended.yaml` の冒頭構造を抜粋する。

```yaml
name: default-extended
description: テスト先行開発ワークフロー（...）
workflow_config:
  provider_options:
    codex:
      network_access: true
max_steps: 60
initial_step: plan
loop_monitors:
  - cycle: [plan_review, plan_fix]
    threshold: 3
    judge:
      persona: supervisor
      instruction: |
        ... 健全 vs 非生産的の判定指示 ...
      rules:
        - condition: 健全（指摘が反映されている）
          next: plan_review
        - condition: 非生産的（同じ指摘を繰り返している）
          next: write_tests
steps:
  - name: plan
    edit: false
    persona: planner
    knowledge: architecture
    instruction: plan
    rules:
      - condition: 要件が明確で実装可能
        next: plan_review
    output_contracts:
      report:
        - name: plan.md
          format: plan
  # ... 以下 12 step ...
```

実体は `~/.takt/workflows/default-extended.yaml` および
`~/01-dev/dotfiles/config/.takt/workflows/default-extended.yaml`。
