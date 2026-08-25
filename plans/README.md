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
| [021](021-takt-062-realignment.md) | takt スキルを 0.62.0 に再整合し references/ へ分割（改訂: 実名・本数列挙は削除しレシピを正とする） | P1 | M | — | TODO |
| [022](022-addblockedby-parallel-first.md) | addBlockedBy の既定を並列優先で統一 | P2 | S | — | TODO |
| [023](023-description-surgery.md) | description を context pointer 規範で書き直す（改訂: eli5 基準・1 分岐 1 トリガー） | P2 | S | — | TODO |
| [024](024-skill-correctness-fixes.md) | 有効スキルの correctness 修正束 | P2 | S | 018, 019 | TODO |
| [025](025-issue-skills-progressive-disclosure.md) | issue / issue-direct を刈ってから開示（改訂: 逐語移動 → prune-then-disclose） | P3 | M | 022, 023 | TODO |
| [026](026-cmux-chrome-cache-pruning.md) | cmux / cmux-workspace / chrome-devtools から環境の再掲を刈る | P3 | S | 019, 024 | TODO |

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
  **2026-08-26 時点の実態**: 018 も 019 も main に未マージで、019 は 018 のブランチに
  stack されている（`main` → `chore/remove-cloudflare-vendor-skills`(018) →
  `chore/remove-cmux-vendor-skills`(019)）。020 / 024 を実行するときも main ではなく
  019 のブランチから分岐すること（main の `skillOverrides` は 18 キーのままなので、
  main から切ると両プランの前提が崩れて即 STOP になる）。020 は内容上も「off スキルが 2 個に減ってから除外ロジックを入れる」方が検証が単純。
- **025 ← 022, 023**: 025 は issue / issue-direct の本文を references/ へ**逐語移動**する。
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
- **worktree 規約の三重記述**（config/.claude/CLAUDE.md ↔ issue-direct/SKILL.md:172 ↔ clean-branch/SKILL.md:86、2026-08-26 監査）: issue-direct 側は **Plan 025（改訂版）がポインタ化を実施**。残るのは clean-branch:86 の 1 箇所のみ（3 行・無害・ドリフト無し）— 次に clean-branch を編集するついでにポインタ化すれば足りる。
- **`troubleshooting` スキルの汎用名**（2026-08-26 監査）: 実体は chrome-devtools MCP 専用。description が十分限定的で誤発動の実害が無いため改名は見送り。改名するなら `chrome-devtools-troubleshooting` + `chrome-devtools/SKILL.md:18,84` の 2 参照更新（Plan 023 の Maintenance notes にも記載）。
- **argument-hint の導入**（2026-08-26 監査）: フラグ提示の本命だが SKILL.md frontmatter でのサポート未確認。1 スキルで実地確認してから nix / clean-branch / free-disk-space / issue / takt へ展開（Plan 023 の Maintenance notes 参照）。
- **aqua-improve の再起動スパイク**（2026-08-26 監査、direction finding）: ユーザー決定で削除（Plan 020）となったため消滅。実行時データ `~/.claude/aqua-improve/` は残置。
- **解消済み**: 第 1 期 deferred #8（`credential.helper = "store"`）は現行コードに存在しない（第 1 期の実装作業の過程で除去された。2026-07-09 再監査で確認）。
- **解消済み（2026-08-26）**: 第 2 期 deferred「takt builtin allowlist の鮮度」— allowlist と contracts チェック自体が `dd218c5` で意図的に撤去されており、追跡対象が消滅。takt スキル本文の鮮度は Plan 021 が扱う。
