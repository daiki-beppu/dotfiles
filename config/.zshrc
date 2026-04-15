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
# op read はコストが高いため、npm 系コマンド初回実行時にのみ取得する
_ensure_npm_token() {
  if [[ -z "$NPM_TOKEN" ]]; then
    export NPM_TOKEN="$(op read "op://Personal/npm token/credential")"
  fi
}

for _cmd in ni nr nlx nu nun nci npm npx bun bunx; do
  eval "
    ${_cmd}() {
      _ensure_npm_token
      command ${_cmd} \"\$@\"
    }
  "
done
unset _cmd

# ターミナルからの URL オープン時の振り分け（認証系 → Chrome、その他 → cmux）
export BROWSER="$HOME/.local/bin/open-browser"

# Vite+ bin (https://viteplus.dev)
. "$HOME/.vite-plus/env"
export PATH="$HOME/.local/bin:$PATH"
