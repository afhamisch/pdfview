// Form-heavy PDF: fill text, check boxes, radios and a dropdown through the pdf.js field layer, save
// fillable and flattened, verify the values landed, reopen and check they show again.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
const [base, pdf, shots, label] = process.argv.slice(2);
const dir = mkdtempSync(join(tmpdir(), 'pdfview-forms-'));
async function textOf(bytes) { const task = pdfjs.getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, verbosity: 0 }); const d = await task.promise; const out = []; for (let i = 1; i <= d.numPages; i++) { const p = await d.getPage(i); const t = await p.getTextContent(); out.push(t.items.map(x => x.str).join(' ')); } await task.destroy(); return out; }
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true }); const page = await ctx.newPage();
const logs = []; page.on('console', m => { if (!/willRead/.test(m.text())) logs.push(m.type() + ': ' + m.text().slice(0, 200)); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n').slice(0, 6).join(' / ')); console.log(JSON.stringify(out, null, 1)); console.log(logs.slice(0, 15).join('\n')); process.exit(1); });
await page.addInitScript(() => { try { localStorage.setItem('pdfview.theme', 'light'); } catch {} });
const dl = async fn => { const [d] = await Promise.all([page.waitForEvent('download'), fn()]); const p = join(dir, d.suggestedFilename()); await d.saveAs(p); return { name: d.suggestedFilename(), bytes: readFileSync(p) }; };
await page.goto(base + '/'); await page.waitForSelector('body[data-ready]', { state: 'attached' });
const t0 = Date.now(); await page.setInputFiles('#fileIn', pdf); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input, .annotationLayer select, .annotationLayer textarea').length > 5); await page.waitForTimeout(800);
out.open = { ms: Date.now() - t0, pages: await page.$$eval('.pg', e => e.length), widgetsOnFirstPages: await page.$$eval('.annotationLayer input, .annotationLayer select, .annotationLayer textarea', e => e.length) };
// fill the first visible text fields, a checkbox, a radio and a dropdown
const texts = await page.$$('.annotationLayer input[type=text]:visible, .annotationLayer textarea:visible');
const typed = []; for (let i = 0; i < Math.min(4, texts.length); i++) { const v = `Test value ${i + 1}`; await texts[i].click(); await texts[i].fill(v); typed.push(v); }
await page.keyboard.press('Tab');
const cb = await page.$('.annotationLayer input[type=checkbox]:visible'); if (cb) await cb.check();
const radio = await page.$('.annotationLayer input[type=radio]:visible'); if (radio) await radio.check();
const sel = await page.$('.annotationLayer select:visible'); let picked = null; if (sel) { const opts = await sel.$$eval('option', o => o.map(x => x.value)); if (opts.length > 1) { picked = opts[opts.length - 1]; await sel.selectOption(picked); } }
await page.waitForTimeout(300); out.filled = { typed, checkbox: !!cb, radio: !!radio, dropdown: picked };
await page.screenshot({ path: `${shots}/f-${label}-filled.png` });
out.dirty = await page.$eval('#dirtyDot', e => !e.hidden);
// save fillable
const saved = await dl(() => page.click('#saveBtn'));
const doc = await PDFDocument.load(saved.bytes, { ignoreEncryption: true }); const form = doc.getForm(); const fields = form.getFields();
const values = {}; for (const f of fields) { try { if (f instanceof PDFTextField) { const t = f.getText(); if (t) values[f.getName()] = t; } else if (f instanceof PDFCheckBox) { if (f.isChecked()) values[f.getName()] = true; } else if (f instanceof PDFRadioGroup) { const s = f.getSelected(); if (s) values[f.getName()] = s; } else if (f instanceof PDFDropdown) { const s = f.getSelected(); if (s.length) values[f.getName()] = s; } } catch (e) { values['ERR ' + f.getName()] = e.message.slice(0, 60); } }
out.saved = { name: saved.name, kb: Math.round(saved.bytes.length / 1024), fields: fields.length, typedFound: typed.filter(v => Object.values(values).includes(v)).length, checkedCount: Object.values(values).filter(v => v === true).length, radioOrDropdown: Object.values(values).filter(v => typeof v === 'string' && !v.startsWith('Test value') || Array.isArray(v)).slice(0, 3), errors: Object.keys(values).filter(k => k.startsWith('ERR')).length };
// reopen: values still show in the field layer
const rp = join(dir, 'reopen.pdf'); writeFileSync(rp, saved.bytes); await page.setInputFiles('#fileIn', rp); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input').length > 5); await page.waitForTimeout(800);
out.reopen = { textValues: (await page.$$eval('.annotationLayer input[type=text], .annotationLayer textarea', e => e.map(x => x.value).filter(Boolean))).slice(0, 5), checked: await page.$$eval('.annotationLayer input:checked', e => e.length) };
// flatten
await page.check('#flatten'); const flat = await dl(() => page.click('#saveBtn')); await page.uncheck('#flatten');
let nf = 0; try { nf = (await PDFDocument.load(flat.bytes)).getForm().getFields().length; } catch { nf = -1; }
const ft = await textOf(flat.bytes); out.flatten = { fields: nf, kb: Math.round(flat.bytes.length / 1024), typedVisible: typed.filter(v => ft.some(t => t.includes(v))).length };
const fp = join(dir, 'flat.pdf'); writeFileSync(fp, flat.bytes); await page.setInputFiles('#fileIn', fp); await page.waitForFunction(() => /Opened/.test(document.querySelector('#toast').textContent)); await page.waitForTimeout(1000); await page.screenshot({ path: `${shots}/f-${label}-flat.png` });
out.logs = logs.filter(l => !/^warning/.test(l)).slice(0, 8); out.warnings = [...new Set(logs.filter(l => /^warning/.test(l)).map(l => l.slice(0, 90)))].slice(0, 5);
console.log(JSON.stringify(out, null, 1)); await browser.close();
