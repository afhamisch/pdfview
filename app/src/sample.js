// A sample intake form, built on the fly so the app can be tried without a file.
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
export async function makeSample() {
  const d = await PDFDocument.create(); const pg = d.addPage([612, 792]);
  const f = await d.embedFont(StandardFonts.Helvetica), fb = await d.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(.09, .11, .16), mute = rgb(.38, .42, .48), rule = rgb(.78, .8, .84);
  const form = d.getForm();
  pg.drawRectangle({ x: 470, y: 731, width: 88, height: 22, borderColor: rgb(.72, .2, .16), borderWidth: 1.2 });
  pg.drawText('SAMPLE', { x: 487, y: 737, size: 12, font: fb, color: rgb(.72, .2, .16) });
  pg.drawText('Client Intake Form', { x: 54, y: 732, size: 22, font: fb, color: ink });
  pg.drawText('Complete each field, then sign and date at the bottom.', { x: 54, y: 712, size: 10, font: f, color: mute });
  pg.drawLine({ start: { x: 54, y: 698 }, end: { x: 558, y: 698 }, thickness: .8, color: rule });
  const lab = (t, x, y) => pg.drawText(t.toUpperCase(), { x, y, size: 7.5, font: fb, color: mute });
  const tf = (name, label, x, y, w, h, val, multi) => { lab(label, x, y + h + 5); const t = form.createTextField(name); if (multi) t.enableMultiline(); if (val) t.setText(val); t.addToPage(pg, { x, y, width: w, height: h, font: f, textColor: ink, borderColor: rule, borderWidth: .8, backgroundColor: rgb(1, 1, 1) }); t.setFontSize(multi ? 10 : 11); };
  tf('full_name', 'Full legal name', 54, 650, 504, 22, 'Jane Q. Sample'); tf('dob', 'Date of birth', 54, 598, 150, 22, ''); tf('phone', 'Phone', 220, 598, 160, 22, '(239) 555-0142'); tf('email', 'Email', 396, 598, 162, 22, ''); tf('address', 'Mailing address', 54, 520, 504, 48, '', true);
  lab('Type of matter', 54, 488);
  const rg = form.createRadioGroup('matter');
  [['ch7', 'Bankruptcy, Chapter 7'], ['ch13', 'Bankruptcy, Chapter 13'], ['pi', 'Personal injury'], ['other', 'Other']].forEach(([v, t], i) => { const x = 54 + (i % 2) * 252, y = 462 - Math.floor(i / 2) * 24; rg.addOptionToPage(v, pg, { x, y, width: 12, height: 12, borderColor: mute, borderWidth: .8, backgroundColor: rgb(1, 1, 1) }); pg.drawText(t, { x: x + 20, y: y + 2, size: 10.5, font: f, color: ink }); });
  lab('How did you hear about us?', 54, 400);
  const dd = form.createDropdown('referral'); dd.addOptions(['Select one', 'Referral from a friend', 'Web search', 'Prior client', 'Other attorney']); dd.select('Select one');
  dd.addToPage(pg, { x: 54, y: 372, width: 250, height: 22, font: f, textColor: ink, borderColor: rule, borderWidth: .8, backgroundColor: rgb(1, 1, 1) });
  const cb = form.createCheckBox('sms_ok'); cb.addToPage(pg, { x: 54, y: 332, width: 12, height: 12, borderColor: mute, borderWidth: .8, backgroundColor: rgb(1, 1, 1) });
  pg.drawText('I agree to receive appointment reminders by text message.', { x: 74, y: 334, size: 10.5, font: f, color: ink });
  pg.drawLine({ start: { x: 54, y: 300 }, end: { x: 558, y: 300 }, thickness: .8, color: rule });
  pg.drawText('I confirm the information above is true and complete to the best of my knowledge.', { x: 54, y: 276, size: 10, font: f, color: ink });
  pg.drawLine({ start: { x: 54, y: 210 }, end: { x: 360, y: 210 }, thickness: .8, color: ink }); lab('Signature', 54, 198);
  pg.drawLine({ start: { x: 390, y: 210 }, end: { x: 558, y: 210 }, thickness: .8, color: ink }); lab('Date', 390, 198);
  pg.drawText('Sample document created by PDFView. Open your own PDF to replace it.', { x: 54, y: 54, size: 8, font: f, color: mute });
  const p2 = d.addPage([612, 792]); p2.drawText('Terms of engagement', { x: 54, y: 732, size: 18, font: fb, color: ink });
  for (let i = 0; i < 28; i++) p2.drawText(`${i + 1}. The client agrees to the fee schedule and the retainer terms described in this agreement.`, { x: 54, y: 700 - i * 18, size: 10, font: f, color: ink });
  return d.save();
}
