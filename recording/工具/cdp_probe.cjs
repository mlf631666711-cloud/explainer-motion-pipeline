/* cdp_probe.cjs —— 用 CDP 读 Electron 应用（VS Code 等）UI 元素真实矩形
 * 为什么：截图像素量坐标有 ±20px 误差，是"标注看着歪"的来源之一（RC-012）。
 *   getBoundingClientRect 是 0 误差，且不用截图、不用看图 => 省掉"抽帧→肉眼"的整轮开销。
 * ★ 多窗口陷阱：VS Code 同时开多个窗口时 pages() 会返回多个 renderer，
 *   必须按 innerWidth 挑出「正在被录的那个窗口」，否则读到别的窗口的 3440 视口（RC-013）。
 * 用法：node cdp_probe.cjs "<css selector>" [期望视口宽]
 */
const puppeteer = require('puppeteer-core');
const SEL = process.argv[2] || '.activitybar .action-item';
const WANT = parseInt(process.argv[3] || '1920', 10);
(async () => {
  const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  const pages = await b.pages();
  let best = null, bestD = 1e9;
  for (const p of pages) {
    const v = await p.evaluate(() => ({ w: innerWidth, h: innerHeight, wb: !!document.querySelector('.monaco-workbench') })).catch(() => null);
    if (!v || !v.wb) continue;
    const d = Math.abs(v.w - WANT);
    if (d < bestD) { bestD = d; best = p; }
  }
  if (!best) { console.error('no workbench page'); process.exit(1); }
  const out = await best.evaluate((sel) => {
    const round = n => Math.round(n);
    const box = e => { const b = e.getBoundingClientRect(); return { x: round(b.x), y: round(b.y), w: round(b.width), h: round(b.height), cx: round(b.x + b.width / 2), cy: round(b.y + b.height / 2) }; };
    const res = { viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio }, items: [] };
    document.querySelectorAll(sel).forEach(e => {
      const lab = e.querySelector('.action-label') || e;
      const t = (lab.getAttribute && (lab.getAttribute('aria-label') || lab.title)) || e.textContent.trim().slice(0, 60) || '';
      const bb = box(e);
      if (bb.w > 0 && bb.h > 0) res.items.push({ t, ...bb });
    });
    return res;
  }, SEL);
  console.log(JSON.stringify(out, null, 1));
  await b.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
