// render.cjs —— HTML 动画页 → 视频（默认 4K/30fps；逐帧 render(t) 后抓图，再由 ffmpeg 合成）
//
// 用法：
//   node render.cjs <页面.html> <时长秒> <配音文件|-> <输出.mp4>
//   node render.cjs S04.html 9.82 seg04.mp3 out/S04.mp4
//   node render.cjs S04.html 9.82 -            out/S04.mp4      ← 无声版（- 占位）
//
// 环境变量（都可省略，脚本会自己找）：
//   FFMPEG      ffmpeg 可执行文件
//   CHROME_PATH Chrome 可执行文件
//   AUDIO_DIR   配音所在目录（只给文件名时来这里找；默认=页面同目录）
//   DEVICE_SCALE 默认 2（1920×1080 页面 → 3840×2160）；要 1080p 就设 1
//   NODE_PATH   必须能 require 到 puppeteer-core
//
// 为什么不用录屏而是逐帧抓图：录屏会掉帧、会和 CSS 动画时钟错位；
// 逐帧 render(i/30) 是确定性的，同一页面渲两次数值上完全一致。
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

function pickFfmpeg() {
  const cands = [process.env.FFMPEG,
    'C:/ffmpeg/bin/ffmpeg.exe', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch (e) {}
  throw new Error('找不到 ffmpeg：设置环境变量 FFMPEG');
}
function pickChrome() {
  const cands = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  for (const c of cands) if (c && fs.existsSync(c)) return c;
  throw new Error('找不到 Chrome：设置环境变量 CHROME_PATH');
}
function resolveAudio(a, pageDir) {
  if (!a || a === '-' || a === 'none') return null;
  if (path.isAbsolute(a) && fs.existsSync(a)) return a;
  const dirs = [process.env.AUDIO_DIR, pageDir, process.cwd()].filter(Boolean);
  for (const d of dirs) { const p = path.join(d, a); if (fs.existsSync(p)) return p; }
  throw new Error('找不到配音文件：' + a);
}

const [page, D, seg, out] = process.argv.slice(2);
if (!page || !D || !seg || !out) {
  console.log('用法: node render.cjs <页面.html> <时长秒> <配音文件|-> <输出.mp4>');
  process.exit(1);
}
const FF = pickFfmpeg(), CHROME = pickChrome();
const PAGE_DIR = path.dirname(path.resolve(page));
const AUD = resolveAudio(seg, PAGE_DIR);
const FPS = Number(process.env.FPS || 30);
const SCALE = Number(process.env.DEVICE_SCALE || 2);   // 2 ⇒ 1920×1080 页面出 3840×2160

(async () => {
  const dir = '_f' + path.basename(out, '.mp4');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: SCALE });
  const [pf, qs] = page.split('?');
  const q0 = qs ? (qs + '&t=0') : 't=0';
  await p.goto('file:///' + path.resolve(pf).split(path.sep).join('/') + '?' + q0, { waitUntil: 'load', timeout: 120000 });
  await p.evaluate(() => { window.__hold = true; });
  await new Promise(r => setTimeout(r, 700));

  const N = Math.round(parseFloat(D) * FPS);
  for (let i = 0; i < N; i++) {
    await p.evaluate(async t => {
      if (window.renderAsync) { await window.renderAsync(t); }
      else if (window.render) { render(t); }
      else throw new Error('页面没有 window.render(t)');
    }, i / FPS);
    await new Promise(r => setTimeout(r, 35));
    await p.screenshot({ path: dir + '/f' + String(i).padStart(4, '0') + '.jpg', type: 'jpeg', quality: 92 });
  }

  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(FPS), '-i', dir + '/f%04d.jpg'];
  if (AUD) args.push('-i', AUD);
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p');
  if (AUD) args.push('-c:a', 'aac', '-b:a', '192k'); else args.push('-an');
  args.push('-t', String(D), out);
  execFileSync(FF, args, { stdio: 'inherit' });
  try { execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', dir]); } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); }
  console.log('DONE', out, N, '帧', AUD ? '· 配音 ' + path.basename(AUD) : '· 无声');
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
