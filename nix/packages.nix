{
  pkgs,
  lib,
  config,
  hostConfig,
  taktPkg,
  ...
}:

let
  dotfilesDir = "${config.home.homeDirectory}/ghq/github.com/daiki-beppu/dotfiles/config";
  # nixpkgs は 0.1.1 止まり（2026-10-05 時点）。0.2.0 の worktree 対応を使うため上書きする。
  # nixpkgs が 0.2.0 以上になったらこの上書きを消して pkgs.gh-stack に戻す。
  ghStack = pkgs.gh-stack.overrideAttrs (old: rec {
    version = "0.2.0";
    src = pkgs.fetchFromGitHub {
      owner = "github";
      repo = "gh-stack";
      tag = "v${version}";
      hash = "sha256-70H1kOdvklTeB8OVFg7g6xQ4rn0gqv+zU7yjDYPd3vo=";
    };
    vendorHash = "sha256-Otstml5TSTJeYsP9o94aUperP1MgT2axa/wqALEnXYk=";
    # installAgentSkills は go-modules の導出で pname 未設定エラーになる。スキルは npx skills で入れているので外す。
    nativeBuildInputs = lib.remove pkgs.installAgentSkills old.nativeBuildInputs;
    # modify の TUI（エージェントからは使わない）の branch 挿入テストが Nix のサンドボックスで落ちるため除外する。
    checkFlags = [ "-skip=Insert" ];
    ldflags = [
      "-s"
      "-X=github.com/github/gh-stack/cmd.Version=${version}"
    ];
  });
in
{
  imports = [ ./vite-plus.nix ];

  home.stateVersion = "24.11";

  home.packages = with pkgs; [
    actionlint # GitHub Actions の workflow を検査する。run: の bash は PATH 上の shellcheck で検査する
    bun
    xz
    codex
    direnv
    # nixpkgs 716c7a2 で依存の whisper-cpp が darwin でビルド不能（CoreML リンク時に
    # ld がクラッシュ）なため、whisper フィルタを無効化（上流修正後に外す）
    (ffmpeg-full.override { withWhisper = false; })
    gh
    fzf # ghq のリポジトリへ移動する Ctrl-] ウィジェット（.zshrc）で使う
    ghq
    google-cloud-sdk
    gzip
    herdr
    # takt の /verify（形式仕様検証）で quint verify（Apalache）と Alloy Analyzer が
    # Java 17 以上を要求する。無いとモデル検査だけが黙ってスキップされる
    jdk21_headless
    rclone
    ripgrep
    shellcheck # actionlint が run: を検査するのに使う。scripts/check.sh の shellcheck check もこれを優先する
    terraform
    tmux
    tree
    unzip
    uv
    sqld
    turso-cli
    (callPackage ./cf { }) # Cloudflare CLI（wrangler の後継）。nixpkgs 未収録なので nix/cf/ でビルドする。Vercel CLI は flake.nix の homebrew.brews
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
  ]
  ++ [
    # flake input 由来（nixpkgs 未収録）
    taktPkg # AI コーディングエージェント向けの workflow 制御 CLI
  ]
  ++ (hostConfig.extraPackages pkgs);

  # ── gh 拡張の登録 ──
  # gh は PATH ではなくデータディレクトリ配下しか拡張として探さないので、
  # gh-stack を home.packages に足すだけでは `gh stack` にならない。
  # ディレクトリ自体を store の bin へ symlink すると gh は「ローカル拡張」と
  # 見なし、manifest.yml 無しでも解決する（home-manager の programs.gh.extensions が
  # linkFarm でやっているのと同じ形）。
  #
  # programs.gh.enable を使わないのは副作用が二つあるため:
  #   1. config.yml が store への symlink になり書き込み不可になる。gh-stack の
  #      `gh stack alias` や `gh config set` が書き込めなくなる
  #   2. github.com / gist.github.com に credential.helper を自動注入する
  # 拡張を 1 つ入れたいだけなのでその二つは引き受けない。
  xdg.dataFile."gh/extensions/gh-stack".source = "${ghStack}/bin";

  # ── nh: Nix ヘルパー CLI（GC root まで掃除できる clean コマンド持ち） ──
  # 手動実行用: `nh clean all --dry` で削除対象を確認できる。
  # NH_FLAKE を設定するので `nh darwin switch` だけで rebuild できる。
  # 週次の自動クリーンは flake.nix 側の launchd daemon（root）で行う。
  # useUserPackages = true のため世代は root 所有のシステムプロファイルに
  # 積まれ、ユーザー権限の `nh clean user` では削除できないため。
  programs.nh = {
    enable = true;
    flake = "${config.home.homeDirectory}/ghq/github.com/daiki-beppu/dotfiles";
  };

  # ── git 設定 ──
  programs.git = {
    enable = true;

    settings = {
      user.name = "daiki-beppu";
      user.email = hostConfig.gitEmail;
      init.defaultBranch = "main";
      ghq.root = "${config.home.homeDirectory}/ghq";
      ghq.user = "daiki-beppu";

      # gh stack はスタック全体を繰り返し cascade rebase するので、同じ衝突に
      # 何度も遭遇する。rerere があれば解決内容が再利用される。
      # gh stack init も未設定だとこれを有効化してよいか確認プロンプトを出すため、
      # 先に立てておくとエージェントからの非対話実行がそこで止まらない。
      rerere.enabled = true;
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

  # ~/.gitconfig にも identity のみ複製する（XDG_CONFIG_HOME 乗っ取り防御）。
  # takt 等のツールが自プロセスの XDG_CONFIG_HOME を隔離ディレクトリへ向けると、
  # ~/.config/git/config しか持たない XDG 純化構成では git の identity が見えず
  # commit が "Author identity unknown" で失敗する。git は ~/.gitconfig を
  # HOME 基準で常に読む（XDG 側の後に読まれスカラー値は勝つ）ため、ここに
  # identity を置けば XDG がどこへ向いても解決する。
  # フル設定の symlink にしないのは、両経路が二重に読まれた際の複数値キー
  # （credential.helper / include.path 等）の二重適用を避けるため。
  home.file.".gitconfig".text = ''
    [user]
      name = ${config.programs.git.settings.user.name}
      email = ${config.programs.git.settings.user.email}
  '';

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

    # ブラウザ振り分けスクリプト
    mkdir -p "$HOME/.local/bin"
    link_force "${dotfilesDir}/.local/bin/open-browser" "$HOME/.local/bin/open-browser"

    # takt トークン消費の横断集計
    link_force "${dotfilesDir}/.local/bin/takt-usage-report" "$HOME/.local/bin/takt-usage-report"

    # takt-mcp をメインチェックアウトのルートで起動するラッパー（MCP 登録用）
    link_force "${dotfilesDir}/.local/bin/takt-mcp-root" "$HOME/.local/bin/takt-mcp-root"

    # zsh-abbr
    mkdir -p "$HOME/.config/zsh-abbr"
    link_force "${dotfilesDir}/.config/zsh-abbr/user-abbreviations" "$HOME/.config/zsh-abbr/user-abbreviations"

    # Claude Code
    mkdir -p "$HOME/.claude"
    # グローバル指示の正本は AGENTS.md。Claude Code は user-level の AGENTS.md を
    # 読まないので、CLAUDE.md という名前でだけ配置する。
    link_force "${dotfilesDir}/.agents/AGENTS.md" "$HOME/.claude/CLAUDE.md"
    link_force "${dotfilesDir}/.claude/settings.json" "$HOME/.claude/settings.json"
    link_force "${dotfilesDir}/.claude/statusline-command.sh" "$HOME/.claude/statusline-command.sh"
    link_force "${dotfilesDir}/.claude/hooks" "$HOME/.claude/hooks"
    # 共通スキル: ディレクトリ全体を共有するため、追加・削除時の同期は不要。
    # 初回移行では既存 ~/.agents/skills の外部スキルを正本へ引き継いでから適用する。
    # link_force は既存ディレクトリも退避する。
    mkdir -p "$HOME/.agents"
    link_force "${dotfilesDir}/.agents/skills" "$HOME/.agents/skills"
    link_force "${dotfilesDir}/.agents/skills" "$HOME/.claude/skills"

    # Codex
    # グローバル規約の実体は config/.agents/AGENTS.md 1 枚。
    # Claude Code と内容を複製せず同じソースへ symlink する（2 枚に分けると drift する）。
    # ~/.codex 自体は Codex が実行時状態を書く通常ディレクトリ。
    mkdir -p "$HOME/.codex"
    link_force "${dotfilesDir}/.agents/AGENTS.md" "$HOME/.codex/AGENTS.md"

    # takt
    # ~/.takt 自体は takt が実行時状態を書く通常ディレクトリ。
    # グローバルで git 管理するのは config.yaml と runtime.yaml のみ。
    # runtime.yaml は takt が初回起動時に `version: 1` だけの実ファイルを生成するので、
    # link_force で置き換える。
    # カスタム workflow / facets / schemas は各プロジェクトの .takt/ で管理する方針
    mkdir -p "$HOME/.takt"
    link_force "${dotfilesDir}/.takt/config.yaml" "$HOME/.takt/config.yaml"
    link_force "${dotfilesDir}/.takt/runtime.yaml" "$HOME/.takt/runtime.yaml"

    if [ -n "$MISSING_SOURCES" ]; then
      echo "ERROR: linkDotfiles aborted: missing sources:$MISSING_SOURCES" >&2
      exit 1
    fi
  '';
}
