# PATH configuration
export PATH=$HOME/bin:$HOME/.local/bin:/usr/local/bin:$PATH

# Oh My Zsh installation
export ZSH="$HOME/.oh-my-zsh"

# Theme
ZSH_THEME="eastwood"

# Plugins
plugins=(git)

source $ZSH/oh-my-zsh.sh

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
