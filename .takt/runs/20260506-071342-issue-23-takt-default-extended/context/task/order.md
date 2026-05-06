## Issue #23: [takt] default-extended workflow を新規追加（specv ベース + report_spillover step）

## 概要

takt の builtin `default` を汚さず、specv 流の多段レビュー（plan → plan_review → test_design → test_design_review → write_tests → write_tests_review → implement → ai_review → reviewers）に **`report_spillover` step**（スコープ外発見の自動 issue 化）を組み込んだ汎用 workflow を新規追加する。

## 背景

- `takt-issue` skill 側にスコープ外発見ルールを書いても、Claude が忘れる可能性がある
- workflow 側の step として組み込めば、毎回 takt run で必ず通るので確実
- specv では既に多段レビュー workflow が運用されており、テスト設計の品質が高い
- 各リポジトリで使えるよう、グローバル dotfiles に置く

## 実装内容

### 新規ファイル

| パス | 内容 |
|---|---|
| `config/.takt/workflows/default-extended.yaml` | specv `default.yaml` を base に specv-conventions / specv-testing / srp policy を除外。`reviewers` の `next: COMPLETE` を `next: report_spillover` に変更し、新 step を追加。max_steps=60 |
| `config/.takt/facets/instructions/report-scope-spillover.md` | spillover step が参照する instruction（スコープ判定基準・対象例・gh issue create 手順・出力形式） |
| `config/.takt/facets/instructions/test-design.md` | specv から汎用化して dotfiles に持ってくる（`specv-testing` policy 参照は削除） |
| `config/.takt/facets/instructions/test-design-review.md` | 同上 |

### 既存ファイル変更

| パス | 変更 |
|---|---|
| `nix/packages.nix` | `# takt` セクションに `mkdir -p` と `link_force` を追加（4 ファイル分の symlink） |
| `config/.claude/skills/takt-issue/SKILL.md` | デフォルト workflow を `default-extended` に切替。具体的な選択手順を更新 |
| specv リポジトリ `.takt/workflows/default.yaml` | 削除（dotfiles の default-extended を使うため） |

## 検証

- `darwin-rebuild switch --flake ~/01-dev/dotfiles` で symlink 反映
- `takt add` 実行時に「レビュー/」配下に `default-extended` が出現することを確認
- 任意リポジトリで `takt add` → workflow 選択 → `default-extended` を選び、最後の `report_spillover` step が走り、検出したスコープ外問題が `gh issue create` で起票されること

## 参考

- specv default workflow: `~/01-dev/projects/specv/.takt/workflows/default.yaml`（16 step、loop_monitors 5 つ）
- builtin default: `~/.bun/install/cache/takt@0.38.0@@@1/builtins/en/workflows/default.yaml`

### Labels
enhancement