// 一次性探针：把 EIM 页的选择器 / option 值 / 下载按钮 id 全打出来
const puppeteer = require('puppeteer-core');

(async () => {
  const url = process.argv[2];
  const b = await puppeteer.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: false,
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--no-first-run', '--no-default-browser-check', '--window-position=0,0', '--window-size=1920,1080'],
    defaultViewport: null,
  });
  const p = (await b.pages())[0];
  await p.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2500));

  const tabs = await p.evaluate(() => [...document.querySelectorAll('button.tab-button')].map((e, i) => i + ':' + e.innerText.trim()));
  console.log('TABS', JSON.stringify(tabs));

  // 切到 offline
  await p.evaluate(() => { const e = document.querySelectorAll('button.tab-button')[1]; if (e) e.click(); });
  await new Promise(r => setTimeout(r, 1500));

  const info = await p.evaluate(() => {
    const sels = [...document.querySelectorAll('select')].map((e, i) => ({
      i, id: e.id || '', name: e.name || '',
      value: e.value,
      options: [...e.options].map(o => o.value + ' | ' + o.text.trim()).slice(0, 12),
    }));
    const btns = [...document.querySelectorAll('button,a[role=button]')]
      .filter(e => /download|下载/i.test(e.innerText || '') || /download/i.test(e.id || ''))
      .map(e => (e.id || '') + ' :: ' + (e.innerText || '').trim().slice(0, 40));
    const inputs = [...document.querySelectorAll('input')].map((e, i) => i + ' ' + (e.type || '') + ' ' + (e.id || e.name || '') + ' ph=' + (e.placeholder || ''));
    return { sels, btns, inputs };
  });
  console.log('SELECTS', JSON.stringify(info.sels, null, 1));
  console.log('BTNS', JSON.stringify(info.btns, null, 1));
  console.log('INPUTS', JSON.stringify(info.inputs, null, 1));
  console.log('URL', p.url());
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
