// render-record.cjs —— 录屏美化页 → 4K mp4（逐帧同时驱动 render(t) 与 <video>.currentTime）
//
// 与 render.cjs 的唯一区别：这类页面里嵌着一段真录屏 <video id="v">，
// 每渲染一帧都要把视频 seek 到对应时间点，否则画面上的录屏会停在第一帧。
//
// 用法（在「单集/01/动画」目录下执行）：
//   node render-record.cjs <页面.html> <时长秒> <配音> <输出.mp4>
//   node render-record.cjs 录屏R01-美化.html 16.85 seg14.mp3 ../成片/R01-录屏美化-4K.mp4
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');

const PAGE_DIR = () => path.dirname(path.resolve(process.argv[2] || '.'));
function pickFfmpeg() {
  const c = [process.env.FFMPEG,
    'C:/ffmpeg/bin/ffmpeg.exe', '/usr/bin/ffmpeg'].find(x => x && fs.existsSync(x));
  if (c) return c;
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch (e) {}
  throw new Error('找不到 ffmpeg：设置环境变量 FFMPEG');
}
function pickChrome() {
  const c = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(x => x && fs.existsSync(x));
  if (c) return c;
  throw new Error('找不到 Chrome：设置环境变量 CHROME_PATH');
}
function resolveAudio(a) {
  if (!a || a === '-' || a === 'none') return null;
  if (path.isAbsolute(a) && fs.existsSync(a)) return a;
  for (const d of [process.env.AUDIO_DIR, PAGE_DIR(), process.cwd()].filter(Boolean)) {
    const p = path.join(d, a);
    if (fs.existsSync(p)) return p;
  }
  throw new Error('找不到配音文件：' + a);
}

const FF = pickFfmpeg(), CHROME = pickChrome();
const [page, D, aud, out] = process.argv.slice(2);
if (!page || !D || !aud || !out) { console.log('用法: node render-record.cjs <页面> <时长秒> <配音> <输出>'); process.exit(1); }
const AUD = resolveAudio(aud);

(async () => {
  const dir = '_f' + path.basename(out, '.mp4');
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir);
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files', '--autoplay-policy=no-user-gesture-required'] });
  const p = await b.newPage(); await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });
  const pf = page.split('?')[0];
  await p.goto('file:///' + path.resolve(pf).split(path.sep).join('/') + '?t=0', { waitUntil: 'load', timeout: 120000 });
  await p.evaluate(() => { window.__hold = true; });
  await p.evaluate(() => new Promise(r => { const v = document.getElementById('v');
    if (v.readyState >= 2) return r(); v.addEventListener('loadeddata', () => r(), { once: true }); }));
  await new Promise(r => setTimeout(r, 500));
  const N = Math.round(parseFloat(D) * 30);
  for (let i = 0; i < N; i++) {
    const t = i / 30;
    await p.evaluate(async tt => {
      render(tt);
      const v = document.getElementById('v');
      if (v) {
        const target = window.vmap ? window.vmap(tt) : tt;
        v.pause();
        if (Math.abs(v.currentTime - target) > 0.008) {
          await new Promise(res => { const h = () => { v.removeEventListener('seeked', h); res(); };
            v.addEventListener('seeked', h, { once: true }); v.currentTime = target; setTimeout(res, 900); });
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        }
      }
    }, t);
    await new Promise(r => setTimeout(r, 14));
    await p.screenshot({ path: dir + '/f' + String(i).padStart(4, '0') + '.jpg', type: 'jpeg', quality: 92 });
  }
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', '30', '-i', dir + '/f%04d.jpg'];
  if (AUD) args.push('-i', AUD);
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p');
  if (AUD) args.push('-c:a', 'aac', '-b:a', '192k'); else args.push('-an');
  args.push('-t', String(D), out);
  execFileSync(FF, args, { stdio: 'inherit' });
  try { execFileSync('cmd', ['/c', 'rmdir', '/s', '/q', dir]); } catch (e) {}
  console.log('DONE', out, N, '帧 · 配音', path.basename(AUD));
  await b.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
