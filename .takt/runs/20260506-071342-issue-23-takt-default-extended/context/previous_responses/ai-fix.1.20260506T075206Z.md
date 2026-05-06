Confirmed — `report_spillover` step now has no Web tools (line 549's WebFetch removed), and `_helpers.py:read_text` is just a 2-line function without redundant existence check.

---

## 確認したファイル
- `.takt/runs/20260506-071342-issue-23-takt-default-extended/reports/ai-review.md:1-40`（指摘 3 件の事実を一次情報として確認）
- `config/.takt/workflows/default-extended.yaml:539-556`（report_spillover step の allowed_tools 実態を確認）
- `config/.takt/facets/instructions/report-scope-spillover.md:1-37`（Read / gh / Glob / Grep のみで Web 系を呼ばないことを確認）
- `tests/_helpers.py:25-29`（`path.exists()` チェック直後に `path.read_text()` を呼ぶ二重防御を確認）
- `.takt/runs/20260506-071342-issue-23-takt-default-extended/reports/coder-decisions.md:3-9`（「7 件しか含まず → 10 件に揃えた」が新規ファイルなのに既存ファイル拡張のように読めることを確認）
- `git status -s`（`tests/test_integration.py` が untracked = 新規ファイルであることを確認）

## 実行した検索
- `grep -n "WebFetch\|WebSearch" config/.takt/workflows/default-extended.yaml` → L549 が WebFetch のみで他 16 step は両方保持していると確認
- `grep -n "7→10\|10 件" .takt/.../coder-decisions.md` → L9 に「workflow が実際に使う 10 件」記述があると確認
- `git status -s` → `tests/` が `??` で新規ファイルだと確認

## 修正内容
- **Issue 1（dead-permission, REJECT 候補ではないが warning）**: `config/.takt/workflows/default-extended.yaml:549` から `- WebFetch` を削除。instruction が Web 系を一切呼ばないため、最小権限原則に従い `[Read, Glob, Grep, Bash]` の 4 件に絞った。「他 step との一貫性」より「未使用権限を持たせない」を優先（policy「フォールバック・デフォルト引数の禁止」に通底する考え方）
- **Issue 2（over-defensive）**: `tests/_helpers.py:27-29` の `if not path.exists(): raise FileNotFoundError(...)` を削除し、`Path.read_text(encoding="utf-8")` の自然な FileNotFoundError に任せる構造に変更。docstring に「Why: 欠落時は Path.read_text が FileNotFoundError を自然に raise する」と記録
- **Issue 3（doc-mismatch）**: `coder-decisions.md:3-9` の見出しを「白リストを実 builtin の集合に合わせて拡張」→「白リストを実 builtin 集合に揃える」、本文を「7 件しか含まず…10 件に揃えた」→「初期草案では 7 件で書き始めたが…10 件で初出（commit 上は最初から 10 件）」へ書き換え。test_integration.py が新規ファイルである事実と整合させた

## テスト結果
- `bash tests/run.sh` → `Ran 55 tests in 0.267s OK`（全 55 件 pass、回帰なし）