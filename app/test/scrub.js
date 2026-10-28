// White-out and the eraser take the words underneath out of the saved file; the boxes come back as
// editable objects on reopen; the switch is in the strip.
import { chromium } from 'playwright';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises'; import { tmpdir } from 'node:os';
const url = process.argv[2], here = new URL('.', import.meta.url).pathname;
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); });
const wordRect = (needle, word) => page.evaluate(([n, w]) => { const sp = [...document.querySelectorAll('.textLayer span')].find(s => s.textContent.includes(n)); if (!sp) return null; const t = sp.firstChild, i = sp.textContent.indexOf(w); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + w.length); const b = r.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; }, [needle, word]);
const allText = () => page.$$eval('.textLayer span', es => es.map(e => e.textContent).join(' '));
await page.goto(url); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.setInputFiles('#fileIn', join(here, 'fixtures/wordlike.pdf')); await page.waitForSelector('.textLayer span:text("Defendant, John Doe")', { timeout: 15000 }); await page.waitForTimeout(300);
out.before = { john: /John Doe/.test(await allText()), counsel: /undersigned counsel/.test(await allText()) };
// white-out box over "John Doe"
const jr = await wordRect('Defendant, John Doe', 'John Doe');
await page.click('#tools [data-tool="whiteout"]'); out.switchShown = !!(await page.$('#scrubChk')); out.switchOn = await page.$eval('#scrubChk', e => e.checked);
await page.mouse.move(jr.x - 2, jr.y - 2); await page.mouse.down(); await page.mouse.move(jr.x + jr.w + 2, jr.y + jr.h + 2, { steps: 4 }); await page.mouse.up(); await page.waitForSelector('.obj-whiteout');
// eraser stroke through "counsel"
const cr = await wordRect('undersigned counsel', 'counsel');
await page.click('#tools [data-tool="erase"]'); await page.mouse.move(cr.x - 2, cr.y + cr.h * 0.5); await page.mouse.down(); await page.mouse.move(cr.x + cr.w + 2, cr.y + cr.h * 0.5, { steps: 4 }); await page.mouse.up(); await page.waitForSelector('.obj-ink.erase');
// save, reopen the saved file
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#saveBtn')]); await page.waitForTimeout(300);
out.toast = await page.textContent('#toast');
const saved = join(tmpdir(), 'pdfview-scrubbed.pdf'); await writeFile(saved, await (await import('node:fs/promises')).readFile(await dl.path()));
await page.setInputFiles('#fileIn', saved); await page.waitForFunction(() => document.querySelectorAll('#tabs .tab').length === 2); await page.waitForSelector('.textLayer span:text("Defendant,")', { timeout: 15000 }); await page.waitForTimeout(500);
const t = await allText();
out.after = { john: /John Doe/.test(t), john2: /John|Doe/.test(t), counsel: /undersigned counsel/.test(t), defendant: /Defendant,/.test(t), through: /by and through/.test(t), undersigned: /undersigned/.test(t), whiteouts: await page.$$eval('.obj-whiteout', e => e.length), erasers: await page.$$eval('.obj-ink.erase', e => e.length) };
console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n'));
await browser.close();
