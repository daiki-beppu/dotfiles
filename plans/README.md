# Implementation Plans

improve スキルによる監査から生成。第 1 期（001〜006）は 2026-07-09 の初回監査（commit `3dbd88e` 時点）、
第 2 期（007〜017）は同日の再監査（commit `e0a2d44` 時点）による。
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
| [007](007-link-force-hardening-wezterm.md) | linkDotfiles を堅牢化し .wezterm.lua を Nix 配備 | P1 | S | — | DONE (worktree `worktree-agent-aeb82451035d62fd2` / commit `c8a4891`、未マージ) |
| [008](008-zsh-guard-and-dedup.md) | .zshenv/.zshrc の無ガード source と重複を解消 | P1 | S | — | TODO |
| [009](009-reject-hooks-quoted-strings.md) | reject hooks の引用文字列への誤発動を解消 | P1 | S | — | TODO |
| [010](010-sync-codex-skills-matcher.md) | sync-codex-skills を symlink 経由の編集でも発火させる | P2 | S | — | TODO |
| [011](011-takt-skill-docs-alignment.md) | takt 系スキル docs を takt 0.49.0 の実体に整合 | P1 | M | — | TODO |
| [012](012-ci-local-verification.md) | 検証を scripts/check.sh に一本化、shellcheck 自動検出化 | P2 | M | 007 | TODO |
| [013](013-readme-refresh.md) | README の構成図・管理表・セットアップ手順を実体に整合 | P2 | S | 007, (012) | TODO |
| [014](014-flake-cleanup.md) | flake.nix のコメントドリフトと未使用 tap を掃除 | P3 | S | — | TODO |
| [015](015-review-lite-workflow.md) | review-lite workflow でレビュー run を約 -70%（spike） | P2 | M | 011 | TODO |
| [016](016-per-host-config.md) | hosts にホスト差分の注入点を作る（spike） | P3 | M | 014 | TODO |
| [017](017-skill-workflow-contract-check.md) | skill ↔ workflow の契約整合チェックを CI 化 | P3 | M | 011, 012, (015) | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)

## Dependency notes（第 2 期）

- **012 ← 007**: 012 の link-manifest drift チェックは 007 適用後の linkDotfiles（`MISSING_SOURCES` 入り）を前提にする。同じファイルを触るためコンフリクト回避の意味でも 007 が先。
- **013 ← 007, (012)**: README は `.wezterm.lua` が配備対象になった状態を文書化する。012 は「よくある操作」への check.sh 追記のためだが、未実施でも 013 は実行可（該当行を省く）。
- **015 ← 011**: 011 が takt 系 docs の誤りを直してから workflow 切替を載せる。逆順だと 011 の修正対象がさらに動く。
- **016 ← 014**: 両方 flake.nix を触る。014 は 2 行の掃除なので先に済ませる。
- **017 ← 011, 012, (015)**: 契約チェックは check.sh 基盤（012）に載り、正しい docs（011）を照合対象にする。015 実施後に allowlist / 対象名が安定するため、可能なら 015 の後。
- **007 / 008 / 009 / 010 / 011 / 014 は互いに独立** — 並列実行可（ファイル素材が重ならない）。

## Findings considered and rejected

（次回の監査が再検出・再調査しないための記録）

- **`Bash(rm *)` の ask ルールが無効という疑い**: 誤り。公式 docs で `Bash(rm *)` と `Bash(rm:*)` は等価、precedence は deny > ask > allow で ask が blanket allow に勝つと確認。設定は意図どおり動作している。
- **`autoMode.allow` の自然文エントリが不正という疑い**: 誤り。autoMode の allow は自然文プロズが正式仕様。
- **`"model": "claude-opus-4-6[1m]"` の `[1m]` サフィックス**: 有効な公式構文（1M コンテキスト指定）。
- **`.config/gh/hosts.yml` の機密漏洩疑い**: トークン非含有を確認。ファイル自体は Plan 005 で除去済み。
- **copy-env.sh / statusline-command.sh / open-browser の不具合疑い**: 精読の結果、意図どおり動作。statusline の `grep` 使用はスクリプト内であり「Claude が rg を使う」規約の対象外。
- **takt-usage-report の naive-datetime 比較パス（249-252 行付近）**: 実 run の `meta.json` の startTime は常に Z 付き ISO であり到達不能と確認（2026-07-09 再監査）。
- **CI の shellcheck が takt-usage-report を対象外にしている件**: 正しい挙動（Python スクリプト）。ただし「shebang 判定でなくハードコード一覧なのはたまたま正しいだけ」問題は Plan 012 が解消。
- **git identity が両ホスト共通な件**: ビルドは壊れないため defect ではなく方針選択。差分を入れたくなったときの受け皿は Plan 016。
- **flake.lock の 6〜7 週間の staleness**（2026-07-09 時点）: unstable チャンネルの個人環境として通常範囲。強制イベントなし、finding にせず。

## Deferred findings（監査で検出したがプラン化しなかったもの）

- **#7 `bun install -g takt@latest` が毎 rebuild で実行**（`nix/packages.nix` の installTakt）: 非再現・要ネットワーク。バージョンピン留めか失敗時の graceful degradation を検討。S 工数。（第 1 期から持ち越し — 条件変化なし）
- **#9 skills-lock.json のフォーク乖離**: `to-issues` 等が upstream（mattpocock/skills）ロックのままローカル大改変済み。同期ポリシーの決定が必要（vendored 宣言 or overlay 化）。（第 1 期から持ち越し）
  - 追記（2026-07-09 再監査）: cloudflare 系 8 スキル（cloudflare / agents-sdk / wrangler / workers-best-practices / durable-objects / sandbox-sdk / cloudflare-email-service / turnstile-spin）は lock 自体に未登録。lock が mattpocock インストーラ専用スコープの可能性が高く（LOW confidence）、#9 の同期ポリシー決定時に併せて扱う。
- **skills-lock.json が linkDotfiles で配備されない**: repo に tracked だが `~/.claude/` に届かない。消費するツールの実行場所を確認の上、#9 のポリシー決定と同時に配備要否を判断。
- **worktree 新規スキルの codex 同期タイミング問題**: matcher 修正（Plan 010）では解決しない構造的事項。対策候補は activation での同期実行。詳細は Plan 010 の Maintenance notes。
- **shellcheck warning 級の指摘**: error 級ゲート運用は維持（Plan 012 でも変えない）。warning 対応は CI 強化の次段。
- **解消済み**: 第 1 期 deferred #8（`credential.helper = "store"`）は現行コードに存在しない（第 1 期の実装作業の過程で除去された。2026-07-09 再監査で確認）。
