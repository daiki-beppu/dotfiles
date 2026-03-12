{ pkgs, lib, ... }:

let
  dotfilesDir = "/Users/mba/01-dev/dotfiles/config";
in
{
  home.stateVersion = "24.11";

  home.packages = with pkgs; [
    xz
    cocoapods
    ffmpeg
    gh
    git
    gzip
    tree
    unzip
    uv
    watchman
  ];

  # ── シンボリンク管理 ──
  # ryoppippi 方式: home.file (Nix store 経由) ではなく
  # home.activation で dotfiles リポジトリへ直接リンクする
  # これにより全ファイルが直接編集可能な状態を保てる
  home.activation.linkDotfiles = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    link_force() {
      local src="$1"
      local dst="$2"
      if [ ! -L "$dst" ] || [ "$(readlink "$dst")" != "$src" ]; then
        rm -rf "$dst"
        ln -sf "$src" "$dst"
        echo "Linked: $dst -> $src"
      fi
    }

    # dotfiles
    link_force "${dotfilesDir}/.zshrc" "$HOME/.zshrc"
    link_force "${dotfilesDir}/.zprofile" "$HOME/.zprofile"
    link_force "${dotfilesDir}/.gitconfig" "$HOME/.gitconfig"
    link_force "${dotfilesDir}/.gitignore_global" "$HOME/.gitignore_global"

    # Claude Code
    mkdir -p "$HOME/.claude"
    link_force "${dotfilesDir}/.claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
    link_force "${dotfilesDir}/.claude/settings.json" "$HOME/.claude/settings.json"
    link_force "${dotfilesDir}/.claude/statusline-command.sh" "$HOME/.claude/statusline-command.sh"
    link_force "${dotfilesDir}/.claude/hooks" "$HOME/.claude/hooks"
    link_force "${dotfilesDir}/.claude/skills" "$HOME/.claude/skills"
  '';
}
