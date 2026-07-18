# takt トークン消費ベースライン (2026-07-05 計測)

`takt-usage-report`(`config/.local/bin/takt-usage-report`、`darwin-rebuild switch` 後は
`~/.local/bin/takt-usage-report`)による初回計測結果。削減施策の before/after 比較は
本ツールの再実行で行う。

```sh
takt-usage-report              # 全期間・markdown
takt-usage-report --days 7     # 直近 7 日
takt-usage-report --json       # 機械可読
```

数値は provider 差を正規化済み(codex は `cached_input_tokens` が input 内数、
claude は `cache_read/cache_creation_input_tokens` が input 外数のため input に合算)。

## サマリ(全期間: 2026-06-15 〜 2026-07-03)

- 計測あり run: **282**(計測なし = observability 有効化前の run: 24)
- 総トークン: **約 52.1 億**(cache hit 87.7%)
- ピーク日: 6/19 に **8.3 億/日**(43 run)。重い日は概ね 5 億前後

## workflow 別

| workflow | runs | total | avg/run |
| --- | ---: | ---: | ---: |
| review-takt-default(7 観点レビュー) | 265 | 4,304,697,950 | 16,244,143 |
| default-mini(実装) | 13 | 658,108,414 | 50,623,724 |
| review-fix-takt-default(廃止済み) | 3 | 230,251,187 | 76,750,395 |
| default(実装 + テスト先行) | 1 | 20,096,489 | 20,096,489 |

→ **全体の 83% が review-takt-default**。run 数(265)× 単価(1,600万)の両方が大きい。

## phase 別

| phase | total | share |
| --- | ---: | ---: |
| phase1_execute(本来の作業) | 2,721,768,375 | 52.2% |
| phase2_report(レポート生成の再呼び出し) | 2,436,598,425 | 46.7% |
| phase3_structured(次 step 判定) | 54,787,240 | 1.1% |

→ **レポート生成だけで全体の 47%**。takt は step ごとに execute → report → structured の
3 回エージェントを呼び、report は output_contract の report ファイル数ぶん会話全体を
再送する(`report-phase-runner.ts`)。

## step 別 (top 10)

| step | total | share |
| --- | ---: | ---: |
| ai-antipattern-review-2nd | 839,426,720 | 16.1% |
| coding-review | 661,746,657 | 12.7% |
| arch-review | 647,599,793 | 12.4% |
| qa-review | 630,584,164 | 12.1% |
| pure-review | 577,997,589 | 11.1% |
| testing-review | 486,439,059 | 9.3% |
| security-review | 460,431,934 | 8.8% |
| supervise | 341,286,929 | 6.5% |
| gather | 185,502,564 | 3.6% |
| implement | 125,885,325 | 2.4% |

→ **レビュー系 step の合計が全体の約 84%**。実装(implement + fix + plan)は 5% 未満。

## 特記事項

- **aborted run の空費**: default-mini の aborted run が 8,000万〜1.08 億トークンを
  成果なしで消費(top 10 中 3 件)。abort までの粘りが長い。
- 最大単一 run は review-fix-takt-default の **2.08 億**(6/19、既にワークフロー廃止済み)。
- 02-yt / グローバルとも observability は有効で、run ごとの
  `logs/*-usage-events.phase.jsonl` に計測が残っている(設定変更は不要だった)。

## 削減施策の候補(未実施・要意思決定)

実測に基づく概算効果。上から効果が大きい順:

1. **レビュー観点統合(review-lite 自作)** — **廃止（2026-07-15）**。
   Plan 015（2026-07-09）で gather → 統合レビュアー 1〜2 体 → supervise のカスタム workflow
   `config/.takt/workflows/review-lite.yaml` を作成し `takt-review` skill のデフォルトを
   切替したが、その後 builtin `review-takt-default`（7 観点個別レビュー）に戻して
   review-lite.yaml は削除した。AI 用の takt 関連 skill も削除し、現在はユーザーが takt CLI を直接操作する。
2. **レビュー頻度の運用ルール化** — 265 run 中どれだけが必要だったか。対象 PR を
   絞るだけで比例削減(現状レビューが全体の 83%)。
3. **default-mini の draft 内 1st レビュー除去** — `ai-antipattern-review-1st` + `ai-antipattern-fix`
   (合計 1.6 億、default-mini 内では約 25%)は peer-review 内 2nd と観点が重複。
   eject して除去すれば実装 run 約 -25%。
4. **aborted 対策** — abort 判定の早期化(plan 段階の ABORT 条件強化)。1 件で 1 億の空費を防ぐ。
5. **phase2_report の構造改善** — report が 47% を占めるのは takt 本体の設計。
   output_contract の report ファイル統合(1 step 1 ファイル)で軽減、
   根本改善は本家 nrslib/takt への提案(fork 保有: daiki-beppu/takt)。
6. **persona/model 振り分け** — reviewer 系 persona を軽量モデルへ
   (`persona_providers.<persona>.model`)。総量は減らないがレート枠の消費を軽減。
