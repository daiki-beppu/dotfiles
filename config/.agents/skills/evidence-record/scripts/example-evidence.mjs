// example-evidence.mjs — 「生成される run.mjs」の完成例（参照・流用用）
//
// 実行: playwright-cli run-code --filename example-evidence.mjs
// 題材: 公開デモ https://demo.playwright.dev/todomvc
//
// このファイルは recorder-helpers.md のヘルパー前文を inline した自己完結スクリプト。
// 実際の /evidence-record はこの形を、指示された操作に合わせて生成する。
//
// 重要: playwright-cli は自前の cwd で実行されるため、出力は必ず【絶対パス】にすること。
//       相対パスだと webm/png がどこに行ったか分からなくなる。
// この例は /tmp/evidence-record-example/ に出力する。事前に:
//   mkdir -p /tmp/evidence-record-example
// 生成時は ~/Downloads/evidence-record-<timestamp>/ の実パスへ置換する。

async page => {
  // ===== evidence-record helpers (screencast) =====
  const EVREC = { total: 1, banner: null, cursor: null };

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

  async function cursorTo(page, x, y) {
    if (EVREC.cursor) { await EVREC.cursor.dispose().catch(() => {}); EVREC.cursor = null; }
    EVREC.cursor = await page.screencast.showOverlay(`
      <div style="position:fixed;left:${x}px;top:${y}px;width:26px;height:26px;
        z-index:2147483601;transform:translate(-50%,-50%);
        border:3px solid #e60012;border-radius:50%;
        background:rgba(230,0,18,.25);box-shadow:0 0 8px rgba(0,0,0,.4);"></div>
    `);
  }

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
  async function setup(page, label, fn) {
    try {
      await fn();
    } catch (e) {
      await page.screenshot({ path: globalThis.__EVREC_FAIL_PNG__ || 'fail.png' }).catch(() => {});
      throw new Error(`SETUP FAILED: ${label}\n${e && e.message ? e.message : e}`);
    }
  }

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

  EVREC.total = 3;
  const OUT = '/tmp/evidence-record-example';
  globalThis.__EVREC_FAIL_PNG__ = `${OUT}/fail.png`;

  // 録画サイズとビューポートを一致させる（揃えないと下部に灰色の余白が出る）
  await page.setViewportSize({ width: 1280, height: 800 });

  // ログイン等の「録画したくない前準備」は、この screencast.start() の【前】で setup() を使って実行する。
  // 例: await setup(page, 'ログインして開始画面へ', async () => { ...ログイン操作... });
  // page.screencast に pause は無いので、start 後の操作はすべて動画に残る。この TodoMVC 例は前準備不要。
  await page.screencast.start({ path: `${OUT}/evidence.webm`, size: { width: 1280, height: 800 } });

  const input = page.getByRole('textbox', { name: 'What needs to be done?' });

  await step(page, 1, 'TodoMVC を開く', 'デモアプリにアクセスします', async () => {
    await page.goto('https://demo.playwright.dev/todomvc', { waitUntil: 'domcontentloaded' });
    // 冪等性のため既存の todo（localStorage）をクリアしてから始める
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: 'domcontentloaded' });
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(600);
  });

  await step(page, 2, 'タスクを追加', '2件のタスクを入力する', async () => {
    await fillFx(page, input, 'Walk the dog');
    await input.press('Enter');
    await page.waitForTimeout(500);
    await fillFx(page, input, 'Buy groceries');
    await input.press('Enter');
    await page.waitForTimeout(700);
  });

  await step(page, 3, '完了にチェック', '1件目を完了にして件数を確認', async () => {
    // 確認項目: 追加した行が存在すること
    const row = page.getByRole('listitem').filter({ hasText: 'Walk the dog' });
    await row.waitFor({ state: 'visible', timeout: 5000 });
    // listitem 内の toggle checkbox をクリック（getByRole('checkbox').first() は toggle-all なので不可）
    await clickFx(page, row.getByRole('checkbox'));
    // 確認項目: 残り1件と表示されること
    await page.getByText('1 item left').waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(1200);
  });

  await page.screencast.stop();
}
