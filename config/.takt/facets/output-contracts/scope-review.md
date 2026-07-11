```markdown
# スコープ見直し提案

## Result: SCOPE_TOO_LARGE / REQUIREMENTS_UNCLEAR / TECHNICAL_BLOCKER

## Summary
{implement ⇄ review が空転した原因の要約を 1-3 文で}

## 空転の分析

- **繰り返された指摘**: {review feedback で解消しなかった指摘の要約}
- **根本原因**: {なぜ 1 つの implement step で収束しなかったのか（スコープ過大 / 要件曖昧 / 設計判断の不在 など）}

## ここまでの資産（worktree に残存）

| 種別 | パス | 状態 |
|------|------|------|
| {実装 / テスト / 設計書} | {ファイルパス} | {完成 / 部分実装 / 要やり直し} |

## 未達の受入条件

- [ ] {受入条件} — {何が足りないか}

## 推奨分割（vertical slice）

各 slice は takt workflow で AFK 実装可能な単位にする（to-issues skill の issue 構造に合わせる）。

### Slice 1: {タイトル}
- **参照資料**: {plan.md / test-design.md / 本レポートの該当節}
- **影響ファイル**: {パス}
- **要件**: {この slice で完了させる受入条件}
- **スコープ外**: {隣接するが含めないもの}
- **依存**: {先行 slice があれば}

### Slice 2: {タイトル}
{同上}

## 推奨 workflow

| Slice | workflow | 理由 |
|-------|----------|------|
| 1 | {feature / improve / fix} | {判定理由} |
```
