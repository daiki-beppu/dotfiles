# Plan 001: GitHub Actions CI を追加し、flake 評価と shellcheck の検証基盤を確立する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 3dbd88e..HEAD -- flake.nix nix/ config/.claude/hooks/ config/.claude/statusline-command.sh config/.local/bin/ .github/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `3dbd88e`, 2026-07-09

## Why this matters

このリポジトリには CI が一切ない（`.github/` ディレクトリ自体が存在しない）。一方で、このリポジトリの開発は takt / issue-direct スキル経由の AI エージェント実装が主で、それらのスキルは「PR 作成 → **CI green まで監視** → 完了」を完了条件に定めている（`config/.claude/skills/takt-issue/SKILL.md` の Step 5-C 等）。checks がゼロの現状では「CI green」が常に空虚に成立し、壊れた Nix 設定やシェルスクリプトがそのまま main に入る。この plan が入ると、flake の評価エラーとシェルスクリプトの error 級の欠陥が PR 段階で機械的に検出される。これは後続の Plan 002（flake の大きめのリファクタ）の安全網でもある。

## Current state

- `.github/` — 存在しない。`ls .github` → `No such file or directory`（2026-07-09 確認済み）。
- `flake.nix` — リポジトリのエントリポイント。現在 `darwinConfigurations."MacBook-Pro-3"` の 1 構成のみ定義:

```nix
# flake.nix:25-31
    let
      username = "daikibeppu";
      hostname = "MacBook-Pro-3";
      system = "aarch64-darwin";
    in
    {
      darwinConfigurations.${hostname} = nix-darwin.lib.darwinSystem {
```

- シェルスクリプトは 6 本（すべて bash）:
  - `config/.claude/hooks/copy-env.sh`
  - `config/.claude/hooks/reject-grep.sh`
  - `config/.claude/hooks/reject-raw-pm.sh`
  - `config/.claude/hooks/sync-codex-skills.sh`
  - `config/.claude/statusline-command.sh`
  - `config/.local/bin/open-browser`
- shellcheck の現状（2026-07-09、shellcheck 0.11.0 で確認済み）: `--severity=error` では **6 本すべて指摘ゼロ（exit 0）**。`--severity=warning` では 2 ファイルに指摘あり。したがって CI ゲートは `--severity=error` で開始する（今日から green）。warning 対応はこの plan のスコープ外（Maintenance notes 参照）。
- flake の評価は成功する（2026-07-09 確認済み）: `nix eval .#darwinConfigurations --apply builtins.attrNames` → `[ "MacBook-Pro-3" ]`。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| flake 評価（ローカル検証） | `nix eval .#darwinConfigurations."MacBook-Pro-3".system.drvPath` | `"/nix/store/....drv"` 形式の文字列が出力され exit 0 |
| shellcheck（ローカル検証） | `nix run nixpkgs#shellcheck -- --severity=error config/.claude/hooks/*.sh config/.claude/statusline-command.sh config/.local/bin/open-browser` | 出力なし、exit 0 |
| workflow 構文検証 | `nix run nixpkgs#actionlint -- .github/workflows/ci.yml` | 出力なし、exit 0 |

（すべて recon 時に実機で動作確認済みのコマンド。`nix run` の初回はダウンロードが走るが正常）

## Scope

**In scope**（変更してよいファイル）:
- `.github/workflows/ci.yml`（新規作成）
- `README.md`（CI バッジ追加は任意。追加する場合のみ）

**Out of scope**（触らない）:
- shellcheck の warning 級指摘の修正（別途。ゲートを error 級にすることで今回は不要）
- `flake.nix` / `nix/packages.nix` の変更（Plan 002 の領分）
- スキルファイル（`config/.claude/skills/**`）へのチェック追加（Maintenance notes の将来項目）

## Git workflow

- このリポジトリの規約: **開発は必ず worktree 上で行う**（リポジトリ本体で直接ブランチを切らない。手動 worktree は `$REPO_ROOT/.worktrees/<slug>/`、gitignore 済み）
- Branch: `feat/ci-baseline`（既存の命名例: `feat/takt-review`, `fix/issue-normalize-takt-compat`）
- Commit message: conventional commits 日本語。例（`git log` より）: `feat(skills): issue テンプレの影響ファイルに兄弟入口・貫通先の列挙を追加`。この plan なら `feat(ci): nix flake 評価と shellcheck の CI を追加` など
- push / PR 作成はオペレーターの指示があるときのみ

## Steps

### Step 1: CI workflow ファイルを作成する

`.github/workflows/ci.yml` を新規作成し、以下の内容を書く:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  nix-eval:
    name: Nix flake evaluation
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      - uses: DeterminateSystems/nix-installer-action@v16
      - name: Evaluate darwin configuration
        run: |
          nix eval .#darwinConfigurations --apply builtins.attrNames
          for host in $(nix eval --raw .#darwinConfigurations --apply 'a: builtins.concatStringsSep " " (builtins.attrNames a)'); do
            echo "evaluating $host"
            nix eval ".#darwinConfigurations.\"$host\".system.drvPath"
          done

  shellcheck:
    name: ShellCheck (severity=error)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install shellcheck
        run: sudo apt-get update && sudo apt-get install -y shellcheck
      - name: Run shellcheck
        run: |
          shellcheck --severity=error \
            config/.claude/hooks/*.sh \
            config/.claude/statusline-command.sh \
            config/.local/bin/open-browser
```

設計意図（変更するな、の理由）:
- `nix-eval` はホスト名をハードコードせず attrNames から列挙する。Plan 002 でホストが 2 つに増えても CI 変更が不要になる。
- `system.drvPath` の eval は darwin モジュール全体（home-manager 含む）の評価を強制する。ビルドはしない（macos runner で全ビルドすると遅くコストが高いため意図的に eval 止まり）。
- shellcheck は `--severity=error`。現状 warning 指摘が 2 ファイルにあり、warning ゲートだと初日から red になるため。

**Verify**: `nix run nixpkgs#actionlint -- .github/workflows/ci.yml` → 出力なし、exit 0

### Step 2: CI が検出対象を実際に検出することをローカルで確認する

ローカルで CI と同じコマンドを実行して green になることを確認:

**Verify 1**: `nix eval .#darwinConfigurations."MacBook-Pro-3".system.drvPath` → `"/nix/store/....drv"` が出力され exit 0
**Verify 2**: `nix run nixpkgs#shellcheck -- --severity=error config/.claude/hooks/*.sh config/.claude/statusline-command.sh config/.local/bin/open-browser` → 出力なし、exit 0

### Step 3: 否定テスト（ゲートが機能する証拠）

一時的に `config/.claude/hooks/copy-env.sh` の末尾に構文エラー行 `if [` を追加し、shellcheck が exit 非 0 になることを確認してから、**必ずその行を削除して元に戻す**。

**Verify**: エラー行追加時に shellcheck が exit 非 0 → 行削除後に exit 0 に戻る。`git diff config/.claude/hooks/copy-env.sh` → 差分なし

## Test plan

このリポジトリにテストスイートは存在しない（CI そのものがこの plan の成果物）。Step 2 のローカル green 確認と Step 3 の否定テストがテストに相当する。PR を作成した場合は Actions タブで両ジョブが green になることを確認する。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `.github/workflows/ci.yml` が存在する
- [ ] `nix run nixpkgs#actionlint -- .github/workflows/ci.yml` が exit 0
- [ ] `nix eval .#darwinConfigurations."MacBook-Pro-3".system.drvPath` が exit 0
- [ ] `nix run nixpkgs#shellcheck -- --severity=error config/.claude/hooks/*.sh config/.claude/statusline-command.sh config/.local/bin/open-browser` が exit 0
- [ ] `git status` で in-scope 外のファイルに変更がない
- [ ] `plans/README.md` のステータス行を更新した

## STOP conditions

Stop and report back (do not improvise) if:

- `.github/` ディレクトリがすでに存在し、中に workflow がある（この plan の前提「CI 皆無」が崩れている）
- Step 2 の flake 評価がローカルで失敗する（flake が壊れている＝先に直すべき別問題）
- shellcheck `--severity=error` が現状のスクリプトで指摘を出す（この plan 作成時点ではゼロだった。ドリフトしている）
- `flake.nix` の `darwinConfigurations` の構造が Current state の抜粋と一致しない

## Maintenance notes

- **Plan 002 との相互作用**: 002 がホストを追加しても Step 1 の列挙ループがそのまま吸収する。CI 側の変更は不要のはず（002 の done criteria で確認される）。
- **将来の強化（今回は意図的に見送り）**: ① shellcheck を `--severity=warning` に引き上げ（現状 2 ファイルの指摘を先に修正）② スキル整合性チェック（例: `rg -l 'architecture-review\.md' config/.claude/skills/` が空であること等の rg ベース assertion。takt-issue だけで 29 commit の churn があり、今回の監査で 3 件の契約矛盾が見つかったため、再発防止の効き目が大きい）③ `nix flake check` の追加。
- レビュー時の注視点: workflow の `on:` 条件が意図通りか（fork PR での secrets 不要、read-only なので安全）。
