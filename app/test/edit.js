// Edit existing text: lift a paragraph, change a word, save; the old wording is gone from the file,
// the rest of the page did not move, undo puts the original back, and form values survive the reload.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const url = process.argv[2], here = new URL('.', import.meta.url).pathname;
async function items(bytes, n = 1) { const d = await pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }).promise; const p = await d.getPage(n); const tc = await p.getTextContent(); return tc.items; }
const dir = mkdtempSync(join(tmpdir(), 'pdfview-'));
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true }); const page = await ctx.newPage();
const logs = []; page.on('console', m => { if (!/willRead/.test(m.text())) logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); });
const dl = async (fn) => { const [d] = await Promise.all([page.waitForEvent('download'), fn()]); const p = join(dir, d.suggestedFilename()); await d.saveAs(p); return { name: d.suggestedFilename(), bytes: readFileSync(p) }; };
await page.goto(url); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.click('#restSample'); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input').length > 3);
// on the sample form: type a value, lift the subtitle line, the value must survive the page reload
await page.fill('.annotationLayer input[type=text]', 'Alan F. Hamisch'); await page.waitForTimeout(100);
await page.click('#tools [data-tool="text"]');
{ const sp = await page.$('.textLayer span:text("Complete each field")'); const b = await sp.boundingBox(); await page.mouse.move(b.x + 30, b.y + b.height / 2); await page.waitForTimeout(300); await page.mouse.move(b.x + 32, b.y + b.height / 2); await page.waitForSelector('.liftbox', { timeout: 5000 }); await page.mouse.click(b.x + 32, b.y + b.height / 2); await page.waitForSelector('.obj-text .txt[contenteditable]', { timeout: 15000 }); }
out.sampleLift = await page.evaluate(() => { const t = document.querySelector('.obj-text .txt[contenteditable]'); return { text: t.innerText.slice(0, 30), font: t.style.fontFamily.slice(0, 16) }; });
await page.keyboard.press('Escape'); await page.waitForTimeout(600);
out.formValueKept = await page.evaluate(() => document.querySelector('.annotationLayer input[type=text]').value);
out.formIds = await page.evaluate(() => [...document.querySelectorAll('.annotationLayer [data-annotation-id]')].slice(0, 3).map(e => e.dataset.annotationId));
await page.setInputFiles('#fileIn', join(here, 'fixtures/wordlike.pdf')); await page.waitForSelector('.textLayer span:text("Defendant, John Doe")', { timeout: 15000 });
const before = await items(readFileSync(join(here, 'fixtures/wordlike.pdf')));
// find the first paragraph on screen through its text span, hover it in the text tool, click
await page.click('#tools [data-tool="text"]');
const span = await page.$('.textLayer span:text("Defendant, John Doe")'); const sb = await span.boundingBox();
await page.mouse.move(sb.x + 40, sb.y + sb.height / 2); await page.waitForTimeout(300); await page.mouse.move(sb.x + 42, sb.y + sb.height / 2);
await page.waitForSelector('.liftbox', { timeout: 5000 }); out.hoverBox = true;
const t0 = Date.now(); await page.mouse.click(sb.x + 42, sb.y + sb.height / 2);
await page.waitForSelector('.obj-text .txt[contenteditable]', { timeout: 15000 }); out.liftMs = Date.now() - t0;
out.lifted = await page.evaluate(() => { const t = document.querySelector('.obj-text .txt[contenteditable]'); return { text: t.innerText.slice(0, 60), font: t.style.fontFamily, size: t.style.fontSize, lineHeight: t.style.lineHeight, align: t.style.textAlign, width: t.parentElement.style.width }; });
// the original words are off the page now (the text layer no longer has them)
await page.waitForFunction(() => ![...document.querySelectorAll('.textLayer span')].some(s => /Defendant, John Doe/.test(s.textContent)), null, { timeout: 10000 }); out.originalGone = true;
// change one word: select all and retype the start
await page.keyboard.press('Home'); await page.keyboard.press('Control+Home');
for (let i = 0; i < 'Defendant'.length; i++) await page.keyboard.press('Shift+ArrowRight');
await page.keyboard.type('Respondent'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
out.edited = await page.evaluate(() => document.querySelector('.obj-text .txt').textContent.slice(0, 40));
// undo twice (text change, then the lift) brings the original text back onto the page
await page.keyboard.press('Control+z'); await page.waitForTimeout(100); await page.keyboard.press('Control+z');
await page.waitForFunction(() => [...document.querySelectorAll('.textLayer span')].some(s => /Defendant, John Doe/.test(s.textContent)), null, { timeout: 10000 }); out.undoRestored = true;
out.objsAfterUndo = await page.evaluate(() => document.querySelectorAll('.obj-text').length);
// lift again, edit, save
await page.click('#tools [data-tool="text"]'); const span2 = await page.$('.textLayer span:text("Defendant, John Doe")'); const sb2 = await span2.boundingBox();
await page.mouse.move(sb2.x + 40, sb2.y + sb2.height / 2); await page.waitForTimeout(300); await page.mouse.move(sb2.x + 42, sb2.y + sb2.height / 2); await page.waitForSelector('.liftbox');
await page.mouse.click(sb2.x + 42, sb2.y + sb2.height / 2); await page.waitForSelector('.obj-text .txt[contenteditable]', { timeout: 15000 });
await page.keyboard.press('Control+Home'); for (let i = 0; i < 'Defendant'.length; i++) await page.keyboard.press('Shift+ArrowRight'); await page.keyboard.type('Respondent'); await page.keyboard.press('Escape'); await page.waitForTimeout(200);
const saved = await dl(() => page.click('#saveBtn'));
const after = await items(saved.bytes);
const text = after.map(i => i.str).join(' ');
out.savedHasRespondent = /Respondent, John Doe/.test(text); out.savedHasDefendant = /Defendant, John Doe/.test(text);
out.savedKeepsRest = /The deadline is/.test(text) && /Red paragraph/.test(text) && /Hearing date/.test(text);
const key = i => i.str + '@' + i.transform.map(v => v.toFixed(1)).join(',');
const untouched = before.filter(i => i.str.trim() && !/Defendant|respond to the Complaint|on October 15/.test(i.str)).map(key), afterKeys = new Set(after.map(key));
out.untouchedMoved = untouched.filter(k => !afterKeys.has(k)).length; out.untouchedTotal = untouched.length;
// the lifted paragraph starts where the old one did
const oldFirst = before.find(i => /Defendant, John Doe/.test(i.str)), newFirst = after.find(i => /Respondent, John Doe/.test(i.str));
out.firstLineShift = oldFirst && newFirst ? [Math.abs(oldFirst.transform[4] - newFirst.transform[4]).toFixed(2), Math.abs(oldFirst.transform[5] - newFirst.transform[5]).toFixed(2)] : 'missing';
out.linesAfter = after.filter(i => i.transform[5] > 720 && i.transform[5] < 760 && i.str.trim()).length;
// reopen: the paragraph is still an editable item
writeFileSync(join(dir, 'reopen.pdf'), saved.bytes); await page.setInputFiles('#fileIn', join(dir, 'reopen.pdf')); await page.waitForTimeout(1500);
out.reopenedObjs = await page.evaluate(() => document.querySelectorAll('.obj-text').length);
console.log(JSON.stringify(out, null, 1)); console.log(logs.filter(l => /error|PAGEERROR|reload:/i.test(l)).join('\n'));
await browser.close();
