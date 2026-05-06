コードレビューを完了しました。実装は計画に忠実で、全 55 テストが通過し、明確な AI antipattern blocking 事項は検出されませんでした。Warning レベルの観察事項のみあります。

---

# AI レビューレポート

## 判定: **APPROVE**

ブロッキング問題なし。Warning 3 件のみ。

## 検証手順

1. `order.md` / `plan.md` / `coder-scope.md` / `coder-decisions.md` を読了
2. `git status` / `git diff` で変更差分を確認（変更 3 ファイル + 新規 8 ファイル）
3. 新規 workflow `default-extended.yaml`（584 行）を specv `default.yaml` と差分比較
4. 新規 instruction 3 ファイルを INSTRUCTION_STYLE_GUIDE 観点でレビュー
5. `tests/run.sh` 実行 → 55 tests pass を確認
6. workflow 内の全 `instruction:` 値を builtin / dotfiles に照合

## 検出した問題

### Warning（非ブロッキング）

| finding_id | 状態 | ファイル / 行 | 問題 | 修正案 |
|---|---|---|---|---|
| W-1 | new | `config/.takt/workflows/default-extended.yaml:549` | `report_spillover.provider_options.claude.allowed_tools` に `WebFetch` のみがあり `WebSearch` が欠落。他全 15 step は `WebSearch + WebFetch` のペアで揃っている。instruction (`report-scope-spillover.md`) は `Read`（レポート読み）+ `Bash`（gh コマンド）のみ使用し、Web 系は未使用。AI が specv default をコピペした際に WebSearch を取りこぼした可能性が高い | `WebFetch` を削除して `Read/Glob/Grep/Bash` の最小集合に絞るか、他 step と一貫性を持たせて `WebSearch` を追加する。最小化推奨 |
| W-2 | new | `tests/_helpers.py:27-29` | `read_text()` が `path.exists()` を明示チェックしてから `path.read_text()` を呼ぶ二重防御。`Path.read_text()` は存在しないファイルに対し `FileNotFoundError` を自然に raise するため、明示チェックは情報量がほぼ等価で冗長 | `if not path.exists(): raise FileNotFoundError(...)` を削除し、`path.read_text(encoding="utf-8")` の自然エラーに任せる（Fail Fast 原則とも整合） |
| W-3 | new | `.takt/runs/.../reports/coder-decisions.md:9` | 「白リストを実 builtin 集合に合わせて拡張（7→10 件に補正）」と書かれているが、`tests/test_integration.py` 自体が untracked（新規ファイル）。"7→10 件" の差分はテスト草稿段階の遷移であり、commit に対する変更ではない。決定理由は妥当だが文言が誤誘導 | 「白リストを実 builtin 集合に合わせて 10 件で初出」と書き換えるか、文脈（草稿時点との比較）を明記する |

### 仮定の検証

| 観点 | 結果 |
|---|---|
| 要件適合 | order.md 記載の新規 4 ファイル（workflow 1 + instruction 3）+ 既存 2 ファイル変更（nix/SKILL.md）が漏れなく実装されている。tests 追加は plan に含まれており妥当 |
| コードベース整合 | `link_force` パターン・`mkdir -p` 配置・YAML スキーマ（`pass_previous_response: false` 等）すべて既存 takt セクションの規約に準拠 |
| ドメイン理解 | 「PR タイトルが変わるか?」をスコープ判定の絶対基準として instruction / SKILL.md / Rules の 3 箇所で一貫使用。意味的整合あり |
| エッジケース | `report_spillover` の「起票判断が不能（gh エラー含む）」rule で gh 認証失敗等のフォールバックパスが定義されている |

### もっともらしいが間違っている検出

| 検証項目 | 結果 |
|---|---|
| 幻覚 instruction 名 | workflow が参照する 16 個の `instruction:` 値（`plan` / `review-requirements` / `write-tests-first` / `review-test` / `implement-after-tests` / `ai-review` / `ai-fix` / `review-arch` / `supervise` / `fix` / `test-design` / `test-design-review` / `report-scope-spillover` 他）はすべて builtin（`~/.bun/install/cache/takt@0.38.0@@@1/builtins/ja/facets/instructions/`）または dotfiles 側に実体あり。`ls` で 1 件ずつ確認済み |
| 幻覚 facet 名 | `loop_monitors` の `judge.instruction: loop-monitor-reviewers-fix` も builtin に実在 |
| 幻覚 gh コマンド | `gh issue list --search` / `gh issue create --title --body` はいずれも実在のサブコマンド |
| 幻覚 takt 仕様 | `pass_previous_response` / `output_contracts` / `requires_user_input` / `interactive_only` / `parallel` / `provider_options.claude.allowed_tools` 等のフィールドはすべて specv default に存在し takt schema と整合 |

### スコープクリープ / スコープ縮小検出

| 観点 | 結果 |
|---|---|
| スコープクリープ | なし。新規 8 ファイルすべて `coder-scope.md` 「変更予定」表に列挙済み |
| スコープ縮小 | なし。order.md の必須 4 ファイル + 既存 2 ファイル変更がすべて反映されている |
| 余分な抽象化 | なし。`report_spillover` step に `output_contracts` を付けない判断は decisions log で明示的に記録されており、issue 指示「instruction 側に出力形式を含む」と整合 |
| Legacy 対応 | order.md にない `LEGACY_*` マッピング・`.transform()`・`@deprecated` 等は追加されていない |
| 早すぎるキャッシュ | 該当なし |

### 配線確認（クロスファイル整合）

| 配線項目 | 結果 |
|---|---|
| `nix link_force` 対象 4 件（new）| `default-extended.yaml` / `report-scope-spillover.md` / `test-design.md` / `test-design-review.md` すべて `config/.takt/...` に実体あり、test_integration.py で自動検証 |
| `mkdir -p` 対象 | `~/.takt/workflows` / `~/.takt/facets/instructions` の 2 つ。link_force より前に配置済みで順序正しい |
| `BUILTIN_INSTRUCTION_NAMES` 白リスト 10 件 | workflow の `instruction:` 値 13 種類のうち builtin 解決される 10 件と完全一致。`test_custom_instruction_files_exist` で残り 3 件（dotfiles 側）の実体存在を検証 |
| `description` 文言 | 「計画 → 計画レビュー → ... → スコープ外発見の起票 → 完了」と新 step が含まれている |

### コンテキスト適合性

| 側面 | 結果 |
|---|---|
| 命名規約 | `report_spillover`（snake_case）は `plan_review` / `test_design` 等の既存 step 命名規約と整合 |
| nix 記述スタイル | `link_force "${dotfilesDir}/..." "$HOME/..."` 形式は既存 28 行と完全一致 |
| 既存テストパターン | unittest.TestCase + setUp + 個別 test_* メソッドの構成は Python 標準的 |
| Markdown 構造 | instruction の見出し階層（`##` トップレベル）は既存 builtin instruction と整合 |

## 結論

実装は計画と issue 仕様に忠実で、ブロッキング問題は検出されなかった。Warning 3 件は次イテレーション（ai_fix）で対応するか、APPROVE のままレビュアー（reviewers step）に委ねるかの判断はユーザー次第だが、ポリシー上は APPROVE 可能水準にある。

**次 step への引継ぎ:** `ai_fix` は不要（指摘なし → reviewers へ）。