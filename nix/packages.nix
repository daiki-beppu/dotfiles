{
  pkgs,
  lib,
  config,
  hostConfig,
  ...
}:

let
  dotfilesDir = "${config.home.homeDirectory}/01-dev/dotfiles/config";
in
{
  home.stateVersion = "24.11";

  home.packages = with pkgs; [
    bun
    xz
    cocoapods
    codex
    direnv
    # nixpkgs 716c7a2 で依存の whisper-cpp が darwin でビルド不能（CoreML リンク時に
    # ld がクラッシュ）なため、whisper フィルタを無効化（上流修正後に外す）
    (ffmpeg-full.override { withWhisper = false; })
    gh
    google-cloud-sdk
    gzip
    herdr
    ripgrep
    terraform
    tmux
    tree
    unzip
    uv
    sqld
    turso-cli
    zsh-abbr

    # Python + youtube-channels 自動化に必要なパッケージ
    (python314.withPackages (
      ps: with ps; [
        google-api-python-client
        google-auth-oauthlib
        google-auth-httplib2
        pandas
        matplotlib
        # nixpkgs 716c7a2 で test_ticklabels_overlap が darwin で失敗するため
        # テストをスキップ（上流修正後に外す）
        (seaborn.overridePythonAttrs (old: {
          doCheck = false;
        }))
        schedule
        python-dotenv
        pillow
        google-genai
        pyyaml
      ]
    ))
  ] ++ (hostConfig.extraPackages pkgs);

  # ── git 設定 ──
  programs.git = {
    enable = true;

    settings = {
      user.name = "daiki-beppu";
      user.email = hostConfig.gitEmail;
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
    MISSING_SOURCES=""
    link_force() {
      local src="$1"
      local dst="$2"
      if [ ! -e "$src" ]; then
        echo "ERROR: link source missing: $src" >&2
        MISSING_SOURCES="$MISSING_SOURCES $src"
        return 0
      fi
      if [ ! -L "$dst" ] || [ "$(readlink "$dst")" != "$src" ]; then
        if [ -e "$dst" ] || [ -L "$dst" ]; then
          local backup="$dst.backup-before-link"
          if [ -e "$backup" ] || [ -L "$backup" ]; then
            backup="$backup.$(date +%s)"
          fi
          mv "$dst" "$backup"
          echo "Backed up: $dst -> $backup"
        fi
        ln -sf "$src" "$dst"
        echo "Linked: $dst -> $src"
      fi
    }

    # dotfiles
    link_force "${dotfilesDir}/.zshenv" "$HOME/.zshenv"
    link_force "${dotfilesDir}/.zshrc" "$HOME/.zshrc"
    link_force "${dotfilesDir}/.zprofile" "$HOME/.zprofile"
    link_force "${dotfilesDir}/.wezterm.lua" "$HOME/.wezterm.lua"

    # ブラウザ振り分けスクリプト
    mkdir -p "$HOME/.local/bin"
    link_force "${dotfilesDir}/.local/bin/open-browser" "$HOME/.local/bin/open-browser"

    # takt トークン消費の横断集計
    link_force "${dotfilesDir}/.local/bin/takt-usage-report" "$HOME/.local/bin/takt-usage-report"

    # zsh-abbr
    mkdir -p "$HOME/.config/zsh-abbr"
    link_force "${dotfilesDir}/.config/zsh-abbr/user-abbreviations" "$HOME/.config/zsh-abbr/user-abbreviations"

    # Claude Code
    mkdir -p "$HOME/.claude"
    link_force "${dotfilesDir}/.claude/CLAUDE.md" "$HOME/.claude/CLAUDE.md"
    link_force "${dotfilesDir}/.claude/settings.json" "$HOME/.claude/settings.json"
    link_force "${dotfilesDir}/.claude/statusline-command.sh" "$HOME/.claude/statusline-command.sh"
    link_force "${dotfilesDir}/.claude/hooks" "$HOME/.claude/hooks"
    link_force "${dotfilesDir}/.claude/skills" "$HOME/.claude/skills"

    # takt
    mkdir -p "$HOME/.takt"
    link_force "${dotfilesDir}/.takt/config.yaml" "$HOME/.takt/config.yaml"
    link_force "${dotfilesDir}/.takt/workflows" "$HOME/.takt/workflows"
    link_force "${dotfilesDir}/.takt/facets" "$HOME/.takt/facets"
    link_force "${dotfilesDir}/.takt/schemas" "$HOME/.takt/schemas"

    if [ -n "$MISSING_SOURCES" ]; then
      echo "ERROR: linkDotfiles aborted: missing sources:$MISSING_SOURCES" >&2
      exit 1
    fi
  '';

  # ── takt CLI ──
  # nixpkgs に takt パッケージは存在しないため、Nix 管理下の bun で
  # グローバルインストールし、darwin-rebuild switch のたびに最新化する
  home.activation.installTakt = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
    export PATH="${pkgs.bun}/bin:$PATH"
    "${pkgs.bun}/bin/bun" install -g takt@latest
  '';
}
