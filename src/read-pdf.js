// Reads the text of a PDF book back into simple HTML (headings, paragraphs,
// italic and bold), dropping page numbers and running heads on the way.
// Scanned PDFs (pictures of pages) have no text and cannot be read.
async function pdfToHtml(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;

  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const view = page.getViewport({ scale: 1 });
    await page.getOperatorList(); // loads fonts so we can see their real names
    const tc = await page.getTextContent();
    const fontName = (id) => { try { return page.commonObjs.get(id)?.name || ''; } catch { return ''; } };
    const lines = [];
    const drops = [];
    for (const it of tc.items) {
      if (!('str' in it)) continue;
      const x = it.transform[4]; const y = it.transform[5];
      const size = Math.hypot(it.transform[2], it.transform[3]) || it.height;
      const fname = fontName(it.fontName);
      const run = { text: it.str, i: /italic|oblique/i.test(fname), b: /bold|black|heavy|semibold/i.test(fname) };
      // A drop cap: one or two huge letters at the start of a chapter.
      if (it.str.trim().length && it.str.trim().length <= 2 && size > 24) { drops.push({ text: it.str.trim(), x, y, size }); continue; }
      if (!it.str.trim()) {
        const near = lines.find((l) => Math.abs(l.y - y) < l.size * 0.4);
        if (near && it.str) near.runs.push({ ...run, text: ' ', x });
        continue;
      }
      let line = lines.find((l) => Math.abs(l.y - y) < size * 0.4);
      if (!line) { line = { y, x, xEnd: x, size, runs: [] }; lines.push(line); }
      if (!it.str) continue;
      line.runs.push({ ...run, x });
      line.x = Math.min(line.x, x);
      line.xEnd = Math.max(line.xEnd, x + it.width);
      line.size = Math.max(line.size, size);
    }
    for (const d of drops) {
      const first = lines.filter((l) => l.y > d.y - 2 && l.y < d.y + d.size && l.x > d.x).sort((a, b) => b.y - a.y)[0];
      if (first) {
        first.runs.push({ text: d.text, i: false, b: false, x: -1 });
        first.x = d.x;
        for (const l of lines) if (l !== first && l.y < first.y && l.y > d.y - d.size * 0.6) l.inDrop = true;
      }
    }
    for (const l of lines) {
      l.runs.sort((a, b) => a.x - b.x);
      const raw = l.runs.map((r) => r.text).join('').trim();
      l.text = raw.replace(/\s+/g, ' ');
      // Letter-spaced titles come out as "C H A P T E R  1".
      if (/^(?:\S ){3,}\S$/.test(l.text)) {
        l.text = raw.split(/\s{2,}/).map((w) => w.replace(/ /g, '')).join(' ').replace(/(\p{L})(\d)/gu, '$1 $2');
        l.runs = [{ text: l.text, i: l.runs[0].i, b: l.runs[0].b, x: l.x }];
      }
    }
    pages.push({ h: view.height, lines: lines.filter((l) => l.text).sort((a, b) => b.y - a.y) });
  }
  if (!pages.some((p) => p.lines.length)) {
    throw new Error('This PDF has no text in it (it looks like scanned pictures). Please upload the Word or Google Docs version instead.');
  }

  // Running heads and footers repeat on many pages; page numbers are just digits.
  const edgeCount = new Map();
  for (const p of pages) {
    for (const l of [p.lines[0], p.lines[p.lines.length - 1]].filter(Boolean)) {
      const key = l.text.replace(/\d+/g, '#').toLowerCase();
      edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    }
  }
  const isFurniture = (l, p) => {
    if (pages.indexOf(p) < 2 && !/^\d+$/.test(l.text)) return false; // title and copyright pages
    const atEdge = l === p.lines[0] || l === p.lines[p.lines.length - 1];
    if (!atEdge) return false;
    if (/^[\divxlc]+$/i.test(l.text) && l.text.length < 6) return true;
    return pages.length > 4 && (edgeCount.get(l.text.replace(/\d+/g, '#').toLowerCase()) || 0) > pages.length * 0.25;
  };

  // Body text size is the most common size.
  const sizes = new Map();
  for (const p of pages) for (const l of p.lines) { const k = Math.round(l.size * 2) / 2; sizes.set(k, (sizes.get(k) || 0) + l.text.length); }
  const bodySize = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0][0];

  // Usual left edge and line width, so we can spot indents and short last lines.
  const lefts = []; const rights = [];
  for (const p of pages) for (const l of p.lines) if (Math.abs(l.size - bodySize) < 1) { lefts.push(Math.round(l.x)); rights.push(Math.round(l.xEnd)); }
  const mode = (arr) => { const m = new Map(); let best = arr[0]; for (const v of arr) { m.set(v, (m.get(v) || 0) + 1); if (m.get(v) > m.get(best)) best = v; } return best; };

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const runsHtml = (runs) => runs.map((r) => { let t = esc(r.text); if (r.i) t = `<em>${t}</em>`; if (r.b) t = `<strong>${t}</strong>`; return t; }).join('');

  const out = [];
  let para = null;
  let heading = null;
  let prev = null;
  const flushPara = () => { if (para) out.push(`<p>${runsHtml(para)}</p>`); para = null; };
  const flushHeading = () => {
    if (!heading) return;
    // A small "CHAPTER 1" line just above a big title belongs to that title.
    const m = /^<p>((?:chapter|part|book)\s+[\w-]+)<\/p>$/i.exec(out[out.length - 1] || '');
    if (m) { out.pop(); heading = `${m[1].replace(/^(\w)(\w*)/, (_, a, b) => a + b.toLowerCase())}: ${heading}`; }
    out.push(`<h1>${esc(heading.trim())}</h1>`);
    heading = null;
  };

  for (const p of pages) {
    // Mirrored margins: odd and even pages can have different left edges.
    const body = p.lines.filter((l) => Math.abs(l.size - bodySize) < 1);
    const left = body.length ? mode(body.map((l) => Math.round(l.x))) : mode(lefts);
    const right = body.length ? Math.max(...body.map((l) => l.xEnd)) : mode(rights);
    let samePage = false;
    for (const l of p.lines) {
      if (isFurniture(l, p)) continue;
      if (l.size > bodySize * 1.25 && l.text.length < 80) {
        flushPara();
        heading = heading ? `${heading} ${l.text}` : l.text;
        prev = null;
        continue;
      }
      flushHeading();
      const lineGap = prev && samePage ? prev.y - l.y : 0;
      const indented = !l.inDrop && l.x - left > bodySize * 0.8;
      const centred = Math.abs((l.x - left) - (right - l.xEnd)) < bodySize && l.x - left > bodySize * 3;
      const bigGap = prev && lineGap > l.size * 1.9;
      const prevShort = prev && prev.xEnd < right - bodySize * 3 && /[.!?:"'”’)]$/.test(prev.text);
      if (!para || indented || bigGap || prevShort || centred || (prev && prev.centred)) {
        flushPara();
        para = [];
      } else if (para.length) {
        // Join to the previous line, mending words broken with a hyphen.
        const last = para[para.length - 1];
        if (/[a-z]-$/.test(last.text) && /^[a-z]/.test(l.runs[0]?.text.trim() || '')) last.text = last.text.slice(0, -1);
        else last.text += ' ';
      }
      for (const r of l.runs) para.push({ text: r.text, i: r.i, b: r.b });
      prev = { ...l, centred };
      samePage = true;
    }
    flushHeading();
  }
  flushPara();
  return out.join('\n');
}

module.exports = { pdfToHtml };
