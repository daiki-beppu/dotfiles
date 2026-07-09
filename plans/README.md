# Implementation Plans

improve スキルによる監査（2026-07-09、commit `3dbd88e` 時点）から生成。
下表の順に実行すること（依存関係が許す限り並べ替え可）。各 executor は plan を全文読み、
STOP conditions を尊重し、完了時に自分の行の Status を更新する。

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [001](001-ci-verification-baseline.md) | CI（flake 評価 + shellcheck）の検証基盤を確立 | P1 | M | — | DONE (commit `da68e14`, main にマージ済み・未 push) |
| [002](002-multi-host-flake.md) | flake をマルチホスト化しハードコード排除 | P1 | M | 001 | TODO |
| [003](003-takt-skill-contract-fixes.md) | takt 系スキルの契約矛盾 3 件＋未定義状態を解消 | P1 | S | — | DONE（`eaeb7ff` で refresh 後に実行。worktree `agent-a95f59669759fa6cc` の branch `fix/takt-skill-contracts`、commit `5da9385`。マージは未実施） |
| [004](004-declare-shell-dependencies.md) | .zshrc の未宣言依存を宣言、stale な proto 手順を除去 | P2 | S | 002 | TODO |
| [005](005-public-repo-cleanup.md) | 公開リポジトリから事故コミットを除去 | P2 | S | 003 | DONE（worktree `agent-a636d48b64fb1a7e8` の branch `chore/public-repo-cleanup`、commit `9e441c1`。マージは未実施） |
| [006](006-fix-hooks-registration.md) | 死んだ hook の登録と reject hook の出力契約修正 | P2 | S | 002 | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED (with one-line rationale)

## Dependency notes

- **002 ← 001**: 002 は flake の構造リファクタ。001 の CI（flake 評価ゲート）が安全網として先にあるべき。
- **004 ← 002 / 006 ← 002**: 004 は `nix/packages.nix`、006 は `config/.claude/settings.json` を触る。002 が同じファイルを大きく変えるため、コンフリクト回避で 002 を先に。内容上の依存は薄いので、002 が長期 BLOCKED になった場合は 004/006 を先行させてよい（その場合 002 の drift check が発火するので 002 側で吸収）。
- **005 ← 003**: 003 が `.takt/runs/.../reports/architect-review.md` をファイル名修正の物証として参照する。005 はそれを追跡解除するため後。
- **003 は完全に独立** — 最初に実行しても良い。

## Findings considered and rejected

（次回の監査が再検出・再調査しないための記録）

- **`Bash(rm *)` の ask ルールが無効という疑い**: 誤り。公式 docs で `Bash(rm *)` と `Bash(rm:*)` は等価、precedence は deny > ask > allow で ask が blanket allow に勝つと確認。設定は意図どおり動作している。
- **`autoMode.allow` の自然文エントリが不正という疑い**: 誤り。autoMode の allow は自然文プロズが正式仕様。
- **`"model": "claude-opus-4-6[1m]"` の `[1m]` サフィックス**: 有効な公式構文（1M コンテキスト指定）。
- **`.config/gh/hosts.yml` の機密漏洩疑い**: トークン非含有を確認（キーは git_protocol / user / users のみ）。ファイル自体は迷子コミットとして Plan 005 で除去。
- **copy-env.sh / statusline-command.sh / open-browser の不具合疑い**: 精読の結果、意図どおり動作。statusline の `grep` 使用はスクリプト内であり「Claude が rg を使う」規約の対象外。

## Deferred findings（監査で検出したが今回プラン化しなかったもの）

- **#7 `bun install -g takt@latest` が毎 rebuild で実行**（`nix/packages.nix:148-151`）: 非再現・要ネットワーク。バージョンピン留めか失敗時の graceful degradation を検討。S 工数。
- **#8 `credential.helper = "store"`**（`nix/packages.nix:52`）: GitHub 以外のホストで平文 `~/.git-credentials` に保存される。macOS 標準の `osxkeychain` への置換を検討。S 工数。
- **#9 skills-lock.json のフォーク乖離**: `to-issues` 等が upstream（mattpocock/skills）ロックのままローカル大改変済み。upstream 再同期でローカル変更が消えるリスク。同期ポリシーの決定が必要（vendored 宣言 or overlay 化）。
- **shellcheck warning 級の指摘**（2 ファイル）: Plan 001 は error 級ゲートで開始。warning 対応は CI 強化時に。
- **スキル整合性チェックの CI 化**: Plan 001/003 の Maintenance notes 参照。takt 系スキルの churn（takt-issue だけで 29 commit）に対する恒久対策。
