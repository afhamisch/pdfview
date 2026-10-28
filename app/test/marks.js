// Marks already in a file (made elsewhere): click selects, Delete removes it from the file, Undo puts
// it back; the eraser removes marks it crosses (the file's and ours) and paints white elsewhere.
import { chromium } from 'playwright';
import { PDFDocument, PDFName, PDFArray, PDFDict } from 'pdf-lib';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path'; import { tmpdir } from 'node:os';
const url = process.argv[2], here = new URL('.', import.meta.url).pathname;
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); });
// a fixture with three marks made "elsewhere": a highlight, a red box and a sticky note with its popup
const src = await PDFDocument.load(await readFile(join(here, 'fixtures/wordlike.pdf')));
{ const ctx = src.context, p0 = src.getPage(0), PN = k => PDFName.of(k);
  const hl = ctx.register(ctx.obj({ Type: PN('Annot'), Subtype: PN('Highlight'), Rect: [100, 600, 300, 620], QuadPoints: [100, 620, 300, 620, 100, 600, 300, 600], C: [1, 1, 0], CA: 1, F: 4 }));
  const sq = ctx.register(ctx.obj({ Type: PN('Annot'), Subtype: PN('Square'), Rect: [100, 400, 220, 450], C: [1, 0, 0], Border: [0, 0, 2], F: 4 }));
  const note = ctx.register(ctx.obj({ Type: PN('Annot'), Subtype: PN('Text'), Rect: [400, 400, 420, 420], Contents: PDFName.of('x').constructor === PDFName ? undefined : undefined, C: [1, 1, 0], F: 4 }));
  const nd = ctx.lookup(note); nd.set(PN('Contents'), src.context.obj('old note')); 
  const pop = ctx.register(ctx.obj({ Type: PN('Annot'), Subtype: PN('Popup'), Rect: [420, 400, 600, 500], Parent: note, Open: false }));
  nd.set(PN('Popup'), pop);
  p0.node.set(PN('Annots'), ctx.obj([hl, sq, note, pop])); }
const fx = join(tmpdir(), 'pdfview-marks.pdf'); await writeFile(fx, await src.save());
await page.goto(url); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.setInputFiles('#fileIn', fx); await page.waitForSelector('.annotationLayer section.highlightAnnotation', { timeout: 20000 });
const count = sel => page.$$eval(sel, e => e.length);
out.start = { hl: await count('section.highlightAnnotation'), sq: await count('section.squareAnnotation'), note: await count('section.textAnnotation') };
// click the highlight: selected, Delete removes it, Undo brings it back
await page.click('section.highlightAnnotation'); await page.waitForSelector('#delMark');
out.selected = { label: await page.textContent('#ctx .lbl'), outlined: await count('section.asel') };
await page.keyboard.press('Delete'); await page.waitForFunction(() => !document.querySelector('section.highlightAnnotation'), null, { timeout: 15000 }); await page.waitForTimeout(300);
out.afterDelete = { hl: await count('section.highlightAnnotation'), sq: await count('section.squareAnnotation'), ctxDel: !!(await page.$('#delMark')), toast: await page.textContent('#toast') };
await page.keyboard.press('Control+z'); await page.waitForSelector('section.highlightAnnotation', { timeout: 15000 }); await page.waitForTimeout(300);
out.afterUndo = { hl: await count('section.highlightAnnotation') }; await page.waitForFunction(() => !window.__pdfview.lifting); await page.waitForTimeout(300);
// the Delete button in the strip
await page.click('section.highlightAnnotation'); await page.click('#delMark'); await page.waitForFunction(() => !document.querySelector('section.highlightAnnotation'), null, { timeout: 15000 }); await page.waitForTimeout(300);
// eraser across the red box made elsewhere removes it
await page.$eval('section.squareAnnotation', e => e.scrollIntoView({ block: 'center' })); await page.waitForTimeout(400);
const b = await (await page.$('.sheet')).boundingBox(); const sq = await (await page.$('section.squareAnnotation')).boundingBox();
await page.click('#tools [data-tool="erase"]'); await page.mouse.move(sq.x - 10, sq.y + sq.height / 2); await page.mouse.down(); await page.mouse.move(sq.x + sq.width + 10, sq.y + sq.height / 2, { steps: 6 }); await page.mouse.up();
await page.waitForFunction(() => !document.querySelector('section.squareAnnotation'), null, { timeout: 15000 }); await page.waitForTimeout(300);
out.afterEraseBox = { sq: await count('section.squareAnnotation'), note: await count('section.textAnnotation'), eraseStrokes: await count('.obj-ink.erase') };
// our own highlight: drag one, then erase across it
await page.click('#tools [data-tool="highlight"]'); await page.mouse.move(b.x + 100, sq.y + 150); await page.mouse.down(); await page.mouse.move(b.x + 400, sq.y + 180, { steps: 5 }); await page.mouse.up(); await page.waitForSelector('.obj-highlight');
await page.click('#tools [data-tool="erase"]'); await page.waitForTimeout(200); const hb = await (await page.$('.obj-highlight')).boundingBox();
await page.mouse.move(hb.x - 20, hb.y + hb.height / 2); await page.mouse.down(); await page.mouse.move(hb.x + 100, hb.y + hb.height / 2, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(200);
out.afterEraseOurs = { highlights: await count('.obj-highlight'), eraseStrokes: await count('.obj-ink.erase'), toast: await page.textContent('#toast') };
// over plain page content the eraser paints white
await page.mouse.move(hb.x, hb.y + 120); await page.mouse.down(); await page.mouse.move(hb.x + 100, hb.y + 120, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(200);
out.afterEraseBlank = { eraseStrokes: await count('.obj-ink.erase') };
// saved file: highlight and box gone, note and its popup kept
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#saveBtn')]);
const saved = await PDFDocument.load(await readFile(await dl.path()), { ignoreEncryption: true });
const types = []; try { const a = saved.getPage(0).node.lookup(PDFName.of('Annots'), PDFArray); for (let i = 0; i < a.size(); i++) types.push(String(a.lookup(i, PDFDict).get(PDFName.of('Subtype')))); } catch {}
out.savedAnnots = types.filter(t => !/Widget/.test(t));
console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n'));
await browser.close();
