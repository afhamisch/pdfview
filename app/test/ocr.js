// OCR on a scanned PDF: recognize, search a word that exists only in the image, save with invisible text, reopen and search again.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const [base, pdf, word, shots] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'pdfview-ocr-'));
async function textOf(bytes) { const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }); const d = await task.promise; const out = []; for (let i = 1; i <= d.numPages; i++) { const p = await d.getPage(i); const t = await p.getTextContent(); out.push(t.items.map(x => x.str).join(' ')); } await task.destroy(); return out; }
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }); const page = await ctx.newPage();
const logs = []; page.on('console', m => { if (!/willRead/.test(m.text())) logs.push(m.type() + ': ' + m.text().slice(0, 200)); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n').slice(0, 6).join(' / ')); console.log(JSON.stringify(out, null, 1)); console.log(logs.slice(0, 15).join('\n')); process.exit(1); });
await page.addInitScript(() => { try { localStorage.setItem('pdfview.theme', 'light'); } catch {} });
await page.goto(base + '/'); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.setInputFiles('#fileIn', pdf); await page.waitForFunction(() => [...document.querySelectorAll('.pg canvas')].some(c => c.width > 0)); await page.waitForTimeout(500);
await page.keyboard.press('Control+f'); await page.fill('#findIn', word); await page.waitForFunction(() => /No matches|\d+ of/.test(document.querySelector('#findCount').textContent)); out.before = await page.textContent('#findCount'); await page.keyboard.press('Escape');
const t0 = Date.now(); await page.click('#ocrBtn'); await page.waitForSelector('#ocrScope'); await page.selectOption('#ocrScope', 'all'); await page.click('#ocrGo');
await page.waitForFunction(() => /Recognized|failed|Stopped/.test(document.querySelector('#toast').textContent), null, { timeout: 300000 }); out.ocr = { ms: Date.now() - t0, toast: await page.textContent('#toast') };
await page.waitForTimeout(800); out.ocrSpans = await page.$$eval('.ocrLayer span.ocr', e => e.length);
await page.keyboard.press('Control+f'); await page.fill('#findIn', word); await page.waitForFunction(() => /No matches|\d+ of/.test(document.querySelector('#findCount').textContent) && !/Search/.test(document.querySelector('#findCount').textContent)); await page.waitForTimeout(400); out.after = await page.textContent('#findCount');
await page.screenshot({ path: `${shots}/ocr-search.png` }); await page.keyboard.press('Escape');
// select text with the mouse across OCR spans and read the selection
await page.evaluate(() => { document.querySelector('#scroller').scrollTop = 0; getSelection().removeAllRanges(); }); await page.waitForTimeout(300);
const sp = await page.$$('.ocrLayer span.ocr'); const r1 = await sp[0].boundingBox(), r2 = await sp[Math.min(5, sp.length - 1)].boundingBox();
await page.mouse.move(r1.x + 2, r1.y + r1.height / 2); await page.mouse.down(); await page.mouse.move(r2.x + r2.width - 2, r2.y + r2.height / 2, { steps: 6 }); await page.mouse.up();
out.selection = await page.evaluate(() => getSelection().toString().replace(/\s+/g, ' ').trim().slice(0, 80));
const [d] = await Promise.all([page.waitForEvent('download'), page.click('#saveBtn')]); const fp = join(dir, 'ocr.pdf'); await d.saveAs(fp); const bytes = readFileSync(fp);
const texts = await textOf(bytes); out.saved = { kb: Math.round(bytes.length / 1024), wordInText: texts.some(t => t.toUpperCase().includes(word.toUpperCase())), p1Words: texts[0].split(/\s+/).length };
await page.setInputFiles('#fileIn', fp); await page.waitForFunction(() => /Opened/.test(document.querySelector('#toast').textContent)); await page.waitForTimeout(1200);
await page.keyboard.press('Control+f'); await page.fill('#findIn', word); await page.waitForFunction(() => /No matches|\d+ of/.test(document.querySelector('#findCount').textContent) && !/Search/.test(document.querySelector('#findCount').textContent)); await page.waitForTimeout(300); out.reopened = await page.textContent('#findCount');
await page.screenshot({ path: `${shots}/ocr-reopened.png` });
out.logs = logs.filter(l => !/^warning/.test(l)).slice(0, 8); console.log(JSON.stringify(out, null, 1)); await browser.close();
