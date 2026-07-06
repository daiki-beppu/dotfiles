# PATH configuration
export PATH=$HOME/bin:$HOME/.local/bin:/usr/local/bin:$PATH

# Oh My Zsh installation
export ZSH="$HOME/.oh-my-zsh"

# Theme
ZSH_THEME="eastwood"

# Plugins
plugins=(git)

source $ZSH/oh-my-zsh.sh

# zsh-abbr
source /opt/homebrew/share/zsh-abbr/zsh-abbr.zsh

# abbr: パイプや && の後でも展開可能にする
ABBR_REGULAR_ABBREVIATION_GLOB_PREFIXES+=(
  '*& '
  '*&& '
  '*| '
  '*|| '
  '*; '
)

# WezTerm タブタイトルの自動設定
precmd() {
  # カレントディレクトリを取得（ホームディレクトリは~に短縮）
  local dir="${PWD/#$HOME/~}"

  # gitブランチ名を取得
  local branch=$(git symbolic-ref --short HEAD 2>/dev/null)

  # タイトルを設定
  if [[ -n "$branch" ]]; then
    print -Pn "\e]2;[${branch}][${dir}]\a"
  else
    print -Pn "\e]2;[${dir}]\a"
  fi
}

# NPM_TOKEN lazy loading (1Password CLI)
# publish 時のみ 1Password から取得する。install 等の通常操作ではトークン不要。
_ensure_npm_token() {
  [[ -n "$NPM_TOKEN" ]] && return 0
  if ! command -v op >/dev/null 2>&1; then
    print -u2 "error: op (1Password CLI) が見つかりません"
    return 1
  fi
  local token
  if ! token=$(op read "op://Personal/npm token/credential" 2>/dev/null); then
    print -u2 "error: 1Password から npm token を取得できません。"
    print -u2 "  1Password アプリを起動・アンロックしてください"
    return 1
  fi
  export NPM_TOKEN="$token"
}

npm-publish() {
  _ensure_npm_token || return $?
  command npm publish "$@"
}

# ターミナルからの URL オープン時の振り分け（認証系 → Chrome、その他 → cmux）
export BROWSER="$HOME/.local/bin/open-browser"

# Vite+ bin (https://viteplus.dev)
[ -f "$HOME/.vite-plus/env" ] && . "$HOME/.vite-plus/env"
export PATH="$HOME/.local/bin:$PATH"

# direnv hook
eval "$(direnv hook zsh)"
