// Notes become real comment annotations and come back editable on reopen without doubling up;
// the properties dialog shows the file's facts and its edits and the strip switch reach the saved file.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFHexString, PDFString } from 'pdf-lib';
const url = process.argv[2];
const dir = mkdtempSync(join(tmpdir(), 'pdfview-notes-'));
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true }); const page = await ctx.newPage();
const logs = []; page.on('console', m => { if (!/willRead/.test(m.text())) logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); });
const dl = async (fn) => { const [d] = await Promise.all([page.waitForEvent('download'), fn()]); const p = join(dir, d.suggestedFilename()); await d.saveAs(p); return { name: d.suggestedFilename(), bytes: readFileSync(p) }; };
const str = v => v instanceof PDFHexString || v instanceof PDFString ? v.decodeText() : String(v || '');
async function notesIn(bytes) { const d = await PDFDocument.load(bytes, { updateMetadata: false }); const res = []; for (const pg of d.getPages()) { const an = pg.node.Annots(); if (!an) continue; for (let i = 0; i < an.size(); i++) { const a = d.context.lookup(an.get(i)); if (a instanceof PDFDict && String(a.get(PDFName.of('Subtype'))) === '/Text') res.push({ text: str(a.get(PDFName.of('Contents'))), author: str(a.get(PDFName.of('T'))), rect: a.get(PDFName.of('Rect')).asArray().map(n => Math.round(n.asNumber())) }); } } return { doc: d, notes: res }; }
await page.goto(url); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.click('#restSample'); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input').length > 3);
// place a note, type into it, name the author, close it
await page.click('[data-tool="note"]'); const b = await (await page.$('.sheet')).boundingBox(); await page.mouse.click(b.x + 500, b.y + 300);
await page.waitForSelector('.notepop textarea'); await page.keyboard.type('Check this exhibit against the retainer.');
await page.fill('.notepop .nauthor', 'Alan'); await page.press('.notepop .nauthor', 'Tab'); await page.waitForTimeout(100);
await page.keyboard.press('Escape'); await page.waitForTimeout(200);
out.noteOnPage = await page.$$eval('.obj-note', e => e.length); out.popClosed = !(await page.$('.notepop'));
// an empty note is dropped when left
await page.click('[data-tool="note"]'); await page.mouse.click(b.x + 300, b.y + 400); await page.waitForSelector('.notepop textarea'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
out.emptyDropped = (await page.$$eval('.obj-note', e => e.length)) === 1;
// the Notes tab in the sidebar lists it
await page.keyboard.press('Control+b'); await page.click('#tabNotes'); await page.waitForSelector('.note-row', { timeout: 10000 });
out.sidebar = await page.$$eval('.note-row', e => e.map(r => r.textContent.replace(/\s+/g, ' ').trim()));
// document properties: facts, then edit the title
await page.click('#infoBtn'); await page.waitForSelector('#infoModal .props dd'); await page.waitForFunction(() => !/Reading fonts/.test(document.querySelector('#infoModal .fonts').textContent), null, { timeout: 15000 });
out.props = await page.$$eval('#infoModal .props dt', e => e.map(x => x.textContent)); out.fonts = await page.$$eval('#infoModal .fchip', e => e.map(x => x.textContent));
await page.fill('#infoModal input[data-k="title"]', 'Intake Form Test Title'); await page.fill('#infoModal input[data-k="author"]', 'Law Office of Alan F. Hamisch');
await page.click('#infoModal .btn.primary'); await page.waitForTimeout(100); out.infoClosed = !(await page.$('#infoModal'));
// save: the note is a Text annotation, the title is set
const saved = await dl(() => page.click('#saveBtn'));
const first = await notesIn(saved.bytes);
out.saved = { name: saved.name, notes: first.notes, title: first.doc.getTitle(), author: first.doc.getAuthor() };
// reopen: the note is editable again and does not double on the next save
writeFileSync(join(dir, 'reopen.pdf'), saved.bytes); await page.setInputFiles('#fileIn', join(dir, 'reopen.pdf')); await page.waitForFunction(() => /Opened/.test(document.querySelector('#toast').textContent), null, { timeout: 15000 }); await page.waitForTimeout(800);
out.reopenedNotes = await page.$$eval('.obj-note', e => e.length);
await page.click('.obj-note'); await page.waitForSelector('.notepop textarea'); await page.keyboard.press('End'); await page.keyboard.type(' Second thought.'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const again = await dl(() => page.click('#saveBtn')); const second = await notesIn(again.bytes);
out.resaved = { notes: second.notes.length, text: second.notes[0] && second.notes[0].text, title: second.doc.getTitle() };
// strip everything
await page.click('#infoBtn'); await page.waitForSelector('#infoModal'); await page.check('#stripMeta'); await page.click('#infoModal .btn.primary'); await page.waitForTimeout(100);
const stripped = await dl(() => page.click('#saveBtn')); const d3 = await PDFDocument.load(stripped.bytes, { updateMetadata: false });
out.stripped = { title: d3.getTitle() || null, producer: d3.getProducer() || null, xmp: /\/Metadata\b/.test(new TextDecoder('latin1').decode(stripped.bytes)) };
console.log(JSON.stringify(out, null, 1)); console.log(logs.filter(l => /error|PAGEERROR/i.test(l)).join('\n'));
await browser.close();
