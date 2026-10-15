# Home Manager のセッション変数（NH_FLAKE 等）
# .zshrc は手動リンク管理のため HM は自動で source を挿入できない
[ -f "/etc/profiles/per-user/$USER/etc/profile.d/hm-session-vars.sh" ] && \
  . "/etc/profiles/per-user/$USER/etc/profile.d/hm-session-vars.sh"

# Vite+ bin (https://viteplus.dev)
[ -f "$HOME/.vite-plus/env" ] && . "$HOME/.vite-plus/env"

# Bun global packages (bun add -g <pkg>)
export PATH="$HOME/.bun/bin:$PATH"

# `=cmd` をコマンドのパスに展開しない。既定では引用符の無い `echo ==== 見出し` が
# `== not found` で落ちる（エージェントの Bash は .zshrc を読まない非対話シェルなのでここで設定する）。
# `=(cmd)` のプロセス置換は EQUALS と無関係なので、このまま使える
setopt noequals
