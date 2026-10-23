// Tabs: several PDFs open at once; each keeps its pages, placed items, form values and scroll
// position; closing works for active and background tabs; unsaved changes are flagged.
import { chromium } from 'playwright';
import { join } from 'node:path';
const url = process.argv[2], here = new URL('.', import.meta.url).pathname;
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const page = await ctx.newPage();
const logs = []; page.on('console', m => { if (!/willRead/.test(m.text())) logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); });
const tabs = () => page.$$eval('#tabs .tab', es => es.map(e => ({ name: e.querySelector('.nm').textContent, active: e.getAttribute('aria-selected') === 'true', dirty: !!e.querySelector('.dot') })));
await page.goto(url); await page.waitForSelector('body[data-ready]', { state: 'attached' });
out.empty = await page.$eval('#tabbar', e => e.hidden);
await page.click('#restSample'); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input').length > 3);
await page.fill('.annotationLayer input[type=text]', 'Tab one value');
await page.click('#tools [data-tool="check"]'); const b = await (await page.$('.sheet')).boundingBox(); await page.mouse.click(b.x + 300, b.y + 300); await page.waitForSelector('.obj-check');
await page.evaluate(() => document.querySelector('#scroller').scrollTop = 400); await page.waitForTimeout(200);
out.one = await tabs();
// second file in a new tab
await page.setInputFiles('#fileIn', join(here, 'fixtures/wordlike.pdf')); await page.waitForSelector('.textLayer span:text("Defendant, John Doe")', { timeout: 15000 });
out.two = await tabs(); out.twoPages = await page.$$eval('.pg', e => e.length); out.twoObjs = await page.$$eval('.obj', e => e.length);
// back to the first: pages, check mark, typed value and scroll position are all still there
await page.click('#tabs .tab:nth-child(1)'); await page.waitForTimeout(400);
out.backPages = await page.$$eval('.pg', e => e.length); out.backObjs = await page.$$eval('.obj-check', e => e.length);
out.backValue = await page.$eval('.annotationLayer input[type=text]', e => e.value); out.backScroll = await page.evaluate(() => document.querySelector('#scroller').scrollTop);
out.backTabs = await tabs();
// keyboard: Ctrl+PageDown goes to the next tab
await page.keyboard.press('Control+]'); await page.waitForTimeout(300); out.afterKey = (await tabs()).map(t => t.active);
// two files at once: two more tabs, the last one active
await page.setInputFiles('#fileIn', [join(here, 'fixtures/wordlike.pdf'), join(here, 'fixtures/sample-form.pdf')]); await page.waitForFunction(() => document.querySelectorAll('#tabs .tab').length === 4, null, { timeout: 30000 }); await page.waitForTimeout(500);
out.four = await tabs(); out.toast = await page.textContent('#toast');
// close a background tab, then the active one; the neighbor takes over
await page.click('#tabs .tab:nth-child(2) .x'); await page.waitForTimeout(200); out.afterCloseBg = await tabs();
await page.click('#tabs .tab[aria-selected="true"] .x'); await page.waitForTimeout(400); out.afterCloseActive = await tabs(); out.pagesNow = await page.$$eval('.pg', e => e.length);
// a dirty tab needs two clicks to close: mark the sample dirty? samples never count, so edit wordlike instead
await page.click('#tabs .tab:nth-child(2)'); await page.waitForTimeout(300);
await page.click('#tools [data-tool="check"]'); const b2 = await (await page.$('.sheet')).boundingBox(); await page.mouse.click(b2.x + 200, b2.y + 200); await page.waitForSelector('.obj-check');
out.dirtyTabs = await tabs();
await page.click('#tabs .tab[aria-selected="true"] .x'); await page.waitForTimeout(200); out.firstCloseToast = await page.textContent('#toast'); out.stillOpen = (await tabs()).length;
await page.click('#tabs .tab[aria-selected="true"] .x'); await page.waitForTimeout(300); out.afterSecondClose = await tabs();
// close the last tab: the empty screen is back
await page.click('#tabs .tab[aria-selected="true"] .x'); await page.waitForTimeout(300); out.rest = !!(await page.$('#restOpen')); out.barHidden = await page.$eval('#tabbar', e => e.hidden);
console.log(JSON.stringify(out, null, 1)); console.log(logs.filter(l => /error|PAGEERROR/i.test(l)).join('\n'));
await browser.close();
