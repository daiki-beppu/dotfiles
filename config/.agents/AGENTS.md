# Claude Code 設定

## ブラウザ操作

通常のブラウザ操作（閲覧・クリック・入力・画面確認）は、実行中の各エージェントが提供する Browser（Use Browser）または Computer Use の機能を使う。その環境のツール・スキルの手順に従い、委任先にも同じ方針を伝える。

次の 2 つの場合は `chrome-devtools` スキルを使う。

- 通信・JavaScript エラー・性能・メモリなどの詳細な診断で、標準機能では必要な情報を取得できない場合
- Browser / Computer Use が無い環境（CLI など）で、UI の変更後に画面を確かめる場合

どちらの手段も使えない場合は、その制約を報告する。

## 開発ワークフロー

### Wayfinder 完了後の起票

Wayfinder の map 完了後に実装 issue を起票するときは、Matt Pocock の `to-spec` → `to-tickets` の流れに従う。map と決定 ticket を `to-spec` で仕様にまとめ、その仕様を `to-tickets` で実装 ticket に分割して起票する。仕様が既に完成していれば `to-tickets` から進める。各スキルの手順とリポジトリの issue tracker 設定を使う。

起票時は、実装全体の目的・仕様への参照・完了条件を持つ親 issue を作成し、分割した実装 issue をすべて GitHub のネイティブな sub-issue 関係で紐付ける。同じ実装範囲の親 issue が既にあれば再利用する。各 issue の本文に親へのリンクを記載するだけでは完了とせず、親から全 sub-issue を取得して紐付けを確認し、親と子の URL を報告する。実装 issue 間の blocking 関係も `to-tickets` の分割案に従って設定する。

### main を最新化してから作業開始

古い main から派生した worktree は、無用な merge conflict と「すでに main に入っている変更の再実装」を引き起こす。前者は事後の `git merge main` で払えるが、**後者は書いてしまった時点で回復できない**（マージ時に「同じことを別の書き方でやっている」コンフリクトとして初めて発覚する）。

worktree を作る前に `git fetch origin` を実行し、`--base-branch origin/main` を明示して切る。

**落とし穴**: `--base-branch` を省くと Orca の repo の既定の base ref（`orca repo set-base-ref` で設定）から切られる。サブエージェントの isolation worktree は、Claude Code の `worktree.baseRef: "head"` に従い、**セッションの cwd の HEAD** から分岐する（メインチェックアウトの main ではない）。

### worktree 必須

開発作業（コード編集 / コミット / PR 化）は **必ず worktree 上で行う**。リポジトリ本体のメイン作業ツリーで直接ブランチを切って作業してはならない（進行中の他作業との衝突を避けるため）。

worktree は **Orca 経由で作る**: `orca worktree create --repo name:<repo> --name <slug> --base-branch origin/main`（置き場は Orca の workspace、ブランチは Orca が作る。依存 install などは Orca の repo の setup script が実行する）。手動の `git worktree add` や Claude Code の `--worktree` / EnterWorktree は使わない（例外: takt 自動生成の `<repo-parent>/takt-worktrees/` は takt CLI が管理し、サブエージェントの isolation worktree は Claude Code が管理する）。repo が Orca に未登録なら `orca repo add` で登録する。

不要になった worktree は `orca worktree rm` で消す（Orca のメタデータと git の両方から外れる）。まとめて整理するなら `/clean-branch`。

### worktree に .env を持ち込む

worktree は新規チェックアウトなので `.env` 等の未追跡ファイルが存在しない。リポジトリルートに `.worktreeinclude`（`.gitignore` 構文）を置くと、worktree 作成時に自動コピーされる（gitignore 済みファイルのみが対象で、追跡ファイルは複製されない）。

```text
.env
.env.local
config/secrets.json
```

gitignore された設定ファイルを持つリポジトリでは、**worktree を使う前に必ず `.worktreeinclude` を置く**（置き忘れると worktree でだけ `.env` が無い状態になり、原因が分かりにくい）。

`.worktreeinclude` は Codex（ChatGPT デスクトップアプリ）とも同名・同構文の共通仕様なので、1 つ置けば両方に効く（Codex 側は `AGENTS.override.md` を列挙なしで自動コピーする）。

**落とし穴**: `.worktreeinclude` が効くのは **エージェントが worktree を作るとき**（Claude Code の `--worktree` / EnterWorktree / subagent / Desktop、Codex デスクトップの Worktree チャット）だけ。Orca・手動 `git worktree add`・Codex CLI・takt では適用されない。Orca で作る worktree に `.env` 等を持ち込むときは、Orca の repo の setup script でコピーする。
