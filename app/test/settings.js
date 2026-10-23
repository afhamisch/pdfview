// Settings dialog: version line, theme select shared with the toolbar button, name on notes, token
// field when served; Escape closes it. The update check button only exists in the desktop app.
import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.launch(); const page = await browser.newPage();
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); });
await page.goto(url); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.click('#settingsBtn'); await page.waitForSelector('#settingsModal');
out.version = await page.textContent('#setVersion');
out.updateButton = !!(await page.$('#updCheck'));
out.tokenField = !!(await page.$('#setToken'));
await page.selectOption('#setTheme', 'dark');
out.dark = await page.evaluate(() => ({ attr: document.documentElement.dataset.theme, stored: localStorage.getItem('pdfview.theme') }));
await page.fill('#setAuthor', 'A. Hamisch'); await page.press('#setAuthor', 'Tab');
out.author = await page.evaluate(() => localStorage.getItem('pdfview.author'));
await page.keyboard.press('Escape'); await page.waitForSelector('#settingsModal', { state: 'detached' });
// the toolbar button cycles from dark back to system, and the dialog shows that
await page.click('#themeBtn'); out.afterCycle = await page.evaluate(() => document.documentElement.dataset.theme || 'system');
await page.click('#settingsBtn'); await page.waitForSelector('#settingsModal'); out.selectShows = await page.inputValue('#setTheme');
await page.mouse.click(5, 5); await page.waitForSelector('#settingsModal', { state: 'detached' }); out.closedByBackdrop = true;
console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n'));
await browser.close();
