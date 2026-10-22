/* cdp_dump.cjs —— 一次读多个选择器，输出紧凑 JSON（省掉反复来回）*/
const puppeteer = require('puppeteer-core');
const SELS = JSON.parse(process.argv[2]);
const WANT = parseInt(process.argv[3] || '1920', 10);
(async () => {
  const b = await puppeteer.connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });
  let best = null, bestD = 1e9;
  for (const p of await b.pages()) {
    const v = await p.evaluate(() => ({ w: innerWidth, wb: !!document.querySelector('.monaco-workbench') })).catch(() => null);
    if (!v || !v.wb) continue;
    const d = Math.abs(v.w - WANT); if (d < bestD) { bestD = d; best = p; }
  }
  const out = await best.evaluate((sels) => {
    const R = n => Math.round(n);
    const box = e => { const b = e.getBoundingClientRect(); return [R(b.x), R(b.y), R(b.width), R(b.height)]; };
    const res = { vp: [innerWidth, innerHeight], q: {} };
    for (const s of sels) {
      const arr = [];
      document.querySelectorAll(s).forEach(e => {
        const t = (e.getAttribute('aria-label') || e.title || e.textContent || '').trim().slice(0, 44);
        arr.push({ t, b: box(e) });
        if (arr.length >= 14) return;
      });
      res.q[s] = arr.slice(0, 14);
    }
    return res;
  }, SELS);
  console.log(JSON.stringify(out));
  await b.disconnect();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
