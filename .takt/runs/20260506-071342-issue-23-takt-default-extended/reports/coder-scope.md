# 変更スコープ宣言

## タスク
takt の `default-extended` workflow（多段レビュー + report_spillover step）を dotfiles に新規追加し、関連 nix リンクと takt-issue skill を更新する

## 変更予定
| 種別 | ファイル |
|------|---------|
| 作成 | `config/.takt/workflows/default-extended.yaml` |
| 作成 | `config/.takt/facets/instructions/report-scope-spillover.md` |
| 作成 | `config/.takt/facets/instructions/test-design.md` |
| 作成 | `config/.takt/facets/instructions/test-design-review.md` |
| 変更 | `nix/packages.nix`（`# takt` セクションに mkdir 2 + link_force 4 を追加） |
| 変更 | `config/.claude/skills/takt-issue/SKILL.md`（Overview / 対話プロンプト / spillover セクション / Rules の 4 箇所） |
| 変更 | `tests/test_integration.py`（`BUILTIN_INSTRUCTION_NAMES` 白リストを実 builtin 集合に補正、7→10 件） |

## 推定規模
Medium

## 影響範囲
- takt 利用者の対話プロンプト経路（`takt add` のカテゴリ「その他/」 → workflow `default-extended` 選択）
- `~/.takt/` のシンボリックリンク構成（`darwin-rebuild switch` 適用後に `workflows/default-extended.yaml` と `facets/instructions/{report-scope-spillover,test-design,test-design-review}.md` が解決可能になる）
- takt-issue skill の運用手順（デフォルト workflow が `default` から `default-extended` に切替、スコープ外発見の自動起票が `report_spillover` step として組み込まれ、SKILL.md の人手フォロー記述は補完的位置付けに変更）
- `default-extended` workflow から参照される takt builtin instruction（`plan` / `review-requirements` / `write-tests-first` / `review-test` / `implement-after-tests` / `ai-review` / `ai-fix` / `review-arch` / `supervise` / `fix`）と loop_monitor 用 builtin（`loop-monitor-reviewers-fix`）は `~/.bun/install/cache/takt@0.38.0@@@1/builtins/ja/facets/instructions/` で解決
- specv リポジトリ側 `.takt/workflows/default.yaml` の削除と `.claude/CLAUDE.md` 文言更新はクロスレポ副作用を避けるため本 PR スコープ外（後続作業として明示分離）