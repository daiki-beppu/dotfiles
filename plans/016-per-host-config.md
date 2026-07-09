# Plan 016: hosts にホスト差分の注入点を作る（design/spike）

> **Executor instructions**: これは design/spike プラン — ホスト差分の「受け皿」機構を
> 最小実装し、両ホストの eval で成立を証明するのがゴール。実際の差分値（仕事用 email 等）の
> 投入はユーザーの判断事項として残す。Follow the steps, run every verification, and
> honor STOP conditions. When done, update the status row in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat e0a2d44..HEAD -- flake.nix nix/packages.nix`
> 差分があれば「Current state」と突合し、不一致は STOP。特に Plan 007/014 実施済みなら
> 行番号がずれているだけの可能性が高い — 構造が同じなら続行してよい。

## Status

- **Priority**: P3
- **Effort**: M（coarse — direction 由来のため見積り粗め）
- **Risk**: MED（flake 構造の変更。CI の両ホスト eval が安全網）
- **Depends on**: 014（flake.nix のコンフリクト回避のため 014 を先に）
- **Category**: direction
- **Planned at**: commit `e0a2d44`, 2026-07-09

## Why this matters

この repo は 2 ホスト（`mba` = MacBook Air / `MacBook-Pro-3` = MacBook Pro、ユーザー名も別）を宣言しているが、`hosts` attrset が持てるのは `username` だけで、casks・git identity・パッケージは全て共有。ホスト差分を入れる正規の場所が無い。その結果が PR #65 の事故: MacBook Pro 向けに git email・nodejs・設定パスをハードコードで差し込み、もう一方のホストを壊して全 revert（commit `27f1e3e`）— しかも revert の巻き添えで必要な修正 2 件（`.wezterm.lua` リンク、vite-plus ガード）まで消えた。受け皿が無い限り「ハードコード → 相手ホスト破壊 → revert」が再発する。このプランは差分の**注入点**（per-host module + Home Manager への hostConfig 伝搬）だけを作り、実際の差分投入は次の必要が生じたときに 1 行で済む状態にする。

## Current state

- `flake.nix:27-34` — hosts 定義:

```nix
      hosts = {
        "MacBook-Pro-3" = {
          username = "daikibeppu";
        };
        "mba" = {
          username = "mba";
        };
      };
```

- `flake.nix:35-38` — `mkDarwin = hostname: { username }: nix-darwin.lib.darwinSystem { ... }`（引数パターンが `username` のみを受ける — 新しい属性を足すと **eval エラーになる**点に注意: `{ username }` は閉じたパターン）。
- `flake.nix:165-172` — Home Manager 統合:

```nix
            home-manager.darwinModules.home-manager
            {
              home-manager.useGlobalPkgs = true;
              home-manager.useUserPackages = true;
              home-manager.backupFileExtension = "backup";
              home-manager.users.${username} = import ./nix/packages.nix;
            }
```

- `nix/packages.nix:1-6` — 引数は `{ pkgs, lib, config, ... }`。
- `nix/packages.nix:51-58` — git identity は全ホスト共通のハードコード（`user.name = "daiki-beppu"; user.email = "beppu.engineer@gmail.com";`）。
- CI（`.github/workflows/ci.yml`）が全ホストの `system.drvPath` を eval する — 片ホストを壊す変更は PR 時点で赤くなる。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| 両ホスト eval | `nix eval '.#darwinConfigurations."mba".system.drvPath'` / 同 `"MacBook-Pro-3"` | exit 0 |
| HM 設定値の確認 | `nix eval '.#darwinConfigurations."mba".config.home-manager.users.mba.programs.git.settings.user.email'` | 設定した email 文字列 |

## Scope

**In scope**:
- `flake.nix`（hosts / mkDarwin の構造）
- `nix/packages.nix`（`hostConfig` 引数の受け取りと git identity / packages への適用点）

**Out of scope**:
- 実際のホスト差分値の投入（仕事用 email、ホスト別 casks の中身）— ユーザーの判断。機構だけ作る
- `system.defaults` / Homebrew casks のホスト分割の実施 — extraModules 経由で可能な状態にするだけ
- Plan 007 の linkDotfiles ロジック

## Git workflow

- Branch: `feat/per-host-config`（worktree 上で作業 — repo 規約）
- Commit message 例: `feat(flake): hosts にホスト差分の注入点（extraModules / hostConfig）を追加`
- Push / PR 作成はユーザー指示があるまでしない

## Steps

### Step 1: hosts スキーマを拡張し mkDarwin に通す

`flake.nix` を次の形に変える（推奨形 — 等価な設計でもよいが逸脱理由を記録）:

```nix
      hosts = {
        "MacBook-Pro-3" = {
          username = "daikibeppu";
        };
        "mba" = {
          username = "mba";
        };
      };
      mkDarwin =
        hostname: hostAttrs:
        let
          username = hostAttrs.username;
          hostConfig = {
            gitEmail = hostAttrs.gitEmail or "beppu.engineer@gmail.com";
            extraPackages = hostAttrs.extraPackages or (pkgs: [ ]);
          };
        in
        nix-darwin.lib.darwinSystem {
          ...
          modules = [
            ...既存モジュール...
          ] ++ (hostAttrs.extraModules or [ ]);
        };
```

要点: (a) 引数パターンを閉じた `{ username }` から `hostAttrs` に変え、**未知の属性でも eval が壊れない**ようにする。(b) デフォルト値は `or` で与え、hosts 側は差分だけ書けばよい。(c) nix-darwin レベルの差分（casks、system.defaults）は `extraModules` にモジュールを足すだけで入る口を開ける。

**Verify**: 両ホストの `nix eval ... system.drvPath` → exit 0（この時点で挙動は完全に不変のはず）

### Step 2: hostConfig を Home Manager に伝搬する

`flake.nix` の HM ブロックに:

```nix
              home-manager.extraSpecialArgs = { inherit hostConfig; };
```

を追加し、`nix/packages.nix` の引数を `{ pkgs, lib, config, hostConfig, ... }` にして、git identity を:

```nix
      user.email = hostConfig.gitEmail;
```

に、`home.packages` の末尾に `++ (hostConfig.extraPackages pkgs)` を足す。

**Verify**: 両ホスト eval が exit 0、かつ

```bash
nix eval '.#darwinConfigurations."MacBook-Pro-3".config.home-manager.users.daikibeppu.programs.git.settings.user.email'
```

→ `"beppu.engineer@gmail.com"`（デフォルトが効いている）

### Step 3: 機構の実証テスト（一時的な差分を入れて確認 → 戻す）

hosts の `"mba"` に一時的に `gitEmail = "test@example.com";` を足して Step 2 の eval で `mba` 側だけ値が変わり、`MacBook-Pro-3` 側は不変であることを確認。確認後 **必ず削除**し、`git diff` が Step 2 完了時点と同一であることを確認する。

**Verify**: 一時差分で両ホストの email が別値 → 差分除去後、`git diff` に一時変更が残っていない

### Step 4: 使い方を flake.nix にコメントで残す

hosts 定義の直上に、差分の入れ方を 3〜4 行のコメントで記載（gitEmail / extraPackages / extraModules の 3 つの口と、それぞれ何用か。PR #65 型の変更は今後ここに入れる、と一言）。

**Verify**: `rg -n 'extraModules' flake.nix` → 定義とコメントの両方にヒット

## Test plan

- Step 1〜2 の両ホスト eval（挙動不変の確認）が回帰テスト。
- Step 3 の一時差分テストが機構の実証（このプランの本題）。
- CI が PR 時に両ホストを eval するので、マージ前の最終安全網になる。

## Done criteria

- [ ] 両ホストの `nix eval '.#darwinConfigurations."<host>".system.drvPath'` が exit 0
- [ ] email の eval（Step 2 の Verify）がデフォルト値を返す
- [ ] Step 3 の一時差分テストが記録されている（plans/README.md の状態欄に一言）
- [ ] `rg -c 'extraSpecialArgs' flake.nix` → 1
- [ ] `git status` で変更が flake.nix と nix/packages.nix のみ
- [ ] `plans/README.md` の 016 行を更新

## STOP conditions

Stop and report back (do not improvise) if:

- Step 2 の HM 属性パス（`config.home-manager.users.<user>.programs.git.settings.user.email`）が eval で解決しない — home-manager の内部構造が想定と違う。2 回の探索（`nix eval ... --apply builtins.attrNames` で段階的に降りる）で見つからなければ停止。
- `extraSpecialArgs` の追加で既存モジュールの引数解決が壊れる（無限再帰エラー等）。
- Plan 014 が未実施で flake.nix の同じ領域に触る必要が出た場合 — 順序が崩れている。

## Maintenance notes

- 実際の差分投入（仕事用 email 等）はユーザーが hosts に 1 行足すだけ。その際 CI の両ホスト eval が green であることを必ず確認。
- casks のホスト分割が必要になったら、共有 casks を `common-casks` として let に括り出し、per-host モジュールで `homebrew.casks = common ++ extra` にする形を extraModules 内で取る（機構は今回の口で足りる）。
- レビュー時の注目点: `{ username }` → `hostAttrs` の引数パターン変更で typo った属性名が**黙ってデフォルトに落ちる**ようになる（閉じたパターンなら eval エラーになっていた）。hosts に書く属性名のレビューは今後人間の仕事。
