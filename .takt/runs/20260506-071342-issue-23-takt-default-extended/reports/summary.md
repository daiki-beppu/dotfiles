# タスク完了サマリー

## タスク
takt の builtin `default` を汚さず、specv 流の多段レビュー（plan → plan_review → test_design → test_design_review → write_tests → write_tests_review → implement → ai_review → reviewers → report_spillover → COMPLETE）に **`report_spillover` step**（スコープ外発見の自動 issue 化）を組み込んだ汎用 workflow `default-extended` を dotfiles に新規追加した。

## 結果
完了

## 変更内容
| 種別 | ファイル | 概要 |
|------|---------|------|
| 作成 | `config/.takt/workflows/default-extended.yaml` | specv `default.yaml` をベースに `specv-conventions` / `specv-testing` / `srp` policy を全除外、`reviewers` の `next: COMPLETE` を `next: report_spillover` に変更、新 step `report_spillover` を追加（最終 `next: COMPLETE`）、`max_steps: 60`、`initial_step: plan`、loop_monitors 5 本維持 |
| 作成 | `config/.takt/facets/instructions/report-scope-spillover.md` | `report_spillover` step の instruction。「PR タイトルが変わるか?」を絶対基準とするスコープ判定、対象例 5 種、`gh issue list --search` → `gh issue create --title --body` 手順、必須出力 3 見出し（検出した項目 / 起票 issue / 起票しなかった項目） |
| 作成 | `config/.takt/facets/instructions/test-design.md` | specv 版から汎用化（`specv-testing` policy 参照削除、`tests/test-utils.ts` 等の固有名削除、AAA/GWT 強制を除去）。Happy/Edge/Error 表 + Unit/E2E 責務マトリクスは維持 |
| 作成 | `config/.takt/facets/instructions/test-design-review.md` | 同上（観点 4 項目 + `approved`/`needs_fix` 出力構造） |
| 作成 | `tests/__init__.py` | Python unittest discovery 用パッケージマーカー |
| 作成 | `tests/_helpers.py` | テスト対象ファイルのパス定数と YAML ローダ（Fail Fast、フォールバック値なし） |
| 作成 | `tests/run.sh` | `python3 -m unittest discover` のラッパスクリプト |
| 作成 | `tests/test_default_extended_workflow.py` | `default-extended.yaml` の構造検証（21 件）。メタデータ、step 名整合、specv 残骸 0、`reviewers` の `next: report_spillover`、`report_spillover` の必須プロパティ、loop_monitors の cycle 名解決 |
| 作成 | `tests/test_report_spillover_instruction.py` | `report-scope-spillover.md` の検証（7 件）。必須見出し 3 種、PR タイトル基準言及、`gh issue create` 言及、`{report:filename}` 利用、worktree 修正禁止文言 |
| 作成 | `tests/test_test_design_instructions.py` | `test-design.md` / `test-design-review.md` の汎用化検証（8 件）。specv 固有トークン残存禁止、Happy/Edge/Error 維持、AAA 強制禁止 |
| 作成 | `tests/test_nix_packages.py` | `nix/packages.nix` 差分の完全一致アサート（7 件）。既存 link 維持、新規 mkdir 2 / link_force 4 |
| 作成 | `tests/test_takt_issue_skill.py` | `SKILL.md` 更新検証（6 件）。`default-extended` 言及、step 数固有値消去、`その他` カテゴリ表記、`クイックスタート` 残骸 0、spillover セクションの `report_spillover` 言及 |
| 作成 | `tests/test_integration.py` | モジュール横断検証（4 件）。workflow 参照 instruction の存在、nix link source の repo 内存在、新規 4 ファイルの nix 登場、workflow と nix のパス整合 |
| 変更 | `nix/packages.nix` | `# takt` セクションに `mkdir -p workflows` / `mkdir -p facets/instructions` と 4 つの `link_force` を追加（`darwin-rebuild` 適用で `~/.takt/` 配下に symlink） |
| 変更 | `config/.claude/skills/takt-issue/SKILL.md` | Overview（L13）/ 対話プロンプト 7 段階（L59-69、カテゴリ「その他/」 → ワークフロー `default-extended`）/ spillover セクション冒頭（L213-215、`report_spillover` 自動化を明示）/ Rules 末尾（L251）の 4 箇所を `default-extended` 前提に更新 |
| 変更 | `.gitignore` | `__pycache__/` / `*.pyc`（Python テスト副産物）を追加 |

## 検証証跡
- **テスト**: `python3 -m unittest discover -s tests -p 'test_*.py' -v` を本 supervise step で実行し `Ran 55 tests in 0.275s OK` を確認。内訳：`test_default_extended_workflow.py` 21 件、`test_report_spillover_instruction.py` 7 件、`test_test_design_instructions.py` 8 件、`test_nix_packages.py` 7 件、`test_takt_issue_skill.py` 6 件、`test_integration.py` 4 件、既存 regression guard 2 件 = 計 55 件 全 pass。
- **specv 残骸検査**: `grep -E "specv-conventions|specv-testing|srp" config/.takt/workflows/default-extended.yaml` → 0 件、`grep -E "specv-conventions|specv-testing|specv|tests/test-utils|withTmpDir|AAA" config/.takt/facets/instructions/{test-design,test-design-review}.md` → 0 件で specv 固有トークンの残存なしを確認。
- **AI レビュー**: 2 回目 ai-review で APPROVE。前回 Warning 3 件（`AI-NEW-default-extended-L549` / `AI-NEW-helpers-L27` / `AI-NEW-decisions-L9`）すべて resolved を本 step で再確認（`default-extended.yaml:544-548` の `[Read, Glob, Grep, Bash]` 確定 / `tests/_helpers.py:25-27` の二重防御除去 / `coder-decisions.md:3-9` の文言訂正）。
- **要件分解照合**: order.md から 28 要件に分解し、27 件 ✅（`default-extended.yaml` 新規 / `specv-*` `srp` 全除外 / `reviewers` の遷移先変更 / `report_spillover` 追加 / `max_steps: 60` / instruction 3 ファイル新規 / `nix/packages.nix` の mkdir 2 + link_force 4 / `SKILL.md` 4 箇所更新）。1 件（specv 別リポジトリの `default.yaml` 削除）は `plan.md:278` で「クロスレポ副作用回避のため後続 PR」と根拠付き分離。
- **動作確認の範囲**: テスト可能な構造的整合（YAML パース・instruction MD 構造・nix link_force と config の整合）まで pass で確認。`darwin-rebuild` 適用後の `takt add` 実行による workflow 一覧表示と `report_spillover` step の実起動はユーザー側手動検証ステップとして残る（本 run の実行ログには含まれない）。