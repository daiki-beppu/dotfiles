# takt 資産レジストリ

カスタム workflow 資産の所在一覧。調査フェーズの棚卸しはここから始める。
プロジェクトの増減を見つけたら(SKILL.md の find コマンド)、この表を更新すること。

## 資産一覧(2026-07-31 時点)

| リポジトリ | 資産 | 備考 |
|-----------|------|------|
| `~/01-dev/dotfiles` | `config/.takt/config.yaml` のみ | グローバル設定。`~/.takt/config.yaml` に symlink(packages.nix)。provider_routing で全ペルソナを Codex に割当 |
| `~/01-dev/projects/youtube-automation` | `workflows/` 8 本(yt-auto ファミリー + audit-unit-split)、facets 60 個超(instructions/knowledge/output-contracts/personas/policies)、`schemas/yt-auto-audit-supervise.json`、`config.yaml` | issue #2686 で全面再構築(旧 lite workflow は廃止済み)。`takt:*` ラベルは不使用・履歴メタデータ扱い(docs/takt-operations.md)。takt run が資産を書き換え続ける活発な repo なので、調査結果は適用直前に必ず取り直す |
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

## 既知の問題(更新起因と混同しないこと)

- 現在なし(2026-07-31 時点。youtube-automation 全 8 workflow・libecity 全 2 workflow が
  v0.54.1 の doctor OK)。更新前ベースラインで見つけた既存エラーはここに記録すること
