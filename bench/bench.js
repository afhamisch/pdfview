const { chromium } = require('playwright');
const path=require('path');
(async()=>{
  const [,, html, pdf, label] = process.argv;
  const browser = await chromium.launch({args:['--enable-precise-memory-info','--allow-file-access-from-files']});
  const page = await browser.newPage({viewport:{width:1400,height:900}});
  const logs=[]; page.on('console',m=>logs.push(m.text())); page.on('pageerror',e=>logs.push('PAGEERROR '+e.message));
  await page.addInitScript(()=>{
    window.__lt={n:0,total:0,max:0};
    try{new PerformanceObserver(l=>{for(const e of l.getEntries()){window.__lt.n++;window.__lt.total+=e.duration;window.__lt.max=Math.max(window.__lt.max,e.duration)}}).observe({entryTypes:['longtask']})}catch(e){}
  });
  await page.goto('file://'+path.resolve(html));
  await page.waitForSelector('#restOpen');
  const snapLT=async()=>page.evaluate(()=>{const r={...window.__lt};window.__lt={n:0,total:0,max:0};return r});
  await snapLT();
  const t0=Date.now();
  await page.setInputFiles('#fileIn', path.resolve(pdf));
  await page.waitForFunction(()=>{const t=document.querySelector('#toast');return t&&!t.hidden&&/Opened|could not/.test(t.textContent)},null,{timeout:300000});
  const tOpen=Date.now()-t0;
  // wait for first page canvas to be painted (non-white pixel) 
  await page.waitForFunction(()=>{const c=document.querySelector('.pg canvas');if(!c||!c.width)return false;const d=c.getContext('2d').getImageData(0,0,c.width,Math.min(c.height,400)).data;for(let i=0;i<d.length;i+=16)if(d[i]<200)return true;return false},null,{timeout:300000});
  const tFirst=Date.now()-t0;
  const ltOpen=await snapLT();
  // scroll through the whole document
  const t1=Date.now();
  const H=await page.evaluate(()=>document.querySelector('#scroller').scrollHeight);
  for(let y=0;y<H;y+=1500){await page.evaluate(y=>document.querySelector('#scroller').scrollTop=y,y);await page.waitForTimeout(40)}
  await page.waitForTimeout(3000);
  const tScroll=Date.now()-t1;
  const ltScroll=await snapLT();
  const mem=await page.evaluate(()=>{let n=0,bytes=0;document.querySelectorAll('.pg canvas').forEach(c=>{if(c.width>0){n++;bytes+=c.width*c.height*4}});return{canvases:n,canvasMB:Math.round(bytes/1048576),heapMB:Math.round((performance.memory?.usedJSHeapSize||0)/1048576)}});
  // zoom timing (layout() is synchronous)
  const tz=await page.evaluate(()=>{const t=performance.now();document.querySelector('#zoomIn').click();return Math.round(performance.now()-t)});
  await page.waitForTimeout(1500);
  const ltZoom=await snapLT();
  const fake=logs.filter(l=>/fake worker/i.test(l)).length>0;
  const errs=logs.filter(l=>/PAGEERROR|Error/.test(l)).slice(0,5);
  console.log(JSON.stringify({label,pdf:path.basename(pdf),fakeWorker:fake,openMs:tOpen,firstPaintMs:tFirst,longTasksDuringOpen:ltOpen,scrollMs:tScroll,longTasksDuringScroll:ltScroll,afterScroll:mem,zoomSyncMs:tz,longTasksAfterZoom:ltZoom,errs},null,1));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
