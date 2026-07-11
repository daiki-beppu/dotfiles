# takt builtin catalog（facet）リファレンス

> takt 0.49.0 の builtin と照合済み（2026-07-09）

step に注入される素材（persona / policy / knowledge / instruction / output-contract）の一覧。
件数が多いため SKILL.md 本文には載せず、こちらに分離している。

## 取得方法

```bash
takt catalog                    # 型ごとの件数サマリ
takt catalog personas           # persona 一覧
takt catalog policies           # policy 一覧
takt catalog knowledge          # knowledge 一覧
takt catalog instructions       # instruction 一覧
takt catalog output-contracts   # output-contract 一覧
```

facet の **中身**（Markdown / YAML 本文）は `takt catalog` では表示されない。
内容を読む or 編集したい場合は `takt eject <type> <name>` でプロジェクトまたは
`--global` で `~/.takt/` にコピーする。

`[builtin]` ラベルは takt 本体に同梱されたもの、`[user]` ラベルは eject 済みの
ローカルカスタマイズ版。同名なら user が builtin を上書きする。

## persona（29 件）

step を実行する「役割・視点」。YAML 形式。

| 名前 | 表示名 | 用途 |
|------|--------|------|
| `planner` | Planner | 計画フェーズ（plan / plan_fix） |
| `architect-planner` | Architect Planner | アーキテクチャ設計を兼ねる計画 |
| `test-planner` | Test Planner | テスト設計（test_design） |
| `testing-reviewer` | Testing Reviewer | テスト設計・テストコードのレビュー |
| `coder` | Coder | 実装（write_tests / implement / fix） |
| `terraform-coder` | Terraform Coder | Terraform リソースの実装 |
| `terraform-reviewer` | Terraform Reviewer | Terraform レビュー |
| `architecture-reviewer` | Architecture Reviewer | 並列レビューの arch-review |
| `ai-antipattern-reviewer` | AI Antipattern Reviewer | ai_review（AI 特有のアンチパターン検出） |
| `pure-reviewer` | Pure Reviewer | 並列レビューの pure-review（0.49.0 で追加） |
| `coding-reviewer` | Coding Reviewer | 並列レビューの coding-review（0.49.0 で追加） |
| `frontend-reviewer` | Frontend Reviewer | フロントエンド観点のレビュー |
| `cqrs-es-reviewer` | CQRS+ES Reviewer | CQRS / Event Sourcing 観点のレビュー |
| `security-reviewer` | Security Reviewer | セキュリティレビュー |
| `qa-reviewer` | QA Reviewer | 品質保証観点のレビュー |
| `supervisor` | Supervisor | 並列レビューの集約・loop_monitor の judge |
| `dual-supervisor` | Dual Supervisor | 2 reviewer の調停（arbitrate） |
| `conductor` | Conductor | 全体オーケストレーション |
| `pr-commenter` | PR Commenter | PR レビューコメント対応 |
| `research-planner` | Research Planner | 調査タスクの計画 |
| `research-digger` | Research Digger | 調査の実行 |
| `research-analyzer` | Research Analyzer | 調査結果の分析 |
| `research-supervisor` | Research Supervisor | 調査タスクの集約 |
| `exec-assistant` | Exec Assistant | exec 系ワークフローの補助役 |
| `exec-worker` | Exec Worker | exec 系ワークフローの実行役 |
| `findings-manager` | Findings Manager | レビュー指摘の集約管理 |
| `melchior` | MELCHIOR-1 | 3 体一組の合議型レビュアー（1/3） |
| `balthasar` | BALTHASAR-2 | 3 体一組の合議型レビュアー（2/3） |
| `casper` | CASPER-3 | 3 体一組の合議型レビュアー（3/3） |

上記は builtin。これに加えカスタム persona（Markdown、実体は dotfiles の `config/.takt/facets/personas/`）として `diagnoser`（`diagnose-fix` workflow の診断者。再現ループ最優先・実コマンド実証の行動規範）と `e2e-verifier`（`e2e-verify` workflow のブラウザ検証者）を持つ。

## policy（12 件）

実装・テスト・レビュー時のルール・制約。Markdown。

| 名前 | 内容 |
|------|------|
| `coding` | コーディングポリシー（命名・関数粒度・抽象化の指針） |
| `testing` | テストポリシー（カバレッジ・モック方針・命名規約） |
| `review` | レビューポリシー（指摘の粒度・優先度） |
| `ai-antipattern` | AI 生成コードのアンチパターン検出基準 |
| `qa` | QA 観点での検出基準 |
| `design-fidelity` | UI デザインの忠実再現ポリシー |
| `design-planning` | デザイン計画ポリシー |
| `existing-system-respect` | 既存システムの意図・契約を尊重する指針 |
| `screen-api` | 画面専用 API のポリシー |
| `research` | 調査ポリシー |
| `task-decomposition` | タスク分解の指針 |
| `terraform` | Terraform 規約 |

上記は builtin。これに加えカスタム policy として `pre-review-checklist`（提出前セルフ監査 8 項目、`lite` / `improve` / `feature` workflow の implement / review で使用。実体は dotfiles の `config/.takt/facets/policies/`）を持つ。

## knowledge（14 件）

ドメイン知識・方法論。Markdown。

| 名前 | 領域 |
|------|------|
| `architecture` | アーキテクチャ全般 |
| `backend` | バックエンド専門知識 |
| `frontend` | フロントエンド専門知識 |
| `react` | React |
| `cqrs-es` | CQRS + Event Sourcing |
| `unit-testing` | ユニットテスト |
| `e2e-testing` | E2E テスト |
| `existing-system` | 既存システムの前提知識 |
| `security` | セキュリティ |
| `terraform-aws` | Terraform AWS |
| `research` | 調査方法論 |
| `research-comparative` | 比較調査 |
| `task-decomposition` | タスク分解 |
| `takt` | takt 自体のアーキテクチャ知識 |

## instruction（63 件）

step 実行時に AI に渡される具体的指示。Markdown。カテゴリ別に整理する。

### 計画系

| 名前 | 用途 |
|------|------|
| `plan` | 通常の計画指示（plan / plan_fix step） |
| `plan-investigate` | 調査寄りの計画 |
| `plan-test` | 不足単体テストの洗い出し |
| `research-plan` | 調査計画 |
| `research-dig` | 調査の並列実行 |
| `research-analyze` | 調査結果の分析 |
| `research-supervise` | 調査結果の評価 |

### テスト設計・実装系

| 名前 | 用途 |
|------|------|
| `test-design` | テスト設計（builtin。`default` / `lite` では未使用、`backend-cqrs` 系などで使用） |
| `test-design-review` | テスト設計レビュー（builtin。同上） |
| `write-tests-first` | テストファースト実装（write_tests / write_tests_fix） |
| `review-test` | テスト実装レビュー |

### 実装系

| 名前 | 用途 |
|------|------|
| `implement` | 通常実装 |
| `implement-after-tests` | テスト先行後の実装 |
| `implement-test` | テストの実装 |
| `implement-terraform` | Terraform の実装 |
| `team-leader-implement` | タスク分解 + 並列実装 |
| `dual-team-leader-implement` | 2 系統並列実装 |
| `e2e-coverage-implement` | E2E カバレッジ補完の実装 |

### レビュー系

| 名前 | 用途 |
|------|------|
| `ai-antipattern-review` | AI アンチパターンレビュー（旧 `ai-review`、0.40.0 でリネーム・統合） |
| `review-arch` | アーキテクチャレビュー |
| `review-pure` | 純粋な正しさ観点のレビュー（`pure-reviewer`、0.49.0 で `default-peer-review` に追加） |
| `review-coding` | コーディング規約観点のレビュー（`coding-reviewer`、0.49.0 で `default-peer-review` に追加） |
| `review-frontend` | フロントエンドレビュー |
| `review-security` | セキュリティレビュー |
| `review-qa` | QA レビュー |
| `review-cqrs-es` | CQRS + ES レビュー |
| `review-terraform` | Terraform 規約レビュー |
| `gather-review` | レビュー対象情報の収集 |
| `supervise` | 並列レビューの集約 |

### 修正系

| 名前 | 用途 |
|------|------|
| `ai-antipattern-fix` | AI レビュー指摘の修正（旧 `ai-fix`、0.40.0 でリネーム） |
| `fix` | 通常のレビュー指摘修正 |
| `fix-supervisor` | supervisor 指摘の修正 |
| `arbitrate` | レビュアーとコーダーの調停 |

### 監査系

`architecture-audit-*` / `audit-security-*` / `e2e-audit-*` / `unit-audit-*` の 4 系統で、
それぞれ `-plan` / `-review` / `-supervise` / `-team-leader` の組がある。

| プレフィックス | 領域 |
|---------------|------|
| `architecture-audit-*` | アーキテクチャ監査 |
| `audit-security-*` | セキュリティ監査 |
| `e2e-audit-*` | E2E カバレッジ監査 |
| `unit-audit-*` | ユニットテストカバレッジ監査 |
| `e2e-coverage-plan` / `e2e-coverage-supervise` | E2E カバレッジ補完 |

### loop_monitor 用

| 名前 | 用途 |
|------|------|
| `loop-monitor-ai-antipattern-fix` | ai-antipattern-review ↔ ai-antipattern-fix ループの判定（旧 `loop-monitor-ai-fix`、0.40.0 でリネーム） |
| `loop-monitor-reviewers-fix` | reviewers ↔ fix ループの判定 |

### 保守変更系（`*-maintenance`）

既存機能の保守変更（挙動を変えない改修）向けの `plan` / `implement` / `write-tests` / `fix` / `supervise` の代替版。dotfiles の `default` / `lite` / `fix` workflow では未使用（builtin の maintenance 系 workflow で使われる想定）。

| 名前 | 用途 |
|------|------|
| `plan-maintenance` | 保守変更としての計画（差し戻し時は replan） |
| `implement-maintenance` | 既存契約を保った実装 |
| `write-tests-maintenance` | 既存挙動を保護するテスト作成 |
| `fix-maintenance` | 既存契約を保ちつつ指摘を修正 |
| `supervise-maintenance` | 保守変更として不要な差分がないかを含めた最終承認 |

### exec 系（独立セッションレビュー構成）

Worker/Reviewer/Replan を独立セッションで回す exec 系 workflow（dotfiles の運用 workflow では未使用）向け instruction。

| 名前 | 用途 |
|------|------|
| `exec-worker` | 依頼タスクの実装（`exec-worker` persona） |
| `exec-review` | Worker 結果の独立レビュー |
| `exec-replan` | needs_replan 時のユーザーとの再計画 |
| `exec-loop-monitor` | exec ループが生産的か判定 |

### その他

| 名前 | 用途 |
|------|------|
| `architect` | 小規模タスクのアーキテクチャ設計判断（`architect-planner` persona） |
| `findings-manager` | 各レビュアーの raw findings と前版 ledger を統合（`findings-manager` persona） |

## output-contract（43 件）

step が生成する report ファイルのフォーマット仕様。Markdown。

| 名前 | 出力 report の用途 |
|------|------------------|
| `plan` | タスク計画 (`plan.md`) |
| `plan-frontend` | フロントエンド向け計画 |
| `test-plan` | テスト計画 (`test-design.md`) |
| `test-report` | テスト作成レポート (`test-report.md`) |
| `testing-review` | テストレビュー結果 (`testing-review.md`) |
| `ai-antipattern-review` | AI アンチパターンレビュー結果 (`ai-review.md`、旧 `ai-review` から 0.40.0 でリネーム) |
| `ai-antipattern-review-finding-contract` | ai-antipattern-review の finding 単位フォーマット |
| `coder-scope` | 変更スコープ宣言 (`coder-scope.md`) |
| `coder-decisions` | 実装決定ログ (`coder-decisions.md`) |
| `architecture-design` | アーキテクチャ設計 |
| `architecture-review` | アーキテクチャレビュー (`architect-review.md`) |
| `architecture-review-finding-contract` | architecture-review の finding 単位フォーマット |
| `architecture-audit-plan` | アーキテクチャ監査計画 |
| `architecture-audit` | アーキテクチャ監査レポート |
| `audit-security` | セキュリティ監査レポート |
| `security-review` | セキュリティレビュー |
| `security-review-finding-contract` | security-review の finding 単位フォーマット |
| `pure-review` | 純粋な正しさ観点のレビュー結果 (`pure-review.md`、0.49.0 で追加) |
| `pure-review-finding-contract` | pure-review の finding 単位フォーマット（0.49.0 で追加） |
| `coding-review` | コーディング規約観点のレビュー結果 (`coding-review.md`、0.49.0 で追加) |
| `coding-review-finding-contract` | coding-review の finding 単位フォーマット（0.49.0 で追加） |
| `frontend-review` | フロントエンドレビュー |
| `frontend-review-finding-contract` | frontend-review の finding 単位フォーマット |
| `cqrs-es-review` | CQRS + ES レビュー |
| `cqrs-es-review-finding-contract` | cqrs-es-review の finding 単位フォーマット |
| `qa-review` | QA レビュー |
| `qa-review-finding-contract` | qa-review の finding 単位フォーマット |
| `terraform-review` | Terraform 規約レビュー |
| `terraform-review-finding-contract` | terraform-review の finding 単位フォーマット |
| `testing-review-finding-contract` | testing-review の finding 単位フォーマット |
| `e2e-audit-plan` | E2E 監査計画 |
| `e2e-audit` | E2E 監査レポート |
| `e2e-coverage-plan` | E2E カバレッジ計画 |
| `unit-audit-plan` | ユニットテスト監査計画 |
| `unit-audit` | ユニット監査レポート |
| `review-gather` | レビュー対象情報 |
| `research-report` | 調査レポート |
| `maintenance-scope` | 保守変更のスコープ宣言（`*-maintenance` 系 workflow 用） |
| `exec-review-result` | exec 系 workflow のレビュー結果 |
| `findings-manager` | レビュー指摘の統合結果（`findings-manager` persona 用） |
| `supervisor-validation` | 最終検証結果 (`supervisor-validation.md`) |
| `validation` | 最終検証結果（汎用） |
| `summary` | タスク完了サマリー (`summary.md`) |

上記は builtin。これに加えカスタム output-contract（実体は dotfiles の `config/.takt/facets/output-contracts/`）として `test-design`（`feature` の test_design step が出力するテスト設計書）、`scope-review`（`feature` の scope_review step が出力するスコープ見直し・vertical slice 分割提案）、`e2e-verify-plan` / `e2e-verify-report`（`e2e-verify` 用）を持つ。また構造化出力用のカスタム schema（`config/.takt/schemas/`）として `review-verdict`（verdict / feedback / followups）と `diagnosis-verdict`（`diagnose-fix` の診断結果）を持つ。

## eject 後の編集の流儀

builtin facet を直接編集してはならない（次回 takt アップデートで上書きされる）。

```bash
# プロジェクト固有のカスタマイズ
takt eject persona planner                 # → .takt/facets/personas/planner.yaml
takt eject instruction plan                # → .takt/facets/instructions/plan.md
takt eject default                         # → .takt/workflows/default.yaml

# 全プロジェクト共通のカスタマイズ（dotfiles 管理対象）
takt eject persona planner --global        # → ~/.takt/facets/personas/planner.yaml
```

eject 後のファイル拡張子は facet 型による:

- `persona`: `.yaml`
- `policy` / `knowledge` / `instruction` / `output-contract`: `.md`
- `workflow`: `.yaml`

eject 後、workflow が同名 facet を参照する際に **ローカル版が優先**される。

dotfiles 環境では `~/01-dev/dotfiles/config/.takt/facets/` 配下に置き、git commit する。
eject ファイルの中身（builtin との差分）を意識しないと、takt アップデートで builtin が
変わったときに整合性が崩れる可能性がある。定期的に `takt catalog` で builtin の更新を
確認し、必要なら eject ファイルを書き直す運用が望ましい。
