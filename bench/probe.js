const { chromium } = require('playwright');
const path=require('path');
(async()=>{
  const [,, html, pdf] = process.argv;
  const browser = await chromium.launch({args:['--allow-file-access-from-files']});
  const page = await browser.newPage({viewport:{width:1400,height:900}});
  const logs=[]; page.on('console',m=>logs.push(m.type()+': '+m.text())); page.on('pageerror',e=>logs.push('PAGEERROR '+e.message));
  await page.goto('file://'+path.resolve(html));
  await page.setInputFiles('#fileIn', path.resolve(pdf));
  await page.waitForFunction(()=>document.querySelectorAll('.pg').length>0);
  const count=()=>page.evaluate(()=>{const cs=[...document.querySelectorAll('.pg canvas')];const live=cs.filter(c=>c.width>0);const painted=live.filter(c=>{const d=c.getContext('2d').getImageData(0,0,c.width,Math.min(c.height,300)).data;for(let i=0;i<d.length;i+=32)if(d[i]<180)return true;return false});return{live:live.length,painted:painted.length,first:cs.findIndex(c=>c.width>0)}});
  for(const t of [1000,3000,6000]){await page.waitForTimeout(t);console.log('after wait',t,JSON.stringify(await count()))}
  await page.evaluate(()=>{const s=document.querySelector('#scroller');s.scrollTop=s.scrollHeight});
  for(const t of [1000,3000,6000]){await page.waitForTimeout(t);console.log('end, after wait',t,JSON.stringify(await count()))}
  await page.evaluate(()=>{const s=document.querySelector('#scroller');s.scrollTop=s.scrollHeight/2});
  for(const t of [1000,3000]){await page.waitForTimeout(t);console.log('middle, after wait',t,JSON.stringify(await count()))}
  console.log(logs.slice(0,10).join('\n'));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
