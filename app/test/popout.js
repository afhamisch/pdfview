// A tab moved to its own window: the new window shows the document with its placed items, the
// old window loses the tab; tabs can be reordered by dragging; the right-click menu works.
import { chromium } from 'playwright';
import { join } from 'node:path';
const url = process.argv[2], here = new URL('.', import.meta.url).pathname;
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); });
const tabs = p => p.$$eval('#tabs .tab .nm', es => es.map(e => e.textContent));
await page.goto(url); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.click('#restSample'); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input').length > 3);
await page.setInputFiles('#fileIn', join(here, 'fixtures/wordlike.pdf')); await page.waitForSelector('.textLayer span:text("Defendant, John Doe")', { timeout: 15000 });
// mark the wordlike document so the move can be checked
await page.click('[data-tool="check"]'); const b = await (await page.$('.sheet')).boundingBox(); await page.mouse.click(b.x + 300, b.y + 300); await page.waitForSelector('.obj-check');
await page.click('[data-tool="note"]'); await page.mouse.click(b.x + 500, b.y + 300); await page.waitForSelector('.notepop textarea'); await page.keyboard.type('moved note'); await page.keyboard.press('Escape');
out.before = await tabs(page);
// right-click menu: Open in new window
await page.click('#tabs .tab:nth-child(2)', { button: 'right' }); await page.waitForSelector('.tabmenu');
out.menu = await page.$$eval('.tabmenu button', e => e.map(x => x.textContent));
const [child] = await Promise.all([ctx.waitForEvent('page'), page.click('.tabmenu button:text("Open in new window")')]);
await child.waitForSelector('body[data-ready]', { state: 'attached' });
await child.waitForFunction(() => document.querySelectorAll('#tabs .tab').length === 1 && document.querySelectorAll('.obj').length >= 2, null, { timeout: 20000 });
out.child = { tabs: await tabs(child), checks: await child.$$eval('.obj-check', e => e.length), notes: await child.$$eval('.obj-note', e => e.length), toast: await child.textContent('#toast'), text: await child.$$eval('.textLayer span', e => e.some(s => /Defendant, John Doe/.test(s.textContent))) };
await page.waitForTimeout(300); out.parent = { tabs: await tabs(page), rest: !!(await page.$('#restOpen')) };
// move the last tab out too: the parent shows the empty screen
await page.click('#tabs .tab:nth-child(1)', { button: 'right' }); await page.waitForSelector('.tabmenu');
const [child2] = await Promise.all([ctx.waitForEvent('page'), page.click('.tabmenu button:text("Open in new window")')]);
await child2.waitForSelector('body[data-ready]', { state: 'attached' }); await child2.waitForFunction(() => document.querySelectorAll('#tabs .tab').length === 1, null, { timeout: 20000 });
await page.waitForTimeout(400); out.parentAfterLast = { tabs: await tabs(page), rest: !!(await page.$('#restOpen')), barHidden: await page.$eval('#tabbar', e => e.hidden) };
out.child2 = { tabs: await tabs(child2), inputs: await child2.$$eval('.annotationLayer input', e => e.length) };
// reorder by dragging in the child with two tabs
await child2.setInputFiles('#fileIn', join(here, 'fixtures/wordlike.pdf')); await child2.waitForFunction(() => document.querySelectorAll('#tabs .tab').length === 2);
const t1 = await (await child2.$('#tabs .tab:nth-child(1)')).boundingBox(), t2 = await (await child2.$('#tabs .tab:nth-child(2)')).boundingBox();
await child2.mouse.move(t2.x + 20, t2.y + 10); await child2.mouse.down(); await child2.mouse.move(t1.x + 20, t1.y + 10, { steps: 8 }); await child2.mouse.up(); await child2.waitForTimeout(300);
out.reordered = await tabs(child2);
console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n'));
await browser.close();
