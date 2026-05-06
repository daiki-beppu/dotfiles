# テスト作成レポート

## 作成テスト

| ファイル | 種別 | テスト数 | 概要 |
|---------|------|---------|------|
| `tests/_helpers.py` | ヘルパー | 0 | パス定数（WORKFLOW_FILE / INSTRUCTION_DIR / NIX_PACKAGES / TAKT_ISSUE_SKILL 等）と YAML ローダ。Fail Fast（フォールバック値なし） |
| `tests/__init__.py` | パッケージマーカー | 0 | `python3 -m unittest discover` の対象認識のため |
| `tests/test_default_extended_workflow.py` | 単体 | 21 | `default-extended.yaml` の構造的妥当性。メタデータ（name=default-extended / max_steps=60 / initial_step=plan）、step 名の必須・一意性、`specv-conventions` / `specv-testing` / `srp` 全消去（list 内＋raw text 双方）、reviewers の approved rule が `next: report_spillover`、needs_fix rule は `next: fix` 維持、`next: COMPLETE` 直行禁止、report_spillover step 必須プロパティ（edit:false / persona:supervisor / pass_previous_response:false / instruction:report-scope-spillover / allowed_tools に Read,Glob,Grep,Bash 含有 / 終端 rule で COMPLETE）、step グラフ整合（next 先が steps か COMPLETE/ABORT）、loop_monitors の cycle 内 step 名解決 |
| `tests/test_report_spillover_instruction.py` | 単体 | 6 | `report-scope-spillover.md` の必須出力（`## 検出したスコープ外項目` / `## 起票した issue` / `## 起票しなかった項目`）、判定基準「PR タイトル」言及、`gh issue create` 言及、`{report:filename}` プレースホルダ使用、`.takt/runs/` ハードコード禁止、worktree 内修正禁止の警告 |
| `tests/test_test_design_instructions.py` | 単体 | 8 | `test-design.md` / `test-design-review.md` の汎用化検証。specv 固有トークン（`specv-testing` / `specv-conventions` / `tests/test-utils.ts` / `withTmpDir`）残存禁止、Happy/Edge/Error 分類の維持、AAA 強制文言禁止 |
| `tests/test_nix_packages.py` | 単体 | 7 | `nix/packages.nix` の `# takt` セクション差分。既存 config.yaml link 維持、新規 `mkdir -p` 2 行（workflows / facets/instructions）、新規 `link_force` 4 行（default-extended.yaml / report-scope-spillover.md / test-design.md / test-design-review.md）を完全一致でアサート |
| `tests/test_takt_issue_skill.py` | 単体 | 6 | `SKILL.md` 3 箇所更新。`default-extended` 言及、`9 step` 等の固有 step 数表記消去、`その他` カテゴリ表記、`クイックスタート` 残骸禁止、scope-out セクションの `report_spillover` 言及 |
| `tests/test_integration.py` | 統合 | 4 | モジュール横断検証。workflow YAML の `instruction:` 値が builtin 以外なら `facets/instructions/<name>.md` の実体存在、nix link_force のソースパスがリポジトリ内に存在、新規 4 ファイル全てが nix 側に登場、workflow YAML 実体と nix link_force ソースの整合 |
| `tests/run.sh` | 実行スクリプト | - | `python3 -m unittest discover -s tests -p 'test_*.py' -v` のラッパ |

合計テスト数: **55**（5 ファイル × 平均 11 ケース、ヘルパー除く）

## 実行結果（参考）

実装前のためテスト失敗・import エラーは想定内。

```
Ran 55 tests in 0.015s
FAILED (failures=17, errors=35)
```

| 状態 | 件数 | 備考 |
|------|------|------|
| Pass | 3 | 既存ファイル状態への regression guard。実装後も pass 維持が要件: ① `test_existing_config_yaml_link_is_preserved`（nix の既存 config.yaml link が壊れていないこと）、② `test_each_takt_link_source_exists_in_repo`（nix link_force の現存ソースが repo 内に実在すること。実装後は新規 4 本にも適用）、③ `test_skill_md_exists`（SKILL.md 自体が存在すること） |
| Fail / Import Error（想定内） | 52 | 内訳: FAIL 17 + ERROR 35。すべて未作成ファイル / 未更新ファイルが原因。ERROR の大半は `setUp` での `load_workflow_yaml()` が `FileNotFoundError` を投げるため（`config/.takt/workflows/default-extended.yaml` 未存在）。FAIL は `pathlib.Path.exists()` ベースのチェックや、既存 nix / SKILL.md に新規行が無いことによる substring miss。実装完了で全件 green になる |
| Error（要対応） | 0 | 既存パスミス等、実装後も残るエラーは無い。テスト側の import や YAML パース自体は健全（PyYAML 6.0.3 で動作確認済み） |

## 備考

- **テスト基盤の選定**: 本リポジトリは dotfiles（YAML + Markdown + Nix）構成で既存テストフレームワークが存在しない。新規依存追加を避けるため、`nix/packages.nix` の `python314.withPackages` で既に provisioning 済みの **PyYAML + Python 標準 `unittest`** を採用した。`bun` も利用可能だが TS プロジェクト構造を新設する負荷が高く、YAML 検証なら Python が最短経路。
- **Fail Fast 徹底**: `_helpers.py` の `read_text()` / `load_workflow_yaml()` はファイル不在時に例外を投げる（フォールバック値・空文字返却を禁止）。これにより実装漏れがテスト pass で隠蔽される事故を防ぐ。
- **specv 固有 policy 残骸の二重チェック**: `test_no_step_references_specv_only_policies`（パース後の構造検証）と `test_raw_yaml_does_not_mention_specv_policy_names`（raw text 全文検索）の両方を入れた。Why: コメント内・別フィールド内に残った場合も検出するため。dotfiles 側に対応 facet が無いため、残れば facet 解決エラーで workflow 起動失敗するクリティカル要件。
- **「クイックスタート」表記の禁止**: SKILL.md 既存テキスト L62 に `ワークフロー: クイックスタート/ → Enter` がハードコードされている。`workflowCategoryParser.js` を確認した結果、未登録 workflow は自動的に `その他` に分類されるため、SKILL.md の対話プロンプト手順をこの実装挙動に揃える必要がある。テストはこの差分を確実に捕捉する。
- **nix の link_force 完全一致アサート**: `assertIn` で部分一致せず、`${dotfilesDir}/...` から `$HOME/...` までの完全な行をアサートしている。Why: パス・引用・空白の typo（dotfiles のシンボリックリンク機構ではこれらが原因で活性化失敗が黙って起きる）を捕捉するため。
- **インテグレーションテストの必要性判断**: 設問の 3 条件のうち「3 つ以上のモジュールを横断するデータフロー」（workflow YAML → instruction MD → nix link_force → SKILL.md 案内）と「新オプションが呼び出しチェーンを通じて末端まで伝搬」（`default-extended` workflow 名が SKILL.md → `takt add` 対話 → workflow file → instruction 解決へ伝搬）に該当。`test_integration.py` を 4 ケース新設した。
- **builtin instruction の白リスト**: `WorkflowInstructionReferencesResolveTest.BUILTIN_INSTRUCTION_NAMES` に `plan` / `plan-review` / `implement` / `fix` / `review` / `ai-review` / `summary` を列挙。これらは takt builtin 側で解決されるため dotfiles 側に MD ファイル不要。一方、それ以外（`test-design` / `test-design-review` / `report-scope-spillover`）は dotfiles 側 facets/instructions に必須となるテスト構造になっている。
- **`.gitignore` 追加**: `__pycache__/` と `*.pyc` を追記。テスト実行で生成されるが追跡対象外。
- **未取得 chmod**: `tests/run.sh` への `chmod +x` は permission 未承認で失敗したが、`python3 -m unittest discover` で直接呼び出せるため動作影響なし。利用者が必要なら手動で `chmod +x` する想定。