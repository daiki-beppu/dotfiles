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
    gzip
    tree
    unzip
    uv
    watchman

    # Python + youtube-channels 自動化に必要なパッケージ
    (python314.withPackages (ps: with ps; [
      google-api-python-client
      google-auth-oauthlib
      google-auth-httplib2
      pandas
      matplotlib
      seaborn
      schedule
      python-dotenv
      pillow
      google-genai
      pyyaml
    ]))
  ];

  # ── git 設定 ──
  programs.git = {
    enable = true;

    settings = {
      user.name = "daiki-beppu";
      user.email = "beppu.engineer@gmail.com";
      init.defaultBranch = "main";
    };

    ignores = [
      # macOS
      ".DS_Store"
      ".AppleDouble"
      ".LSOverride"
      "._*"

      # Thumbnails
      "Thumbs.db"

      # IDE
      ".vscode/"
      ".idea/"
      "*.swp"
      "*.swo"
      "*~"

      # Node.js
      "node_modules/"
      "npm-debug.log*"
      "yarn-debug.log*"
      "yarn-error.log*"

      # Environment variables
      ".env"
      ".env.local"
      ".env.*.local"

      # Logs
      "*.log"
      "logs/"

      # OS generated files
      ".Spotlight-V100"
      ".Trashes"
    ];
  };

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

    # ブラウザ振り分けスクリプト
    mkdir -p "$HOME/.local/bin"
    link_force "${dotfilesDir}/.local/bin/open-browser" "$HOME/.local/bin/open-browser"

    # Claude Code
    mkdir -p "$HOME/.claude"
    link_force "${dotfilesDir}/.claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
    link_force "${dotfilesDir}/.claude/settings.json" "$HOME/.claude/settings.json"
    link_force "${dotfilesDir}/.claude/statusline-command.sh" "$HOME/.claude/statusline-command.sh"
    link_force "${dotfilesDir}/.claude/hooks" "$HOME/.claude/hooks"
    link_force "${dotfilesDir}/.claude/skills" "$HOME/.claude/skills"
  '';
}
