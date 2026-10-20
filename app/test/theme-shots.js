import { chromium } from 'playwright';
const base = process.argv[2], outDir = process.argv[3];
const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: scheme }); const page = await ctx.newPage();
  await page.goto(base + '/'); await page.waitForSelector('body[data-ready]', { state: 'attached' }); await page.screenshot({ path: `${outDir}/t-${scheme}-rest.png` });
  await page.click('#restSample'); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input').length > 3); await page.waitForTimeout(500);
  await page.click('#sideBtn'); await page.waitForTimeout(600); await page.click('[data-tool="sign"]'); await page.waitForSelector('#sigModal:not([hidden])'); await page.click('[data-sigtab="type"]'); await page.fill('#sigName', 'Alan F. Hamisch'); await page.waitForTimeout(300);
  await page.screenshot({ path: `${outDir}/t-${scheme}-desk.png` }); await ctx.close();
}
await browser.close(); console.log('done');
