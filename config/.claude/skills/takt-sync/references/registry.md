# takt 資産レジストリ

カスタム workflow 資産の所在一覧。調査フェーズの棚卸しはここから始める。
プロジェクトの増減を見つけたら(SKILL.md の find コマンド)、この表を更新すること。

## 資産一覧(2026-07-31 時点)

| リポジトリ | 資産 | 備考 |
|-----------|------|------|
| `~/01-dev/dotfiles` | `config/.takt/config.yaml` のみ | グローバル設定。`~/.takt/config.yaml` に symlink(packages.nix)。provider_routing で全ペルソナを Codex に割当 |
| `~/01-dev/projects/youtube-automation` | `workflows/lite.yaml`、facets(instructions/policies/output-contracts 各 1)、`schemas/review-verdict.json`、`config.yaml` | 開発用 lite workflow |
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

- youtube-automation の `lite.yaml` は v0.53.0 時点で既に doctor エラー:
  `steps.2.rules.0.condition: Invalid input: expected string, received undefined`
  (2026-07-31 確認)。修正されたらこの記載を消すこと
