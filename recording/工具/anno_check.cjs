// anno_check.cjs —— 录屏美化页「标注件」闸门（红框 / 荧光笔 / 下划线 / 箭头 / 毛玻璃框）
//
// 为什么要有它：标注是"手量坐标 + 时间对齐"的产物，做完了没人验。
//   实测踩到的真 bug（2026-10-21）：渲染器绕过页面 vmap 直接写 currentTime=t，
//   R01 的 vmap = 0.779t+2.077 ⇒ 全片视频错位最多 2.08 秒；所有闸门（safe/density）都不报。
//
// 本闸只判机械错，不管好不好看：
//   A1 时间对齐   v.currentTime ≈ vmap(t)            ← 抓上面那个 bug
//   A2 标注在画幅内
//   A3 尺寸合理（占画幅 0.05%~30%；<0.25% 给 WARN）
//   A4 压在内容上（框心梯度 ≥ 线；红框与毛玻璃框适用）
//   A5 红框的边框真的画出来了（信号红像素 ≥ 55%）
//   A6 此刻可见（opacity ≥ 0.85）
//
// 用法：
//   node anno_check.cjs <页面.html> [--t 3.5,7.2] [--neg 40] [--shot 目录] [--json out.json]
//     --neg N   负控：把每个标注件真的挪 N 像素再判，**必须变红**
// 退出码：0 全过 / 1 有 FAIL
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const page = argv[0];
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TIMES_ARG = opt('--t', null);
const NEG = parseInt(opt('--neg', '0'), 10);
const SHOT = opt('--shot', null);
const JSONOUT = opt('--json', null);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const TH = {
  seekTol: 0.02, insideTol: 1.0, areaMin: 0.0005, areaWarn: 0.0025, areaMax: 0.30,
  emptyE: 1.6, borderRatio: 0.55, opMin: 0.85,
};

function gradOf(buf, W, H) {
  const g = new Float32Array(W * H);
  for (let i = 0, p = 0; i < W * H; i++, p += 3) g[i] = 0.299 * buf[p] + 0.587 * buf[p + 1] + 0.114 * buf[p + 2];
  const o = new Float32Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; o[i] = Math.abs(g[i + 1] - g[i - 1]) + Math.abs(g[i + W] - g[i - W]);
  }
  return o;
}
function meanRect(G, W, H, x, y, w, h) {
  let s = 0, n = 0;
  const x0 = Math.max(1, Math.round(x)), x1 = Math.min(W - 2, Math.round(x + w));
  const y0 = Math.max(1, Math.round(y)), y1 = Math.min(H - 2, Math.round(y + h));
  for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { s += G[yy * W + xx]; n++; }
  return n ? s / n : 0;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files'],
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const abs = path.resolve(page).split(path.sep).join('/');
  await p.goto('file:///' + abs + '?t=0', { waitUntil: 'load', timeout: 120000 });
  await p.evaluate(() => { window.__hold = true; });
  // 没有 <video> 的页面（标注件自检页）不等
  await p.waitForFunction(() => { const v = document.querySelector('video'); return !v || v.readyState >= 2; }, { timeout: 25000 })
    .catch(() => console.log('[warn] video readyState<2'));

  const boxes = await p.evaluate(() => (Array.isArray(window.BOX) ? window.BOX.map(b => [b[0], b[1]]) : null));
  let times = TIMES_ARG ? TIMES_ARG.split(',').map(Number) : [];
  if (!times.length) {
    if (!boxes) { console.error('页面没有 window.BOX，且未给 --t'); process.exit(2); }
    for (const [t0, t1] of boxes) times.push(+(t0 + (t1 - t0) * 0.45).toFixed(2), +(t0 + (t1 - t0) * 0.75).toFixed(2));
  }

  const rows = [];
  for (const t of times) {
    const g = await p.evaluate(async (tt, NEG) => {
      if (window.renderAsync) await window.renderAsync(tt);
      else {
        if (window.render) render(tt);
        const v = document.querySelector('video');
        if (v) {
          v.pause();
          const d = (typeof window.vmap === 'function') ? window.vmap(tt) : tt;
          if (isFinite(d)) {
            await new Promise(res => {
              const h = () => { v.removeEventListener('seeked', h); res(); };
              v.addEventListener('seeked', h, { once: true });
              v.currentTime = Math.min(d, (v.duration || 0) - 0.001);
              setTimeout(res, 900);
            });
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          }
        }
      }
      const v = document.querySelector('video');
      const win = document.getElementById('win').getBoundingClientRect();
      const camEl = document.getElementById('cam');
      const cm = new DOMMatrix(getComputedStyle(camEl).transform === 'none' ? '' : getComputedStyle(camEl).transform);

      let items = [];
      if (window.ANNO && ANNO.visible) {
        items = ANNO.visible();
        if (NEG) {
          document.querySelectorAll('[data-anno]').forEach(e => {
            e.style.left = (parseFloat(e.style.left || 0) + NEG) + 'px';
            e.style.top = (parseFloat(e.style.top || 0) + NEG) + 'px';
          });
          items = ANNO.visible();
        }
      } else {
        const a = document.getElementById('anno');
        if (a) {
          if (NEG) {
            a.style.left = (parseFloat(a.style.left || 0) + NEG) + 'px';
            a.style.top = (parseFloat(a.style.top || 0) + NEG) + 'px';
          }
          const b = a.getBoundingClientRect();
          items = [{ kind: 'box', op: +(getComputedStyle(a).opacity || 0), x: b.x, y: b.y, w: b.width, h: b.height }];
        }
      }
      return {
        t: tt,
        vmap: (typeof window.vmap === 'function') ? +window.vmap(tt).toFixed(3) : null,
        vCur: v ? +v.currentTime.toFixed(3) : null,
        camScale: +cm.a.toFixed(4),
        win: { x: win.x, y: win.y, w: win.width, h: win.height },
        items,
      };
    }, t, NEG);

    const png = await p.screenshot({ type: 'png' });
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
    const G = gradOf(data, info.width, info.height);
    const INK = { r: 200, g: 52, b: 42 };
    const isInk = (x, y) => {
      const i = (Math.round(y) * info.width + Math.round(x)) * 3;
      return Math.abs(data[i] - INK.r) < 55 && data[i + 1] < 110 && data[i + 2] < 100;
    };
    const along = (x0, y0, dx, dy, n) => {
      let hit = 0, tot = 0;
      for (let k = 0; k < n; k++) { if (isInk(x0 + dx * k, y0 + dy * k)) hit++; tot++; }
      return tot ? hit / tot : 0;
    };

    const checks = [];
    if (g.vmap != null && g.vCur != null) {
      const dv = Math.abs(g.vmap - g.vCur);
      checks.push({ id: 'A1 时间对齐', ok: dv <= TH.seekTol, msg: `vmap=${g.vmap} vCur=${g.vCur} Δ=${dv.toFixed(3)}s` });
    }

    const warns = [];
    g.items.forEach((it, idx) => {
      const tag = (it.kind || 'box') + (g.items.length > 1 ? '#' + (idx + 1) : '');
      const over = Math.max(g.win.x - it.x, g.win.y - it.y, (it.x + it.w) - (g.win.x + g.win.w), (it.y + it.h) - (g.win.y + g.win.h));
      checks.push({ id: `A2 ${tag} 在画幅内`, ok: over <= TH.insideTol, msg: `越界 ${over.toFixed(1)}px` });

      const ratio = (it.w * it.h) / (g.win.w * g.win.h);
      const thin = (it.kind === 'pen' || it.kind === 'under' || it.kind === 'arrow');
      // 线状件（荧光笔/下划线/箭头）天然面积小，不参与面积下限。
      // ★ 也**不能查宽度下限**：它们的宽度就是"画出来多少"的动画进度，
      //   入场首帧必然是 1px 甚至 0 —— 查 w>6 会把正常动画判成"尺寸退化"（2026-10-22 实测）。
      //   真正要抓的是"高度塌成 0"（= 线根本不存在）。
      const okSize = thin ? (it.h > 0.5) : (ratio >= TH.areaMin && ratio <= TH.areaMax);
      checks.push({ id: `A3 ${tag} 尺寸`, ok: okSize, msg: thin ? `${it.w.toFixed(0)}x${it.h.toFixed(0)}px` : `占画幅 ${(ratio * 100).toFixed(2)}%` });
      if (!thin && ratio >= TH.areaMin && ratio < TH.areaWarn) warns.push(`${tag} 只有 ${(ratio * 100).toFixed(2)}%，4K 下也偏小`);

      const inset = Math.min(it.w, it.h) * 0.22;
      const coreE = meanRect(G, info.width, info.height, it.x + inset, it.y + inset, it.w - 2 * inset, it.h - 2 * inset);
      // ★ A4 只对红框：毛玻璃的 backdrop-filter 会把梯度抹平（实测 1.36 < 1.6），
      //   那是它的正常行为，不是"压在空处"。glass 只查"有没有画出来"（A6）。
      if (it.kind === 'box') {
        checks.push({ id: `A4 ${tag} 压在内容上`, ok: coreE >= TH.emptyE, msg: `框心梯度 ${coreE.toFixed(2)}（线 ${TH.emptyE}）` });
      }

      if (it.kind === 'box') {
        const off = Math.max(1, Math.round(1.5 * (g.camScale || 1)));
        const bl = Math.round(it.x) + off, bt = Math.round(it.y) + off;
        const br = Math.round(it.x + it.w - 1) - off, bb = Math.round(it.y + it.h - 1) - off;
        const borderRatio = Math.min(
          along(bl, bt, 1, 0, Math.max(1, br - bl)), along(bl, bb, 1, 0, Math.max(1, br - bl)),
          along(bl, bt, 0, 1, Math.max(1, bb - bt)), along(br, bt, 0, 1, Math.max(1, bb - bt)));
        checks.push({ id: `A5 ${tag} 边框已画`, ok: borderRatio >= TH.borderRatio, msg: `红像素 ${Math.round(borderRatio * 100)}%（线 ${Math.round(TH.borderRatio * 100)}%）` });
      }
      checks.push({ id: `A6 ${tag} 可见`, ok: it.op >= TH.opMin, msg: `op=${it.op}` });
    });

    rows.push({ t, items: g.items.length, checks, warns, png });
  }

  let fails = 0, warns = 0;
  console.log('\n标注闸门 · ' + path.basename(page) + (NEG ? `（负控：标注件挪 ${NEG}px）` : ''));
  console.log('─'.repeat(80));
  for (const r of rows) {
    const bad = r.checks.filter(c => !c.ok);
    fails += bad.length; warns += r.warns.length;
    console.log(`${bad.length ? '✗' : '✓'} t=${String(r.t).padEnd(6)} 标注件 ${r.items} 个`);
    for (const c of bad) console.log(`     ↳ ${c.id}: ${c.msg}`);
    for (const w of r.warns) console.log(`     · WARN ${w}`);
  }
  console.log('─'.repeat(80));
  console.log(fails === 0 ? `PASS · ${rows.length} 个采样点${warns ? `（${warns} 条 WARN）` : ''}` : `FAIL · ${fails} 条判据不过`);

  if (SHOT) {
    fs.mkdirSync(SHOT, { recursive: true });
    rows.forEach(r => fs.writeFileSync(path.join(SHOT, `t${String(r.t).replace('.', '_')}${NEG ? '_neg' : ''}.png`), r.png));
    console.log('截图 →', SHOT);
  }
  if (JSONOUT) fs.writeFileSync(JSONOUT, JSON.stringify(rows.map(({ png, ...x }) => x), null, 1));

  await browser.close();
  process.exit(fails === 0 ? 0 : 1);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
