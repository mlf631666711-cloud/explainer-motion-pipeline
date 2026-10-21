// probe.cjs —— 抽帧看画面（闸门只能判"有没有"，判不了"好不好看"）
// 用法（在「单集/01/动画」下）：node probe.cjs <页面.html> "3,6.2,8.6" _p
const puppeteer = require('puppeteer-core'), path = require('path'), fs = require('fs');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const [page, times, outdir] = process.argv.slice(2);
(async () => {
  if (!fs.existsSync(outdir)) fs.mkdirSync(outdir, { recursive: true });
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--allow-file-access-from-files'] });
  const p = await b.newPage(); await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  const errs = []; p.on('pageerror', e => errs.push(String(e)));
  const list = String(times).split(',').map(Number);
  for (const t of list) {
    const u = 'file:///' + path.resolve(page).split(path.sep).join('/') + '?t=' + t;
    await p.goto(u, { waitUntil: 'load', timeout: 120000 });
    await new Promise(r => setTimeout(r, 420));
    const f = path.join(outdir, 't' + String(t).replace('.', '_') + '.jpg');
    await p.screenshot({ path: f, type: 'jpeg', quality: 94 });
  }
  console.log('SHOT', list.length, 'errs=' + (errs.length ? JSON.stringify(errs.slice(0, 3)) : 'none'));
  await b.close();
})();
