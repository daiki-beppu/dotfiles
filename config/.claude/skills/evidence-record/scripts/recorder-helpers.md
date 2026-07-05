# recorder-helpers — screencast 版ヘルパー前文（正典）

`/evidence-record` が生成する録画スクリプト `run.mjs` の**先頭に inline する**ヘルパー群。
`playwright-cli run-code --filename run.mjs` で実行する前提で、`page.screencast` API を使う。

- `run-code` はモジュール解決が不安定なので **import せず、この前文をそのまま貼り付けて自己完結**にする。
- オーバーレイは `pointer-events:none` なので操作を邪魔しない（sticky 表示のまま click/fill して良い）。
- 役割分担:
  - **showChapter** = 各ステップ冒頭のフルスクリーン章カード（区切りの導入。`await` で duration ぶんブロック→自動消滅）。
  - **showOverlay(sticky)** = 章カードが消えた後、操作中ずっと残す上部ステップ帯。
  - **showOverlay(短duration)** = クリック時の対象ハイライト＋波紋、疑似カーソル。
- **録画したくない前準備（ログイン/初期ナビ/Cookie 同意）は `screencast.start()` の前に `setup()` で実行する**。`page.screencast` に pause/resume は無いので、映したくない操作は録画開始前に済ませる（start 後の操作はすべて動画に残る）。

## ヘルパー前文（このコードブロックを run.mjs の先頭に inline する）

```js
// ===== evidence-record helpers (screencast) =====
const EVREC = { total: 1, banner: null, cursor: null };

// 画面上部に残り続ける sticky ステップ帯。前の帯を dispose して差し替える。
async function banner(page, n, title) {
  if (EVREC.banner) { await EVREC.banner.dispose().catch(() => {}); EVREC.banner = null; }
  EVREC.banner = await page.screencast.showOverlay(`
    <div style="position:fixed;top:0;left:0;width:100%;box-sizing:border-box;
      padding:14px 20px;z-index:2147483600;
      background:linear-gradient(90deg,#e60012,#ff5a36);color:#fff;
      font-family:'Hiragino Sans','Noto Sans JP',sans-serif;
      font-size:22px;font-weight:700;letter-spacing:1px;text-align:center;
      box-shadow:0 2px 10px rgba(0,0,0,.3);">
      STEP ${n}/${EVREC.total}　${title}
    </div>
  `);
}

// 疑似カーソルを (x,y) に置く。dispose→再表示で移動を表現する。
async function cursorTo(page, x, y) {
  if (EVREC.cursor) { await EVREC.cursor.dispose().catch(() => {}); EVREC.cursor = null; }
  EVREC.cursor = await page.screencast.showOverlay(`
    <div style="position:fixed;left:${x}px;top:${y}px;width:26px;height:26px;
      z-index:2147483601;transform:translate(-50%,-50%);
      border:3px solid #e60012;border-radius:50%;
      background:rgba(230,0,18,.25);box-shadow:0 0 8px rgba(0,0,0,.4);"></div>
  `);
}

// クリックの波紋＋対象ハイライトを短時間だけ出す。
async function rippleAt(page, x, y, box) {
  const hl = box ? `
    <div style="position:fixed;left:${box.x}px;top:${box.y}px;
      width:${box.width}px;height:${box.height}px;z-index:2147483601;
      border:3px solid #ffcc00;border-radius:8px;box-sizing:border-box;"></div>` : '';
  await page.screencast.showOverlay(`
    <style>@keyframes __evrec_ripple__{to{width:72px;height:72px;opacity:0;}}</style>
    ${hl}
    <div style="position:fixed;left:${x}px;top:${y}px;width:12px;height:12px;
      z-index:2147483602;transform:translate(-50%,-50%);
      border:4px solid #ffcc00;border-radius:50%;
      animation:__evrec_ripple__ .6s ease-out forwards;"></div>
  `, { duration: 650 });
}

// カーソル移動→波紋→実クリック。locator は Playwright Locator。
async function clickFx(page, locator) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(250);
  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await cursorTo(page, x, y);
    await page.waitForTimeout(350);
    await rippleAt(page, x, y, box);
    await page.waitForTimeout(200);
  }
  await locator.click();
  await page.waitForTimeout(400);
}

// 自然なタイピングで入力する。
async function fillFx(page, locator, text) {
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  if (box) await cursorTo(page, box.x + box.width / 2, box.y + box.height / 2);
  await locator.click();
  await locator.fill('');
  await locator.pressSequentially(text, { delay: 60 });
  await page.waitForTimeout(400);
}

// 録画開始前の前準備（ログイン等）。screencast.start() の前に呼ぶので動画に映らない。
// step() と違い録画はまだ無いので screencast.stop() は呼ばない（呼ぶとエラー）。
// 失敗したらスクショだけ撮って SETUP FAILED を投げ、撮影に進ませない。
async function setup(page, label, fn) {
  try {
    await fn();
  } catch (e) {
    await page.screenshot({ path: globalThis.__EVREC_FAIL_PNG__ || 'fail.png' }).catch(() => {});
    throw new Error(`SETUP FAILED: ${label}\n${e && e.message ? e.message : e}`);
  }
}

// 1ステップ: 章カード(showChapter) → sticky帯(banner) → 操作(fn)。
// fn が throw したら撮影を止めて、どのステップで落ちたかを付けて投げ直す。
async function step(page, n, title, description, fn) {
  await page.screencast.showChapter(`STEP ${n}/${EVREC.total}　${title}`, {
    description: description || '',
    duration: 1800,
  });
  await banner(page, n, title);
  await page.waitForTimeout(400);
  try {
    await fn();
  } catch (e) {
    await page.screenshot({ path: globalThis.__EVREC_FAIL_PNG__ || 'fail.png' }).catch(() => {});
    await page.screencast.stop().catch(() => {});
    throw new Error(`STEP ${n} FAILED: ${title}\n${e && e.message ? e.message : e}`);
  }
}
// ===== /helpers =====
```

## 使い方（run.mjs の骨格）

```js
async page => {
  // ↑のヘルパー前文をここに inline 済みとする
  EVREC.total = 2;                                  // ← 録画する step() の数だけ（プリアンブルは数えない）
  globalThis.__EVREC_FAIL_PNG__ = '<OUT>/fail.png'; // 失敗時スクショの保存先

  // 録画サイズとビューポートを一致させる（揃えないと下部に灰色の余白が出る）
  await page.setViewportSize({ width: 1280, height: 800 });

  // ===== プリアンブル（録画しない前準備：ログイン等）=====
  // screencast.start() より前なので動画に映らない。不要なら丸ごと省略してよい。
  await setup(page, 'ログインして開始画面へ', async () => {
    await page.goto('https://example.com/login', { waitUntil: 'domcontentloaded' });
    await fillFx(page, page.getByLabel('Email'), 'user@example.com');
    await fillFx(page, page.getByLabel('Password'), 'secret');
    await page.getByRole('button', { name: 'Log in' }).click();
    await page.getByRole('heading', { name: 'Dashboard' }).waitFor({ state: 'visible', timeout: 10000 });
  });

  // ===== ここから録画開始（プリアンブルは映らない）=====
  await page.screencast.start({ path: '<OUT>/evidence.webm', size: { width: 1280, height: 800 } });

  await step(page, 1, '検索する', 'キーワードを入力して検索', async () => {
    await fillFx(page, page.getByRole('textbox'), 'playwright');
    await clickFx(page, page.getByRole('button', { name: '検索' }));
  });

  await step(page, 2, '結果を確認', '一覧が表示されることを確認', async () => {
    await page.getByText('結果').first().waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1200);
  });

  await page.screencast.stop();
}
```

> ログインが不要なケースでは `setup()` ブロックを省き、`step(page, 1, '対象ページを開く', …)` から始めてよい。

### 注意（実測で判明した必須事項）
- **クリーンセッションで録画する**: `playwright-cli` のブラウザ/ページは `run-code` をまたいで生き続け、`page.screencast` のオーバーレイが**前回実行分まで蓄積**する（帯やカーソルが二重・三重に映る）。録画の直前に必ず
  ```bash
  playwright-cli close   # 失敗は無視してよい
  playwright-cli open
  ```
  で**新しいページにしてから** `run-code` する。`dispose()` 自体はクリーンな状態なら正しく効く。
- **出力は絶対パス**: `playwright-cli` は自前の cwd で実行されるため、`screencast.start({path})` と `__EVREC_FAIL_PNG__` は**必ず絶対パス**。相対パスだと webm/png が行方不明になる。
- **`setViewportSize` で録画サイズと一致**させる。揃えないと下部に灰色の余白が出る。
- `<OUT>` は `~/Downloads/evidence-record-<timestamp>/` の実パスに置換すること。
- ステップ内の最後の操作（`waitFor` / `expect` 相当）が「確認項目」を兼ねる。ここが失敗すると `step()` が撮影を止めて投げる。
- ロケータは可能な限り `getByRole` / `getByText` など堅牢なものを使う。CSS セレクタは最終手段。
- **映したくない操作（ログイン等）は `screencast.start()` の前に `setup()` で実行する**。`page.screencast` に pause は無く、start 後の操作はすべて動画に残る。`setup()` が失敗すると `SETUP FAILED` を投げ、録画（`evidence.webm`）は生成されない。
