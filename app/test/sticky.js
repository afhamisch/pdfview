// Tools stay active after a placement: two text boxes and two stamps in a row without re-picking the
// tool; the Text tool edits existing text when clicked; an empty note left behind is dropped;
// Escape returns to Select.
import { chromium } from 'playwright';
const url = process.argv[2];
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const logs = []; page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
const out = {}; process.on('uncaughtException', e => { console.log('FAILED', e.message.split('\n')[0]); console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n')); process.exit(1); });
const tool = () => page.evaluate(() => document.body.dataset.tool);
const texts = () => page.$$eval('.obj-text .txt', es => es.map(e => e.textContent));
await page.goto(url); await page.waitForSelector('body[data-ready]', { state: 'attached' });
await page.click('#restSample'); await page.waitForFunction(() => document.querySelectorAll('.annotationLayer input').length > 3);
const b = await (await page.$('.sheet')).boundingBox();
await page.click('#tools [data-tool="text"]');
await page.mouse.click(b.x + 200, b.y + 300); await page.waitForSelector('.obj-text .txt[contenteditable]'); await page.keyboard.type('first');
out.toolWhileTyping = await tool();
// clicking elsewhere commits the first box and starts a second one, no tool click in between
await page.mouse.click(b.x + 200, b.y + 400); await page.waitForFunction(() => document.querySelectorAll('.obj-text').length === 2); await page.waitForSelector('.obj-text:nth-of-type(2) .txt[contenteditable]'); await page.keyboard.type('second');
await page.mouse.click(b.x + 600, b.y + 500); await page.waitForFunction(() => document.querySelectorAll('.obj-text').length === 3);
// an empty box left behind disappears
await page.mouse.click(b.x + 600, b.y + 600); await page.waitForTimeout(150); await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('.obj-text .txt[contenteditable]'));
out.afterThree = { texts: await texts(), tool: await tool() };
// the Text tool edits existing text when clicked
await page.click('#tools [data-tool="text"]'); await page.click('.obj-text:nth-of-type(1)'); await page.waitForSelector('.obj-text:nth-of-type(1) .txt[contenteditable]');
await page.keyboard.press('End'); await page.keyboard.type(' edited'); await page.keyboard.press('Escape');
out.edited = { texts: await texts(), tool: await tool() };
await page.keyboard.press('Escape'); out.escapeTool = await tool(); // a second Escape leaves the tool
// stamps in a row
await page.click('#tools [data-tool="stamp"]'); await page.selectOption('#stampPick', 'EXHIBIT A'); await page.mouse.click(b.x + 400, b.y + 150);
await page.selectOption('#stampPick', 'EXHIBIT B'); await page.mouse.click(b.x + 400, b.y + 200); await page.waitForTimeout(100);
out.stamps = { count: await page.$$eval('.obj-text.boxed', e => e.length), pickerStillUp: !!(await page.$('#stampPick')), words: (await texts()).filter(t => /EXHIBIT/.test(t)), tool: await tool() };
// notes: an empty first note is dropped when the second is placed
await page.keyboard.press('Escape'); await page.click('#tools [data-tool="note"]'); await page.mouse.click(b.x + 500, b.y + 300); await page.waitForSelector('.notepop textarea');
await page.mouse.click(b.x + 500, b.y + 400); await page.waitForTimeout(150); await page.keyboard.type('kept'); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
out.notes = { count: await page.$$eval('.obj-note', e => e.length), tool: await tool() };
await page.click('#tools [data-tool="select"]'); out.selectTool = await tool();
console.log(JSON.stringify(out, null, 1)); console.log(logs.join('\n'));
await browser.close();
