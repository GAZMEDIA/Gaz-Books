// One call that turns a manuscript into the three KDP files.
const path = require('path');
const fontkit = require('fontkit');
const { readManuscript, plain } = require('./read');
const { makePdf } = require('./pdf');
const { makeEpub } = require('./epub');
const { makeDocx } = require('./docx');
const { translateBook } = require('./translate');
const { MAX_PAGES, MIN_PAGES } = require('./kdp');

const FONT_FILES = {
  crimson: path.join(__dirname, '..', 'fonts', 'CrimsonText-Regular.ttf'),
  noto: path.join(__dirname, '..', 'fonts', 'NotoSerif-Regular.ttf'),
};
const fontCache = {};
function missingGlyphs(book, family) {
  fontCache[family] = fontCache[family] || fontkit.openSync(FONT_FILES[family]);
  const f = fontCache[family];
  let total = 0; let missing = 0;
  const seen = new Set();
  const check = (t) => {
    for (const ch of t) {
      const cp = ch.codePointAt(0);
      if (cp <= 0x20 || cp === 0xA0 || cp === 0xAD) continue;
      total++;
      if (seen.has(cp)) continue;
      if (!f.hasGlyphForCodePoint(cp)) { missing++; seen.add(cp); }
    }
  };
  check(`${book.title}${book.author}${book.subtitle}`);
  for (const ch of book.chapters) { check(ch.title || ''); for (const b of ch.blocks) if (b.runs) check(plain(b.runs)); }
  return { total, missing: seen.size };
}

function safeName(s) {
  return (s || 'book').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'book';
}

async function readBook(buffer, filename) {
  const book = await readManuscript(buffer, filename);
  const words = book.chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + (b.runs ? plain(b.runs).split(/\s+/).filter(Boolean).length : 0), 0), 0);
  return { book, summary: { title: book.title, author: book.author, subtitle: book.subtitle, chapters: book.chapters.map((c) => c.title || '(untitled)'), words } };
}

// opts: trim, fontSize, dropCaps, rectoChapters, toc, isbn, dedication, copyrightExtra,
//       cover (data URL), title/author/subtitle overrides, lang,
//       translate: { engine, target, language, googleKey, claudeKey, offline },
//       makeCover: async (book, pageCount) => ({ kindle (data URL), files }) for a
//         translated cover; runs after the PDF so the spine fits the real page count
//       beforeLayout: async (book, onProgress) => book, after translating (checks and corrections)
//       extraFiles: async (book, { pageCount, pdfMade, files }) => files (listing and checks)
async function buildAll(book, opts, onProgress = () => {}) {
  let b = JSON.parse(JSON.stringify(book));
  if (opts.title) b.title = opts.title;
  if (opts.author) b.author = opts.author;
  if (opts.subtitle !== undefined) b.subtitle = opts.subtitle;
  const notes = [];
  let lang = opts.lang || 'en';
  let rtl = false;

  if (opts.translate && opts.translate.target) {
    onProgress('Translating', 0);
    b = await translateBook(b, opts.translate, (p) => onProgress('Translating', p));
    lang = b.lang; rtl = b.rtl;
  }

  if (opts.beforeLayout) b = await opts.beforeLayout(b, onProgress);

  const files = [];
  const base = safeName(b.title) + (opts.translate?.target ? ` (${opts.translate.target})` : '');

  // Pick a font that has every letter in the book.
  let family = opts.font === 'noto' ? 'noto' : 'crimson';
  let cover = missingGlyphs(b, family);
  if (cover.missing && family === 'crimson') { family = 'noto'; cover = missingGlyphs(b, 'noto'); }

  let pageCount = 200;
  let pdfMade = false;
  if (rtl || cover.missing > 0) {
    notes.push('The print PDF was skipped: this language uses letters our print fonts do not have yet. The EPUB and Word files are ready, and Word can make a PDF from the .docx (File > Save As > PDF).');
  } else {
    onProgress('Making the print PDF', 0);
    const pdf = await makePdf(b, { ...opts, font: family, lang });
    pageCount = pdf.pageCount;
    pdfMade = true;
    files.push({ name: `${base} - paperback ${opts.trim || '6x9'}.pdf`, buffer: pdf.buffer, kind: 'pdf' });
    if (pageCount < MIN_PAGES) notes.push(`The paperback is ${pageCount} pages. Amazon needs at least ${MIN_PAGES} pages for a paperback.`);
    if (pageCount > MAX_PAGES) notes.push(`The paperback is ${pageCount} pages. Amazon allows at most ${MAX_PAGES}; try a bigger page size or smaller text.`);
  }

  let ebookCover = opts.cover;
  if (opts.makeCover) {
    onProgress('Making the cover', 0);
    const c = await opts.makeCover(b, pageCount);
    ebookCover = c.kindle || ebookCover;
    files.push(...c.files);
  }

  onProgress('Making the Kindle EPUB', 0);
  files.push({ name: `${base} - Kindle.epub`, buffer: await makeEpub(b, { ...opts, cover: ebookCover, lang, rtl }), kind: 'epub' });
  onProgress('Making the Word file', 0);
  files.push({ name: `${base} - Word.docx`, buffer: await makeDocx(b, { ...opts, lang }, pageCount), kind: 'docx' });
  if (opts.extraFiles) files.push(...await opts.extraFiles(b, { pageCount, pdfMade, files }));
  onProgress('Done', 1);
  return { files, pageCount, notes, font: family };
}

module.exports = { readBook, buildAll, safeName };
