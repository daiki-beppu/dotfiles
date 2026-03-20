
eval "$(/opt/homebrew/bin/brew shellenv)"

# npm auth token (1Password から取得、ログインシェルでのみ実行)
if [[ -z "$NPM_TOKEN" ]]; then
  export NPM_TOKEN="$(op read "op://Personal/npm token/credential" 2>/dev/null)"
fi

# Nix のパスを Homebrew より優先させる
if [ -d "/etc/profiles/per-user/$USER/bin" ]; then
  export PATH="/etc/profiles/per-user/$USER/bin:$PATH"
fi
