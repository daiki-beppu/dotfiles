---
name: takt-sync
description: >-
  takt を新バージョンへ更新し、カスタム workflow 資産(config.yaml / workflows /
  facets / schemas)を追随させる。「takt 更新」「takt を最新に」「takt のバージョン上げて」
  「takt 追随」「takt の changelog 確認して」「takt の BREAKING 対応」など、
  takt のバージョンアップやそれに伴う資産移行の文脈で、対象ファイルが明示されなくても使用すること。
  takt 以外のパッケージ追加・更新には使わない(それは nix スキルの領分)。
---

# takt バージョン追随

## 概要

takt 本体の更新(nix flake)と、複数リポジトリに分散したカスタム workflow 資産の移行を一気通貫で行う。

設計の骨子:

- **調査と適用を分ける**。BREAKING 対応は機械的だが、新機能の採用は好みの判断を含む。
  調査レポートを提示して適用範囲を合意してから変更する
- **資産の所在はレジストリで管理する**。カスタム workflow はプロジェクトごとの `.takt/` に
  分散しており(dd218c5 の方針)、コードからは所在を導出できない。
  [references/registry.md](references/registry.md) が逆引きインデックス
- **switch 前に新バージョンで検証する**。Nix はバージョンを store に並存できるので、
  `nix run 'github:nrslib/takt/vX.Y.Z' -- workflow doctor <path>` で
  環境を切り替えずに新バイナリの検証が通る(動作確認済み)

## フェーズ 1: 調査(読み取り専用)

### 1. バージョン差分の把握

```sh
takt --version                                        # インストール済み
grep 'takt.url' ~/01-dev/dotfiles/flake.nix           # flake のピン(通常は一致)
gh api repos/nrslib/takt/tags --jq '.[].name' | head -3   # 最新タグ
```

GitHub Releases は使われていない。**タグ + CHANGELOG.md が正**。
インストール済みと flake ピンが不一致なら switch 忘れなので先に指摘する。

### 2. CHANGELOG 差分の取得

```sh
gh api repos/nrslib/takt/contents/CHANGELOG.md --jq .content | base64 -d
```

Keep a Changelog 形式で、破壊的変更には `**BREAKING:**` マーカーが付く。
現行バージョンから最新までの**全セクション**を読む(1 つ飛ばすと中間バージョンの
deprecation を見逃す)。日本語版は `docs/CHANGELOG.ja.md`。

### 3. 資産棚卸しとトリアージ

対象資産は [references/registry.md](references/registry.md) を参照。
最初にレジストリの鮮度を確認する:

```sh
find ~/01-dev -maxdepth 3 -type d -name .takt -not -path '*worktree*' 2>/dev/null
```

レジストリにないプロジェクトが見つかったら、資産の有無(workflows/ facets/ schemas/
config.yaml)を確認してレジストリを更新する。`tasks/` `runs/` `clone-meta/` 等は
takt の実行時状態であり資産ではない(移行対象外)。

CHANGELOG の各項目(BREAKING / Deprecated / Changed)× 各資産で該当判定し、表にする:

| 変更 | 種別 | 該当 | 対応 |
|------|------|------|------|
| cost_tier → routing_tier 改名 | BREAKING | あり: config.yaml の auto_routing | キー改名 + default_pool 追加 |
| for-local-llm 削除 | BREAKING | なし(未使用) | — |

Added 項目は運用利益の明確さで扱いを分ける:

- **運用利益が明確なもの → デフォルト採用**として調査レポートに含める(ユーザーは
  レポート確認時に外せる)。「明確」の目安: 既知の運用課題(トークン消費・レビュー空転・
  止まらないループ等)を直接解決する、または既に手動でやっていることの自動化。
  前例: v0.52 の auto_requeue_max_attempts
- **利益が好みに依存するもの → 採用候補として列挙**に留める。目安: 既存カスタム資産と
  役割が被る(例: v0.54 の simple family は lite と競合)、運用スタイルの変更を伴う

deprecated の後継機能(v0.52 の persona_providers → provider_routing のような
置き換え)は「採用」ではなく「移行」なので必須対応に含める。

### 4. 検証ベースラインの取得

**更新前に** 各カスタム workflow へ doctor を実行し、既存エラーを記録する:

```sh
cd <project> && takt workflow doctor    # 引数なしでプロジェクトの全 workflow を検証
```

これを飛ばすと、更新後のエラーが「更新起因」か「元から壊れていた」か区別できなくなる
(実例: youtube-automation の lite.yaml は v0.53.0 時点で既に invalid。registry.md 参照)。

### 5. 調査レポートの提示

トリアージ表・採用候補・ベースライン結果を提示し、適用範囲を合意してからフェーズ 2 へ。

## フェーズ 2: 適用

### 1. takt 本体の更新(dotfiles)

worktree を切り、README「よくある操作」の手順で更新する:

```sh
# flake.nix の takt.url のタグを上げてから
nix flake update takt
```

着手前に `git worktree list` で更新用 worktree が既に進行中でないか確認する
(flake 更新だけ先行しているケースがある)。

`sudo darwin-rebuild switch` は特権が要るためユーザーに依頼する
(`! sudo darwin-rebuild switch --flake ~/01-dev/dotfiles` をプロンプトに入力してもらう)。

### 2. 資産の移行

- グローバル設定: dotfiles の `config/.takt/config.yaml`(`~/.takt/config.yaml` に symlink)
- プロジェクト資産: 各リポジトリで worktree を切って移行する(リポジトリごとに別 PR)

移行の判断に迷ったら過去事例(registry.md の「移行事例」)とパターンを揃える。

### 3. 検証

switch 前でも新バージョンで検証できる:

```sh
nix run 'github:nrslib/takt/vX.Y.Z' -- workflow doctor <workflow.yaml>
```

全カスタム workflow の doctor が(ベースラインに無かった)新規エラーゼロになるまで直す。
プロンプト組み立てまで見たい場合は `takt prompt <workflow>` を使う。

### 4. 記録

commit message に BREAKING トリアージの結論を残す(#118 の前例)。次回更新時に
「どこまで確認済みか」を git log から追えるようにするため:

```text
chore(nix): takt を v0.54.1 に更新

BREAKING 2 件(cost_tier 改名・Node >= 24.15.0)のうち前者は config.yaml を
移行、後者は該当なしを確認済み。
```

移行事例として意味のある更新(config 移行を伴ったもの)は registry.md の
「移行事例」にも追記する。
