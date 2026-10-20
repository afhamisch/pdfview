const { chromium } = require('playwright');
const path=require('path'),fs=require('fs');
(async()=>{
  const [,, html, pdf] = process.argv;
  const browser = await chromium.launch({args:['--allow-file-access-from-files']});
  const ctx = await browser.newContext({viewport:{width:1400,height:900},acceptDownloads:true});
  const page = await ctx.newPage();
  const logs=[]; page.on('console',m=>logs.push(m.type()+': '+m.text())); page.on('pageerror',e=>logs.push('PAGEERROR '+e.message));
  await page.goto('file://'+path.resolve(html));
  const toast=async()=>page.evaluate(()=>document.querySelector('#toast').textContent);
  const waitToast=re=>page.waitForFunction(re=>{const t=document.querySelector('#toast');return t&&!t.hidden&&new RegExp(re).test(t.textContent)},re.source,{timeout:120000});
  // 1. sample form
  await page.click('#restSample'); await page.waitForSelector('#pages [data-field]',{timeout:60000}); const out={};
  out.fields=await page.evaluate(()=>document.querySelectorAll('#pages [data-field]').length);
  await page.fill('#pages input[data-field="full_name"]','Alan F. Hamisch'); 
  // 2. add a text object
  await page.click('[data-tool="text"]'); const sheet=await page.$('.sheet'); const b=await sheet.boundingBox();
  await page.mouse.click(b.x+100,b.y+300); await page.keyboard.type('Added text'); await page.keyboard.press('Escape');
  out.objects=await page.evaluate(()=>document.querySelectorAll('.obj').length);
  // 3. save
  const [dl]=await Promise.all([page.waitForEvent('download'),page.click('#saveBtn')]);
  const p=await dl.path(); const head=fs.readFileSync(p).subarray(0,5).toString(); out.saved={name:dl.suggestedFilename(),bytes:fs.statSync(p).size,header:head};
  // 4. big pdf: nav + zoom anchoring
  await page.setInputFiles('#fileIn', path.resolve(pdf)); await waitToast(/Opened/);
  out.bigToast=await toast();
  await page.fill('#pgIn','250'); await page.press('#pgIn','Enter'); await page.waitForTimeout(300);
  out.afterGoto={pgIn:await page.inputValue('#pgIn'),pgOf:await page.textContent('#pgOf'),scrollTop:await page.evaluate(()=>document.querySelector('#scroller').scrollTop)};
  await page.click('#zoomIn'); await page.waitForTimeout(300);
  out.afterZoomIn={pgIn:await page.inputValue('#pgIn'),zoom:await page.textContent('#zoomPct')};
  await page.click('#zoomOut'); await page.click('#zoomOut'); await page.waitForTimeout(300);
  out.afterZoomOut={pgIn:await page.inputValue('#pgIn'),zoom:await page.textContent('#zoomPct')};
  await page.click('#pgNext'); await page.waitForTimeout(200); out.afterNext=await page.inputValue('#pgIn');
  await page.keyboard.press('Control+0'); await page.waitForTimeout(300); out.afterFit={pgIn:await page.inputValue('#pgIn'),zoom:await page.textContent('#zoomPct')};
  // canvases far from page 250 should be released
  await page.waitForTimeout(1500);
  out.liveCanvases=await page.evaluate(()=>[...document.querySelectorAll('.pg canvas')].filter(c=>c.width>0).length);
  // organize view and back
  await page.click('#orgBtn'); await page.waitForTimeout(500); out.orgThumbs=await page.evaluate(()=>document.querySelectorAll('#orgGrid .th').length);
  await page.keyboard.press('Escape'); await page.waitForTimeout(500); out.navAfterOrg={pgIn:await page.inputValue('#pgIn'),disabled:await page.evaluate(()=>document.querySelector('#pgIn').disabled)};
  out.fakeWorker=logs.some(l=>/fake worker/i.test(l));
  out.errors=logs.filter(l=>/error|PAGEERROR|warn/i.test(l)).slice(0,8);
  console.log(JSON.stringify(out,null,1));
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
