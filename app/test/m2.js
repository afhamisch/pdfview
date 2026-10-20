import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const url = process.argv[2];
async function textOf(bytes) { const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }); const d = await task.promise; const out = []; for (let i = 1; i <= d.numPages; i++) { const p = await d.getPage(i); const t = await p.getTextContent(); out.push(t.items.map(x => x.str).join(' ')); } await task.destroy(); return out; }
const dir = mkdtempSync(join(tmpdir(), 'pdfview-')); 
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true }); const page = await ctx.newPage();
const logs = []; page.on('console', m => { if (!/willRead/.test(m.text())) logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
await page.goto(url); await page.waitForSelector('body[data-ready]', { state: 'attached' });
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); }); const dl = async (fn) => { const [d] = await Promise.all([page.waitForEvent('download'), fn()]); const p = join(dir, d.suggestedFilename()); await d.saveAs(p); return { name: d.suggestedFilename(), bytes: readFileSync(p) }; };
await page.click('#restSample'); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input').length > 3);
await page.fill('.annotationLayer input[type=text]', 'Alan F. Hamisch'); await page.check('.annotationLayer input[type=checkbox]');
// add text
await page.evaluate(() => document.querySelector('#scroller').scrollTop = 0); await page.waitForTimeout(200);
await page.click('[data-tool="text"]'); const sheet = await page.$('.sheet'); const b = await sheet.boundingBox();
await page.mouse.click(b.x + 400, b.y + 560); await page.waitForSelector('.obj-text .txt[contenteditable]'); await page.keyboard.type('Added by PDFView'); await page.keyboard.press('Enter'); await page.keyboard.type('Second point here'); await page.keyboard.press('Escape');
// format it: Times, bold, bullets, then widen the box by dragging the corner handle
await page.click('.obj-text'); await page.selectOption('#ctx select[aria-label="Font"]', 'times'); await page.click('#ctx button[title^="Bold"]'); await page.selectOption('#ctx select[aria-label="List"]', 'bullet');
{ const h = await page.$('.obj-text .hdl'); const hb = await h.boundingBox(); await page.mouse.move(hb.x + 6, hb.y + 6); await page.mouse.down(); await page.mouse.move(hb.x + 160, hb.y + 6, { steps: 5 }); await page.mouse.up(); }
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
out.textStyle = await page.$eval('.obj-text .txt', e => ({ font: getComputedStyle(e).fontFamily.slice(0, 15), weight: getComputedStyle(e).fontWeight, list: e.classList.contains('list'), text: e.textContent.slice(0, 20), width: e.closest('.obj').style.width }));
// stamp
await page.click('[data-tool="stamp"]'); await page.selectOption('#stampPick', 'CONFIDENTIAL'); await page.mouse.click(b.x + 700, b.y + 150); await page.waitForTimeout(200);
// check mark
await page.click('[data-tool="check"]'); await page.mouse.click(b.x + 100, b.y + 600);
// highlight from text selection: select the first long span on page 1 then press H
await page.click('[data-tool="select"]');
await page.evaluate(() => { const spans = [...document.querySelectorAll('.pg:nth-child(1) .textLayer span')].filter(s => s.textContent.length > 20); const r = document.createRange(); r.selectNodeContents(spans[0]); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); });
await page.keyboard.press('h');
// redact box on page 2 by dragging
await page.click('[data-tool="redact"]'); const s2 = (await page.$$('.sheet'))[1]; await s2.evaluate(e => e.scrollIntoView({ block: 'start' })); await page.waitForTimeout(200); const b2 = await s2.boundingBox();
await page.mouse.move(b2.x + 60, b2.y + 60); await page.mouse.down(); await page.mouse.move(b2.x + 500, b2.y + 200, { steps: 5 }); await page.mouse.up();
out.objects = await page.$$eval('.obj', e => e.map(x => x.className.replace(/obj |sel/g, '').trim()));
// bates
await page.click('#batesBtn'); await page.fill('#batesPrefix', 'HAM-'); await page.fill('#batesStart', '100'); await page.fill('#batesPad', '5'); await page.click('#batesApply');
out.batesPreview = await page.$$eval('.obj-bates', e => e.map(x => x.textContent));
// rotate page 1 via page bar
await page.click('.pg:nth-child(1) .pg-actions [title="Rotate page right"]'); out.rotated = await page.$eval('.pg:nth-child(1) .sheet', e => [e.style.width, e.style.height]);
// save with redaction confirm
await page.click('#saveBtn'); await page.waitForSelector('#redModal:not([hidden])');
const saved = await dl(() => page.click('#redGo'));
out.saved = { name: saved.name, size: saved.bytes.length };
const doc = await PDFDocument.load(saved.bytes); out.savedPages = doc.getPageCount(); out.rot = doc.getPage(0).getRotation().angle;
out.fieldValue = doc.getForm().getTextField('full_name').getText(); out.hasEditLayer = saved.bytes.includes('/EditLayer');
const texts = await textOf(saved.bytes); out.p1HasAdded = /Added by PDFView/.test(texts[0]); out.p1HasStamp = /CONFIDENTIAL/.test(texts[0]); out.p1Bullets = /\u2022/.test(texts[0]); out.timesBold = saved.bytes.includes('Times-Bold'); out.p1Bates = /HAM-00100/.test(texts[0]); out.p2TextAfterRedact = texts[1].trim().length;
// reopen the saved file: objects and bates come back
writeFileSync(join(dir, 'reopen.pdf'), saved.bytes); await page.setInputFiles('#fileIn', join(dir, 'reopen.pdf')); await page.waitForTimeout(1500);
out.reopen = { objects: await page.$$eval('.obj:not(.obj-bates)', e => e.length), bates: await page.$$eval('.obj-bates', e => e.map(x => x.textContent)), toast: await page.textContent('#toast') };
// undo + organize: open organize, move page 2 to position 1, done, save, check order
await page.click('#orgBtn'); await page.waitForSelector('#orgGrid .oth'); await page.click('#orgGrid .oth >> nth=1'); await page.fill('#orgMoveTo', '1'); await page.press('#orgMoveTo', 'Enter'); await page.waitForTimeout(200);
out.orgOrder = await page.$$eval('#orgGrid .oth .src', e => e.map(x => x.textContent));
const ex = await dl(() => page.click('#ctx .mini.extract')); out.extract = { name: ex.name, pages: (await PDFDocument.load(ex.bytes)).getPageCount() };
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
out.pgAfterOrg = await page.$$eval('.pg .src-note, .pg-lbl', e => e.length);
const saved2 = await dl(() => page.click('#saveBtn')); const d2 = await PDFDocument.load(saved2.bytes); out.saved2Pages = d2.getPageCount();
const t2 = await textOf(saved2.bytes); out.firstPageNowTerms = /Terms of engagement/.test(t2[0]) || t2[0].length < 40;
// combine: open two files at once; the second is appended
await page.setInputFiles('#fileIn', [join(dir, 'reopen.pdf'), join(dir, 'reopen.pdf')]); await page.waitForFunction(() => /Combined/.test(document.querySelector('#toast').textContent), null, { timeout: 30000 }); out.combined = { pages: await page.$$eval('.pg', e => e.length) };
const comb = await dl(() => page.click('#saveBtn')); out.combined.savedPages = (await PDFDocument.load(comb.bytes)).getPageCount();
// flatten: save again with the checkbox on; the form is gone but the values remain as page text
await page.check('#flatten'); const saved3 = await dl(() => page.click('#saveBtn')); await page.uncheck('#flatten');
const d3 = await PDFDocument.load(saved3.bytes); let nf = -1; try { nf = d3.getForm().getFields().length; } catch { nf = 0; }
const t3 = await textOf(saved3.bytes); out.flatten = { fields: nf, valueStillVisible: t3.some(t => /Alan F\. Hamisch/.test(t)) };
// print opens a new tab
const pop = await Promise.race([ctx.waitForEvent('page').then(p => 'tab:' + p.url().slice(0, 5)).catch(() => 'tab-timeout'), page.waitForEvent('download').then(d => 'download:' + d.suggestedFilename()).catch(() => 'dl-timeout'), (async () => { await page.click('#printBtn'); await new Promise(r => setTimeout(r, 15000)); return 'none'; })()]); out.print = pop;
out.logs = logs.slice(0, 10); console.log(JSON.stringify(out, null, 1)); await browser.close();
