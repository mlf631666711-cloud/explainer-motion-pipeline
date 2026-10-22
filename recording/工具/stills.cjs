// stills.cjs —— 批量静帧 + 几何回读（一次 Chrome 启动，多次取样）
//
// 为什么要有它：原来的 _still.cjs 每次调用都启一次 Chrome + 等 1.2s 元数据，
//   取样 4 个时刻 = 4 次冷启动 ≈ 20s，而真正干活只有 4 张截图。
//   这里只 goto 一次，之后逐时刻 renderAsync + 截图。
//
// 用法：
//   node stills.cjs <page.html> <t1,t2,...> <outdir> [--json out.json]
//
// 输出（每时刻一条）：
//   t            页面时间
//   vmap         该时刻对应的片源时间（页面里的 window.vmap）
//   vCurrent     视频元素真实 currentTime（★ 判"有没有 seek 到位"就用它）
//   ready        视频 readyState
//   cam          #cam 的 transform 矩阵（a,b,c,d,e,f）
//   win          #win 取景框的屏幕矩形
//   anno         #anno 的屏幕矩形 + opacity（框已经含相机变换，所以这就是观众看到的框）
//   annolab      角标 opacity
//   png          落盘的图
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const [page, timesArg, outdir, ...rest] = process.argv.slice(2);
const jsonIdx = rest.indexOf('--json');
const jsonOut = jsonIdx >= 0 ? rest[jsonIdx + 1] : (outdir.replace(/[\\/]$/, '') + '/stills.json');
const TIMES = timesArg.split(',').map(s => parseFloat(s.trim())).filter(v => !isNaN(v));

(async () => {
  fs.mkdirSync(outdir, { recursive: true });
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files'],
  });
  const p = await b.newPage();
  await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

  const abs = path.resolve(page).split(path.sep).join('/');
  await p.goto('file:///' + abs + '?t=0', { waitUntil: 'load', timeout: 120000 });
  await p.evaluate(() => { window.__hold = true; });

  // 等视频元数据就绪（否则第一次 seek 会落空 → 停在 0 帧，框画在错的地方）
  await p.waitForFunction(
    () => { const v = document.getElementById('v'); return v && v.readyState >= 2; },
    { timeout: 20000 }
  ).catch(() => console.log('[warn] 视频 20s 内没到 readyState>=2'));

  const rows = [];
  for (const t of TIMES) {
    const ok = await p.evaluate(async tt => {
      if (!window.renderAsync) return { err: 'no renderAsync' };
      await window.renderAsync(tt);
      return { ok: 1 };
    }, t);
    if (ok && ok.err) { console.log('[ERR]', t, ok.err); continue; }

    const info = await p.evaluate(tt => {
      const v = document.getElementById('v');
      const cam = document.getElementById('cam');
      const win = document.getElementById('win');
      const m = new DOMMatrix(getComputedStyle(cam).transform === 'none' ? '' : getComputedStyle(cam).transform);
      const r = e => { const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
      // ★ 兼容两代页面：老的单个 #anno/#annolab，和 anno-kit 的 N 个 .ak[data-anno]
      const annos = [];
      document.querySelectorAll('.ak[data-anno]').forEach(e => {
        const op = +(getComputedStyle(e).opacity || 0);
        if (op > 0.02) annos.push({ kind: e.getAttribute('data-anno'), op: +op.toFixed(2), ...r(e) });
      });
      const old = document.getElementById('anno');
      return {
        t: tt,
        vmap: window.vmap ? +window.vmap(tt).toFixed(3) : null,
        vCurrent: +v.currentTime.toFixed(3),
        ready: v.readyState,
        cam: { a: +m.a.toFixed(4), d: +m.d.toFixed(4), e: +m.e.toFixed(1), f: +m.f.toFixed(1) },
        win: r(win),
        annos,
        anno: old ? r(old) : null,
        annoOp: old ? +(getComputedStyle(old).opacity || 0) : 0,
      };
    }, t);

    const png = path.join(outdir, 'still_' + String(t).replace('.', '_') + '.png');
    await p.screenshot({ path: png });
    info.png = png;
    rows.push(info);
    const brief = (info.annos || []).map(a => `${a.kind}@${a.op}`).join(' ') || (info.anno ? `box@${info.annoOp}` : 'none');
    console.log(`t=${String(t).padEnd(6)} vmap=${info.vmap} vCur=${info.vCurrent} cam=${info.cam.a} 标注: ${brief}`);
  }

  fs.writeFileSync(jsonOut, JSON.stringify({ page: abs, rows }, null, 1));
  console.log('写出', jsonOut, '·', rows.length, '条');
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
