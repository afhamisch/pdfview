# Benchmarks for pdf-desk.html

Scripts used to measure the viewer on large files. They need Node, Playwright
(`npm i playwright` and a Chromium build) and Python with reportlab, Pillow and numpy.

```
python3 gen.py text500.pdf text 500     # 500 text pages, ~1 MB
python3 gen.py scan150.pdf scan 150     # 150 scanned-style JPEG pages, ~150 MB

node bench.js ../pdf-desk.html text500.pdf label   # open, scroll through, zoom; prints timing + memory
node smoke.js ../pdf-desk.html text500.pdf         # functional pass: sample form, text, save, go-to, zoom, organize
node probe.js ../pdf-desk.html scan150.pdf         # how quickly pages paint after jumping around
```

`bench.js` reports whether pdf.js fell back to its main-thread "fake worker",
total main-thread long-task time during a scroll through the whole file,
how many page canvases are alive afterwards and their backing-store size.
