---
name: mf-scrape
description: マネーフォワード ME から月次の収支データを取得・構造化するスキル。Chrome DevTools MCP でブラウザ操作し、指定月の収入・支出をカテゴリ別にスクレイピングする。「マネーフォワードのデータ取って」「MFの家計簿取得」「マネフォから収支データ」「MFスクレイピング」「家計簿データ取得」「/mf-scrape」で発動。マネーフォワードやMFや家計簿のデータ取得に関わるあらゆる表現で積極的に発動すること。
---

# mf-scrape

マネーフォワード ME の収支内訳ページから月次データを取得し、構造化された JSON として出力する。

## 前提条件

- Chrome DevTools MCP が利用可能であること
- 1Password CLI (`op`) が利用可能で、`Personal` vault に `Moneyforward` アイテムがあること

## 実行フロー

### 1. ログイン情報の取得

1Password から直接取得する：

```bash
MF_EMAIL=$(op read "op://Personal/Moneyforward/username")
MF_PASSWORD=$(op read "op://Personal/Moneyforward/password")
```

### 2. ログイン

Chrome DevTools MCP で MF ME にアクセスし、ログイン状態を確認する。

```
navigate_page → https://moneyforward.com/cf/summary
```

ログインページ（`id.moneyforward.com`）にリダイレクトされた場合、自動ログインを実行：

1. `take_snapshot` でフォーム構造を確認
2. メールアドレス入力フィールドに `MF_EMAIL` を `fill`
3. 「ログインする」ボタンをクリック
4. パスワード入力画面が表示されたら `MF_PASSWORD` を `fill`
5. 「ログインする」ボタンをクリック
6. ダッシュボードにリダイレクトされるのを `wait_for` で待つ

### 3. 対象月への移動

引数で指定された月の収支内訳ページを表示する。

- 現在表示中の月を確認（ページ上部の日付表示）
- 「前月」「次月」リンクをクリックして目的の月に移動
- URL のクエリパラメータは `from=YYYY%2FMM%2FDD` 形式

### 4. データのスクレイピング

`evaluate_script` で全テーブルデータを一括取得する：

```javascript
() => {
  const allTables = document.querySelectorAll('table');
  const results = [];
  allTables.forEach((table, idx) => {
    const rows = table.querySelectorAll('tr');
    const tableData = [];
    rows.forEach(row => {
      const cells = row.querySelectorAll('td, th');
      const rowData = [];
      cells.forEach(cell => rowData.push(cell.textContent.trim()));
      if (rowData.length > 0 && rowData.some(c => c)) tableData.push(rowData);
    });
    if (tableData.length > 0) results.push({ tableIndex: idx, data: tableData });
  });
  return results;
}
```

### 5. データの構造化

取得した生データから以下の形式に整形する。テーブルデータの解析ポイント：

- **tableIndex 1**: 収入・支出・収支のサマリー行（`["221,316円","ー","254,667円","＝","-33,351円"]`）
- **tableIndex 2 or 3**: 支出の内訳テーブル
  - 「○○ 合計」行がカテゴリ見出し（例: `["食費 合計","16,014円","6.29%"]`）
  - それ以外がサブカテゴリ（例: `["食費","14,513円","5.70%"]`）
- 金額は「1,000円」形式 → カンマと「円」を除去して数値化

出力フォーマット：

```json
{
  "period": "2026/03/01 - 2026/03/31",
  "income": 221316,
  "expense": 254667,
  "balance": -33351,
  "expense_breakdown": [
    {
      "category": "食費",
      "total": 16014,
      "subcategories": [
        { "name": "食費", "amount": 14513 },
        { "name": "食料品", "amount": 1005 },
        { "name": "外食", "amount": 496 }
      ]
    }
  ]
}
```

### 6. 出力

構造化データをユーザーに表示する。`lifeplan-input` スキルと連携する場合は、このデータをそのまま渡せる形式になっている。

## 引数

- 月の指定（例: `/mf-scrape 2026年3月`, `/mf-scrape 先月`）
- 省略時は前月

## 注意事項

- MF は 2段階認証が有効な場合、自動ログインに追加操作が必要になる可能性がある
- 無料プランはデータ保持期間に制限がある
- 「未分類」カテゴリの金額が大きい場合はユーザーに内訳確認を促す
