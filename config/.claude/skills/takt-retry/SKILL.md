---
name: takt-retry
description: >-
  takt の failed / aborted な task・run をリトライする手順リファレンス。「takt リトライ」「takt 失敗したのでやり直したい」「takt resume」「requeue して」「失敗 task を再実行」など、takt 実行の失敗からの復帰場面で発動。issue → PR の一気通貫実行は takt-issue スキルを使う。
---

# takt-retry — 失敗した takt 実行のリトライ

> Note: takt v0.51.0 の実装（`taskRetryService` / `features/tasks/resume`）を根拠とする。バージョンが大きく進んだら `takt resume --help` / `takt list --help` で再確認すること。

## Step 0: リトライすべきかの判定（必須・最初に行う）

failed / aborted を見たら、リトライ手段を選ぶ前に**リトライ対象かどうか**を判定する。以下はリトライしない:

| 状況 | 理由 | 代わりにやること |
|---|---|---|
| `diagnose-fix` の診断停止（ABORT） | 診断完了・自動修正条件未達は設計どおりの正常停止 | takt-issue スキル「完了時の確認」の専用ハンドリング（診断レポートを issue にコメント） |
| `feature` / `solid` の scope_review 停止 | 空転・スコープ過大の検知は正常停止 | `.takt/runs/<run_slug>/reports/scope-review.md` を読み、分割起票（to-issues / issue スキル） |
| `lite` workflow の失敗 | 同じ workflow の再実行は同じ理由で落ちやすい | **solid への振り替え**（takt-issue スキル「lite 失敗時の solid への振り替え」: 失敗サマリを issue にコメント → task 破棄 → solid で再 add） |
| max_steps 超過だが続行したいだけ | 失敗ではなく上限到達 | `takt run --ignore-exceed` |

上記に該当しない失敗（一時的なエラー、環境要因、追加指示で直せる失敗）が本スキルのリトライ対象。

## リトライ手段の選択

失敗した実行の**経路**で手段が決まる:

| 失敗した実行 | リトライ手段 |
|---|---|
| queue 経路（`takt add` → `takt run`）の failed task | `takt list`（対話）→ 該当 task を選択 → Requeue / Retry |
| direct run（`takt '#N'` / `takt -t "..."` の直接実行） | `takt resume`（対話） |
| agent（Claude Code 等）から非対話でリトライしたい | 下記「非対話リトライ」 |

## `takt list` — queue task のリトライ（対話）

failed task を選択すると、**既存 worktree を再利用**してリトライできる（worktree は初回実行後も保存されている）。

選択時に決められること:

- **workflow の選び直し**: 前回と同じ workflow を再利用するか、別の workflow（例: lite → solid）に切り替えるか
- **開始 step**: workflow のどの step から再開するか。デフォルトは失敗した step（resume point があればそこ）。初期 step を選べばゼロからやり直し

アクションの違い:

- **Requeue**: 失敗情報から自動生成された retry note を付けて status を `pending` に戻す。**次の `takt run` で実行される**（その場では実行されない）
- **Retry**: 対話で追加指示を入力してから再実行する。リトライモードのコマンド:
  - `/go` — 入力した追加指示から指示書（order.md）を作成して実行
  - `/n` — 前回の指示書（order.md）をそのまま使って再実行
  - `/cancel` — 終了
  - 実行せず pending 保存（save_task）を選ぶと Requeue 相当になる

失敗時の情報（failed step / error / last_message / retry_note）は選択画面に表示され、retry note は次回実行の prompt に引き継がれる。

## `takt resume` — direct run のリトライ（対話）

**最新の** failed / aborted な direct run を 1 件検出し、サマリ（workflow / step / iteration / run path）を表示してアクションを選ぶ:

- **Requeue**: 追加指示なしでそのまま再実行（resume point / 失敗時の currentStep から再開 step を自動解決）
- **Retry**: 追加指示を対話で与えて再実行（`/go` / `/n` / `/cancel` は `takt list` の Retry と同じ）
- **Instruct**: 前回セッションの文脈を読み込んで指示書を作り直してから実行
- **View reports**: `.takt/runs/<slug>/` のレポート・ログのパス表示のみ（実行しない）

対象は direct run のみ。queue task には「Use `takt list` for queued tasks.」と案内されて何もしない。

## 非対話リトライ（agent から）

`takt list --non-interactive` の `--action` は `diff|try|merge|delete` のみで **retry / requeue は非対話にない**。agent から復帰する場合は「破棄 → 再 add」パターンを使う:

```bash
# 1. 失敗原因の回収（issue コメントで次回実行に引き継ぐ場合は gh issue comment）
tail -80 /tmp/takt_<slug>.log
ls .takt/runs/<run_slug>/reports/

# 2. 前回 task の破棄（worktree ごと削除。PR 作成済みなら先に close）
takt list --non-interactive --action delete --branch <branch> --yes

# 3. 再 add → 実行（workflow を変える場合は tasks.yaml の workflow を補正してから）
takt add '#<N>'
takt run
```

失敗情報の引き継ぎは issue コメント経由（`takt add '#N'` は issue 本文 + コメントを task 記述に展開する）。詳細な手順・監視方法は takt-issue スキルに従う。

## トラブルシュート

- **`takt resume` が「No resumable direct run found」** → 失敗したのは queue task。`takt list` を使う
- **Requeue したのに実行されない** → Requeue は `pending` に戻すだけ。`takt run` を打つ
- **worktree が消えていて Retry できない**（`Worktree directory does not exist`） → 破棄 → 再 add パターンでゼロから
- **同じ失敗を繰り返す** → 同条件リトライをやめ、Retry の追加指示で原因を潰すか、workflow を一段堅牢なもの（lite → solid）に切り替える
