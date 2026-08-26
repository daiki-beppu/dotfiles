# Implementation Plans

improve スキルによる監査から生成。第 1 期（001〜006）は 2026-07-09 の初回監査（commit `3dbd88e` 時点）、
第 2 期（007〜017）は同日の再監査（commit `e0a2d44` 時点）、
第 3 期（018〜025）は 2026-08-26 のグローバルスキル監査（commit `f9948f8` 時点。
対象は `config/.claude/skills/` の要不要選定と品質）による。
下表の順に実行すること（依存関係が許す限り並べ替え可）。各 executor は plan を全文読み、
STOP conditions を尊重し、完了時に自分の行の Status を更新する。

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [001](001-ci-verification-baseline.md) | CI（flake 評価 + shellcheck）の検証基盤を確立 | P1 | M | — | DONE (commit `da68e14`, main にマージ・push 済み。初回 CI run 28993365768 両ジョブ green) |
| [002](002-multi-host-flake.md) | flake をマルチホスト化しハードコード排除 | P1 | M | 001 | DONE（`26bddd5` 時点に refresh 後実行。commit `77d14f5`、レビュー済み・全 done criteria pass。PR #67 に実装込みで含む） |
| [003](003-takt-skill-contract-fixes.md) | takt 系スキルの契約矛盾 3 件＋未定義状態を解消 | P1 | S | — | DONE（commit `5da9385`、PR #68 経由で main にマージ済み） |
| [004](004-declare-shell-dependencies.md) | .zshrc の未宣言依存を宣言、stale な proto 手順を除去 | P2 | S | 002 | DONE（`69c32b4` で refresh 後に実行。branch `fix/declare-shell-deps`、commit `5981f42`。レビュー済み・全 done criteria pass。zsh-abbr は unfree のため flake.nix の allowUnfreePredicate に追加。マージ・push は未実施。新品マシン相当の検証は次回セットアップ時） |
| [005](005-public-repo-cleanup.md) | 公開リポジトリから事故コミットを除去 | P2 | S | 003 | DONE（commit `9e441c1`、PR #68 経由で main にマージ済み。追跡除去を main で実地確認済み） |
| [006](006-fix-hooks-registration.md) | 死んだ hook の登録と reject hook の出力契約修正 | P2 | S | 002 | DONE（PR #69 / merge `7018535` で独立に実装・マージ済み。executor は branch 重複を検知して正しく STOP。レビュアーが origin/main の内容一致と単体テスト pass を再検証。Step 4 の sync-codex-skills 実地スモークは未実施 — 次セッションでスキルを 1 つ Edit して発火確認を推奨） |
| [007](007-link-force-hardening-wezterm.md) | linkDotfiles を堅牢化し .wezterm.lua を Nix 配備 | P1 | S | — | DONE (PR #72) |
| [008](008-zsh-guard-and-dedup.md) | .zshenv/.zshrc の無ガード source と重複を解消 | P1 | S | — | DONE（PR #73 でマージ済み。全 done criteria pass を reconcile で確認） |
| [009](009-reject-hooks-quoted-strings.md) | reject hooks の引用文字列への誤発動を解消 | P1 | S | — | DONE（PR #74 でマージ済み。全 done criteria pass を reconcile で確認） |
| [010](010-sync-codex-skills-matcher.md) | sync-codex-skills を symlink 経由の編集でも発火させる | P2 | S | — | DONE（PR #75 でマージ済み。全 done criteria pass を reconcile で確認） |
| [011](011-takt-skill-docs-alignment.md) | takt 系スキル docs を takt 0.49.0 の実体に整合 | P1 | M | — | DONE (PR #76) |
| [012](012-ci-local-verification.md) | 検証を scripts/check.sh に一本化、shellcheck 自動検出化 | P2 | M | 007 | DONE（PR #78。レビュー済み・全 done criteria をレビュアーが再実行で確認。shebang 検出 14 本すべて severity=error pass、除外リスト空。Step 4 の ubuntu runner 化は CI 実走で検証） |
| [013](013-readme-refresh.md) | README の構成図・管理表・セットアップ手順を実体に整合 | P2 | S | 007, (012) | DONE（PR #77 でマージ済み。012 未実施時点の実装のため check.sh 行は省略 — 012 マージ後に「よくある操作」へ 1 行追記の余地あり） |
| [014](014-flake-cleanup.md) | flake.nix のコメントドリフトと未使用 tap を掃除 | P3 | S | — | DONE（PR #79 `cac4896` で tap 除去がマージ済み。コメント更新は executor commit `78356ab` branch `chore/flake-cleanup` — PR #79 に包含されたため破棄可。zsh-abbr は genuinely unfree: cc-by-nc-sa-40 / hl3） |
| [015](015-review-lite-workflow.md) | review-lite workflow でレビュー run を約 -70%（spike） | P2 | M | 011 | DONE→廃止（commit `23c3575` で導入後、2026-07-15 に review-lite.yaml を削除し builtin `review-takt-default` に復帰） |
| [016](016-per-host-config.md) | hosts にホスト差分の注入点を作る（spike） | P3 | M | 014 | DONE（PR #80 でマージ済み。両ホスト eval pass、一時差分テストで機構実証済み） |
| [017](017-skill-workflow-contract-check.md) | skill ↔ workflow の契約整合チェックを CI 化 | P3 | M | 011, 012, (015) | DONE→撤去（`24c4240` でマージ後、`dd218c5`「カスタム workflow 資産をグローバル管理から撤去」で contracts チェックと allowlist ごと意図的に削除済み。2026-08-26 再確認） |
| [018](018-cloudflare-plugin-migration.md) | Cloudflare 系 9 スキルを公式プラグインへ移行しローカル削除 | P1 | S | — | DONE（executor commit `5916261`、branch `chore/remove-cloudflare-vendor-skills`、worktree `agent-a5ae63b0dcf9531df`。レビュー済み・done criteria 再実行 pass。マージ後に main checkout で `sync-agent-skills.sh` 再実行 → `~/.agents/skills/` の stale symlink 9 本を掃除すること。次セッションで cloudflare スキルのロード確認） |
| [019](019-cmux-vendor-cleanup.md) | 無効化済み cmux-* 5 スキルを削除し参照を掃除 | P1 | S | 018 | DONE（executor commit `0f6bdcf`、branch `chore/remove-cmux-vendor-skills`、worktree `.claude/worktrees/remove-cmux-vendor-skills`。**018 の未マージブランチに stack** — 018 → 019 の順にマージすること。レビュー済み・done criteria 再実行 pass。実行前にプラン 2 箇所を修正: Step 6 の `sync-agent-skills.sh` を worktree で走らせる指示を削除（`~/.agents/skills` が worktree を指す事故になる）、Step 3 の文言を実在する CLI 面に訂正（`cmux docs` に `markdown` / `diagnostics` トピックは無い）。done criterion の `git ls-files | grep -c 'skills/cmux-' → 0` も誤り（保持する `cmux-workspace` にマッチ）だったため訂正済み） |
| [020](020-sync-overrides-and-prune-user-skills.md) | sync が skillOverrides を尊重 + 自作 2 スキル削除 | P1 | S | 018, 019 | DONE（executor commits `62ca26a` / `4b6338d` / `fe7e25e`、worktree `.claude/worktrees/agent-a163538e616017797`、branch `worktree-agent-a163538e616017797`。main `65627a4` から分岐 — 018/019 はマージ済みなので stack 不要だった。レビュー済み・`bash scripts/check.sh` exit 0、done criteria 再実行 pass。REVISE 1 回: 新テストの off リストが `off-me` だけで `grep -Fxq` の `-x` 欠落を検出できなかったため、off キーに `keep-me` の superstring `keep-me-extra` を追加（`fe7e25e`）。レビュアーが変異テスト（`-Fxq`→`-Fq` の複製）で assert の実効性を実証。main へ `--no-ff` マージ済み（merge `fbbc14f`）。マージ後にメインチェックアウトで実同期を実行し、`~/.agents/skills/` から aqua-improve / release-tweet / empirical-prompt-tuning / evidence-record の 4 本を回収・リンク切れ 0・14 本 link を確認。2 回目実行も skipped 2 件のみで冪等。origin へは未 push） |
| [021](021-takt-062-realignment.md) | takt スキルを 0.62.0 に再整合し references/ へ分割（改訂: 実名・本数列挙は削除しレシピを正とする） | P1 | M | — | DONE（executor commits `5e333e0`（事実の再整合）/ `32775ea`（references/ 分割）、worktree `.claude/worktrees/agent-a703e195ce12ad001`、branch `worktree-agent-a703e195ce12ad001`。main `032028a` から分岐。レビュー済み・`bash scripts/check.sh` exit 0（nix-eval / shellcheck / links / hooks / agent-skills）、done criteria 再実行 pass。SKILL.md 589→441 行、references/ 3 ファイル計 188 行。**REVISE 1 回はプラン側の欠陥**: ≤400 行ゲートはプラン自身の「本文に必ず残すもの」リストと両立せず（残った全セクションが must-stay に載っていた）、レビュアーが ≤450 に校正（同リポジトリの issue 443 行 / issue-direct 442 行と同水準）。executor が即興せず STOP したのは正しい振る舞い。executor の判断 3 件を merit で承認: 落とし穴の `development-core` 実例を「callable な部品名」へ一般化、gotchas ポインタから腐った件数「17 項目」を削除（実際は 21）、`../../cmux-workspace/SKILL.md` へのパス修正。レビュアー検証: gotchas.md は原文と 1 行（上記の一般化）を除き byte 一致、落とし穴 21 項目すべて保持、手作業で再構成したコミット分割も commit1 = 589 行・移動ゼロ・19+/19- の純粋な事実修正であることを確認。cmux 非搭載 fallback の変数展開バグ（呼び出しをまたぐと `$LOG`/`$DONE` が空展開 → sentinel 未作成 → 検知ループが永久待ち）も修正済み。origin へは未 push・main へは未マージ） |
| [022](022-addblockedby-parallel-first.md) | addBlockedBy の既定を並列優先で統一 | P2 | S | — | DONE（executor commit `871a739`、worktree `.claude/worktrees/agent-a581c204b08364ff2`、branch `worktree-agent-a581c204b08364ff2`。main `52e8c98` から分岐。レビュー済み・`bash scripts/check.sh` exit 0、done criteria 再実行 pass（2 ファイル 8+/8-、スコープ逸脱なし）。**実行前レビューでプランを 2 度改訂**: (1) Step 3 の棚卸しが誤り — issue-organize の node ID 取得は addBlockedBy の 2 箇所ではなく addSubIssue を含む 6 箇所で、旧 Step 3 の Verify `grep -c 'node_id' → 0` は達成不能かつ STOP 条件が即発火した。2 行だけ直すとファイル内で 2 流儀に割れるため 6 箇所すべてを `gh issue view --json id` へ統一。(2) Step 3 の3 本目の Verify 期待値 `3` がレビュアーの数え違い（実測 4）— `:33` のテンプレート用リテラル `repository(owner: "OWNER")` は変数ではないため、`grep -n '$OWNER'` へ校正済み。executor はこの不一致を STOP 条件でないと正しく判定し、調査結果を NOTES で報告した。Step 1 の node ID 等価はissue #150 で実測一致（`I_kwDOQRkZBs8AAAABONZ3JQ`）。origin へは未 push・main へは未マージ） |
| [023](023-description-surgery.md) | description を context pointer 規範で書き直す（改訂: eli5 基準・1 分岐 1 トリガー） | P2 | S | — | DONE（executor commit `ab6bdaf`、worktree `.claude/worktrees/agent-ae22c956ffbbce88f`、branch `worktree-agent-ae22c956ffbbce88f`。main `ca2ac0b` から分岐。レビュー済み・`bash scripts/check.sh` exit 0、done criteria 再実行 pass（10 ファイル 27+/34−、diff は全件 frontmatter の `description:` 値に閉じておりスコープ逸脱なし。YAML スタイル `>-` / `|` / `"` も全件保持）。description 合計 3,219 → **2,209 字（−31%）** でゲート ≤2,300 を満たす。**実行前レビューで 2 点補正**: (1) drift check は 5 ファイルにヒットするが全て本文の差分（021 等の成果）で、frontmatter は 10 件とも「Current state」と位置・内容が一致 → STOP させず続行を指示。(2) Step 8 の `wc -m` は環境の `LANG`/`LC_ALL` が空だとバイト計数になり CJK が 3 倍に膨れて 5,499 と出る（≤2,300 が達成不能）→ `LC_ALL=en_US.UTF-8` 付きで計測するよう指示。なおプラン記載の「現状 3,074 字」は `name:` 行を除いた値で、Step 8 のコマンドが実際に出す baseline は 3,219 だった。**レビュアーによる本文突き合わせ**: issue-direct の新文言「CI green + ready for review で完了」は本文（`:13` / `:19` / `:46` / `:410`）と一致し、旧文言「CI green で完了」より正確になっている。**残る観察点 2 件**（いずれもプラン設計の帰結であり executor の逸脱ではない）: takt の description は 「#N を takt で回して」を「投入+実行」と宣言する一方、本文 `:21` は「回すのは `--run` を明示されたときだけ」と限定しており、会話文トリガーだけでフェーズ 5 に入らないか実運用で観察する。cmux の "Cross-workspace cmux control" は、本文が扱う同一ワークスペース内の split / move を含む一般的な topology 制御より狭く名乗っている（後段の境界節が routing を担うため実害は出にくい見込み）。main へ `--no-ff` マージ済み（merge `8da8f73`）。マージ後にメインチェックアウトで再検証: `bash scripts/check.sh` exit 0、`~/.claude/skills` は dotfiles への symlink のため即時反映され、稼働セッションのスキル一覧が新 description に差し替わることを実地確認（`to-issues` 参照は 0 件）。origin へは未 push） |
| [024](024-skill-correctness-fixes.md) | 有効スキルの correctness 修正束（Fix A〜G） | P2 | S | 018, 019 | DONE（executor commits `40a6103`（Fix A+B+C+D）/ `7c0e743`（E）/ `66cf06b`（F）/ `f254cae`（G）＋ REVISE 1 回で `642ac18` / `397ba85`、worktree `.claude/worktrees/agent-ae6331e09879484da`、branch `worktree-agent-ae6331e09879484da`。main `1a587d7` から分岐。レビュー済み・`bash scripts/check.sh` exit 0、done criteria 全件再実行 pass（in-scope 7 ファイルのみ 38+/36−、`plans/` に差分ゼロ、作業ツリー clean）。**実行前レビューでプランの欠陥 3 件を校正**: (1) Fix G の「`grep -c 'chrome-devtools' settings.json` → 0」は誤りで実際は `1`（`permissions.allow:18` の `mcp__chrome-devtools`）— そのままなら STOP 誤発火。(2) Step 5 の置換範囲が前回 reconcile で Current state 側だけ更新され `:293-306` が取り残されていた（正: `:252-265`）— 362 行のファイルでは無関係な段落を指す。(3) Step 5 の Verify `grep -c '${PR_NUM}'` は BSD grep の BRE で `$` がアンカー扱いになり**変更前から 0 を返す**無意味ゲートだった（`grep -cF 'ci_pr${PR_NUM}'` へ。実行前 3 → 実行後 0）。**レビューで検出し REVISE で解消した欠陥 2 件**: (a) Fix A が Step 3 の worktree 安全確認 `:99` で**loud failure を silent failure に変えていた** — `DEFAULT_BRANCH` 未設定時 `"${DEFAULT_BRANCH}..HEAD"` は `HEAD..HEAD` に解決され無出力・exit 0（修正前の `main..HEAD` は exit 128 で叫ぶ）。プラン自身が「最悪の縮退」と名指しした失敗形を、`git worktree remove` という不可逆操作のゲートに作り込んでいた。プランは「最初の使用箇所に注意書き 1 行」しか指示しておらずexecutor の逸脱ではなくプラン設計の欠陥。3 行の解決を全コードブロックへインライン化させ、レビュアーが fenced block 単位で「全使用箇所が同一ブロック内で解決済み」を機械照合（3/3 ok）。(b) Fix G の新文言「there is no `enabledPlugins` key to toggle」が事実誤認 — `enabledPlugins` は 13 エントリで実在し、無いのは chrome-devtools エントリのみ。MCP 診断中に settings.json を開いたエージェントが矛盾に当たる（Fix G が消そうとした欠陥の裏返し）。**残る follow-up**: Fix F で `gh pr checks <PR#> --watch` の明示的許可が落ちた（新文言は manual `gh pr checks <PR#>` のみ）— スキル群が `--watch` を禁止しているため意図的な絞り込みだが、手動で `--watch` を使う場面が出たら確認が挟まる。origin へは未 push・main へは未マージ）
| [025](025-issue-skills-progressive-disclosure.md) | issue / issue-direct を刈ってから開示（改訂: 逐語移動 → prune-then-disclose） | P3 | M | 022, 023 | DONE（executor commits `377cdfe`（issue-direct 削除）/ `138ff12`（issue-direct 開示）/ `9f90b82`（issue 開示）/ `5d0b91a`（宙吊りポインタ解消）、worktree `.claude/worktrees/agent-ac84fb404987ca3a2`、branch `worktree-agent-ac84fb404987ca3a2`。main `63ed431` から分岐。レビュー済み・`bash scripts/check.sh` exit 0、done criteria 再実行 pass。SKILL.md は issue 439→**220 行**、issue-direct 441→**362 行**。新規 references 3 本（body-contract.md 128 / splitting.md 111 / subagent-prompts.md 78）。スコープ逸脱なし（in-scope 5 ファイルのみ、`plans/README.md` は executor 未変更）。**逐語性をレビュアーが機械照合**: 原文 440 行のうち 439 行が移動先または本文に byte 一致で存在し、唯一の不一致は Step 3 が指定した見出し改名（`## フェーズ 4: 本文を生成する（出力契約）` → `## フェーズ 4: 本文を生成する`）のみ。issue-direct 側の消失 14 行も全て削除対象そのもの（When to Use 3 / baseRef 説明 1 / テンプレ導入文 1 / Rules 9）。**実行前レビューでプランを 2 点校正**: (1) 行数ゲート `issue-direct ≤ 300` は達成不能だった — 441 行から移動 2 テンプレート（35+32）・削除（When to Use 5 / Rules 9）・ポインタ +4 を引くと着地は約 362 行で、プラン自身の「残す」リストと両立しない（021 と同型の欠陥）。≤370 に校正し、実測 362 で着地。(2) Rules 保持リストの「frontier からの着手順」はファイル内に `frontier` の語が存在せず、実体はトポロジカルソートの bullet。保持 6 件を逐語列挙して渡したため STOP は発火しなかった。**レビュアーによる本文突き合わせ**: 削除した Rules 9 件のうち 8 件は本文に再掲を確認（`:39`/`:111` の 1スタック=1worktree、`:24` の「親による再読ではない」、1-c の policy 解決、`submit --auto` 2 箇所、`gh stack sync` 4 箇所、ready for review 4 箇所）。baseRef はプラン指定どおり説明のみポインタ化し `git log --oneline main..HEAD` / `git merge main` の実行手順は保持（`:166`）。**レビューで検出し解消した欠陥 1 件**: 初回 executor は最終報告後に 2 行を修正したが commit も報告もしておらず、コミット記録上は欠陥が残っていた — 2-2 の `(進め方は上記「## 進め方」と同じ)` と 3-1 の `(進め方は同じ)`。`## 進め方` が references/ へ移った結果これらの「上記」が宙吊りになり、**段が 1 つの run では tdd ルールへの到達経路が本文から消えていた**（Rules から `tdd` bullet を削除したのは、テンプレート内に同じ規定があることを前提とした判定だったため）。修正は references への明示ポインタ化 + 「親が自分で実装するときも必ず開く — tdd スキルの駆動と seam の決定はそこにある」の明記。初回 executor は resume 不能（transcript 消失）だったため別 executor に commit のみ委任し `5d0b91a` で解消、レビュアーが最終状態で全 done criteria を再実行して pass を確認（作業ツリー clean、`grep -c "進め方は上記\|進め方は同じ"` → 0）。origin へは未 push・main へは未マージ) |
| [026](026-cmux-chrome-cache-pruning.md) | cmux / cmux-workspace / chrome-devtools から環境の再掲を刈る | P3 | S | 019, 024 | DONE（executor commits `3b2599a`（cmux）/ `82e9af6`（cmux-workspace）/ `6c5eaeb`（chrome-devtools）＋ REVISE 1 回で `cec1ea8`、worktree `.claude/worktrees/agent-a19363916a76f2596`、branch `worktree-agent-a19363916a76f2596`。main `6b7b502` から分岐。レビュー済み・`bash scripts/check.sh` exit 0、done criteria 全件再実行 pass（in-scope 3 ファイルのみ 7+/105−、`plans/` と `references/` に差分ゼロ、作業ツリー clean、frontmatter は 3 件とも先頭 5 行の md5 が変更前と一致）。行数 cmux 83→**60**、cmux-workspace 224→**160**、chrome-devtools 88→**77**。cmux-workspace の「残す」8 節は変更前と byte 一致をレビュアーが機械照合。**実行前レビューでプランの欠陥 4 件を校正**: (1) cmux-workspace の行数ゲート `≤130` は達成不能 — 「残す」と判定した節だけで**ちょうど 130 行**（intro 9 + Default Rule 16 + Non-Disruptive Automation 24 + Right-Side Helper Pane 27 + Hierarchy 8 + Contributor Reloads/Socket 28 + References/Rules 18）あり、圧縮 4 節を 0 行にしろという自己矛盾（021 / 025 と同型の欠陥）→ `≤170` に校正し実測 160 で着地。(2) chrome-devtools の `≤70` も達成不能 — 88 − 7 − 4 = 77 が下限 → `≤78` に校正。(3) Step 2 の `grep -c 'reload.sh --tag' → 1` は誤りで現状 2 件、**両方とも保持対象**（`:184` Contributor Reloads のコマンドと `:224` Rules 最終 bullet）— 期待値 1 のままだと保持すべき行を消しにいく動機を作る → 期待値 `2` に訂正。(4) Step 1 の markdown スニペットがフェンス入れ子で壊れていた（内側の ```bash 閉じフェンスが外側を閉じる）。**レビューで検出し REVISE で解消した欠陥 2 件**: (a) `## Sidebar State` を節ごと削除したため、列挙ではない規範「status / progress / log を現ワークスペースに紐付けてサイドバーに反映せよ」が消えていた — `references/commands.md:70-80` はコマンド列挙のみで規範を持たず、本文に残る `sidebar` 3 箇所（`:8` / `:32` / `:80`）は全て定義文のため、この運用方針はどこにも残っていなかった。プランの指示は「`references/commands.md` へ委ねる 1 行に」であり全削除ではない（誘因はレビュアーの事前補正が「Sidebar State を削除」と略記した点にもあるため executor の逸脱としては扱わず）。規範 1 文 + commands.md へのポインタのみ復活させ、`grep -c 'set-progress\|clear-status'` → 0 で列挙が戻っていないことを機械照合。(b) `--id-format both` の圧縮が「on any command」となりフラグ位置を落としていた — 実機確認で`cmux --help` の Usage は `cmux [global-options] <command> [options]` で `--id-format` は global 側、`cmux identify --help` の Flags には載らない。削除された例 `cmux --json --id-format both identify` だけが「サブコマンドより前」という位置を encode しており、commands.md にも cmux/SKILL.md にも位置の記述が無く完全消失していた（プランの STOP condition 3 が言う「表に無い実測知」に該当）。global option である旨と実例を復元。**残る follow-up**: プランの Maintenance notes が許可していた「`cmux/SKILL.md` 末尾の CLI ポインタ行と上部 Settings and Docs の重複を 1 箇所に寄せる」は行数ゲートを 60 ちょうどで満たしたため未実施 — 次に cmux スキルを触るときの候補。main へ `--no-ff` マージ済み（merge `8994f2d`）。マージ後にメインチェックアウトで再検証: `bash scripts/check.sh` exit 0、`~/.claude/skills` は dotfiles への symlink のため即時反映を実地確認（cmux 60 / cmux-workspace 160 / chrome-devtools 77 行）。origin へは未 push） |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)

## Dependency notes（第 2 期）

- **012 ← 007**: 012 の link-manifest drift チェックは 007 適用後の linkDotfiles（`MISSING_SOURCES` 入り）を前提にする。同じファイルを触るためコンフリクト回避の意味でも 007 が先。
- **013 ← 007, (012)**: README は `.wezterm.lua` が配備対象になった状態を文書化する。012 は「よくある操作」への check.sh 追記のためだが、未実施でも 013 は実行可（該当行を省く）。
- **015 ← 011**: 011 が takt 系 docs の誤りを直してから workflow 切替を載せる。逆順だと 011 の修正対象がさらに動く。
- **016 ← 014**: 両方 flake.nix を触る。014 は 2 行の掃除なので先に済ませる。
- **017 ← 011, 012, (015)**: 契約チェックは check.sh 基盤（012）に載り、正しい docs（011）を照合対象にする。015 実施後に allowlist / 対象名が安定するため、可能なら 015 の後。
- **007 / 008 / 009 / 010 / 011 / 014 は互いに独立** — 並列実行可（ファイル素材が重ならない）。

## Dependency notes（第 3 期）

- **019 ← 018、020 ← 018+019、024 ← 018+019**: いずれも `config/.claude/settings.json` の
  同じブロック（skillOverrides / enabledPlugins / autoMode）を編集するためのコンフリクト
  回避順。
  **2026-08-26 reconcile 時点の実態**: 018 / 019 / 020 はいずれも main にマージ済みで、
  `skillOverrides` は **2 キー**（`empirical-prompt-tuning` / `evidence-record`）に落ちている。
  024 は **main から直接分岐してよい**（旧注記にあった「019 のブランチから分岐せよ」は解消済み）。
- **025 ← 022, 023**: 025 は issue / issue-direct の本文を**刈ってから** references/ へ開示する（移す素材は逐語）。
  022（依存姿勢の書き換え）と 023（frontmatter）が先に確定していないと、移動後に同じ内容を
  二度直すことになる。
- **021 / 022 / 023 は互いに独立**（021 と 023 は takt/SKILL.md を共有するが、本文と
  frontmatter で領域が分かれる。同時実行だけ避ける）。
- **026 ← 019, 024**: 同じ 3 ファイル（cmux / cmux-workspace / chrome-devtools）を 019 が
  参照掃除、024 が socket / `--focus` 修正した後の姿を前提に刈る。
- **ユーザー決定の記録（2026-08-26、第 3 期の前提）**:
  - Cloudflare 系はサービス利用が現役のため「削除して終わり」ではなく**公式プラグインで on**
    にする（018 の形）。
  - 自作 off スキルは **aqua-improve / release-tweet を削除**、
    **empirical-prompt-tuning / evidence-record は off のまま保持**（020）。
  - addBlockedBy の既定姿勢は**並列優先**（022）。
  - references/ 分割は **takt / issue / issue-direct の 3 つとも実施**（021, 025）。
  - **スキル執筆の規準を eli5（公式コミュニティの 10 行スキル）と writing-for-agents に置く**
    （同日追加指示）。行が場所を稼ぐのは「モデルが放っておくと間違える失敗を防ぐ」
    （実測知・house rule・安全境界）か「逐語コピーするテンプレート」のときだけ。no-op・
    重複・環境（`--help` / 設定ファイル）の再掲は移動でなく削除。数と実名の列挙はレシピの
    キャッシュなので書かない。description は「先頭に主語 + 1 分岐 1 トリガー + 否定境界」。
    021 / 023 / 025 はこの規準で改訂済み、026 はこの規準による追加プラン。

## Reconcile 記録

### 2026-08-26（commit `e08bf89` 時点）

- **DONE の再検証（第 3 期、現 HEAD で実測）**: 018 `git ls-files | grep -c skills/cloudflare` → 0 /
  019 残存 cmux 系 2 本（`cmux` / `cmux-workspace` のみ）/ 020 `skillOverrides` 2 キー /
  021 takt 436 行（≤450）/ 022 issue-organize の `node_id` 0 件 / 023 description 計 2,198 字（≤2,300）/
  025 issue 220 行・issue-direct 362 行。**いずれも現 HEAD で成立を維持**。
  `bash scripts/check.sh` exit 0（nix-eval / shellcheck / links / hooks / agent-skills）。
- **TODO の refresh**: 024・026 とも drift check がヒットしたが、いずれも**内容ドリフトではなく座標ずれ**。
  finding 自体は現物に残存することを 1 件ずつ実測確認し、`Planned at` を `e08bf89` に更新した。
  REJECTED（他所で解消済み）に落ちた finding は無い。
- **新規 finding 1 件を 024 に統合**: `e08bf89` の chrome-devtools-mcp プラグイン登録削除に
  `troubleshooting/SKILL.md:33-42` が追随しておらず、実在しない `enabledPlugins` キーの設定を
  指示している。新プランを起こさず 024 の **Fix G** として追加（024 は同じ settings.json を
  触る correctness 修正束で、削除の当事者でもあるため）。
- **いま実行可能**: 024（依存 018/019 は解消済み・main から直接分岐可）→ その後 026。

## Findings considered and rejected

（次回の監査が再検出・再調査しないための記録）

- **`Bash(rm *)` の ask ルールが無効という疑い**: 誤り。公式 docs で `Bash(rm *)` と `Bash(rm:*)` は等価、precedence は deny > ask > allow で ask が blanket allow に勝つと確認。設定は意図どおり動作している。
- **`autoMode.allow` の自然文エントリが不正という疑い**: 誤り。autoMode の allow は自然文プロズが正式仕様。
- **`"model": "claude-opus-4-6[1m]"` の `[1m]` サフィックス**: 有効な公式構文（1M コンテキスト指定）。
- **`.config/gh/hosts.yml` の機密漏洩疑い**: トークン非含有を確認。ファイル自体は Plan 005 で除去済み。
- **copy-env.sh / statusline-command.sh / open-browser の不具合疑い**: 精読の結果、意図どおり動作。statusline の `grep` 使用はスクリプト内であり「Claude が rg を使う」規約の対象外。
- **takt-usage-report の naive-datetime 比較パス（249-252 行付近）**: 実 run の `meta.json` の startTime は常に Z 付き ISO であり到達不能と確認（2026-07-09 再監査）。
- **CI の shellcheck が takt-usage-report を対象外にしている件**: 正しい挙動（Python スクリプト）。ただし「shebang 判定でなくハードコード一覧なのはたまたま正しいだけ」問題は Plan 012 が解消。
- **git identity が両ホスト共通な件**: ビルドは壊れないため defect ではなく方針選択。差分を入れたくなったときの受け皿は Plan 016 で整備済み（`hostConfig.gitEmail`）。
- **flake.lock の 6〜7 週間の staleness**（2026-07-09 時点）: unstable チャンネルの個人環境として通常範囲。強制イベントなし、finding にせず。
- **`## 実行スタイル` ボイラープレートの 5 スキル重複**（issue / issue-direct / issue-organize / clean-branch / free-disk-space、2026-08-26 監査）: 各コピーはスキル固有の Step 番号・文脈に特殊化済みでドリフト無し。共通 references 化は「起動ごとのファイルロード追加」と「固有性の喪失」でコスト超過のため**統合しない**。
- **issue / issue-organize の addBlockedBy mutation スニペット重複**（2026-08-26 監査）: スキルの自己完結性のための**意図した重複**として残す（022 で姿勢だけ統一）。スキル間 `../` 参照による共有はリンク切れの温床（019 で掃除した類型）なので採らない。
- **empirical-prompt-tuning / evidence-record の削除提案**: ユーザー決定（2026-08-26）で保持。次回監査は「未使用だから削除」を再提案しないこと。

## Deferred findings（監査で検出したがプラン化しなかったもの）

- **#7 `bun install -g takt@latest` が毎 rebuild で実行**（`nix/packages.nix` の installTakt）: 非再現・要ネットワーク。バージョンピン留めか失敗時の graceful degradation を検討。S 工数。（第 1 期から持ち越し — 条件変化なし）
- **#9 skills-lock.json のフォーク乖離**: `to-issues` 等が upstream（mattpocock/skills）ロックのままローカル大改変済み。同期ポリシーの決定が必要（vendored 宣言 or overlay 化）。（第 1 期から持ち越し）
  - 追記（2026-07-09 再監査）: cloudflare 系 8 スキル（cloudflare / agents-sdk / wrangler / workers-best-practices / durable-objects / sandbox-sdk / cloudflare-email-service / turnstile-spin）は lock 自体に未登録。lock が mattpocock インストーラ専用スコープの可能性が高く（LOW confidence）、#9 の同期ポリシー決定時に併せて扱う。
  - 追記（2026-08-26）: cloudflare 系の同期ポリシーは **Plan 018 で決着**（公式プラグイン管理へ移行、ローカル削除）。lock ファイル自体の扱いだけが残件。
- **skills-lock.json が linkDotfiles で配備されない**: repo に tracked だが `~/.claude/` に届かない。消費するツールの実行場所を確認の上、#9 のポリシー決定と同時に配備要否を判断。
- **worktree 新規スキルの codex 同期タイミング問題**: matcher 修正（Plan 010）では解決しない構造的事項。対策候補は activation での同期実行。詳細は Plan 010 の Maintenance notes。
- **shellcheck warning 級の指摘**: error 級ゲート運用は維持（Plan 012 でも変えない）。warning 対応は CI 強化の次段。
- **takt builtin allowlist の鮮度**: `scripts/takt-builtin-workflows.txt` が takt 0.49.0 時点の生成で、現在の takt builtins と差分あり（`*-for-local-llm` 系 7 件削除、`*-with-fc` 系 2 件追加）。`check.sh contracts` は warning 表示のみで exit 0 だが、次回 takt バージョンアップ時に再生成が必要。S 工数。
- **worktree 規約の三重記述**（config/.claude/CLAUDE.md ↔ issue-direct/SKILL.md ↔ clean-branch/SKILL.md:86、2026-08-26 監査）: issue-direct 側は **Plan 025 でポインタ化済み**（`:166`。説明のみ CLAUDE.md 参照に置換し `git log --oneline main..HEAD` / `git merge main` の手順は保持）。残るのは clean-branch:86 の 1 箇所のみ（3 行・無害・ドリフト無し）— 次に clean-branch を編集するついでにポインタ化すれば足りる。
- **`troubleshooting` スキルの汎用名**（2026-08-26 監査）: 実体は chrome-devtools MCP 専用。description が十分限定的で誤発動の実害が無いため改名は見送り。改名するなら `chrome-devtools-troubleshooting` + `chrome-devtools/SKILL.md:18,84` の 2 参照更新（Plan 023 の Maintenance notes にも記載）。
- **argument-hint の導入**（2026-08-26 監査）: フラグ提示の本命だが SKILL.md frontmatter でのサポート未確認。1 スキルで実地確認してから nix / clean-branch / free-disk-space / issue / takt へ展開（Plan 023 の Maintenance notes 参照）。
- **aqua-improve の再起動スパイク**（2026-08-26 監査、direction finding）: ユーザー決定で削除（Plan 020）となったため消滅。実行時データ `~/.claude/aqua-improve/` は残置。
- **解消済み**: 第 1 期 deferred #8（`credential.helper = "store"`）は現行コードに存在しない（第 1 期の実装作業の過程で除去された。2026-07-09 再監査で確認）。
- **解消済み（2026-08-26）**: 第 2 期 deferred「takt builtin allowlist の鮮度」— allowlist と contracts チェック自体が `dd218c5` で意図的に撤去されており、追跡対象が消滅。takt スキル本文の鮮度は Plan 021 が扱う。
