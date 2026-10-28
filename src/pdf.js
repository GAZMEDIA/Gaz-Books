// Print-ready paperback PDF for Amazon KDP: trim size, mirrored margins with
// the right gutter for the page count, chapters on right-hand pages, drop caps,
// running heads, page numbers, no widows or orphans, embedded fonts.
const path = require('path');
const PDFDocument = require('pdfkit');
const { layoutSettings, gutterFor } = require('./kdp');
const { plain } = require('./read');

const FONT_DIR = path.join(__dirname, '..', 'fonts');
const FAMILIES = {
  crimson: { R: 'CrimsonText-Regular.ttf', I: 'CrimsonText-Italic.ttf', B: 'CrimsonText-Bold.ttf', BI: 'CrimsonText-BoldItalic.ttf' },
  noto: { R: 'NotoSerif-Regular.ttf', I: 'NotoSerif-Italic.ttf', B: 'NotoSerif-Bold.ttf', BI: 'NotoSerif-BoldItalic.ttf' },
};
const SHY = '­';
const DROP_LINES = 3;

function styleKey(r) { return r.b ? (r.i ? 'BI' : 'B') : (r.i ? 'I' : 'R'); }

function newDoc(s, family) {
  const doc = new PDFDocument({ size: [s.pageW, s.pageH], margin: 0, autoFirstPage: false, pdfVersion: '1.4' });
  for (const [k, f] of Object.entries(FAMILIES[family])) doc.registerFont(k, path.join(FONT_DIR, f));
  return doc;
}

async function makePdf(book, opts = {}) {
  const family = FAMILIES[opts.font] ? opts.font : 'crimson';
  let hyph = null;
  if (opts.hyphenate !== false && (!opts.lang || opts.lang.startsWith('en'))) hyph = require('hyphen/en').hyphenateSync;

  // Lay out once, then again if the page count lands in a different gutter band.
  let pages = 200;
  let result;
  for (let pass = 0; pass < 3; pass++) {
    const s = layoutSettings(opts, pages);
    result = layoutBook(book, opts, s, family, hyph);
    const count = result.pages.length;
    if (gutterFor(count) === gutterFor(pages)) break;
    pages = count;
  }
  const buf = await render(result, family, book, opts);
  return { buffer: buf, pageCount: result.pages.length, settings: result.s };
}

// ---------------------------------------------------------------- layout

function layoutBook(book, opts, s, family, hyph) {
  const doc = newDoc(s, family);
  const measure = (text, style, size) => doc.font(style).fontSize(size).widthOfString(text);
  const capRatio = (style) => { doc.font(style); const f = doc._font.font; return f.capHeight / f.unitsPerEm; };
  const colW = s.pageW - s.inside - s.outside;
  const areaH = s.pageH - s.top - s.bottom;
  const perPage = Math.floor((areaH - s.size) / s.leading) + 1;
  const indent = s.size * 1.4;
  const spaceW = measure(' ', 'R', s.size);

  const ctx = { measure, s, colW, spaceW, hyph };

  // ---- body pages
  const body = [];
  let page = null;
  let line = 0;
  const newPage = (opening) => { page = { kind: 'body', opening: !!opening, items: [] }; body.push(page); line = 0; };
  const toc = [];

  book.chapters.forEach((ch, ci) => {
    // Chapters open on a right-hand page. Body page 1 is a right-hand page.
    if (ci === 0 || opts.rectoChapters !== false) {
      if (body.length % 2 === 1) body.push({ kind: 'blank', items: [] });
    }
    newPage(true);
    toc.push({ title: ch.title, page: body.length });

    // Chapter title block: drop about a quarter of the page.
    line = Math.round(perPage * 0.22);
    const t = splitChapterTitle(ch.title || '');
    if (t.label) {
      page.items.push({ type: 'center', line, text: t.label.toUpperCase(), style: 'R', size: s.size * 0.9, spacing: 2 });
      line += 2;
    }
    if (t.name) {
      const nameSize = Math.min(s.size * 1.9, 24);
      for (const ln of wrapPlain(t.name, 'R', nameSize, colW * 0.85, measure)) {
        page.items.push({ type: 'center', line, text: ln, style: 'R', size: nameSize });
        line += 2;
      }
    }
    line += t.label || t.name ? 1 : 0;

    let afterBreak = true;
    let dropDone = opts.dropCaps === false;
    let dropRemaining = 0;
    let dropWidth = 0;

    for (const blk of ch.blocks) {
      if (blk.type === 'break') {
        // Never let a scene break sit at the top or bottom of a page.
        if (line + 3 > perPage) { newPage(); }
        else if (line > 0) line += 1;
        page.items.push({ type: 'center', line, text: '* * *', style: 'R', size: s.size });
        line += 2;
        afterBreak = true;
        continue;
      }
      if (blk.type === 'h2') {
        const ls = wrapPlain(plain(blk.runs), 'B', s.size, colW, measure);
        if (line + ls.length + 3 > perPage) newPage(); else if (line > 0) line += 1;
        for (const l of ls) { page.items.push({ type: 'center', line, text: l, style: 'B', size: s.size }); line += 1; }
        line += 1;
        afterBreak = true;
        continue;
      }
      if (blk.type === 'img') {
        const img = imageBuffer(blk.src);
        if (!img) continue;
        let iw; let ih;
        try { const o = doc.openImage(img); iw = o.width; ih = o.height; } catch { continue; }
        const maxH = (perPage - 2) * s.leading;
        let w = Math.min(colW, iw * 0.75);
        let h = (ih / iw) * w;
        if (h > maxH) { h = maxH; w = (iw / ih) * h; }
        const rows = Math.ceil(h / s.leading) + 1;
        if (line + rows > perPage) newPage();
        page.items.push({ type: 'img', line, img, w, h });
        line += rows;
        afterBreak = true;
        continue;
      }

      // Paragraphs
      const isQuote = blk.type === 'quote';
      const firstIndent = afterBreak || isQuote || blk.list ? 0 : indent;
      const sideIndent = isQuote ? indent * 1.5 : 0;
      let runs = blk.runs;
      let drop = null;
      if (!dropDone) {
        dropDone = true;
        drop = makeDrop(runs, s, measure, capRatio);
        if (drop) { runs = drop.rest; dropRemaining = DROP_LINES; dropWidth = drop.width; }
      }
      const words = toWords(runs, hyph);
      const widthFor = (i) => {
        const inDrop = i < dropRemaining;
        return colW - sideIndent * 2 - (inDrop ? dropWidth : 0) - (i === 0 && !inDrop ? firstIndent : 0);
      };
      const offsetFor = (i) => sideIndent + (i < dropRemaining ? dropWidth : (i === 0 ? firstIndent : 0));
      const lines = breakLines(words, widthFor, ctx);
      const used = Math.min(lines.length, dropRemaining);
      const placed = lines.map((ln, i) => ({ ...ln, x: offsetFor(i), width: widthFor(i), last: i === lines.length - 1, align: blk.list ? 'left' : 'justify' }));
      dropRemaining -= used;

      // Widow / orphan control: keep at least two lines together at each end.
      let idx = 0;
      if (drop && line + DROP_LINES > perPage) newPage();
      if (drop) page.items.push({ type: 'drop', line: line + DROP_LINES - 1, text: drop.text, size: drop.size, style: drop.style });
      while (idx < placed.length) {
        const room = perPage - line;
        const left = placed.length - idx;
        let take = Math.min(room, left);
        if (take < left) {
          if (left - take < 2) take = left - 2;
          if (take < 2 && !(drop && idx === 0)) take = 0;
        }
        if (take <= 0) { newPage(); continue; }
        for (let k = 0; k < take; k++) page.items.push({ type: 'line', line: line + k, ...placed[idx + k] });
        idx += take;
        line += take;
        if (idx < placed.length) newPage();
      }
      if (isQuote) line = Math.min(line, perPage);
      afterBreak = false;
    }
  });

  // ---- front matter
  const front = [];
  const titlePage = { kind: 'front', items: [] };
  const title = book.title || 'Untitled';
  let tl = Math.round(perPage * 0.25);
  const titleSize = Math.min(s.size * 2.6, 30);
  for (const l of wrapPlain(title, 'R', titleSize, colW, measure)) { titlePage.items.push({ type: 'center', line: tl, text: l, style: 'R', size: titleSize }); tl += 3; }
  if (book.subtitle) for (const l of wrapPlain(book.subtitle, 'I', s.size * 1.3, colW, measure)) { titlePage.items.push({ type: 'center', line: tl, text: l, style: 'I', size: s.size * 1.3 }); tl += 2; }
  if (book.author) titlePage.items.push({ type: 'center', line: Math.max(tl + 4, Math.round(perPage * 0.6)), text: book.author.toUpperCase(), style: 'R', size: s.size * 1.1, spacing: 2 });
  front.push(titlePage);

  const copy = { kind: 'front', items: [] };
  const year = opts.year || new Date().getFullYear();
  const copyLines = [
    `Copyright © ${year} ${book.author || ''}`.trim(),
    'All rights reserved.',
    '',
    'No part of this book may be reproduced in any form without written permission from the author, except for brief quotations in reviews.',
  ];
  if (opts.isbn) copyLines.push('', `ISBN: ${opts.isbn}`);
  if (opts.copyrightExtra) copyLines.push('', ...String(opts.copyrightExtra).split('\n'));
  const small = s.size * 0.85;
  const wrapped = copyLines.flatMap((t) => (t ? wrapPlain(t, 'R', small, colW, measure) : ['']));
  let cl = perPage - wrapped.length;
  for (const t of wrapped) { if (t) copy.items.push({ type: 'left', line: cl, text: t, style: 'R', size: small }); cl += 1; }
  front.push(copy);

  if (opts.dedication) {
    front.push({ kind: 'front', items: [] }); // keep dedication on a right-hand page
    front.pop();
    const ded = { kind: 'front', items: [] };
    let dl = Math.round(perPage * 0.3);
    for (const t of wrapPlain(opts.dedication, 'I', s.size, colW * 0.75, measure)) { ded.items.push({ type: 'center', line: dl, text: t, style: 'I', size: s.size }); dl += 1; }
    front.push(ded);
    front.push({ kind: 'blank', items: [] });
  }

  if (opts.toc !== false && toc.filter((t) => t.title).length > 1) {
    let tp = { kind: 'front', items: [] };
    front.push(tp);
    let l = Math.round(perPage * 0.12);
    tp.items.push({ type: 'center', line: l, text: (opts.labels?.contents || 'Contents').toUpperCase(), style: 'R', size: s.size, spacing: 2 });
    l += 3;
    for (const e of toc.filter((t) => t.title)) {
      const num = String(e.page);
      const ls = wrapPlain(e.title, 'R', s.size, colW - 40, measure);
      if (l + ls.length > perPage) { tp = { kind: 'front', items: [] }; front.push(tp); l = 2; }
      ls.forEach((t, i) => {
        tp.items.push({ type: 'left', line: l, text: t, style: 'R', size: s.size });
        if (i === ls.length - 1) tp.items.push({ type: 'right', line: l, text: num, style: 'R', size: s.size });
        l += 1;
      });
    }
  }
  if (front.length % 2 === 1) front.push({ kind: 'blank', items: [] });

  // Last page of the book: KDP wants an even page count is not required, but
  // a trailing blank after an odd-numbered last page keeps the back cover clean.
  if (body.length % 2 === 1) body.push({ kind: 'blank', items: [] });

  body.forEach((p, i) => { p.number = i + 1; });
  const all = front.concat(body);
  return { pages: all, s, perPage, toc };
}

function splitChapterTitle(title) {
  const m = title.match(/^((?:chapter|part|book)\s+[\wÀ-ɏ-]+)\s*[:.\-–—]?\s*(.*)$/i);
  if (m && m[2]) return { label: m[1], name: m[2] };
  if (m) return { label: '', name: m[1] };
  return { label: '', name: title };
}

function makeDrop(runs, s, measure, capRatio) {
  const text = runs.map((r) => r.text).join('');
  const m = text.match(/^([“‘"'(«]?)(\p{L}|\p{N})/u);
  if (!m || !/\p{L}/u.test(m[2])) return null;
  const take = m[0].length;
  const style = 'R';
  const ratio = capRatio(style);
  const height = (DROP_LINES - 1) * s.leading + s.size * ratio;
  const size = height / ratio;
  const dropText = m[0].replace(/"/, '“').replace(/'/, '‘');
  const width = measure(dropText, style, size) + s.size * 0.35;
  // Remove the dropped letters from the start of the runs.
  const rest = [];
  let skip = take;
  for (const r of runs) {
    if (skip >= r.text.length) { skip -= r.text.length; continue; }
    rest.push({ ...r, text: r.text.slice(skip) });
    skip = 0;
  }
  return { text: dropText, size, width, style, rest };
}

function toWords(runs, hyph) {
  const words = [];
  let cur = [];
  for (const r of runs) {
    const st = styleKey(r);
    const parts = r.text.split(/( )/);
    for (const p of parts) {
      if (p === ' ') { if (cur.length) words.push(cur); cur = []; continue; }
      if (!p) continue;
      const t = hyph && p.length > 5 && /^\p{L}/u.test(p) ? hyph(p) : p;
      cur.push({ t, st });
    }
  }
  if (cur.length) words.push(cur);
  return words;
}

const strip = (t) => t.split(SHY).join('');
function wordWidth(w, ctx) { return w.reduce((a, p) => a + ctx.measure(strip(p.t), p.st, ctx.s.size), 0); }
function shyCount(w) { return w.reduce((a, p) => a + (p.t.split(SHY).length - 1), 0); }
function splitWord(w, k) {
  const left = []; const right = [];
  let n = 0; let done = false;
  for (const p of w) {
    if (done) { right.push(p); continue; }
    const bits = p.t.split(SHY);
    if (n + bits.length - 1 <= k) { left.push(p); n += bits.length - 1; continue; }
    const cut = k - n + 1;
    left.push({ t: bits.slice(0, cut).join(SHY) + '-', st: p.st });
    right.push({ t: bits.slice(cut).join(SHY), st: p.st });
    done = true;
  }
  return [left, right];
}

function breakLines(words, widthFor, ctx) {
  const lines = [];
  let cur = []; let curW = 0;
  const push = () => { lines.push({ words: cur }); cur = []; curW = 0; };
  let i = 0;
  let pending = null;
  while (i < words.length || pending) {
    const w = pending || words[i];
    pending = null;
    const avail = widthFor(lines.length);
    const ww = wordWidth(w, ctx);
    const sp = cur.length ? ctx.spaceW : 0;
    if (curW + sp + ww <= avail + 0.5 || !cur.length && ww > avail) {
      cur.push(w); curW += sp + ww; i++;
      continue;
    }
    // Try to hyphenate the word so the line is not too loose.
    let placed = false;
    for (let k = shyCount(w) - 1; k >= 0; k--) {
      const [l, r] = splitWord(w, k);
      const lw = wordWidth(l, ctx);
      if (curW + sp + lw <= avail + 0.5) { cur.push(l); push(); pending = r; i++; placed = true; break; }
    }
    if (placed) { i--; continue; }
    push();
  }
  if (cur.length) push();
  // Turn words into drawable segments (same font = one segment).
  return lines.map(({ words: ws }) => {
    const segs = [];
    ws.forEach((w, wi) => {
      w.forEach((p, pi) => {
        let t = strip(p.t);
        if (pi === w.length - 1 && wi < ws.length - 1) t += ' ';
        const last = segs[segs.length - 1];
        if (last && last.st === p.st) last.t += t; else segs.push({ t, st: p.st });
      });
    });
    return { segs, spaces: Math.max(0, ws.length - 1) };
  });
}

function wrapPlain(text, style, size, width, measure) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = []; let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (measure(t, style, size) > width && cur) { out.push(cur); cur = w; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

function imageBuffer(src) {
  const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(src || '');
  return m ? Buffer.from(m[2], 'base64') : null;
}

// ---------------------------------------------------------------- render

function render({ pages, s }, family, book, opts) {
  const doc = newDoc(s, family);
  doc.info.Title = book.title || 'Untitled';
  if (book.author) doc.info.Author = book.author;
  doc.info.Creator = 'GazBook';
  const colW = s.pageW - s.inside - s.outside;
  const baseY = (line) => s.top + s.size + line * s.leading;
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  pages.forEach((p, i) => {
    doc.addPage({ size: [s.pageW, s.pageH], margin: 0 });
    const recto = i % 2 === 0; // physical page 1 is a right-hand page
    const x0 = recto ? s.inside : s.outside;
    const text = (t, x, y, style, size, o = {}) => doc.font(style).fontSize(size).text(t, x, y, { lineBreak: false, baseline: 'alphabetic', ...o });

    for (const it of p.items) {
      const y = baseY(it.line);
      if (it.type === 'line') {
        let natural = 0;
        for (const sg of it.segs) natural += doc.font(sg.st).fontSize(s.size).widthOfString(sg.t);
        const justify = it.align === 'justify' && !it.last && it.spaces > 0;
        let extra = justify ? (it.width - natural) / it.spaces : 0;
        if (extra > s.size * 0.9) extra = s.size * 0.9; // a very loose line looks worse than a ragged one
        let x = x0 + it.x;
        for (const sg of it.segs) {
          text(sg.t, x, y, sg.st, s.size, { wordSpacing: extra });
          const sp = (sg.t.match(/ /g) || []).length;
          x += doc.widthOfString(sg.t) + sp * extra;
        }
      } else if (it.type === 'drop') {
        text(it.text, x0, y, it.style, it.size);
      } else if (it.type === 'center' || it.type === 'left' || it.type === 'right') {
        const o = it.spacing ? { characterSpacing: it.spacing } : {};
        const w = doc.font(it.style).fontSize(it.size).widthOfString(it.text, o);
        const x = it.type === 'center' ? x0 + (colW - w) / 2 : it.type === 'right' ? x0 + colW - w : x0;
        text(it.text, x, y, it.style, it.size, o);
      } else if (it.type === 'img') {
        doc.image(it.img, x0 + (colW - it.w) / 2, baseY(it.line) - s.size, { width: it.w, height: it.h });
      }
    }

    if (p.kind === 'body') {
      const small = s.size * 0.8;
      if (!p.opening) {
        const head = (recto ? (book.title || '') : (book.author || book.title || '')).toUpperCase();
        if (head) {
          const w = doc.font('R').fontSize(small).widthOfString(head, { characterSpacing: 1.2 });
          text(head, x0 + (colW - w) / 2, s.top - s.size * 1.6, 'R', small, { characterSpacing: 1.2 });
        }
      }
      const num = String(p.number);
      const w = doc.font('R').fontSize(small * 1.1).widthOfString(num);
      text(num, x0 + (colW - w) / 2, s.pageH - s.bottom + s.size * 2, 'R', small * 1.1);
    }
  });
  doc.end();
  return done;
}

module.exports = { makePdf, splitChapterTitle };
