// box_finder.cjs —— 标注框取坐标：给一个种子点，自动吸附到那个色块/元素的外接矩形
//
// 为什么要有它：红框坐标一直是"看 1080 宽的预览图、乘 1.7778、写进去"，误差 ±20px，
//   而且**改完没人验**。这就是"标注往往是歪的"的真实来源（与 vmap 那条是两个独立问题）。
//
// 用法：
//   node box_finder.cjs <页面.html> <t> <x,y> [--tol 28] [--pad 6]
//     x,y     种子点：你想框的那个东西上任意一点（**屏幕像素**，就是你看图看到的坐标）
//     --tol   颜色容差（0-255，默认 28；按钮/卡片给 20-35，文字块给 40-60）
//     --pad   外接矩形外扩（默认 6px，保证不贴内容）
//     --json  输出 JSON
//
// 输出：屏幕矩形 + **可直接贴进页面的 B(vx,vy,w,h) 形参**（视频坐标）
//
// 原理：以种子点颜色为基准做 4 连通填充，取外接矩形。UI 元素（按钮/卡片/搜索框）
//   都是同色块，因此比肉眼量准；**渐变或半透明元素**请加大 --tol 或改用 --pad 0 手调。
const puppeteer = require('puppeteer-core');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(2);
const page = argv[0];
const T = parseFloat(argv[1]);
const [SX, SY] = String(argv[2] || '').split(',').map(Number);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const TOL = parseFloat(opt('--tol', '28'));
const PAD = parseFloat(opt('--pad', '6'));
const JSONOUT = opt('--json', null);
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

if (!page || !isFinite(T) || !isFinite(SX) || !isFinite(SY)) {
  console.error('用法: node box_finder.cjs <页面.html> <t> <x,y> [--tol 28] [--pad 6]');
  process.exit(2);
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files'],
  });
  const p = await browser.newPage();
  await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await p.goto('file:///' + path.resolve(page).split(path.sep).join('/') + '?t=0', { waitUntil: 'load', timeout: 120000 });
  await p.evaluate(() => { window.__hold = true; });
  await p.waitForFunction(() => { const v = document.querySelector('video'); return v && v.readyState >= 2; }, { timeout: 25000 }).catch(() => {});
  await p.evaluate(async tt => {
    if (window.renderAsync) return window.renderAsync(tt);
    if (window.render) render(tt);
  }, T);

  const geo = await p.evaluate(() => {
    const cam = document.getElementById('cam');
    const win = document.getElementById('win');
    const m = new DOMMatrix(getComputedStyle(cam).transform === 'none' ? '' : getComputedStyle(cam).transform);
    const wb = win.getBoundingClientRect();
    return { a: m.a, e: m.e, f: m.f, win: { x: wb.x, y: wb.y, w: wb.width, h: wb.height } };
  });
  const png = await p.screenshot({ type: 'png' });
  await browser.close();

  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const at = (x, y) => { const i = (y * W + x) * 3; return [data[i], data[i + 1], data[i + 2]]; };
  const sx = Math.round(SX), sy = Math.round(SY);
  if (sx < 1 || sy < 1 || sx >= W - 1 || sy >= H - 1) {
    console.error(`种子点 (${sx},${sy}) 超出画面 ${W}x${H}`); process.exit(2);
  }
  const seed = at(sx, sy);
  const near = (c) => Math.abs(c[0] - seed[0]) + Math.abs(c[1] - seed[1]) + Math.abs(c[2] - seed[2]) <= TOL * 3;

  // 4 连通填充（BFS，用 typed array 当队列，避免 100 万次数组 push）
  const seen = new Uint8Array(W * H);
  const qx = new Int32Array(W * H), qy = new Int32Array(W * H);
  let head = 0, tail = 0;
  qx[tail] = sx; qy[tail] = sy; tail++; seen[sy * W + sx] = 1;
  let minX = sx, maxX = sx, minY = sy, maxY = sy, n = 0;
  const CAP = 400000;                       // 防串成一整屏
  while (head < tail && n < CAP) {
    const x = qx[head], y = qy[head]; head++; n++;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    const nb = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const k = ny * W + nx;
      if (seen[k]) continue;
      seen[k] = 1;
      if (near(at(nx, ny))) { qx[tail] = nx; qy[tail] = ny; tail++; }
    }
  }

  const scr = {
    x: Math.max(0, minX - PAD), y: Math.max(0, minY - PAD),
    w: Math.min(W - 1, maxX + PAD) - Math.max(0, minX - PAD) + 1,
    h: Math.min(H - 1, maxY + PAD) - Math.max(0, minY - PAD) + 1,
  };
  // 屏幕 → 视频坐标：减取景框原点与边框(3px)，去相机变换，再除 K
  const K = 0.71146;
  const bx = scr.x - geo.win.x - 3, by = scr.y - geo.win.y - 3;
  const vx = (bx - geo.e) / geo.a / K, vy = (by - geo.f) / geo.a / K;
  const vw = scr.w / geo.a / K, vh = scr.h / geo.a / K;

  const r = (v) => Math.round(v * 10) / 10;
  console.log(`\n种子颜色 rgb(${seed.join(',')}) · 容差 ${TOL} · 连通像素 ${n}${n >= CAP ? '（触顶，可能串色）' : ''}`);
  console.log(`相机 scale=${geo.a.toFixed(3)} 平移=(${geo.e.toFixed(1)},${geo.f.toFixed(1)})`);
  console.log(`屏幕矩形   [${scr.x},${scr.y}  ${scr.w}x${scr.h}]`);
  console.log(`\n★ 贴进页面：B(${r(vx)},${r(vy)},${r(vw)},${r(vh)})`);
  if (n >= CAP) console.log('  ⚠ 连通区域触顶，容差调小或换个种子点（可能串到整块背景）');
  if (JSONOUT) fs.writeFileSync(JSONOUT, JSON.stringify({ seed, tol: TOL, px: n, screen: scr, video: { vx: r(vx), vy: r(vy), vw: r(vw), vh: r(vh) } }, null, 1));
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
