---
name: free-disk-space
description: >-
  macOS のディスク空き容量を回収する(ビルド成果物・パッケージキャッシュの掃除、nh での
  Nix 世代整理、外部ドライブへのメディア退避)。「ディスクがいっぱい」「空き容量を増やして」
  「No space left on device」など空き容量への不満があれば、対象の指定が無くても発動。
  --dry-run で計測レポートのみ。
---

## Overview

ディスクを計測し、承認されたビルド成果物とキャッシュを片付け、実際の空き容量を報告する。メディア退避は Step 7 の別手順で扱う。

設計の骨子:

- **ビルド成果物は Trash、キャッシュは純正 cleanup**。ゴミ箱を空にするのはユーザーだけが行う
- **「再生成可能」と「消してよい」は別物**。node_modules は再生成できるが、作業中プロジェクトなら dev サーバーが即死し、再インストールにも時間がかかる。だから一覧承認制にしている
- **既存の仕組みに委譲する**: Nix の掃除は `nh`（週次 launchd daemon で自動化済み）、worktree 残骸は `/clean-branch`。このスキルで再実装しない

## Invocation variants

- Bare invocation → Step 1〜8 を通す（計測 → 調査 → 承認 → 削除 → Nix 確認 → worktree 委譲 → 退避提案 → 再計測）。
- `--dry-run` → Step 3 の分類別一覧までを出して**停止する**。何も削除しない。
- `--builds` / `--caches` → 削除スコープをビルド成果物のみ / キャッシュのみに絞る（併用可）。
- `--nix` → Step 5 だけを実行する。`nh clean all --dry` の報告と提案だけで、何も削除しない。
- `--archive` → Step 1 でドライブを確認し、Step 7 の退避と Step 8 の検証・報告を行う。

`--dry-run` は全変種に優先する。計測と計画提示だけで止め、cleanup・コピー・Trash 移動・symlink 作成を行わない。

## 実行スタイル

- **ビルド成果物の削除は `trash` 経由**。CLI が無ければその削除だけ未実行とし、計測・報告を続ける。`rm` への代替はしない
- **ゴミ箱を空にする操作は行わない**。ユーザーに依頼する
- **進め方**: 計測と一覧作成は自律的に進め、承認済みの同じ対象は聞き直さない。結果と追加の判断が必要な項目だけ簡潔に伝える
- **スコープを広げない**: 承認された一覧の範囲だけを削除する。調査中に見つけた「ついで」の削除はしない

## Instructions

### 1. 計測

```bash
df -h /System/Volumes/Data   # APFS ではルートは封印スナップショット側。`df /` では実容量が見えない
ls /Volumes                  # 外部ドライブの有無（Step 7 の退避提案に使う）
```

### 2. 調査（targeted du）

ホーム全体のフルスキャンはしない。当たりのある場所だけ測る:

```bash
# ビルド成果物（-prune で発見ディレクトリ以下へ潜らない = 入れ子の二重計上を防ぐ）
find ~/ghq -maxdepth 6 -type d \
  \( -name node_modules -o -name .next -o -name dist -o -name .turbo -o -name target \) \
  -prune -print0 2>/dev/null | xargs -0 du -sh 2>/dev/null | sort -hr | head -30

# パッケージマネージャキャッシュ（bun は `bun pm cache` が要 package.json のためパス直書き）
du -sh "$(pnpm store path)" ~/.npm ~/.bun/install/cache "$(uv cache dir)" "$(brew --cache)" 2>/dev/null

# Claude Code 関連の肥大（報告のみ。projects/ は Claude Code 管理領域）
du -sh ~/.claude/projects ~/.claude/plugins ~/.claude/backups ~/.claude/shell-snapshots 2>/dev/null

# worktree 残骸（大きければ Step 6 で /clean-branch を提案）
find ~/ghq -maxdepth 6 -type d -path '*/.claude/worktrees' -prune -print0 2>/dev/null \
  | xargs -0 du -sh 2>/dev/null | sort -hr

# メディア・大物（報告のみ）
du -sh ~/Movies ~/Music ~/Downloads ~/Library/Developer 2>/dev/null
```

GUI アプリの `~/Library/Caches/<App>` / `~/Library/Application Support/<App>` はサイズ報告のみに留める（Rules 参照）。

### 3. 分類別一覧を提示して承認を取る

ここがこのスキルの安全境界。以下の 3 分類でサイズ付き一覧を提示し、**削除スコープの承認を得てから** Step 4 に進む:

| 分類 | 中身 | 扱い |
|---|---|---|
| **ビルド成果物** | node_modules, .next, dist, target, DerivedData | 一覧承認制。各項目に親プロジェクトの最終更新日を添える（最近触ったものは dev サーバー稼働中の可能性を明記） |
| **キャッシュ** | pnpm store, npm, bun, uv, brew | 純正 prune コマンドで掃除（承認は一覧提示に含めて一括でよい） |
| **報告のみ** | メディア、GUI アプリデータ、~/.claude 配下 | サイズを見せるだけ。削除しない。外部ドライブがあれば Step 7 の退避を提案 |

### 4. 承認分の削除

```bash
# ビルド成果物: 承認されたものを Trash へ
trash <path> ...

# キャッシュ: ツール純正コマンドを使う（ディレクトリ直接削除はツール内部の整合性を壊す）
pnpm store prune
npm cache clean --force
bun pm cache rm   # package.json のあるディレクトリでしか動かない。無ければ ~/.bun/install/cache を trash してよい（中身は再取得可能な DL キャッシュのみ）
uv cache prune
brew cleanup --prune=all
```

node_modules を Trash に送った**後に** `pnpm store prune` を実行する。store の実体は node_modules からのハードリンク参照が切れて初めて「孤立」扱いになるため、順序が逆だと効果が薄い。

### 5. Nix は nh 経由で確認のみ

```bash
nh clean all --dry   # 削減見込みの表示だけ。実削除はしない
```

- 週次の launchd daemon（root）が自動掃除しているので、通常はここで削れるものは少ない
- dry の結果まとまった量があれば、ユーザーに `! sudo nh clean all` の実行を提案する。`useUserPackages = true` のため世代は root 所有のシステムプロファイルに積まれ、ユーザー権限の `nh clean user` では消えない
- `/nix/store` を直接操作しない（store の整合性は Nix だけが保証できる）

### 6. worktree 残骸は /clean-branch に委譲

Step 2 で `.claude/worktrees/` が大きかったリポジトリがあれば、`/clean-branch` の実行を提案する。worktree の安全判定（dirty / unpushed / PR state）はあちらが持っているので、このスキルでは削除しない。

### 7. メディア退避（外部ドライブがマウントされているときのみ）

外部ドライブを確認し、退避元・退避先・検証方法・元データの Trash 移動・symlink 作成を具体化して承認を得る。これらが依頼で指定・承認済みなら再確認せず進む。ドライブが無ければ退避は未実行とし、その理由を報告する。

```bash
rsync -a "<src>/" "/Volumes/<drive>/<dst>/"
rsync -anci "<src>/" "/Volumes/<drive>/<dst>/"   # dry-run + checksum。出力ゼロ = 完全一致を確認
trash "<src>"
ln -s "/Volumes/<drive>/<dst>" "<src>"
```

- コピーと checksum 検証が成功し、差分が無いことを確認してから元データを Trash へ移す。エラーまたは差分があれば元データを保持して停止する
- `~/Movies` のような特殊ディレクトリ全体は symlink しない。中の個別フォルダ単位で退避する
- 退避したデータを使うアプリはドライブ未マウント時に開けなくなることを警告する

### 8. 結果報告と再計測

- 「即時解放」「Trash 内（空にすれば解放）」「触らなかったもの」を分類して報告する
- `df -h /System/Volumes/Data` を再計測して実測の before/after を示す。Trash 内の量を解放済みに数えない。ゴミ箱を空にする必要があればユーザーへ伝え、その操作待ちと承認済み処理の完了を区別する

## Rules

- **`rm -rf` 禁止**。削除は `trash` かツール純正クリーンアップコマンドのみ
- **ゴミ箱を空にする操作は自分では行わない**
- **絶対に触らないもの**:
  - GUI アプリの `~/Library/Caches/<App>` / `~/Library/Application Support/<App>`（ログイン・Cookie・履歴が入っている。消すと再ログイン地獄になる）
  - 音源・ボイスライブラリ（Logic Pro 音源、Synthesizer V / Piapro Studio のボイスバンク。再ダウンロード不能または有償ライセンス紐付き）
  - `~/.claude/projects` / `~/.claude/sessions`（Claude Code 管理領域。transcripts は cleanupPeriodDays が管理する）
  - `/nix/store` への直接操作
  - `~/Library/Mobile Documents`（iCloud 同期領域。ローカル削除がクラウドに伝播する）
- 削除は Step 3、退避は Step 7 で承認された範囲のみ。スコープのフラグは承認や除外対象を変更しない。

## Gotchas

- **ゴミ箱を空にしても df がすぐ減らない**ことがある: APFS の purgeable 領域とローカルスナップショットが原因。`tmutil listlocalsnapshots /` で確認し、スナップショットが残っていれば時間経過で解消される（急ぐ場合のみ `tmutil thinlocalsnapshots` を案内）
