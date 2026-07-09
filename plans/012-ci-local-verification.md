# Plan 012: 検証を scripts/check.sh に一本化し shellcheck 対象を自動検出にする

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e0a2d44..HEAD -- .github/workflows/ci.yml nix/packages.nix`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: 007（`nix/packages.nix` の linkDotfiles を触るため、リンク一覧が確定してから）
- **Category**: dx
- **Planned at**: commit `e0a2d44`, 2026-07-09

## Why this matters

現状 3 つの問題がある: (1) CI の shellcheck はファイル一覧をハードコードしており、repo 内の bash スクリプト 7 本（`config/.claude/skills/turnstile-spin/scripts/*.sh` 6 本 + `config/.claude/skills/diagnose/scripts/hitl-loop.template.sh`）が検査外。今後増えるスクリプトも workflow を編集しない限り黙って網から漏れる。(2) CI と同じ検証をローカルで一発実行する手段がなく、PR 前の確認が「CI 待ち」しかない。(3) デプロイ対象一覧（linkDotfiles）と `config/` 実体の drift を検出する仕組みがない — `.wezterm.lua` が配備漏れしていた実績がある（Plan 007 で修正済みの前提）。単一の `scripts/check.sh` に検証を集約し、CI もローカルもそれを呼ぶ形にして二重管理を無くす。

## Current state

- `.github/workflows/ci.yml` — 全 36 行。2 job:
  - `nix-eval`（9〜21 行、`runs-on: macos-latest`）: `darwinConfigurations` の全ホストを `nix eval ".#darwinConfigurations.\"$host\".system.drvPath"` でループ評価。
  - `shellcheck`（23〜35 行、ubuntu-latest + apt install）:

```yaml
      - name: Run shellcheck
        run: |
          shellcheck --severity=error \
            config/.claude/hooks/*.sh \
            config/.claude/statusline-command.sh \
            config/.local/bin/open-browser
```

- `config/.local/bin/takt-usage-report` は Python（shebang `#!/usr/bin/env python3`）なので shellcheck 対象外が正しい。**shebang 判定**で対象を決めるのが正解で、拡張子や場所では決められない。
- `scripts/` ディレクトリは存在しない。justfile / Makefile / flake `checks` 出力も無い。
- `nix/packages.nix` の linkDotfiles（Plan 007 適用後）が `config/` 配下の何をデプロイするかの一覧を持つ。
- リポジトリは public。GitHub Actions の macOS runner は public repo では無料だが、queue が遅い。nix-eval は純粋な評価で macOS 固有の処理は無い（ビルドしない）ため、Linux runner で動く見込み（要検証 — Step 4）。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| bash スクリプト列挙 | `git ls-files \| while read -r f; do [ -f "$f" ] && head -c 100 "$f" 2>/dev/null \| head -1 \| rg -q '^#!.*\b(ba)?sh\b' && echo "$f"; done` | 10 本（hooks 4 + statusline + open-browser + turnstile 6 + diagnose 1 のうち bash のもの — 実測して確定） |
| shellcheck | `nix run nixpkgs#shellcheck -- --severity=error <files>` | exit 0 |
| Nix eval | `nix eval '.#darwinConfigurations."mba".system.drvPath'` | exit 0 |

## Scope

**In scope**:
- `scripts/check.sh`（新規作成）
- `.github/workflows/ci.yml`
- 自動検出で新たに検査対象になるスクリプトの **error 級指摘の修正のみ**（quoting 等の機械的修正に限る）
- `README.md` は触らない（「よくある操作」への 1 行追記は Plan 013 が担当）

**Out of scope**:
- shellcheck の severity を warning に上げること（既知の deferred 事項）
- flake `checks` 出力の追加 — `nix flake check` 化は魅力的だが、shellcheck を Nix ビルドに包むと sandbox 内コピー等の複雑さが増す。今回はプレーンな bash スクリプトで一本化し、flake checks 化は将来の選択肢として Maintenance notes に残す
- zsh ファイル（`.zshrc` 等）の lint — shellcheck は zsh 非対応

## Git workflow

- Branch: `feat/ci-local-verification`（worktree 上で作業 — repo 規約）
- Commit message 例: `feat(ci): 検証を scripts/check.sh に一本化し shellcheck 対象を shebang 自動検出にする`
- Push / PR 作成はユーザー指示があるまでしない

## Steps

### Step 1: 自動検出で新たに引っかかるスクリプトを triage する

上の列挙コマンドで bash スクリプト全件を出し、`nix run nixpkgs#shellcheck -- --severity=error` を全件にかける。既存 6 ファイル（hooks 4 + statusline + open-browser）は pass するはず（CI 実績）。新規 7 本に error 級指摘があれば:

- 機械的な修正（quoting、`==` → `=` 等）で消えるものは修正する。
- 修正がロジック変更を伴うものは、そのファイルを `scripts/check.sh` 内の明示的な除外リスト（コメントで理由必須）に入れ、報告に含める。

**Verify**: 全対象（除外リスト適用後）で shellcheck --severity=error が exit 0

### Step 2: scripts/check.sh を作る

新規ファイル `scripts/check.sh`（実行権限付き、shebang `#!/usr/bin/env bash`、`set -euo pipefail`）。3 つの検査を関数に分けて順に実行し、最後にサマリを出す:

1. **nix-eval**: 現在の ci.yml の nix-eval ループと同一のロジック（`builtins.attrNames` でホストを列挙して各 `system.drvPath` を eval）。
2. **shellcheck**: `git ls-files` を回して shebang が bash/sh のファイルを動的に検出し、`shellcheck --severity=error` を実行。`shellcheck` が PATH に無ければ `nix run nixpkgs#shellcheck --` に fallback。除外リストは配列で先頭に定義（Step 1 の結果を反映、理由コメント付き）。
3. **link-manifest drift**: `nix/packages.nix` の `link_force "${dotfilesDir}/...` 行から相対パスを抽出し、各パスが `config/` 配下に実在することを確認（dangling 宣言の検出）。逆方向（`config/` 直下のトップレベルエントリで linkDotfiles に登場しないもの）は **warning 出力のみ**とし、exit code には影響させない（`config/.claude/CLAUDE.md` のように directory link 経由で配備されるものが多く、偽陽性を許容できないため。`.claude` / `.takt` / `.config` / `.local` はディレクトリ or 個別リンクで網羅済みなので、チェック対象はトップレベルの通常ファイル — `.zshenv` / `.zshrc` / `.zprofile` / `.wezterm.lua` 級 — に限る)。

`--only nix-eval|shellcheck|links` のような部分実行フラグは**作らない**（YAGNI。必要になったら足す）。

**Verify**: `bash scripts/check.sh` → 3 検査全て pass、exit 0。故意に `config/.zzz-test` 的な壊し方はしない（read-only 検証で十分）

### Step 3: ci.yml を check.sh 呼び出しに置き換える

2 つの job の run ステップを `bash scripts/check.sh` の呼び出しに寄せる。構成の選択肢は 2 つあり、**job 分割は維持**する（失敗箇所が job 名で分かる利点を保つ）:

- `nix-eval` job: checkout + nix-installer + `nix eval` ループを check.sh の nix-eval 部分と同一に保つ…のではなく、check.sh をそのまま呼ぶと shellcheck も走って重複する。そこで check.sh に**引数**を足す: `scripts/check.sh nix-eval` / `scripts/check.sh shellcheck links` のように、引数があればその検査だけ、無ければ全部（Step 2 の「フラグは作らない」はオプション解析のことで、位置引数によるサブセット指定はここで必要になるため実装する。矛盾しているように見えたらこちらが正）。
- `shellcheck` job: apt install を廃止し、`shellcheck` が無ければ nix fallback が効くよう nix-installer を入れるか、apt install を維持して check.sh を呼ぶ（apt 維持のほうが速い — こちらを推奨）。

**Verify**: `rg -n 'check.sh' .github/workflows/ci.yml` → 両 job がスクリプトを呼んでいる。ハードコードのファイル一覧が ci.yml から消えている

### Step 4: nix-eval job の runner を ubuntu-latest に変更する（検証付き・独立コミット）

`runs-on: macos-latest` → `ubuntu-latest` に変更し、**独立したコミット**にする。eval は純粋（ビルド無し・IFD 無し）なので Linux で通る見込みだが、これは MED confidence の変更。PR を出した際に CI が赤くなったらこのコミットだけ revert すればよい構造にしておく。

**Verify**: ローカルでは検証不能（darwin 機のため）。コミット分離ができていることを `git log --oneline -3` で確認

## Test plan

- Step 1 の全件 shellcheck が既存 + 新規スクリプトの回帰確認。
- Step 2 の `bash scripts/check.sh` 実行が結合テスト。
- link-manifest drift 検査の負テスト: 一時的に `link_force "${dotfilesDir}/.nonexistent" ...` 行を packages.nix に足して check.sh が fail することを確認し、**必ず元に戻す**（`git diff` で復元確認）。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bash scripts/check.sh` が exit 0（3 検査 pass）
- [ ] `bash scripts/check.sh nix-eval` が nix-eval のみ実行して exit 0
- [ ] 負テスト（dangling link_force 行）で exit 非 0、復元後に exit 0
- [ ] ci.yml にスクリプト名のハードコード一覧が無い（`rg -n 'open-browser' .github/workflows/ci.yml` → 0 件）
- [ ] runner 変更が独立コミット
- [ ] `git status` で変更が in-scope のみ（check.sh 新規 + ci.yml + 必要なら error 修正したスクリプト）
- [ ] `plans/README.md` の 012 行を更新

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 007 が未実施（`rg -c 'MISSING_SOURCES' nix/packages.nix` → 0）— 依存順序が崩れている。
- Step 1 で新規スクリプトの error 級指摘が 5 件を超え、かつ機械的修正で消えない — triage 結果を報告して指示を仰ぐ。
- linkDotfiles の行フォーマットが「`link_force "${dotfilesDir}/`」のパターンで抽出できない形に変わっていた場合。

## Maintenance notes

- 以後、検証ロジックの変更は `scripts/check.sh` だけを触る。ci.yml は呼び出し側なので原則不変。
- 将来 `nix flake check` に寄せる場合は check.sh の 3 検査を `checks.aarch64-darwin` に移植する（shellcheck を `pkgs.runCommand` で包む）。現時点では bash 一本のほうが保守が軽い。
- Plan 017（skill↔workflow 契約チェック)は check.sh に 4 つ目の検査として同居させる想定。
- Step 4 の runner 変更が CI で赤くなったら、revert して「macos-latest 必須」の理由をこのファイルに追記すること。
