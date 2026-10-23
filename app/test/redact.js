// Redaction leaves nothing behind: the saved file is searched byte by byte (streams decompressed)
// for the text that was under the box, for the rest of the page's text, for document metadata and
// for an attached file. Pages that were not redacted keep their text.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFRawStream, PDFName, decodePDFRawStream } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const url = process.argv[2], here = new URL('.', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'pdfview-redact-'));
// fixture: the Word-like page plus a second page of text, a title, keywords and an attached note
const src = await PDFDocument.load(readFileSync(join(here, 'fixtures/wordlike.pdf')));
const helv = await src.embedFont('Helvetica'); const p2 = src.addPage([612, 792]); p2.drawText('Second page stays as text: Hearing on November 3, 2026.', { x: 72, y: 700, size: 12, font: helv });
src.setTitle('Secret Title Doe v. Roe'); src.setKeywords(['confidential', 'doe-roe']); src.setAuthor('Secret Author');
await src.attach(new TextEncoder().encode('private notes about John Doe'), 'secret-notes.txt', { mimeType: 'text/plain' });
const fx = join(dir, 'secrets.pdf'); writeFileSync(fx, await src.save());
async function everything(bytes) { // every byte of the file plus every decompressed stream, as latin text
  let out = new TextDecoder('latin1').decode(bytes);
  const d = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  for (const [, obj] of d.context.enumerateIndirectObjects()) if (obj instanceof PDFRawStream) { try { out += '\n' + new TextDecoder('latin1').decode(decodePDFRawStream(obj).decode()); } catch {} }
  return { text: out, doc: d };
}
async function pageTexts(bytes) { const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise; const out = []; for (let i = 1; i <= d.numPages; i++) { const tc = await (await d.getPage(i)).getTextContent(); out.push(tc.items.map(x => x.str).join(' ')); } return out; }
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true }); const page = await ctx.newPage();
const logs = []; page.on('console', m => { if (!/willRead/.test(m.text())) logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); });
const dl = async (fn) => { const [d] = await Promise.all([page.waitForEvent('download'), fn()]); const p = join(dir, d.suggestedFilename()); await d.saveAs(p); return readFileSync(p); };
await page.goto(url); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.click('#restSample'); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input').length > 3);
await page.setInputFiles('#fileIn', fx); await page.waitForSelector('.textLayer span:text("Defendant, John Doe")', { timeout: 15000 });
// draw a redaction box over the first paragraph
await page.click('#tools [data-tool="redact"]'); const sp = await page.$('.textLayer span:text("Defendant, John Doe")'); const b = await sp.boundingBox();
await page.mouse.move(b.x - 4, b.y - 4); await page.mouse.down(); await page.mouse.move(b.x + b.width + 4, b.y + b.height * 3 + 6, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(200);
out.boxes = await page.$$eval('.obj-redact', e => e.length);
await page.click('#saveBtn'); await page.waitForSelector('#redModal:not([hidden])'); out.lead = await page.textContent('#redLead');
const saved = await dl(() => page.click('#redGo'));
writeFileSync(process.env.REDACT_OUT || join(dir, 'redacted.pdf'), saved);
const { text, doc } = await everything(saved);
out.leaks = ['Defendant', 'John Doe', 'Respondent', 'undersigned counsel', 'Secret Title', 'Secret Author', 'confidential', 'doe-roe', 'secret-notes', 'private notes', 'Hearing date', 'Courtroom', 'MOTION FOR EXTENSION'].filter(s => text.includes(s));
const texts = await pageTexts(saved);
out.page1Text = texts[0].trim().length; out.page2KeepsText = /Second page stays as text/.test(texts[1]);
out.revisions = (text.match(/%%EOF/g) || []).length; out.fonts = (text.match(/\/Type\s*\/Font\b/g) || []).length; out.forms = (text.match(/\/Subtype\s*\/Form\b/g) || []).length; out.images = (text.match(/\/Subtype\s*\/Image\b/g) || []).length;
out.hasEmbeddedFiles = /EmbeddedFiles/.test(text); out.hasMetadataStream = /\/Metadata\b/.test(text); out.title = doc.getTitle() || null;
out.pages = doc.getPageCount(); out.kb = Math.round(saved.length / 1024);
console.log(JSON.stringify(out, null, 1)); console.log(logs.filter(l => /error|PAGEERROR/i.test(l)).join('\n'));
await browser.close();
