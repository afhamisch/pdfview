// Editing recognized text on a scan: the block is covered and retyped, and the old words leave the
// selectable layer, the search index and the saved file.
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const [base, pdf, word, replacement] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'pdfview-editocr-'));
async function textOf(bytes) { const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise; const p = await d.getPage(1); const tc = await p.getTextContent(); return tc.items.map(i => i.str).join(' '); }
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }); const page = await ctx.newPage();
const logs = []; page.on('console', m => { if (!/willRead/.test(m.text())) logs.push(m.type() + ': ' + m.text().slice(0, 200)); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n').slice(0, 4).join(' / ')); console.log(JSON.stringify(out, null, 1)); console.log(logs.slice(0, 15).join('\n')); process.exit(1); });
await page.goto(base + '/'); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.setInputFiles('#fileIn', pdf); await page.waitForFunction(() => [...document.querySelectorAll('.pg canvas')].some(c => c.width > 0)); await page.waitForTimeout(500);
await page.click('#ocrBtn'); await page.waitForSelector('#ocrScope'); await page.selectOption('#ocrScope', 'all'); await page.click('#ocrGo');
await page.waitForFunction(() => /Recognized|failed|Stopped/.test(document.querySelector('#toast').textContent), null, { timeout: 300000 }); await page.waitForTimeout(800);
out.ocrSpans = await page.$$eval('.ocrLayer span.ocr', e => e.length);
// hover the first recognized word in the text tool and lift its block
await page.evaluate(() => { document.querySelector('#scroller').scrollTop = 0; }); await page.waitForTimeout(200);
await page.click('#tools [data-tool="text"]');
const sp = await page.$(`.ocrLayer span.ocr:text("${word}")`); const b = await sp.boundingBox();
await page.mouse.move(b.x + 5, b.y + b.height / 2); await page.waitForTimeout(300); await page.mouse.move(b.x + 7, b.y + b.height / 2); await page.waitForSelector('.liftbox', { timeout: 10000 });
await page.mouse.click(b.x + 7, b.y + b.height / 2); await page.waitForSelector('.obj-text .txt[contenteditable]', { timeout: 15000 });
out.toast = await page.textContent('#toast');
out.lifted = await page.evaluate(() => document.querySelector('.obj-text .txt[contenteditable]').innerText.slice(0, 60));
out.whiteouts = await page.$$eval('.obj-whiteout', e => e.length);
await page.keyboard.press('Control+a'); await page.keyboard.type(replacement); await page.keyboard.press('Escape'); await page.waitForTimeout(300);
out.spanStillHasWord = await page.$$eval('.ocrLayer span.ocr', (e, w) => e.some(s => s.textContent.includes(w)), word);
await page.keyboard.press('Control+f'); await page.fill('#findIn', word); await page.waitForFunction(() => /No matches|\d+ of/.test(document.querySelector('#findCount').textContent) && !/Search/.test(document.querySelector('#findCount').textContent), null, { timeout: 20000 });
out.findAfterEdit = await page.textContent('#findCount'); await page.keyboard.press('Escape');
const [d] = await Promise.all([page.waitForEvent('download'), page.click('#saveBtn')]); const fp = join(dir, 'edited.pdf'); await d.saveAs(fp);
const text = await textOf(readFileSync(fp));
out.savedHasOld = text.includes(word); out.savedHasNew = text.includes(replacement); out.savedWords = text.split(/\s+/).length;
// undo the edit and the lift: the words are back in the layer
await page.keyboard.press('Control+z'); await page.waitForTimeout(100); await page.keyboard.press('Control+z'); await page.waitForTimeout(400);
out.spanBackAfterUndo = await page.$$eval('.ocrLayer span.ocr', (e, w) => e.some(s => s.textContent.includes(w)), word);
out.logs = logs.filter(l => !/^warning/.test(l)).slice(0, 8); console.log(JSON.stringify(out, null, 1)); await browser.close();
