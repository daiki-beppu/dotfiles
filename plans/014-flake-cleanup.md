# Plan 014: flake.nix のコメントドリフトと未使用 tap を掃除する

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat e0a2d44..HEAD -- flake.nix`
> If the file changed since this plan was written, compare the "Current state"
> excerpts against the live code before proceeding; on a mismatch, treat it as
> a STOP condition.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none（ただし Plan 016 が flake.nix を構造変更するため、016 より**先**に実施する）
- **Category**: tech-debt
- **Planned at**: commit `e0a2d44`, 2026-07-09

## Why this matters

2 点の設定ドリフトが誤編集を誘発する状態にある。(1) `allowUnfreePredicate` のコメントは「BSL ライセンスの terraform を個別許可」だが、リストには `zsh-abbr` も入っている（Plan 004 実施時に eval を通すため追加された）。nixpkgs 上の zsh-abbr は MIT のはずで、本当に unfree 判定されるのか未検証 — 不要なら消すべきだし、必要ならコメントに理由が要る。コメントと実体がズレたままだと、将来「掃除」で必要なエントリが消されるか、逆にカーゴカルトで無関係なパッケージが足される。(2) Homebrew tap `libsql/sqld` は宣言されているが、brews / casks のどこにもこの tap 由来のパッケージが無い（`turso` は `tursodatabase/tap`、`cmux` は `manaflow-ai/cmux`）。`onActivation.cleanup = "none"` なので実機からも自動除去されず、brew update のたびに無駄に fetch される。

## Current state

- `flake.nix:48-49`:

```nix
                # BSL ライセンスの terraform を個別許可（nixpkgs unfree 制限の回避）
                nixpkgs.config.allowUnfreePredicate = pkg: builtins.elem (lib.getName pkg) [ "terraform" "zsh-abbr" ];
```

- `flake.nix:121-130`:

```nix
                  taps = [
                    "manaflow-ai/cmux"
                    "libsql/sqld"
                    "tursodatabase/tap"
                  ];

                  brews = [
                    "ni"
                    "tursodatabase/tap/turso"
                  ];
```

- `nix/packages.nix:30` — `zsh-abbr` が `home.packages` に入っている（unfree 判定の検証対象）。
- `plans/README.md` の 004 行 — 「zsh-abbr は unfree のため flake.nix の allowUnfreePredicate に追加」という当時の実施記録。

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Nix eval (両ホスト) | `nix eval '.#darwinConfigurations."mba".system.drvPath'` / 同 `"MacBook-Pro-3"` | exit 0 |
| zsh-abbr のライセンス確認 | `nix eval --raw 'nixpkgs#zsh-abbr.meta.license.shortName'` あるいは `nix eval 'nixpkgs#zsh-abbr.meta.license'` | ライセンス情報が表示される |

## Scope

**In scope**:
- `flake.nix`（`allowUnfreePredicate` の行とコメント、`taps` の 1 エントリのみ）

**Out of scope**:
- `casks` / `brews` の他のエントリ
- `nix/packages.nix`（zsh-abbr パッケージ自体は残す）
- flake の構造（hosts / mkDarwin）— Plan 016 の領分
- 実機での `brew untap libsql/sqld` — 宣言除去のみ。実機側の掃除は Maintenance notes に記載してユーザーに委ねる

## Git workflow

- Branch: `chore/flake-cleanup`（worktree 上で作業 — repo 規約）
- Commit message 例: `chore(flake): unfree コメントを実体に合わせ、未使用の libsql/sqld tap を除去`
- Push / PR 作成はユーザー指示があるまでしない

## Steps

### Step 1: zsh-abbr が本当に unfree 判定か検証する

まず `flake.nix` の flake が pin している nixpkgs で確認する（レジストリの nixpkgs ではなくロック済み入力で見るのが正確）:

```bash
nix eval '.#darwinConfigurations."mba".pkgs.zsh-abbr.meta.license' 2>&1 | head -5
```

（このパスで届かなければ `nix eval --impure --expr '(builtins.getFlake (toString ./.)).inputs.nixpkgs' ...` 系は深追いせず、次の分岐テストだけで判定してよい）

次に判定テスト: `flake.nix` の predicate リストから `"zsh-abbr"` を外して両ホストを eval する。

- **eval が通る** → zsh-abbr はリストから恒久的に外し、コメントを「BSL ライセンスの terraform を個別許可（nixpkgs unfree 制限の回避）」のまま維持。
- **eval が unfree エラーで失敗する** → `"zsh-abbr"` を戻し、コメントを実体に合わせて更新（例: 「unfree 判定されるパッケージの個別許可: terraform (BSL), zsh-abbr (nixpkgs 上の判定理由をエラーメッセージから転記)」）。

**Verify**: どちらの分岐でも、最終状態で両ホストの `nix eval ... system.drvPath` が exit 0、かつコメントがリストの全エントリを説明している

### Step 2: libsql/sqld tap を除去する

`taps` から `"libsql/sqld"` の行を削除。

**Verify**: `rg -n 'libsql' flake.nix` → 0 件、両ホストの eval が exit 0

## Test plan

Nix eval（両ホスト）が唯一の自動検証。Homebrew の宣言は eval では検証されない（tap 名の typo は実機 switch まで分からない）が、今回は**削除のみ**なので switch での破壊リスクは無い。

## Done criteria

Machine-checkable. ALL must hold:

- [ ] 両ホストの `nix eval '.#darwinConfigurations."<host>".system.drvPath'` が exit 0
- [ ] `rg -n 'libsql' flake.nix` → 0 件
- [ ] `allowUnfreePredicate` のコメントがリストの全エントリと対応している（zsh-abbr を外した場合はリストが `[ "terraform" ]` に戻っている）
- [ ] `git status` で変更が flake.nix のみ
- [ ] `plans/README.md` の 014 行を更新（Step 1 の判定結果も一行で記録）

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 の eval エラーが unfree 以外の原因に見える場合（エラーメッセージを添えて報告）。
- `flake.nix:48-49` / `:121-130` が「Current state」と一致しない（drift）。

## Maintenance notes

- 実機側の掃除（任意）: 次回 rebuild 後に `brew untap libsql/sqld` を手動実行すると fetch の無駄が消える。`cleanup = "none"` の方針上、自動では消えない。
- `allowUnfreePredicate` に今後エントリを足すときは、コメントに「パッケージ名 (ライセンス種別)」を併記する運用にする。
- Plan 016（per-host 構造化）が flake.nix を大きく触る。コンフリクト回避のため本プランを先に。
