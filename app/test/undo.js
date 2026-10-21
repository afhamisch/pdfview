// Undo and redo buttons and keys; Shift keeps marker strokes and lines straight.
import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }); const page = await ctx.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); });
await page.goto(url); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.click('#restSample'); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input').length > 3);
const b = await (await page.$('.sheet')).boundingBox();
const count = sel => page.$$eval(sel, e => e.length);
const btns = () => page.evaluate(() => ({ undo: !document.querySelector('#undoBtn').disabled, redo: !document.querySelector('#redoBtn').disabled }));
out.start = await btns();
await page.click('[data-tool="check"]'); await page.mouse.click(b.x + 200, b.y + 300); await page.waitForSelector('.obj-check'); await page.mouse.click(b.x + 260, b.y + 300); await page.waitForTimeout(100);
out.placed = { checks: await count('.obj-check'), ...await btns() };
await page.click('#undoBtn'); await page.waitForTimeout(100); out.afterUndo = { checks: await count('.obj-check'), ...await btns() };
await page.click('#redoBtn'); await page.waitForTimeout(100); out.afterRedo = { checks: await count('.obj-check'), ...await btns() };
await page.keyboard.press('Escape'); await page.keyboard.press('Control+z'); await page.keyboard.press('Control+z'); await page.waitForTimeout(100); out.afterTwoKeys = { checks: await count('.obj-check'), ...await btns() };
await page.keyboard.press('Control+y'); await page.waitForTimeout(100); out.afterRedoKey = { checks: await count('.obj-check'), ...await btns() };
// a new action clears redo
await page.keyboard.press('Control+z'); await page.click('[data-tool="check"]'); await page.mouse.click(b.x + 400, b.y + 300); await page.waitForTimeout(100); out.afterNewAction = { checks: await count('.obj-check'), ...await btns() };
// marker with Shift: a straight stroke of two points
await page.click('[data-tool="draw"]'); await page.mouse.move(b.x + 100, b.y + 500); await page.mouse.down(); await page.keyboard.down('Shift');
for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 100 + i * 40, b.y + 500 + Math.sin(i) * 30);
await page.mouse.up(); await page.keyboard.up('Shift'); await page.waitForTimeout(100);
out.markerPts = await page.$eval('.obj-ink polyline', e => e.getAttribute('points').split(' ').length);
// arrow with Shift from a slightly sloped drag snaps to horizontal
await page.click('[data-tool="shape"]'); await page.selectOption('#shapeKind', 'arrow');
await page.mouse.move(b.x + 100, b.y + 600); await page.mouse.down(); await page.keyboard.down('Shift'); await page.mouse.move(b.x + 400, b.y + 625, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift'); await page.waitForTimeout(100);
out.arrow = await page.$eval('.obj-shape', e => ({ w: Math.round(parseFloat(e.style.width)), h: Math.round(parseFloat(e.style.height)) }));
// rectangle with Shift becomes a square
await page.keyboard.press('Escape'); await page.click('[data-tool="shape"]'); await page.selectOption('#shapeKind', 'rect');
await page.mouse.move(b.x + 500, b.y + 600); await page.mouse.down(); await page.keyboard.down('Shift'); await page.mouse.move(b.x + 700, b.y + 680, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift'); await page.waitForTimeout(100);
out.square = await page.$$eval('.obj-shape', e => { const x = e[e.length - 1]; return { w: Math.round(parseFloat(x.style.width)), h: Math.round(parseFloat(x.style.height)) }; });
console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n'));
await browser.close();
