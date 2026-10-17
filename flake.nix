{
  description = "daiki-beppu's macOS dotfiles";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    nix-darwin = {
      url = "github:LnL7/nix-darwin";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    home-manager = {
      url = "github:nix-community/home-manager";
      inputs.nixpkgs.follows = "nixpkgs";
    };

    # takt: AI コーディングエージェント向けの workflow 制御 CLI
    # nixpkgs 未収録のため upstream flake から直接取得。
    # リリースタグに固定する: main は未リリースコミットが積まれており、
    # npm の takt@latest（従来の入手経路）とバージョンが一致しないため。
    # 更新手順は README「よくある操作」を参照。
    # nixpkgs.follows は付けない: upstream が flake.lock で検証済みの
    # nixpkgs / nodejs の組み合わせをそのまま使う
    takt.url = "github:nrslib/takt/v0.71.0";
  };

  outputs =
    {
      nixpkgs,
      nix-darwin,
      home-manager,
      takt,
      ...
    }:
    let
      system = "aarch64-darwin";
      # ホスト差分の注入点（3 つ）:
      #   - gitEmail: home-manager 側の git user.email を上書き（未指定ならデフォルトの private email）
      #   - extraPackages: pkgs -> [ ... ] 形式で home.packages に追加パッケージを足す
      #   - extraModules: nix-darwin モジュールのリストを追加（casks / system.defaults のホスト分割等）
      # PR #65 型の変更（ホスト固有のハードコード）は今後ここに入れる。
      hosts = {
        "MacBook-Pro-3" = {
          username = "daikibeppu";
        };
        "mba" = {
          username = "mba";
        };
      };
      mkDarwin =
        hostname:
        hostAttrs:
        let
          username = hostAttrs.username;
          hostConfig = {
            gitEmail = hostAttrs.gitEmail or "beppu.engineer@gmail.com";
            extraPackages = hostAttrs.extraPackages or (pkgs: [ ]);
          };
        in
        nix-darwin.lib.darwinSystem {
          inherit system;

          modules = [
            (
              { pkgs, lib, ... }:
              {
                # Determinate Nix を使うため nix-daemon の管理を無効化
                nix.enable = false;

                # BSL ライセンスの terraform を個別許可（nixpkgs unfree 制限の回避）
                nixpkgs.config.allowUnfreePredicate = pkg: builtins.elem (lib.getName pkg) [ "terraform" "zsh-abbr" ];

                # システム設定
                system.stateVersion = 5;
                system.primaryUser = username;
                networking.hostName = hostname;

                # ユーザー
                users.users.${username} = {
                  name = username;
                  home = "/Users/${username}";
                };

                # ── macOS システム設定 ──
                system.defaults = {
                  # ダークモード
                  NSGlobalDomain.AppleInterfaceStyle = "Dark";

                  # キーボード
                  NSGlobalDomain.KeyRepeat = 2;
                  NSGlobalDomain.InitialKeyRepeat = 15;
                  NSGlobalDomain.AppleKeyboardUIMode = 2;

                  # トラックパッド
                  NSGlobalDomain."com.apple.swipescrolldirection" = false;
                  NSGlobalDomain."com.apple.trackpad.forceClick" = false;
                  NSGlobalDomain."com.apple.trackpad.scaling" = 3.0;

                  trackpad.Clicking = true;
                  trackpad.TrackpadThreeFingerDrag = false;
                  trackpad.TrackpadRightClick = true;

                  # Finder
                  NSGlobalDomain.AppleShowAllExtensions = true;
                  finder.ShowExternalHardDrivesOnDesktop = false;
                  finder.ShowHardDrivesOnDesktop = false;
                  finder.ShowRemovableMediaOnDesktop = false;
                  finder.NewWindowTarget = "Recents";
                  finder.FXPreferredViewStyle = "clmv";

                  # Dock
                  dock.autohide = true;
                  dock.magnification = true;
                  dock.largesize = 50;
                  dock.tilesize = 47;
                  dock.orientation = "bottom";
                  dock.mineffect = "genie";
                  dock.show-recents = false;
                  dock.showAppExposeGestureEnabled = true;
                  dock.showLaunchpadGestureEnabled = false;

                  # 専用オプションがない設定
                  CustomUserPreferences = {
                    "com.apple.AppleMultitouchTrackpad" = {
                      TrackpadTwoFingerFromRightEdgeSwipeGesture = 0;
                    };
                    "com.apple.finder" = {
                      ShowRecentTags = false;
                    };
                    # 入力メニュー（azooKey の かな/英数 表示）をメニューバーに出す
                    "com.apple.TextInputMenu" = {
                      visible = true;
                    };
                    # Raycast の呼び出しを ⌘Space にする（Spotlight 側は下の postActivation で外す）
                    "com.raycast.macos" = {
                      raycastGlobalHotkey = "Command-49";
                    };
                  };
                };

                # ── Spotlight の ⌘Space を無効化 ──
                # ショートカットは AppleSymbolicHotKeys 1 つの辞書にまとまっている。
                # CustomUserPreferences は辞書を丸ごと書き換えてほかのショートカットを消すため、
                # -dict-add で 64（Spotlight 検索を表示）だけ差し替える。
                # activateSettings -u でログアウトせずに反映する。
                system.activationScripts.postActivation.text = ''
                  echo >&2 "disabling Spotlight shortcut..."
                  launchctl asuser "$(id -u -- ${username})" sudo --user=${username} -- \
                    /usr/bin/defaults write com.apple.symbolichotkeys AppleSymbolicHotKeys -dict-add 64 \
                    '<dict><key>enabled</key><false/><key>value</key><dict><key>parameters</key><array><integer>65535</integer><integer>49</integer><integer>1048576</integer></array><key>type</key><string>standard</string></dict></dict>'
                  launchctl asuser "$(id -u -- ${username})" sudo --user=${username} -- \
                    /System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings -u
                '';

                # ── Nix ストアの週次自動クリーン（nh） ──
                # Determinate Nix（nix.enable = false）のため nix.gc / nix.optimise が
                # 使えない。代わりに nh clean all を root の launchd daemon で週次実行し、
                # 古い世代・orphan gcroot の削除とストアの重複排除を行う。
                # 保持ポリシー: 最新 3 世代だけ保持（rollback 先を 2 つ残す）。
                # --keep-since は既定の 0h のため、direnv の gcroot も実行時点で
                # 消え、次に入ったときに再評価される。
                launchd.daemons.nh-clean = {
                  command = "${pkgs.nh}/bin/nh clean all --keep 3 --optimise";
                  serviceConfig = {
                    # 月曜 12:00（スリープ中に時刻を跨ぐと launchd はその回を
                    # スキップするため、稼働している可能性が高い日中に設定）
                    StartCalendarInterval = [
                      {
                        Weekday = 1;
                        Hour = 12;
                        Minute = 0;
                      }
                    ];
                    StandardOutPath = "/var/log/nh-clean.log";
                    StandardErrorPath = "/var/log/nh-clean.err.log";
                  };
                };

                # ── Codex セッションの週次削除 ──
                # Orca 経由の Codex は自動実行で 1 日 1G 近いセッションを書くため、
                # 最終更新から 7 日を過ぎた rollout を消す。日付ディレクトリではなく
                # mtime で判定し、何日も続いているセッションは残す。
                # Orca は runtime-home・各アカウント・~/.codex の sessions を
                # ハードリンクで共有し、欠けた側を作り直すため、3 か所とも消す。
                launchd.user.agents.codex-sessions-clean = {
                  command = "${pkgs.writeShellScript "codex-sessions-clean" ''
                    shopt -s nullglob
                    for dir in \
                      "/Users/${username}"/Library/Application\ Support/orca/codex-runtime-home/home/sessions \
                      "/Users/${username}"/Library/Application\ Support/orca/codex-accounts/*/home/sessions \
                      "/Users/${username}"/.codex/sessions \
                      "/Users/${username}"/.codex/archived_sessions; do
                      [ -d "$dir" ] || continue
                      /usr/bin/find "$dir" -type f -name 'rollout-*.jsonl' -mtime +7 -print -delete
                      /usr/bin/find "$dir" -mindepth 1 -type d -empty -delete
                    done
                  ''}";
                  serviceConfig = {
                    # nh-clean と同じ月曜 12:00
                    StartCalendarInterval = [
                      {
                        Weekday = 1;
                        Hour = 12;
                        Minute = 0;
                      }
                    ];
                    StandardOutPath = "/tmp/codex-sessions-clean.log";
                    StandardErrorPath = "/tmp/codex-sessions-clean.err.log";
                  };
                };

                # ── Touch ID で sudo 認証 ──
                security.pam.services.sudo_local.touchIdAuth = true;
                security.pam.services.sudo_local.reattach = true;

                # Homebrew との共存
                # nixpkgs にないツールと cask は Homebrew で管理
                homebrew = {
                  enable = true;
                  # flake に無い formula / cask は activation 時にアンインストール（データは残す）
                  onActivation.cleanup = "uninstall";

                  taps = [
                    "olets/tap"
                    "stablyai/orca"
                  ];

                  brews = [
                    "git-lfs"
                    "ni"
                    "vercel" # Vercel CLI。nixpkgs 未収録（vercel-pkg は別物のバンドラ）
                  ];

                  casks = [
                    "1password"
                    "1password-cli"
                    "antigravity-cli"
                    "azookey"
                    "cap"
                    "chatgpt"
                    "claude"
                    "codex-app"
                    "cursor"
                    "devin-cli"
                    "devin-desktop"
                    "discord"
                    "font-hackgen"
                    "google-chrome"
                    "google-drive"
                    "nani"
                    "notion"
                    "nvidia-geforce-now"
                    "stablyai/orca/orca" # Orca（エージェント並列実行 IDE）。nixpkgs の orca はスクリーンリーダーで別物
                    "raycast"
                    "typewhisper" # 音声入力。ローカルの Qwen3 ASR（MLX）で日本語を書き起こす
                    "zoom"
                  ];

                  # Mac App Store 限定のアプリ。mas CLI は brew bundle が自動でインストールする。
                  # App Store に Apple ID でサインイン済みであることが前提。
                  # masApps を 1 つでも宣言すると、onActivation.cleanup = "uninstall" が
                  # ここに無い App Store アプリもアンインストール対象にする。
                  # 入っている App Store アプリはすべてここに列挙する。
                  masApps = {
                    "Klack" = 6446206067;
                  };
                };
              }
            )

            # Home Manager を nix-darwin のモジュールとして統合
            home-manager.darwinModules.home-manager
            {
              home-manager.useGlobalPkgs = true;
              home-manager.useUserPackages = true;
              home-manager.backupFileExtension = "backup";
              home-manager.extraSpecialArgs = {
                inherit hostConfig;
                taktPkg = takt.packages.${system}.default;
              };
              home-manager.users.${username} = import ./nix/packages.nix;
            }
          ] ++ (hostAttrs.extraModules or [ ]);
        };
    in
    {
      darwinConfigurations = builtins.mapAttrs mkDarwin hosts;
    };
}
