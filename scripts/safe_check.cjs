// safe_check.cjs v3 —— 版面双闸：竖向安全区 + 横向铺满
//
// 为什么要有它：
//   v1 用「递归 clip 相交」判断越界，同一页手工量出 6 个越界元素、它却报 0（假绿）。
//   v2 改成「元素矩形 ∩ 所有 overflow 祖先」，竖向判对了，但**管不了左右**——
//      于是「整体 scale(0.7148) 居中」那版内容缩到 1372 宽、左右各空 274px，v2 照样全 PASS。
//   v3 加横向覆盖判据：可见内容包围盒必须铺到 ≥1600px（1920 的 83%）。
//      阈值取 1600 不是 1920：版式本来就该有 ~150px 的编辑边距，逼到贴边只会更难看；
//      但 1372（那一版的 71%）必须被拦下。
//
// 用法：node safe_check.cjs <页面> [--step 0.5] [--json out.json]
// 判据：任一 t 可见内容超出 y∈[154,926] ⇒ FAIL；整段横向覆盖 < 1780 ⇒ FAIL
const puppeteer = require('puppeteer-core'), path = require('path'), fs = require('fs');
const args = process.argv.slice(2);
const page = args[0];
const gi = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
const STEP = gi('--step', 0.5);
const TOP = 154, BOT = 926, MINSPAN = 1600;

// 全屏底图 / 画布 / 计量件：本来就该铺满或贴边，不参与「内容」判定
const SKIP_ID = ['stage', 'grid', 'arc', 'endline', 'endfill', 'dots', 'vign', 'ghost'];

(async () => {
  const b = await puppeteer.launch({ executablePath: (process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'), headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files'] });
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const pf = page.split('?')[0];
  await p.goto('file:///' + path.resolve(pf).split(path.sep).join('/') + '?t=0', { waitUntil: 'load', timeout: 120000 });
  await new Promise(r => setTimeout(r, 500));
  const DUR = await p.evaluate(() => window.DUR || 0);
  if (!DUR) { console.log('FAIL 页面没有 window.DUR'); await b.close(); process.exit(2); }

  let hits = 0, samples = 0, worst = null, fillL = 1920, fillR = 0;
  const tally = {};

  for (let t = 0; t <= DUR; t += STEP) {
    const res = await p.evaluate((tt, T, B, skipArr) => {
      render(tt);
      const skip = new Set(skipArr);
      const root = document.getElementById('stage');
      if (!root) return { bad: [['__NO_STAGE__', 0, 0]], box: null };

      const eff = (el) => {                    // 有效矩形 = 自身 ∩ 所有带裁切的祖先
        const s = el.getBoundingClientRect();
        let top = s.top, bottom = s.bottom, left = s.left, right = s.right;
        for (let a = el.parentElement; a; a = a.parentElement) {
          const st = getComputedStyle(a);
          if (/hidden|clip|auto|scroll/.test(st.overflow + st.overflowX + st.overflowY)) {
            const q = a.getBoundingClientRect();
            top = Math.max(top, q.top); bottom = Math.min(bottom, q.bottom);
            left = Math.max(left, q.left); right = Math.min(right, q.right);
          }
        }
        return { top, bottom, left, right, w: right - left, h: bottom - top };
      };

      const bad = [];
      let L = 1e9, R = -1e9;
      for (const el of root.querySelectorAll('*')) {
        if (skip.has(el.id)) continue;
        if (/^(svg|canvas)$/i.test(el.tagName)) continue;
        const st = getComputedStyle(el);
        if (st.visibility === 'hidden') continue;
        if (st.display === 'none') continue;
        if (+st.opacity < 0.15) continue;
        const r = eff(el);
        if (r.w <= 2 || r.h <= 2) continue;
        if (r.top < T - 0.5 || r.bottom > B + 0.5) {
          bad.push([el.id || (typeof el.className === 'string' ? el.className : el.tagName),
                    Math.round(r.top), Math.round(r.bottom)]);
          continue;                             // 越界元素不算覆盖面，免得虚胖
        }
        if (r.left < L) L = r.left;
        if (r.right > R) R = r.right;
      }
      return { bad, box: R > -1e9 ? { l: L, r: R } : null };
    }, t, TOP, BOT, SKIP_ID);

    samples++;
    if (res.box) { fillL = Math.min(fillL, res.box.l); fillR = Math.max(fillR, res.box.r); }
    if (res.bad.length) {
      hits += res.bad.length;
      for (const it of res.bad) tally[it[0]] = (tally[it[0]] || 0) + 1;
      if (!worst || res.bad.length > worst.n) worst = { t: +t.toFixed(1), n: res.bad.length, items: res.bad.slice(0, 6) };
    }
  }

  const span = Math.round(fillR - fillL);
  const vOK = hits === 0, hOK = span >= MINSPAN, pass = vOK && hOK;
  console.log('页面 ' + path.basename(page));
  console.log('  采样 ' + samples + ' 帧（step ' + STEP + 's）· 竖向越界 ' + hits + ' 次 / ' + Object.keys(tally).length + ' 个元素');
  console.log('  横向覆盖 x∈[' + Math.round(fillL) + ',' + Math.round(fillR) + '] 共 ' + span + 'px（要求 ≥' + MINSPAN + '）'
    + (hOK ? '' : '  ← 左右没占满'));
  if (!vOK) {
    console.log('  最严重 @t=' + worst.t + 's（' + worst.n + ' 个）→ ' + JSON.stringify(worst.items));
    console.log('  元素汇总：' + Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 12).map(x => x[0] + '×' + x[1]).join(', '));
  }
  console.log('  判据（竖向 y∈[' + TOP + ',' + BOT + '] · 横向 ≥' + MINSPAN + '）⇒ ' + (pass ? 'PASS' : 'FAIL'));

  const ji = args.indexOf('--json');
  if (ji >= 0) fs.writeFileSync(args[ji + 1], JSON.stringify({ page, DUR, hits, fill: { l: Math.round(fillL), r: Math.round(fillR), span }, worst, tally, pass }, null, 1));
  await b.close();
  process.exit(pass ? 0 : 1);
})();
