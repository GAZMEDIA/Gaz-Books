// Turns a manuscript (.docx, .txt or .md) into a simple book model:
// { title, subtitle, author, chapters: [{ title, blocks }] }
// A block is { type: 'p' | 'h2' | 'break' | 'quote' | 'img', runs?, src? }
// and a run is { text, i, b }.
const path = require('path');
const mammoth = require('mammoth');
const { parseDocument } = require('htmlparser2');

const CHAPTER_RE = /^(chapter|part|book|prologue|epilogue|introduction|preface|foreword|afterword|acknowledg(e)?ments|about the author|interlude)\b/i;
const SCENE_RE = /^\s*([*#~•·\-–—=_+o0]\s*){1,5}\s*$/;

async function readManuscript(buffer, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  let html;
  if (ext === '.pdf') {
    html = await require('./read-pdf').pdfToHtml(buffer);
  } else if (ext === '.docx') {
    const res = await mammoth.convertToHtml({ buffer }, {
      styleMap: ['p[style-name=\'Title\'] => h1.title:fresh', 'p[style-name=\'Subtitle\'] => p.subtitle:fresh'],
    });
    html = res.value;
  } else if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
    html = textToHtml(buffer.toString('utf8'), ext !== '.txt');
  } else if (ext === '.doc') {
    throw new Error('Old .doc files cannot be read. Open the file in Word or Google Docs and save it as .docx first.');
  } else {
    throw new Error('Please upload a .docx, .pdf, .txt or .md file. In Google Docs use File > Download > Microsoft Word (.docx).');
  }
  return htmlToBook(html);
}

// Plain text: blank line = new paragraph. Markdown: # headings, *italic*, **bold**.
function textToHtml(text, markdown) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => {
    s = esc(s);
    if (!markdown) return s;
    return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>').replace(/(^|\W)_(?!\s)(.+?)_(?=\W|$)/g, '$1<em>$2</em>');
  };
  const paras = text.replace(/\r\n?/g, '\n').split(/\n\s*\n/);
  // Text files sometimes have one paragraph per line with no blank lines.
  const lines = paras.length < 3 ? text.replace(/\r\n?/g, '\n').split('\n') : paras;
  return lines.map((p) => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).map((p) => {
    const m = markdown && p.match(/^(#{1,3})\s+(.*)$/);
    if (m) return `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`;
    return `<p>${inline(p)}</p>`;
  }).join('\n');
}

function runsOf(node, style = { i: false, b: false }, out = []) {
  for (const c of node.children || []) {
    if (c.type === 'text') {
      out.push({ text: decode(c.data), i: style.i, b: style.b });
    } else if (c.type === 'tag') {
      if (c.name === 'br') { out.push({ text: ' ', i: style.i, b: style.b }); continue; }
      const s = { ...style };
      if (c.name === 'em' || c.name === 'i') s.i = true;
      if (c.name === 'strong' || c.name === 'b') s.b = true;
      runsOf(c, s, out);
    }
  }
  return out;
}

function decode(s) {
  return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, '\'').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&');
}

function plain(runs) { return runs.map((r) => r.text).join(''); }

// The "fixes": tidy spacing and punctuation the way print books expect.
function tidyRuns(runs) {
  const merged = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = merged[merged.length - 1];
    if (last && last.i === r.i && last.b === r.b) last.text += r.text;
    else merged.push({ ...r });
  }
  let prevChar = ' ';
  for (const r of merged) {
    let t = r.text
      .replace(/[\t  ]+/g, ' ')
      .replace(/\.\s?\.\s?\./g, '…')
      .replace(/\s*---?\s*/g, '—')
      .replace(/ {2,}/g, ' ');
    // Straight quotes to curly quotes.
    let out = '';
    for (const ch of t) {
      const before = out ? out[out.length - 1] : prevChar;
      const opening = /[\s(\[{—–-]/.test(before) || before === '“' || before === '‘';
      if (ch === '"') out += opening ? '“' : '”';
      else if (ch === '\'') out += opening ? '‘' : '’';
      else out += ch;
    }
    if (out) prevChar = out[out.length - 1];
    r.text = out;
  }
  // Trim the paragraph ends.
  if (merged.length) {
    merged[0].text = merged[0].text.replace(/^\s+/, '');
    merged[merged.length - 1].text = merged[merged.length - 1].text.replace(/\s+$/, '');
  }
  return merged.filter((r) => r.text);
}

function htmlToBook(html) {
  const dom = parseDocument(html);
  const flat = [];
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.type !== 'tag') continue;
      if (/^h[1-6]$/.test(n.name)) {
        const lvl = +n.name[1];
        flat.push({ kind: n.attribs.class === 'title' ? 'title' : (lvl === 1 ? 'h1' : 'h2'), runs: tidyRuns(runsOf(n)) });
      } else if (n.name === 'p') {
        const img = findImg(n);
        if (img) flat.push({ kind: 'img', src: img });
        const runs = tidyRuns(runsOf(n));
        if (plain(runs).trim()) flat.push({ kind: n.attribs.class === 'subtitle' ? 'subtitle' : 'p', runs });
      } else if (n.name === 'ul' || n.name === 'ol') {
        let k = 1;
        for (const li of n.children.filter((c) => c.name === 'li')) {
          const runs = tidyRuns(runsOf(li));
          runs.unshift({ text: n.name === 'ol' ? `${k++}. ` : '• ', i: false, b: false });
          flat.push({ kind: 'p', runs, list: true });
        }
      } else if (n.name === 'blockquote') {
        for (const c of n.children.filter((x) => x.name === 'p')) flat.push({ kind: 'quote', runs: tidyRuns(runsOf(c)) });
      } else if (n.name === 'table') {
        // Tables are rare in novels: keep each row as a line of text.
        for (const tr of findAll(n, 'tr')) {
          const cells = findAll(tr, 'td').concat(findAll(tr, 'th')).map((td) => plain(runsOf(td)).trim());
          if (cells.join('')) flat.push({ kind: 'p', runs: [{ text: cells.join('  |  '), i: false, b: false }] });
        }
      } else {
        walk(n.children || []);
      }
    }
  };
  walk(dom.children);

  const BARE = /^(chapter|part|book)\s+[\w-]+$/i;
  const textOf = (b) => (b && b.runs ? plain(b.runs).trim() : '');
  // Word drop caps arrive as a paragraph holding just the big letter: join it back.
  for (let i = flat.length - 2; i >= 0; i--) {
    const t = textOf(flat[i]);
    if (flat[i].kind === 'p' && flat[i + 1].kind === 'p' && /^[\u201C\u2018"'(]?\p{L}$/u.test(t)) {
      flat[i + 1].runs = [{ text: t, i: false, b: false }, ...flat[i + 1].runs];
      flat.splice(i, 1);
    }
  }
  // "Chapter 1" on its own line just above a "The Storm" heading: one title.
  for (let i = flat.length - 2; i >= 0; i--) {
    if (flat[i].kind === 'p' && BARE.test(textOf(flat[i])) && flat[i + 1].kind === 'h1' && !BARE.test(textOf(flat[i + 1]))) {
      flat[i + 1].runs = [{ text: `${fixCase(textOf(flat[i]))}: ${textOf(flat[i + 1])}`, i: false, b: false }];
      flat.splice(i, 1);
    }
  }

  // The app makes its own copyright page and contents, so drop the old ones.
  let skipping = false;
  let seenChapter = false;
  let copyrightName = '';
  for (let i = 0; i < flat.length; i++) {
    const b = flat[i];
    const text = plain(b.runs || []).trim();
    if (b.kind === 'h1' && !/^(table of )?contents$/i.test(text)) { skipping = false; if (CHAPTER_RE.test(text) || seenChapter) seenChapter = true; }
    if ((b.kind === 'p' || b.kind === 'h1') && /^(table of )?contents$/i.test(text)) { skipping = true; flat[i] = null; continue; }
    if (skipping && b.kind !== 'h1') {
      if (CHAPTER_RE.test(text) && text.length < 70 && !flat.some((x) => x && x.kind === 'h1')) { skipping = false; continue; }
      flat[i] = null; continue;
    }
    if (!seenChapter && b.kind === 'p' && /(copyright|\u00A9|all rights reserved|^isbn|may be reproduced)/i.test(text)) {
      const m = /(?:copyright|\u00A9)\s*(?:\u00A9|\(c\))?\s*\d{4}\s+(?:by\s+)?(.+?)\s*(?:\.|all rights|$)/i.exec(text);
      if (m && !copyrightName) copyrightName = m[1].trim();
      flat[i] = null;
    }
  }
  for (let i = flat.length - 1; i >= 0; i--) if (!flat[i]) flat.splice(i, 1);

  const book = { title: '', subtitle: '', author: '', chapters: [] };
  const hasH1 = flat.some((b) => b.kind === 'h1');
  let current = null;
  const startChapter = (title) => { current = { title, blocks: [] }; book.chapters.push(current); };

  for (const b of flat) {
    const text = plain(b.runs || []).trim();
    if (b.kind === 'title') { if (!book.title) book.title = text; continue; }
    if (b.kind === 'subtitle') { if (!book.subtitle) book.subtitle = text; continue; }
    const looksLikeChapter = b.kind === 'p' && text.length < 70 && CHAPTER_RE.test(text) && !/[.,;]$/.test(text);
    const bareChapter = b.kind === 'p' && /^(chapter|part)\s+[\w-]+$/i.test(text);
    if (b.kind === 'h1' || ((!hasH1 && looksLikeChapter) || bareChapter)) { startChapter(fixCase(text)); continue; }
    if (!current) startChapter('');
    if (b.kind === 'img') { current.blocks.push({ type: 'img', src: b.src }); continue; }
    if (b.kind === 'h2') { current.blocks.push({ type: 'h2', runs: b.runs }); continue; }
    if (SCENE_RE.test(text)) { current.blocks.push({ type: 'break' }); continue; }
    current.blocks.push({ type: b.kind === 'quote' ? 'quote' : 'p', runs: b.runs, list: !!b.list });
  }

  // Text before the first chapter heading is usually the title page the author typed by hand.
  const first = book.chapters[0];
  if (first && book.chapters.length > 1 && !CHAPTER_RE.test(first.title)) {
    const paras = first.blocks.filter((b) => b.type === 'p');
    const short = paras.length <= 6 && paras.every((p) => plain(p.runs).length < 80);
    const by = paras.find((p) => /^by\s+/i.test(plain(p.runs)));
    if (short && (!first.title || by || paras.length <= 2)) {
      if (!book.title) book.title = first.title || (paras[0] ? plain(paras[0].runs) : '');
      else if (first.title && !book.subtitle) book.subtitle = first.title;
      if (by) book.author = plain(by.runs).replace(/^by\s+/i, '');
      else {
        const name = paras.find((p) => plain(p.runs) !== book.title && plain(p.runs).split(/\s+/).length <= 5);
        if (name) book.author = titleCase(plain(name.runs));
      }
      book.chapters.shift();
    }
  }
  for (const ch of book.chapters) {
    // Drop scene breaks at the very start or end of a chapter, and double breaks.
    ch.blocks = ch.blocks.filter((b, i, a) => !(b.type === 'break' && (i === 0 || i === a.length - 1 || a[i - 1].type === 'break')));
  }
  book.chapters = book.chapters.filter((c) => c.blocks.length || c.title);
  const squash = (x) => x.replace(/\s/g, '').toLowerCase();
  if (copyrightName && (!book.author || squash(book.author) === squash(copyrightName))) book.author = copyrightName;
  return book;
}

function fixCase(s) { return /^(CHAPTER|PART|BOOK)\b/.test(s) && s === s.toUpperCase() ? titleCase(s) : s; }

function titleCase(s) {
  return s === s.toUpperCase() ? s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()) : s;
}

function findImg(n) {
  if (n.name === 'img') return n.attribs.src;
  for (const c of n.children || []) { const s = c.type === 'tag' && findImg(c); if (s) return s; }
  return null;
}
function findAll(n, name, out = []) {
  for (const c of n.children || []) if (c.type === 'tag') { if (c.name === name) out.push(c); else findAll(c, name, out); }
  return out;
}

module.exports = { readManuscript, htmlToBook, plain };
