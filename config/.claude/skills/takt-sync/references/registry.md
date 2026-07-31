# takt 資産レジストリ

カスタム workflow 資産の所在一覧。調査フェーズの棚卸しはここから始める。
プロジェクトの増減を見つけたら(SKILL.md の find コマンド)、この表を更新すること。

## 資産一覧(2026-07-31 時点)

| リポジトリ | 資産 | 備考 |
|-----------|------|------|
| `~/01-dev/dotfiles` | `config/.takt/config.yaml`、`.takt/config.yaml` | 前者はグローバル設定(`~/.takt/config.yaml` に symlink、packages.nix)。provider_routing で全ペルソナを Codex に割当。後者は dotfiles リポジトリ固有のオーバーライド(draft_pr 等) |
| `~/02-yt/00-automation`(= `~/01-dev/projects/youtube-automation` と同一リポジトリの別チェックアウト。主働は 02-yt 側) | `workflows/` 8 本(yt-auto-feature / fix / docs / maintenance / audit + callable の intake / impl-review + audit-unit-split)、facets(instructions / output-contracts / policies / partials)、`config.yaml` | 旧 lite.yaml は廃止され yt-auto-* 群へ置換(#2686 / #2690)。0.54.1 対応済み(skills.repo 復元・fix-report・session compact・final-gate tags・use-relevant-skills partial)。`takt:*` ラベルは不使用・履歴メタデータ扱い(docs/takt-operations.md)。takt run が資産を書き換え続ける活発な repo なので、調査結果は適用直前に必ず取り直す |
| `~/02-yt/tayk` | `workflows/` 6 本(tayk-feature / fix / intake / impl-review / audit-architecture / audit-runs)、facets、`schemas/`、`quality-gates/`、`config.yaml` | yt-auto-* の元になった ADR-0008 系 workflow 群 |
| `~/01-dev/projects/libecity` | `workflows/article-rewrite.yaml` `workflows/knowhow-article.yaml`、facets 多数(記事執筆・レビュー系)、loop-monitor instructions | 記事執筆 workflow。コーディング系ではないため BREAKING の該当パターンが他と異なることに注意 |
| `~/01-dev/projects/specv` | `config.yaml` のみ | プロジェクト固有オーバーライド(draft_pr 等)。責任分担は specv の `.claude/CLAUDE.md` の `# takt` セクション参照 |
| `~/01-dev/takt` | `config.yaml`(workflow_overrides・quality_gates)、`quality-gates/takt-check.sh` | takt 自体の fork(daiki-beppu/takt)。takt 開発用の設定なので upstream の変更に最も敏感 |

takt 本体のピンは dotfiles の `flake.nix`(`takt.url = "github:nrslib/takt/vX.Y.Z"`)。
`.takt/` 配下でも `tasks/` `runs/` `clone-meta/` `worktree-sessions/` `session-state.json`
`persona_sessions.json` は実行時状態であり、移行対象の資産ではない。
資産に数えるのは `config.yaml` `workflows/` `facets/` `schemas/` `quality-gates/`。

## 移行事例

判断に迷ったときの参照先。パターンを揃えることで config が方言化するのを防ぐ。

### v0.52(2026-07-21、コミット 92f5188)

- `persona_providers`(deprecated)→ `provider_routing.personas` へ移行。
  deprecated の後継機能は「新機能の採用」ではなく「必須の移行」として扱った例
- `auto_requeue_max_attempts: 2` を追加。新機能だが運用上の利益が明確だったため
  ユーザー合意の上で採用した例

### v0.53.0(2026-07-27、PR #118)

- BREAKING 4 件(for-local-llm 削除・MCP ツール削減・Node >= 24.15.0・auto_routing 再設計)
  すべて「ローカル環境に該当なし」でトリアージ完了、config 変更ゼロ。
  該当なしでも commit message に結論を記録した例

### v0.54.1(2026-07-31)

- BREAKING ゼロ(0.54.0 は simple family 追加、0.54.1 は Codex auto-routing 修正のみ)。
  config 移行なし、全プロジェクトの doctor 新規エラーゼロで完了
- 「既定値の反転」型の追随例: 0.53 #1081 で workflow の Codex Skill 継承が既定 off に
  なっていたのを、02-yt/00-automation で `provider_options.codex.skills.repo: true` により復元。
  doctor はエラーにしない無音の挙動変化なので、CHANGELOG の「defaults now …」文言に注意
- 新機能の採用(fix-report 契約 / session compact / final-gate tags / use-relevant-skills
  partial)は 02-yt/00-automation のみ。他リポジトリへの横展開はここからは行わない —
  各リポジトリで個別に判断・適用する方針(2026-07-31 ユーザー決定)。takt-sync の責務は
  バージョン追随(BREAKING 対応 + doctor 検証)までで、新機能採用は各リポジトリの作業

## 既知の問題(更新起因と混同しないこと)

- 現在なし(2026-07-31 時点。lite.yaml の doctor エラーは yt-auto-* 群への置換 #2686 で
  lite.yaml ごと削除され解消)。更新前ベースラインで見つけた既存エラーはここに記録すること
