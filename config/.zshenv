# Home Manager のセッション変数（NH_FLAKE 等）
# .zshrc は手動リンク管理のため HM は自動で source を挿入できない
[ -f "/etc/profiles/per-user/$USER/etc/profile.d/hm-session-vars.sh" ] && \
  . "/etc/profiles/per-user/$USER/etc/profile.d/hm-session-vars.sh"

# takt の Claude を、自動更新される claude CLI で動かす。未設定だと takt 0.68 以降は
# claude-agent-sdk 同梱の古い Claude Code（0.3.261 同梱は 2.1.261）を使い、
# sonnet / opus の別名が一世代前のモデル（Sonnet 5 / Opus 5）に解決される。
# config.yaml の claude_cli_path は絶対パス必須で、ホストごとにユーザー名が違うためここで渡す
[ -x "$HOME/.local/bin/claude" ] && export TAKT_CLAUDE_CLI_PATH="$HOME/.local/bin/claude"

# Vite+ bin (https://viteplus.dev)
[ -f "$HOME/.vite-plus/env" ] && . "$HOME/.vite-plus/env"

# Bun global packages (bun add -g <pkg>)
export PATH="$HOME/.bun/bin:$PATH"

# `=cmd` をコマンドのパスに展開しない。既定では引用符の無い `echo ==== 見出し` が
# `== not found` で落ちる（エージェントの Bash は .zshrc を読まない非対話シェルなのでここで設定する）。
# `=(cmd)` のプロセス置換は EQUALS と無関係なので、このまま使える
setopt noequals
