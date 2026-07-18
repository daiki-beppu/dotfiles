---
name: takt-clean
description: "takt-worktrees 配下の残骸(マージ済み full clone / 空骨組み)を安全側判定でスイープして容量を回復する。「takt 掃除」「takt worktree 残骸」「takt-clean」「takt の容量」で発動。ブランチ削除は clean-branch、collections のメディア掃除は live-clean を使う"
---

# takt-clean — takt worktree 残骸のスイープ

takt は task ごとに `<repo-parent>/takt-worktrees/<timestamp>-<N>-<slug>/` へ full clone
（venv / node_modules 込みで 1 個 800MB〜3GB）を作る。takt-issue スキルの Step 6 を通らない
経路（一括 `takt run`、手動実行、セッション中断）ではクリーンアップが走らず残骸が溜まるため、
本スキルが発生源を問わない定期回収（GC）を担う。

## Hard Gates

- **削除条件を満たさないものは絶対に消さない**（fail-closed）。判定不能・未コミット変更あり・
  PR 未マージ・origin なしはすべて [KEEP] 報告のみ
- [KEEP] 分の解消（手動削除 / issue 化 / PR 化）は**ユーザーに提示して判断を仰ぐ**。勝手に消さない

## 実行

```bash
# dry-run(削除せず判定だけ表示)
bash ~/.claude/skills/takt-clean/references/sweep.sh --dry-run

# 実削除
bash ~/.claude/skills/takt-clean/references/sweep.sh

# 対象 root を明示(複数可。省略時は ~/02-yt/takt-worktrees)
bash ~/.claude/skills/takt-clean/references/sweep.sh ~/02-yt/takt-worktrees /path/to/other/takt-worktrees
```

## 削除判定（sweep.sh の実装と同一）

以下の**いずれか**を満たす場合だけ削除する:

| 条件 | 根拠 |
|---|---|
| dirty なし + ブランチの PR が **MERGED**（`gh pr list --head <branch> --state merged`） | squash merge では ahead 判定が使えないため PR 状態を正とする |
| dirty なし + HEAD が origin デフォルトブランチの祖先 | 独自コミットが存在しない |
| git 管理外かつファイルが 1 つもない空ディレクトリ | takt が再作成するログ用骨組み。失うものがない |

linked worktree（`.git` がファイル）は親リポジトリの `git worktree remove` + `prune` で消し、
full clone（`.git` がディレクトリ）は `rm -rf` する。

## 定期実行（launchd）

`~/Library/LaunchAgents/com.daiki-beppu.takt-clean.plist` が毎週月曜 10:00 に実削除モードで
実行し、ログを `~/Library/Logs/takt-clean.log` に追記する。

```bash
# 状態確認
launchctl print "gui/$(id -u)/com.daiki-beppu.takt-clean" | head -20

# 手動トリガー
launchctl kickstart "gui/$(id -u)/com.daiki-beppu.takt-clean"

# 直近の実行結果
tail -50 ~/Library/Logs/takt-clean.log
```

plist の実体は dotfiles の `config/.claude/skills/takt-clean/references/com.daiki-beppu.takt-clean.plist`。
変更したら `~/Library/LaunchAgents/` へコピーし直して `launchctl bootout` → `bootstrap` で再読込する。

## [KEEP] が出たときの対応

| 理由 | 対応 |
|---|---|
| 未コミット変更あり | 中身を確認し、必要なら issue/PR 化、不要なら手動 `rm -rf` |
| 未マージコミットあり | 対応する PR/issue の状態を確認。放置ブランチなら PR 化か破棄を判断 |
| origin なし | push 手段がない clone。中身を確認して手動判断 |
| fetch 失敗 / 判定不能 | ネットワーク復帰後に再実行 |

## 関連スキル

- **clean-branch**: メインリポジトリのマージ済みローカルブランチ削除（本スキルは worktree/clone 側）
- **takt-issue**: 正常系のクリーンアップ（Step 6）。本スキルはそこから漏れた分の保険
- **live-clean**: collections 配下のメディア・tmp 掃除（takt とは無関係）
