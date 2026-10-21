// web_drive.cjs v2 —— DOM 坐标 → 屏幕坐标，**用画面自校准**（不靠窗口边框算数）
//
// 上一版的错：chromeH = outerHeight - innerHeight 估浏览器 UI 高度，实测偏了 39px，
//   结果鼠标点在「Offline Installer」上方 39 像素 —— 点了、没反应、不报错（零报错的坏）。
// 这一版：页面左上角插一个 12×12 纯红标记 → 抓一帧 → 在像素里找它 →
//   标记的屏幕位置 = 视口原点。所有坐标 = 原点 + DOM 矩形。**判据是像素，不是 API 说法。**
//
// 用法：node web_drive.cjs <url> <out.json> <ready.txt> <steps.json> <pidfile> <calibSignal>
//   calibSignal 文件一出现 ⇒ 卸掉红色标记（开始正式录之前必须卸，否则会录进画面）
const puppeteer = require('puppeteer-core');
const fs = require('fs');

const [url, outJson, readyFile, stepsFile, pidFile, calibSignal] = process.argv.slice(2);
const J = JSON.parse(fs.readFileSync(stepsFile, 'utf8'));
const PREP = J.prep || [];
const POSTPREP = J.postprep || [];
const STEPS = Array.isArray(J) ? J : (J.steps || []);

// prep 的一条：{sel,idx,value?} —— 有 value 就设值（下拉框无法用鼠标脚本选，必须走 DOM）
async function applyPrep(p, a) {
  if (a.value !== undefined) {
    await p.evaluate((sel, idx, val) => {
      const e = document.querySelectorAll(sel)[idx];
      if (!e) return;
      e.value = val;
      e.dispatchEvent(new Event('input', { bubbles: true }));
      e.dispatchEvent(new Event('change', { bubbles: true }));
    }, a.sel, a.idx || 0, a.value);
  } else {
    await p.evaluate((sel, idx) => { const e = document.querySelectorAll(sel)[idx]; if (e) e.click(); }, a.sel, a.idx || 0);
  }
  await new Promise(r => setTimeout(r, a.wait || 900));
}

(async () => {
  const b = await puppeteer.launch({
    executablePath: (process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'),
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-first-run', '--no-default-browser-check', '--disable-features=Translate',
      '--window-position=0,0', '--window-size=1920,1080',
      '--force-device-scale-factor=1', '--disable-session-crashed-bubble', '--noerrdialogs',
    ],
    defaultViewport: null,
  });
  if (pidFile) fs.writeFileSync(pidFile, String((b.process() && b.process().pid) || ''));

  // ① 用 CDP 把窗口钉到 (0,0) 1920×1080 —— 与录制区域逐像素对齐
  const p = (await b.pages())[0];
  const sess = await p.target().createCDPSession();
  const { windowId } = await sess.send('Browser.getWindowForTarget');
  await sess.send('Browser.setWindowBounds', { windowId, bounds: { left: 0, top: 0, width: 1920, height: 1080, windowState: 'normal' } });
  await new Promise(r => setTimeout(r, 600));

  // 页面必须真的起来：网络抽风时 goto 会「成功」返回一张错误页，
  // 后面所有选择器都 found=false，却照样录出一段空画面（实测踩过）⇒ 这里硬等哨兵 + 重试
  let okPage = false;
  for (let t = 0; t < 3 && !okPage; t++) {
    await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 }).catch(e => console.log('goto warn', e.message));
    try {
      await p.waitForFunction(() => document.querySelectorAll('button,select,a').length > 4, { timeout: 15000 });
      okPage = true;
    } catch (e) { console.log('页面没起来，第 ' + (t + 1) + ' 次重试'); await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!okPage) { console.error('FATAL 页面 3 次都没正常渲染，停止（不录空画面）'); process.exit(3); }
  await new Promise(r => setTimeout(r, 1200));
  // ★ 必须把浏览器提到最前：gdigrab 抓的是桌面合成结果，Chrome 在后台就会录到别的窗口。
  //   实测（2026-10-20 23:38）：校准帧里整屏是 WorkBuddy —— 红标找不到，直接崩。
  await p.bringToFront().catch(e => console.log('bringToFront warn', e.message));
  await new Promise(r => setTimeout(r, 800));

  for (const a of PREP) {
    await applyPrep(p, a);
  }
  await p.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 400));

  // ② 插红色定位标记（position:fixed 左上角，纯红 #FF0000）
  await p.evaluate(() => {
    const d = document.createElement('div');
    d.id = '__fid';
    d.style.cssText = 'position:fixed;left:0;top:0;width:12px;height:12px;background:#FF0000;z-index:2147483647;pointer-events:none';
    document.documentElement.appendChild(d);
  });
  await new Promise(r => setTimeout(r, 250));

  const out = [];
  for (const s of STEPS) {
    // @screen 是「屏幕绝对坐标」（浏览器自己的下载气泡这类量不到 DOM 的），
    // 不能丢进 querySelectorAll —— 它不是合法选择器，会直接抛死整个进程
    if (String(s.sel || '').startsWith('@')) { out.push({ ...s, found: false }); continue; }
    const r = await p.evaluate((sel, idx) => {
      const el = document.querySelectorAll(sel)[idx];
      if (!el) return null;
      const bb = el.getBoundingClientRect();
      return { left: bb.left, top: bb.top, w: bb.width, h: bb.height,
               text: (el.innerText || el.value || '').trim().slice(0, 50),
               visible: bb.width > 0 && bb.height > 0 };
    }, s.sel, s.idx || 0).catch(() => null);
    if (!r) { out.push({ ...s, found: false }); continue; }
    out.push({ ...s, found: true, ...r, cx: Math.round(r.left + r.w / 2), cy: Math.round(r.top + r.h / 2) });
  }

  fs.writeFileSync(outJson, JSON.stringify({ url, steps: out, viewport: await p.evaluate(() => [innerWidth, innerHeight]) }, null, 1));
  fs.writeFileSync(readyFile, 'ready');
  console.log(`READY viewport=${(await p.evaluate(() => innerWidth + 'x' + innerHeight))} 红标已插入`);
  out.forEach((r, i) => console.log(`  ${i + 1}. ${r.label || r.sel}[${r.idx || 0}] → 视口(${r.cx},${r.cy}) ${r.w}x${r.h} vis=${r.visible}`));

  // ③ 等校准完成信号 → 卸标记
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    if (fs.existsSync(calibSignal)) {
      // 测量用 CDP 点过 tab（prep），录制必须从**初始状态**开始 ⇒ 重载一次复位
      // ★ 不能 reload：tab 状态写在 URL hash 里（#tab-offline），reload 会原样恢复 —— 实测踩过
      await p.goto(url, { waitUntil: 'networkidle2', timeout: 40000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1200));
      // ★ 复位之后必须重放状态（切 Offline 标签 / 设 Platform 下拉），
      //   否则 prep 的效果被 goto 冲掉 —— 录出来是「默认状态 + 点击落空」
      for (const a of POSTPREP) { await applyPrep(p, a); }
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.evaluate(() => { const e = document.getElementById('__fid'); if (e) e.remove(); });
      await new Promise(r => setTimeout(r, 300));
      fs.writeFileSync(calibSignal + '.done', 'ok'); break;
    }
    await new Promise(r => setTimeout(r, 150));
  }
  console.log('FID REMOVED (可以开始录了)');
  await new Promise(() => {});
})().catch(e => { console.error('FATAL', e); process.exit(1); });
