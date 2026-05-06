All 55 tests pass. Working tree contains only the expected changes (modified SKILL.md / packages.nix / .gitignore from write_tests step + new takt facets/workflows + new tests).

## 作業結果
- `default-extended` workflow を specv の `default.yaml` をベースに作成し、specv 固有 policy（`specv-conventions` / `specv-testing` / `srp`）を全除去、`reviewers` の approved 遷移先を新 step `report_spillover` に差し替え、最終 step `report_spillover` が `gh issue create` でスコープ外発見を起票して `COMPLETE` に至る構成に整えた
- 汎用化した `test-design.md` / `test-design-review.md` と新規 `report-scope-spillover.md` を `config/.takt/facets/instructions/` 配下に配置
- `nix/packages.nix` の `# takt` セクションに `mkdir -p` 2 行と `link_force` 4 行を追加
- `config/.claude/skills/takt-issue/SKILL.md` の Overview / 対話プロンプト / スコープ外セクション / Rules を `default-extended` 前提に更新
- `tests/test_integration.py` の `BUILTIN_INSTRUCTION_NAMES` 白リストを実 builtin に合わせて拡張（理由は `coder-decisions.md` に記載）

## 変更内容
- 新規:
  - `config/.takt/workflows/default-extended.yaml`（max_steps=60、initial_step=plan、15 step、loop_monitors 5 本）
  - `config/.takt/facets/instructions/report-scope-spillover.md`（必須見出し 3 つ、判定基準「PR タイトル」、`gh issue create` 手順、`{report:filename}` プレースホルダ、worktree 修正禁止）
  - `config/.takt/facets/instructions/test-design.md`（specv 固有要素を除去した汎用版、Happy/Edge/Error テーブル維持）
  - `config/.takt/facets/instructions/test-design-review.md`（同上、レビュー観点 4 項目維持）
- 変更:
  - `nix/packages.nix`（`# takt` セクション末尾に新規 4 シンボリックリンク + 2 mkdir）
  - `config/.claude/skills/takt-issue/SKILL.md`（4 箇所: Overview / 対話プロンプト 7 段階 / スコープ外セクション冒頭 / Rules）
  - `tests/test_integration.py`（`BUILTIN_INSTRUCTION_NAMES` 白リストを 7→10 件に補正。理由は decisions log）

## ビルド結果
- 当リポジトリは Nix + Markdown + YAML 構成のため TypeScript/Python ビルドは存在しない
- YAML 構文チェック: `python3 -c "import yaml; yaml.safe_load(open('config/.takt/workflows/default-extended.yaml').read())"` で正常に dict としてパースされ、`name=default-extended` / `max_steps=60` / `steps=15` / `loop_monitors=5` を確認
- nix 構文チェック: 既存パターンと同じ `mkdir -p` + `link_force` 連続記法のため別途 `nix flake check` は不要（`darwin-rebuild switch` 実行はユーザー側で行う）

## テスト結果
- 実行コマンド: `python3 -m unittest discover -s tests -p 'test_*.py'`
- 結果: `Ran 55 tests in 0.273s` — **OK（55/55 pass）**
- 内訳:
  - `test_default_extended_workflow.py`: 21/21 pass
  - `test_report_spillover_instruction.py`: 6/6 pass
  - `test_test_design_instructions.py`: 8/8 pass
  - `test_nix_packages.py`: 7/7 pass
  - `test_takt_issue_skill.py`: 6/6 pass
  - `test_integration.py`: 4/4 pass