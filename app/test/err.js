import { chromium } from 'playwright';
const browser = await chromium.launch(); const page = await browser.newPage();
page.on('console', m => console.log(m.type() + ': ' + m.text().slice(0, 400))); page.on('pageerror', e => console.log('PAGEERROR ' + e.message + '\n' + (e.stack || '').slice(0, 600)));
await page.goto(process.argv[2]); await page.waitForTimeout(3000); console.log('ready:', await page.evaluate(() => document.body.dataset.ready)); await browser.close();
