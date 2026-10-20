// The static page shell: header, context strip, body, find bar, modals.
import { ICON } from './ui.js';
const tool = (t, label, key) => `<button class="tb" data-tool="${t}" aria-pressed="${t === 'select'}" title="${label} (${key})">${ICON[t]}<span class="t">${label}</span></button>`;
export const SHELL = `
<div class="app" id="deskApp">
  <header class="top">
    <div class="brand">${ICON.open.replace('<svg', '<svg width="18" height="18"')}<span>PDFView</span></div>
    <button class="btn" id="openBtn" type="button">${ICON.open}Open</button>
    <input type="file" id="fileIn" accept="application/pdf,.pdf" multiple hidden><input type="file" id="insFile" accept="application/pdf,.pdf" hidden>
    <div class="file" id="fileName"><b>No file</b></div>
    <button class="ib" id="closeBtn" type="button" title="Close PDF" aria-label="Close PDF" hidden>${ICON.close}</button>
    <div class="grp">
      <button class="tb" id="sideBtn" aria-pressed="false" title="Pages and bookmarks">${ICON.side}</button>
      <button class="tb" id="findBtn" title="Find (Ctrl+F)">${ICON.find}</button>
      <button class="tb" id="themeBtn" title="Theme: follows your system. Click to switch." aria-label="Theme">${ICON.theme}</button>
    </div>
    <div class="grp">
      <button class="tb" id="zoomOut" title="Zoom out (Ctrl+minus)" aria-label="Zoom out">${ICON.minus}</button>
      <span class="zoom" id="zoomPct">100%</span>
      <button class="tb" id="zoomIn" title="Zoom in (Ctrl+plus)" aria-label="Zoom in">${ICON.plus}</button>
      <button class="tb" id="zoomFit" title="Fit width or whole page (Ctrl+0)" aria-label="Fit">${ICON.fit}</button>
    </div>
    <div class="grp" id="nav">
      <button class="tb" id="pgPrev" title="Previous page" aria-label="Previous page">${ICON.up}</button>
      <input class="pgin" id="pgIn" type="number" min="1" value="1" aria-label="Current page" title="Type a page number and press Enter">
      <span class="zoom" id="pgOf">of 0</span>
      <button class="tb" id="pgNext" title="Next page" aria-label="Next page">${ICON.down}</button>
    </div>
    <div class="spacer"></div>
    <div class="grp" role="toolbar" aria-label="Tools" id="tools">
      ${tool('select', 'Select', 'V')}${tool('text', 'Text', 'T')}${tool('stamp', 'Stamp', 'M')}${tool('check', 'Check', 'K')}${tool('sign', 'Sign', 'S')}${tool('highlight', 'Highlight', 'H')}${tool('whiteout', 'White-out', 'W')}${tool('redact', 'Redact', 'R')}
    </div>
    <div class="grp">
      <button class="tb" id="undoBtn" title="Undo (Ctrl+Z)" disabled>${ICON.undo}<span class="t">Undo</span></button>
      <button class="tb" id="orgBtn" aria-pressed="false" disabled title="Organize pages: reorder, insert, rotate, delete">${ICON.org}<span class="t">Organize</span></button>
      <button class="tb" id="batesBtn" disabled title="Bates numbering">${ICON.bates}<span class="t">Bates</span></button>
    </div>
    <div class="grp">
      <button class="tb" id="printBtn" disabled title="Print (Ctrl+P)">${ICON.print}<span class="t">Print</span></button>
      <button class="tb" id="sendBtn" disabled title="Send this PDF for signature">${ICON.send}<span class="t">Send</span></button>
      <button class="tb" id="envBtn" title="Envelopes you have sent">${ICON.link}<span class="t">Envelopes</span></button>
    </div>
    <label class="chk" title="Bakes form entries into the page so they can no longer be edited"><input type="checkbox" id="flatten" disabled><span>Flatten</span></label>
    <button class="btn primary" id="saveBtn" type="button" disabled>${ICON.save}Save<span class="dot" id="dirtyDot" hidden></span></button>
  </header>
  <div class="ctx" id="ctx"></div>
  <div class="body">
    <aside id="side" hidden>
      <div class="side-tabs"><button class="tb" id="tabPages" aria-pressed="true">Pages</button><button class="tb" id="tabOutline" aria-pressed="false">Bookmarks</button></div>
      <div id="thumbs"></div><div id="outline" hidden></div>
    </aside>
    <main id="scroller"><div id="pages"></div>
      <div id="findbar" hidden><input id="findIn" type="search" placeholder="Find in document" autocomplete="off" spellcheck="false"><span id="findCount"></span><button class="ib" id="findPrev" title="Previous match (Shift+Enter)">${ICON.up}</button><button class="ib" id="findNext" title="Next match (Enter)">${ICON.down}</button><button class="ib" id="findClose" title="Close (Esc)">${ICON.close}</button></div>
    </main>
    <main id="org" hidden><p class="org-hint">Drag pages to change their order. Click to select a page; Ctrl-click or Shift-click to select several. Double-click a page to open it.</p><div id="orgGrid" role="listbox" aria-label="Pages" aria-multiselectable="true"></div></main>
    <section id="panel" class="panel" hidden></section>
  </div>
</div>
<div class="drop-hint" id="dropHint" hidden>Drop the PDF to open it</div>
<div class="toast" id="toast" hidden></div>

<div class="mback" id="sigModal" hidden><div class="modal" role="dialog" aria-modal="true" aria-labelledby="sigTitle">
  <h3 id="sigTitle">Create your signature</h3>
  <div class="tabs"><button class="tb" data-sigtab="draw" aria-pressed="true">Draw</button><button class="tb" data-sigtab="type" aria-pressed="false">Type</button></div>
  <div id="sigDraw"><div class="pad"><div class="base"></div><div class="x">×</div><canvas id="sigCanvas"></canvas></div></div>
  <div id="sigType" class="typed" hidden><input id="sigName" type="text" placeholder="Type your full name" autocomplete="name"><div class="prev" id="sigPrev">&nbsp;</div></div>
  <div class="mfoot"><button class="mini left" id="sigClear" type="button">Clear</button><button class="btn" id="sigCancel" type="button">Cancel</button><button class="btn primary" id="sigUse" type="button">Use signature</button></div>
</div></div>

<div class="mback" id="redModal" hidden><div class="modal" role="dialog" aria-modal="true" aria-labelledby="redTitle">
  <h3 id="redTitle">Apply redactions and save?</h3><p class="lead" id="redLead"></p>
  <ul class="red-list">
    <li><b>Removed for good:</b> text, images, form fields and comments under the black boxes, including any hidden text layer on those pages.</li>
    <li><b>Redacted pages become images:</b> their text can no longer be selected or searched, and anything you added to those pages becomes permanent. Other pages are unchanged.</li>
    <li><b>Hidden data stripped:</b> document properties, attachments, scripts and accessibility tags are removed from the saved copy.</li>
    <li><b>Your original file is not changed.</b> The redacted copy cannot be un-redacted, so keep the original somewhere safe.</li>
  </ul>
  <div class="mfoot"><button class="btn" id="redCancel" type="button">Cancel</button><button class="btn danger" id="redGo" type="button">Apply redactions and save</button></div>
</div></div>

<div class="mback" id="insModal" hidden><div class="modal wide" role="dialog" aria-modal="true" aria-labelledby="insTitle">
  <div class="frow"><h3 id="insTitle" style="margin:0">Insert pages</h3><span class="muted" id="insName"></span></div>
  <div class="ins-bar"><label for="insRange">Pages</label><input id="insRange" type="text" placeholder="e.g. 1-3, 5" autocomplete="off" spellcheck="false"><button class="mini" id="insAll" type="button">All</button><button class="mini" id="insNone" type="button">None</button><span class="muted" id="insCount"></span></div>
  <div class="ins-grid" id="insGrid"></div>
  <div class="frow"><label for="insPos">Insert</label><select id="insPos"></select></div>
  <div class="mfoot"><button class="btn" id="insCancel" type="button">Cancel</button><button class="btn primary" id="insGo" type="button">Insert pages</button></div>
</div></div>

<div class="mback" id="batesModal" hidden><div class="modal" role="dialog" aria-modal="true" aria-labelledby="batesTitle">
  <h3 id="batesTitle">Bates numbering</h3>
  <p class="lead">A number is stamped on every page of the saved copy, in page order. The stamp previews on the pages until you save.</p>
  <div class="frow"><label for="batesPrefix">Prefix</label><input id="batesPrefix" type="text" placeholder="e.g. SMITH-" autocomplete="off"></div>
  <div class="frow"><label for="batesStart">Start number</label><input id="batesStart" type="number" min="0" value="1"></div>
  <div class="frow"><label for="batesPad">Digits</label><input id="batesPad" type="number" min="1" max="10" value="6"></div>
  <div class="frow"><label for="batesCorner">Position</label><select id="batesCorner"><option value="br">Bottom right</option><option value="bl">Bottom left</option><option value="bc">Bottom center</option><option value="tr">Top right</option><option value="tl">Top left</option></select></div>
  <div class="frow"><label for="batesSize">Size</label><select id="batesSize"><option>8</option><option>9</option><option selected>10</option><option>11</option><option>12</option></select></div>
  <div class="frow"><label></label><span class="muted" id="batesPreview"></span></div>
  <div class="mfoot"><button class="mini left" id="batesRemove" type="button">Remove numbering</button><button class="btn" id="batesCancel" type="button">Cancel</button><button class="btn primary" id="batesApply" type="button">Apply</button></div>
</div></div>
`;
export const REST = `<div class="rest"><div class="rest-card">
  ${ICON.open.replace('<svg', '<svg width="44" height="44"')}
  <h2>Open a PDF to get started</h2>
  <p>Read, search and print. Fill forms, add text, check marks and signatures, highlight, white-out or redact, organize pages, add Bates numbers, then save a new copy. Files stay on this computer unless you send them for signature.</p>
  <button class="btn primary" id="restOpen" type="button">Open PDF</button>
  <p class="small">or drag a PDF anywhere onto this window</p>
  <button class="linkbtn" id="restSample" type="button">Try it on a sample form</button>
</div></div>`;
