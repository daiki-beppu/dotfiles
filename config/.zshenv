# Home Manager のセッション変数（NH_FLAKE 等）
# .zshrc は手動リンク管理のため HM は自動で source を挿入できない
[ -f "/etc/profiles/per-user/$USER/etc/profile.d/hm-session-vars.sh" ] && \
  . "/etc/profiles/per-user/$USER/etc/profile.d/hm-session-vars.sh"

# Vite+ bin (https://viteplus.dev)
[ -f "$HOME/.vite-plus/env" ] && . "$HOME/.vite-plus/env"

# Bun global packages (bun add -g <pkg>)
export PATH="$HOME/.bun/bin:$PATH"
