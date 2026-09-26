# dotfiles プロジェクト

## プロジェクト概要

Nix + Home Manager ベースの dotfiles 管理リポジトリ。

- `config/` 配下にドットファイルの実体を配置
- `~/.dotfiles` → このリポジトリへのシンボリックリンク
- Nix flake でパッケージ管理、darwin-rebuild で適用

## エージェント設定の管理

共有スキルの正本は `config/.agents/skills/`。
`~/.agents/skills/`（Codex）と `~/.claude/skills/`（Claude Code）は、
Nix の activation でこのディレクトリ全体へリンクする。スキル追加・削除時の同期は不要。
有効・無効は各エージェントの設定で管理する。

エージェント向け指示は AGENTS.md に統一し、CLAUDE.md は置かない
（Claude Code は CLAUDE.md が無ければ AGENTS.md を読む）。
グローバル指示の正本は `config/.agents/AGENTS.md`。
Claude Code は user-level の AGENTS.md を読まないため、
`~/.claude/CLAUDE.md` と `~/.codex/AGENTS.md` はどちらもこの正本への symlink にする。

`~/.claude/` の `settings.json` / `hooks/` / `statusline-command.sh` は
`config/.claude/` 内の実体への symlink。それ以外の実行時データは Claude Code が管理する。

スキルとグローバル指示は `config/.agents/`、設定は `config/.claude/` 側で編集する。
ホーム側の symlink を実ファイルに置き換えない。
外部 installer のスキルは共通ディレクトリで保持し、ローカルの Git exclude で追跡対象から外す。

Codex Cloud で公開するサブセットは `config/codex-cloud/skills.txt` を正とし、
`scripts/sync-agent-skills.sh --manifest` で対象のみリンクする。
