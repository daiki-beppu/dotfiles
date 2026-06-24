# E2E 動作確認 — PR body 更新

verify ステップで生成された検証レポート（`e2e-verify-report.md`）を、現在のブランチに紐づく PR の body に追記する。

## 手順

### 1. PR の特定

```bash
gh pr list --head "$(git branch --show-current)" --json number,title,body --jq '.[0]'
```

- PR が見つからない場合は「PR が存在しない」として COMPLETE に遷移する（エラーではない）
- 複数ヒットした場合は最初の 1 件を使う

### 2. 検証レポートの読み取り

直前の verify ステップで生成された `e2e-verify-report.md` を読む。
ファイルが見つからない場合は run ディレクトリ（`.takt/runs/*/reports/`）を探す。

### 3. PR body の更新（冪等）

HTML コメントマーカーで囲んだセクションとして挿入する。
既にマーカーが存在する場合はそのセクションを差し替える（再実行時に重複しない）。

**マーカー形式:**
```
<!-- e2e-verify-start -->
## E2E 動作確認結果
{レポート内容}
<!-- e2e-verify-end -->
```

**更新手順:**

1. 既存の body を取得:
   ```bash
   gh pr view <NUMBER> --json body -q .body
   ```

2. 既存 body にマーカーがある場合:
   - `<!-- e2e-verify-start -->` から `<!-- e2e-verify-end -->` までを新しい内容で置換

3. マーカーがない場合:
   - 既存 body の末尾に `---` 区切り + マーカー付きセクションを追加

4. 更新を実行:
   ```bash
   gh pr edit <NUMBER> --body "..."
   ```

### 4. 注意事項

- body が長すぎる場合（GitHub の 65536 文字制限）: スクリーンショットパスの一覧を省略し、Summary + 結果一覧テーブルのみに絞る
- 既存 body の内容は絶対に消さない。マーカー外の内容には触れない
- スクリーンショット画像自体は PR body に埋め込めない（パスのみ記載）
