const puppeteer=require('puppeteer-core'),path=require('path');
// density_check.cjs v2 <页面> [--step 0.1] [--json out.json] [--quiet]
// v2 修的是 v1 的一处自欺：v1 把「进度线在长」当成「画面在动」⇒ 只要挂一条全程 endline，
//   最长静默恒 0、事件率恒高、闸门永远绿，而人眼看是一张空屏（S05 t=4s 实测）。
// 因此 v2 把「计量件」（#grid 背景漂移 / #endline 进度线 / .meter 计量条）单独拎出来：
//   —— 它们照样报读数，但不许算作「内容事件」，也不许把静默窗填平。
// 判据（规格锁 §7.2 v2）：可见内容对象 ≥12（稳态）· 内容事件 ≥3/s · 内容静默 ≤1.2s
const args=process.argv.slice(2);
const page=args[0];
const gi=(k,d)=>{const i=args.indexOf(k);return i>=0?Number(args[i+1]):d;};
const STEP=gi('--step',0.1);
const METER=new Set(['grid','endline']);
const isMeter=(id,cls)=>METER.has(id)||String(cls||'').split(/\s+/).some(c=>c==='meter'||c==='tk');
(async()=>{
  const b=await puppeteer.launch({executablePath:(process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'),headless:'new',
    args:['--no-sandbox','--hide-scrollbars','--allow-file-access-from-files']});
  const p=await b.newPage();await p.setViewport({width:1920,height:1080,deviceScaleFactor:1});
  const errs=[];p.on('pageerror',e=>errs.push(String(e)));
  const pf=page.split('?')[0];const qs=page.includes('?')?page.split('?')[1]:'';
  const url='file:///'+path.resolve(pf).split(path.sep).join('/')+(qs?('?'+qs+'&t=0'):'?t=0');
  await p.goto(url,{waitUntil:'load',timeout:120000});
  await new Promise(r=>setTimeout(r,600));
  const DUR=await p.evaluate(()=>window.DUR||0);
  if(!DUR){console.log('FAIL 页面没有 window.DUR');await b.close();process.exit(2);}

  const snap=async(t)=>p.evaluate((tt,METER)=>{
    render(tt);
    const root=document.getElementById('stage');
    const out=[];
    const walk=(el)=>{
      const id=el.id||'',cls=el.className||'';
      const isMeter=el.id==='grid'||el.id==='endline'||String(cls).split(/\s+/).some(c=>c==='meter'||c==='tk');
      const st=getComputedStyle(el);
      const op=+st.opacity, w=el.offsetWidth||0, h=el.offsetHeight||0;
      const r=el.getBoundingClientRect();
      // 可见 = 自身透明度过线 且 有实际尺寸（不含 0×0 的容器）
      const vis=(op>=0.15 && w>2 && h>2)?1:0;
      out.push({k:id||cls||el.tagName, s:[(+st.opacity).toFixed(2),st.transform,w,h,
        el.style.strokeDashoffset||'',(el.textContent||'').trim().slice(0,10)].join('|'),
        meter:isMeter?1:0, vis:vis, area:Math.round(r.width*r.height)});
      for(const c of el.children) walk(c);
    };
    walk(root);
    return out;
  },t);

  const N=Math.floor(DUR/STEP);
  let prev=await snap(0);
  let evAll=0,evContent=0,silC=0,maxSilC=0,minVis=1e9,sumVis=0,nf=0;
  const perFrame=[];
  for(let i=1;i<=N;i++){
    const t=i*STEP;
    const cur=await snap(t);
    let dAll=0,dC=0;
    for(let k=0;k<Math.min(prev.length,cur.length);k++){
      if(prev[k].s!==cur[k].s){ dAll++; if(!prev[k].meter) dC++; }
    }
    const vis=cur.filter(o=>o.vis).length;
    evAll+=dAll; evContent+=dC;
    if(dC>0){silC=0;} else {silC+=STEP; if(silC>maxSilC)maxSilC=silC;}
    if(t>1.5){ if(vis<minVis)minVis=vis; }
    sumVis+=vis; nf++;
    perFrame.push({t:+t.toFixed(2),vis,dAll,dC});
    prev=cur;
  }
  const rateC=evContent/DUR, rateAll=evAll/DUR, avgVis=sumVis/nf;
  const pass = minVis>=12 && rateC>=3 && maxSilC<=1.2;
  console.log('页面 '+path.basename(page));
  console.log('  时长 '+DUR.toFixed(2)+'s · 对象 '+perFrame.length+' 帧采样');
  console.log('  内容事件 '+evContent+' ('+rateC.toFixed(1)+'/s) · 含计量件 '+evAll+' ('+rateAll.toFixed(1)+'/s)');
  console.log('  可见对象 均 '+avgVis.toFixed(1)+' · 最少 '+minVis+' （t>1.5s）');
  console.log('  内容静默 最长 '+maxSilC.toFixed(1)+'s');
  console.log('  判据 v2（可见≥12 / 内容事件≥3每秒 / 内容静默≤1.2s）⇒ '+(pass?'PASS':'FAIL'));
  if(errs.length) console.log('  pageerror '+errs.length+' 条：'+errs[0]);
  const ji=args.indexOf('--json');
  if(ji>=0)require('fs').writeFileSync(args[ji+1],JSON.stringify({page,DUR,evContent,rateC,avgVis,minVis,maxSilC,pass,perFrame},null,1));
  await b.close();
  process.exit(pass?0:1);
})();
