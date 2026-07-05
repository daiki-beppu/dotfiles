---
name: aqua-improve
description: >-
  Aqua Voice の文字起こし履歴を分析し、Dictionary / Replacements / カスタム指示の改善案レポートを生成する（提案のみ、Aqua の設定への自動反映はしない）。「aqua 改善」「Aqua Voice のログ分析」「音声入力の精度改善」「/aqua-improve」で発動。週次スケジュールタスクからの自動実行にも対応。
---

# Aqua Voice ログ分析・設定改善提案

## 概要

Aqua Voice がローカルに保存している文字起こし履歴を増分分析し、以下の 3 種類の改善案をレポートとして出力する。

1. **Dictionary 追加候補** — 誤認識されている固有名詞・技術用語
2. **Replacements 候補** — 繰り返し口述されている定型句
3. **カスタム指示の修正案** — 整形ルールが守られていないパターン

**提案のみを行う。Aqua Voice の設定への反映はユーザーが手動で行う。**

## パス定義

| パス | 役割 | 扱い |
|------|------|------|
| `~/Library/Application Support/Aqua Voice/settings.json` | Aqua Voice の全データ（履歴・辞書・置換・カスタム指示） | **読み取り専用。書き込み・編集は絶対禁止** |
| `~/.claude/aqua-improve/state.json` | 分析済み最新 timestamp | 読み書き |
| `~/.claude/aqua-improve/reports/YYYY-MM-DD.md` | 分析レポート | 書き込み |

## 手順

### 1. 抽出

```bash
SETTINGS="$HOME/Library/Application Support/Aqua Voice/settings.json"
STATE="$HOME/.claude/aqua-improve/state.json"
mkdir -p "$HOME/.claude/aqua-improve/reports"

# 前回分析済み timestamp（初回は全件対象）
LAST=$(jq -r '.lastAnalyzedTimestamp // "1970-01-01T00:00:00Z"' "$STATE" 2>/dev/null || echo "1970-01-01T00:00:00Z")

# 新規履歴の抽出（音声パス等は不要なので落とす）
jq --arg last "$LAST" \
  '[.history[]? | select(.kind == "transcription" and .content != null and .timestamp > $last) | {timestamp, app, content, rawText}]' \
  "$SETTINGS"

# 現在の設定（提案の重複除外に使う）
jq '{dictionary, replacements, customInstructions}' "$SETTINGS"
```

- 新規エントリが **5 件未満** の場合: 「新規 N 件のためスキップ（次回に持ち越し）」と報告して終了する。**state は更新しない**。
- 新規エントリが 200 件を超える場合: 出力をファイルに redirect し、分割して読むこと。

### 2. 分析

抽出した履歴をインコンテキストで分析する。各観点の判定基準:

**Dictionary 追加候補**
- 技術用語・製品名がカタカナ化されている（例: クロードコード ← Claude Code）
- 英語の複合語が分割されている（例: work tree ← worktree）
- 既知の語と音が近い不自然な単語 = 誤認識の疑い（例: スピードバック ← フィードバック）
- 文脈上明らかに固有名詞なのに一般語に化けている
- **既存の `dictionary` 登録語と重複する提案はしない**

**Replacements 候補**
- 3 回以上出現する、ほぼ同一の定型句（挨拶・メール定型・AI への指示定型）
- トリガー案は「普段の発話に出てこない短い複合語」で設計する
- **既存の `replacements` と重複する提案はしない**

**カスタム指示の修正案**
- `rawText` と `content` を比較し、現行 `customInstructions` のルールが守られていないパターンを探す（フィラー残り、言い直しの両方残り、文体の過剰変換、前置き混入、記号・数字の表記揺れ）
- 修正案は「追加・変更すべき指示文」を具体的な文面で提示する

**共通ルール**
- 各提案に根拠（該当エントリの timestamp と最小限の断片引用）を添える
- 履歴は私的な内容を含みうるため、レポートへの引用は判断に必要な最小限にとどめる
- 確信度が低い提案は「要確認」と明示し、確実なものと分けて提示する

### 3. レポート出力

`~/.claude/aqua-improve/reports/YYYY-MM-DD.md`（当日日付）に以下の構成で保存し、会話にも要約を提示する。

```markdown
# Aqua Voice 改善提案 YYYY-MM-DD

## サマリ
- 分析対象: N 件（期間: X 〜 Y）、アプリ内訳
- 提案数: Dictionary N 件 / Replacements N 件 / カスタム指示 N 件

## Dictionary 追加候補
| 単語 | 誤認識の実例（引用） | 日時 |
（コピペ用の単語リストを併記）

## Replacements 候補
| トリガー案 | 展開テキスト | 出現回数 |

## カスタム指示の修正案
（問題パターン → 追加・変更する指示文の具体案）

## 登録手順
（Aqua Voice の Settings での反映方法を 1-2 行で）
```

### 4. state 更新

レポート出力に成功した場合のみ、分析したエントリの最大 timestamp を記録する。

```bash
jq -n --arg ts "$NEWEST_TIMESTAMP" '{lastAnalyzedTimestamp: $ts}' > "$STATE"
```

## 禁止事項

- `settings.json` への書き込み・編集（jq の出力を settings.json に redirect するのも禁止）
- Dictionary / Replacements / カスタム指示の自動反映
- レポートへの履歴本文の大量転記（引用は根拠として必要な断片のみ）
