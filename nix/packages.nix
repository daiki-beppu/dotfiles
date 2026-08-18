{
  pkgs,
  lib,
  config,
  hostConfig,
  hunkPkg,
  taktPkg,
  ...
}:

let
  dotfilesDir = "${config.home.homeDirectory}/ghq/github.com/daiki-beppu/dotfiles/config";

  # gh-stack: GitHub Stacked PRs（public preview）の CLI 拡張。
  # nixpkgs は 0.0.4（2026-05）で止まっており、preview 公開の目玉である
  # `gh stack merge`（スタックを一括ランディング）と、rebase/sync が古い trunk の
  # まま success を返す・amend した親コミットが子ブランチへ再生される、という
  # 2 つのデータ破壊系バグの修正がいずれも 0.1.0 以降にしかないため上書きする。
  # v0.1.0 で追加された統合テストが git を exec するので nativeCheckInputs に git を足す
  # （素通しだとサンドボックスに git が無く checkPhase が落ちる）。
  # nixpkgs が 0.1.0 以降に追いついたらこの let ごと消して pkgs.gh-stack に戻す。
  ghStack = pkgs.gh-stack.overrideAttrs (_: prev: {
    version = "0.1.0";
    src = pkgs.fetchFromGitHub {
      owner = "github";
      repo = "gh-stack";
      tag = "v0.1.0";
      hash = "sha256-48JkOeqbvHlCZ2u3LnwJymw55xMQWLTPJLDbV44clGI=";
    };
    vendorHash = "sha256-0Xtr/MOpX4u5GnbRdNxKPA0GpSzi8PIbVc9MmP05De4=";
    nativeCheckInputs = (prev.nativeCheckInputs or [ ]) ++ [ pkgs.git ];
  });
in
{
  home.stateVersion = "24.11";

  home.packages = with pkgs; [
    bun
    xz
    codex
    direnv
    # nixpkgs 716c7a2 で依存の whisper-cpp が darwin でビルド不能（CoreML リンク時に
    # ld がクラッシュ）なため、whisper フィルタを無効化（上流修正後に外す）
    (ffmpeg-full.override { withWhisper = false; })
    gh
    ghq
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
  ]
  ++ [
    # flake input 由来（nixpkgs 未収録）
    hunkPkg # レビュー特化のターミナル diff ビューアー
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

    # Agent skills
    # Claude / Codex 共通の正本は config/.claude/skills。Codex の公式 user scope
    # ~/.agents/skills には共通同期スクリプトで個別 symlink を作り、他 installer が
    # 管理する skill を保護したまま dotfiles 管理分だけを同期する。
    bash "${dotfilesDir}/../scripts/sync-agent-skills.sh"

    # Codex
    # グローバル規約の実体は config/.claude/CLAUDE.md 1 枚。
    # Codex はそれを ~/.codex/AGENTS.md という名前で読むだけなので、
    # 内容を複製せず同じソースへ symlink する（2 枚に分けると drift する）。
    # ~/.codex 自体は Codex が実行時状態を書く通常ディレクトリ。
    mkdir -p "$HOME/.codex"
    link_force "${dotfilesDir}/.claude/CLAUDE.md" "$HOME/.codex/AGENTS.md"

    # takt
    # ~/.takt 自体は takt が実行時状態を書く通常ディレクトリ。
    # グローバルで git 管理するのは config.yaml のみ。
    # カスタム workflow / facets / schemas は各プロジェクトの .takt/ で管理する方針
    mkdir -p "$HOME/.takt"
    link_force "${dotfilesDir}/.takt/config.yaml" "$HOME/.takt/config.yaml"

    if [ -n "$MISSING_SOURCES" ]; then
      echo "ERROR: linkDotfiles aborted: missing sources:$MISSING_SOURCES" >&2
      exit 1
    fi
  '';
}
