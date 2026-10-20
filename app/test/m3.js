// End to end: compose an envelope on the sample form, send it, sign it through the link, download the completed PDF.
import { chromium } from 'playwright';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
const base = process.argv[2] || 'http://localhost:8787';
const dir = mkdtempSync(join(tmpdir(), 'pdfview-e2e-'));
const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage(); const logs = []; page.on('console', m => { if (!/willRead/.test(m.text())) logs.push(m.type() + ': ' + m.text()); }); page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); });
await page.addInitScript(() => { try { localStorage.setItem('pdfview.adminToken', 'test-admin'); localStorage.setItem('pdfview.sender', JSON.stringify({ name: 'Alan F. Hamisch', email: 'alan@example.com' })); } catch {} });
page.on('dialog', d => d.accept());
await page.goto(base + '/'); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.click('#restSample'); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input').length > 3);
await page.fill('.annotationLayer input[type=text]', 'Prefilled by sender');
// compose
await page.click('#sendBtn'); await page.waitForSelector('#envModal');
const rows = await page.$$('#signerRows .signer-row'); await rows[0].$eval('input:nth-of-type(1)', e => e.focus()); await page.keyboard.type('Jane Client'); await page.fill('#signerRows .signer-row:nth-child(1) input[type=email]', 'jane@example.com');
await page.click('#envAddSigner'); await page.fill('#signerRows .signer-row:nth-child(2) input:not([type=email])', 'Bob Witness'); await page.fill('#signerRows .signer-row:nth-child(2) input[type=email]', 'bob@example.com');
await page.fill('#envTitle', 'Retainer: Jane Client'); await page.click('#envSignersOk');
out.tool = await page.evaluate(() => document.body.dataset.tool);
const sheet = await page.$('.sheet'); const b = await sheet.boundingBox();
await page.mouse.click(b.x + 250, b.y + 300);                         // signature for signer 1 (near the signature line)
await page.selectOption('#ctx select[aria-label="Field type"]', 'date'); await page.mouse.click(b.x + 850, b.y + 380);   // date for signer 1
await page.click('.signer-chip >> nth=1'); await page.selectOption('#ctx select[aria-label="Field type"]', 'initials'); await page.mouse.click(b.x + 950, b.y + 200); // initials for signer 2
out.fields = await page.$$eval('.obj-field', e => e.map(x => x.textContent));
await page.click('#envSend'); await page.waitForSelector('#linksModal', { timeout: 60000 });
const link1 = await page.inputValue('#linksModal .signlink'); out.link1 = link1.replace(/\/sign\/.*/, '/sign/<token>');
await page.click('#linksDone');
// signer 1
const s1 = await ctx.newPage(); s1.on('pageerror', e => logs.push('S1 PAGEERROR ' + e.message)); s1.on('console', m => { if (/error/i.test(m.type())) logs.push('S1 ' + m.text()); });
await s1.goto(link1); await s1.waitForSelector('.obj-sigfield', { timeout: 60000 });
out.s1 = { fields: await s1.$$eval('.obj-sigfield', e => e.map(x => x.dataset.ftype)), toolsHidden: await s1.$eval('#tools', e => getComputedStyle(e).display === 'none'), progress: await s1.textContent('#signProgress') };
await s1.click('.obj-sigfield[data-ftype="signature"]'); await s1.waitForSelector('#sigModal:not([hidden])'); await s1.click('[data-sigtab="type"]'); await s1.fill('#sigName', 'Jane Client'); await s1.click('#sigUse');
await s1.waitForSelector('.obj-sigfield[data-ftype="signature"].done');
await s1.click('.obj-sigfield[data-ftype="date"]'); await s1.waitForSelector('.obj-sigfield[data-ftype="date"].done');
out.s1.progressAfter = await s1.textContent('#signProgress'); out.s1.finishDisabledBeforeConsent = await s1.$eval('#finishBtn', e => e.disabled);
await s1.check('#consent'); await s1.click('#finishBtn'); await s1.waitForSelector('#doneCard'); out.s1.done = await s1.textContent('#doneCard h2');
// dashboard: get link for signer 2
await page.click('#envBtn'); await page.waitForSelector('#envList'); await page.click('#envList .mini'); await page.waitForSelector('#envDetail');
out.afterS1 = { status: await page.$eval('#envDetail', e => e.dataset.status), events: await page.$$eval('#auditList tbody tr td:nth-child(2)', e => e.map(x => x.textContent)) };
await page.click('.getlink'); await page.waitForSelector('#envDetail .signlink'); const link2 = await page.inputValue('#envDetail .signlink');
const s2 = await ctx.newPage(); await s2.goto(link2); await s2.waitForSelector('.obj-sigfield', { timeout: 60000 });
out.s2 = { fields: await s2.$$eval('.obj-sigfield', e => e.map(x => x.dataset.ftype + (x.classList.contains('other') ? ':other' : ''))) };
await s2.click('.obj-sigfield[data-ftype="initials"]'); await s2.waitForSelector('#sigModal:not([hidden])'); await s2.click('[data-sigtab="type"]'); await s2.fill('#sigName', 'BW'); await s2.click('#sigUse'); await s2.waitForSelector('.obj-sigfield[data-ftype="initials"].done');
await s2.check('#consent'); await s2.click('#finishBtn'); await s2.waitForSelector('#doneCard'); out.s2.done = await s2.textContent('#doneCard p');
// completed
await page.click('#envDetail .ib[title="All envelopes"]'); await page.waitForSelector('#envList'); await page.click('#envList .mini'); await page.waitForSelector('#envDetail[data-status="completed"]');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dlCompleted')]); const fp = join(dir, 'completed.pdf'); await dl.saveAs(fp);
const doc = await PDFDocument.load(readFileSync(fp)); out.completed = { pages: doc.getPageCount(), name: dl.suggestedFilename(), events: await page.$$eval('#auditList tbody tr td:nth-child(2)', e => e.map(x => x.textContent)) };
// reused link is refused
const s3 = await ctx.newPage(); await s3.goto(link1); await s3.waitForSelector('#doneCard'); out.reuse = await s3.textContent('#doneCard h2');
out.logs = logs.slice(0, 10); console.log(JSON.stringify(out, null, 1)); await browser.close();
