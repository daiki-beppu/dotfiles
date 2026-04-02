
eval "$(/opt/homebrew/bin/brew shellenv)"

# Nix のパスを Homebrew より優先させる
if [ -d "/etc/profiles/per-user/$USER/bin" ]; then
  export PATH="/etc/profiles/per-user/$USER/bin:$PATH"
fi
