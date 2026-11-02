// One call that turns a manuscript into the three KDP files.
const path = require('path');
const fontkit = require('fontkit');
const { readManuscript, plain } = require('./read');
const { makePdf } = require('./pdf');
const { makeEpub } = require('./epub');
const { makeDocx } = require('./docx');
const { translateBook } = require('./translate');
const { MAX_PAGES, MIN_PAGES } = require('./kdp');
const { heading } = require('./kdp-languages');

const ABOUT_AUTHOR_RE = /^about the author\b/i;
const paragraphs = (t) => String(t || '').split(/\n\s*\n|\n/).map((x) => x.trim()).filter(Boolean);

// The author's own "About the Author" page: photo (colour, plus a black-and-white
// copy for the paperback) and their words. Added before translating, so it is
// translated with the rest of the book.
function authorChapter(a) {
  const blocks = [];
  if (a.photo) blocks.push({ type: 'img', src: a.photo, print: a.photoGrey || a.photo, scale: 0.42, alt: 'The author' });
  for (const p of paragraphs(a.text)) blocks.push({ type: 'p', runs: [{ text: p }] });
  return { title: 'About the Author', aboutAuthor: true, blocks };
}

// The About the Author section a manuscript already has, as plain text (to fill the form).
function findAboutAuthor(book) {
  const ch = book.chapters.find((c) => ABOUT_AUTHOR_RE.test(c.title || ''));
  return ch ? ch.blocks.filter((b) => b.runs).map((b) => plain(b.runs)).join('\n\n') : '';
}

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
  const chars = [...seen].map((cp) => String.fromCodePoint(cp));
  return { total, missing: seen.size, chars, letters: chars.filter((c) => /\p{L}/u.test(c)) };
}

// Characters no print font can draw and nobody needs to see: translator word
// markers, invisible joiners, odd spaces. Cleaned out of the whole book.
const ODD = [[/[\u2581\u2047]/g, ' '], [/[\u200B-\u200D\u2060\uFEFF]/g, ''], [/[\u2009\u202F\u2007]/g, '\u00A0'], [/[\u2028\u2029]/g, ' ']];
function cleanText(t) { let s = String(t || ''); for (const [re, to] of ODD) s = s.replace(re, to); return s.replace(/ {2,}/g, ' '); }
function cleanBook(b) {
  for (const k of ['title', 'subtitle', 'author']) if (b[k]) b[k] = cleanText(b[k]).trim();
  for (const ch of b.chapters) {
    if (ch.title) ch.title = cleanText(ch.title).trim();
    for (const bl of ch.blocks) if (bl.runs) for (const r of bl.runs) r.text = cleanText(r.text);
  }
}
// Drops the few symbols the print fonts lack (a ✓ or ★), so they never block the paperback.
function dropChars(b, chars) {
  const re = new RegExp(`[${chars.map((c) => c.replace(/[\]\\^-]/g, '\\$&')).join('')}]`, 'gu');
  const fix = (t) => String(t || '').replace(re, '');
  for (const k of ['title', 'subtitle', 'author']) if (b[k]) b[k] = fix(b[k]);
  for (const ch of b.chapters) {
    if (ch.title) ch.title = fix(ch.title);
    for (const bl of ch.blocks) if (bl.runs) for (const r of bl.runs) r.text = fix(r.text);
  }
}

function safeName(s) {
  return (s || 'book').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'book';
}

async function readBook(buffer, filename) {
  const book = await readManuscript(buffer, filename);
  const words = book.chapters.reduce((n, c) => n + c.blocks.reduce((m, b) => m + (b.runs ? plain(b.runs).split(/\s+/).filter(Boolean).length : 0), 0), 0);
  return { book, summary: { title: book.title, author: book.author, subtitle: book.subtitle, chapters: book.chapters.map((c) => c.title || '(untitled)'), words, aboutAuthor: findAboutAuthor(book) } };
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
  let lang = opts.lang || b.lang || 'en';
  let rtl = !!b.rtl;
  const author = opts.aboutAuthor;
  if (author && (author.text || author.photo)) {
    b.chapters = b.chapters.filter((c) => !ABOUT_AUTHOR_RE.test(c.title || ''));
    b.chapters.push(authorChapter(author));
  }

  if (opts.translate && opts.translate.target) {
    onProgress('Translating', 0);
    b = await translateBook(b, opts.translate, (p) => onProgress('Translating', p));
    lang = b.lang; rtl = b.rtl;
  }

  for (const c of b.chapters) if (c.aboutAuthor) c.title = heading('aboutAuthor', opts.translate?.target || lang);
  const aboutAuthorText = (b.chapters.find((c) => c.aboutAuthor) || { blocks: [] }).blocks.filter((x) => x.runs).map((x) => plain(x.runs)).join('\n\n');

  if (opts.beforeLayout) b = await opts.beforeLayout(b, onProgress);

  const files = [];
  const base = safeName(b.title) + (opts.translate?.target ? ` (${opts.translate.target})` : '');

  // Pick a font that has every letter in the book.
  cleanBook(b);
  let family = opts.font === 'noto' ? 'noto' : 'crimson';
  let cover = missingGlyphs(b, family);
  if (cover.missing && family === 'crimson') { family = 'noto'; cover = missingGlyphs(b, 'noto'); }
  // only symbols missing (no letters): leave them out of the print book instead of skipping it
  let printBook = b;
  if (cover.missing && !cover.letters.length && !rtl) {
    const shown = cover.chars.map((c) => `"${c}" (U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})`).join(', ');
    printBook = JSON.parse(JSON.stringify(b)); // the eBook and Word file keep them
    dropChars(printBook, cover.chars);
    notes.push(`The paperback leaves out ${cover.chars.length === 1 ? 'one symbol' : 'a few symbols'} its fonts can't print: ${shown}. The eBook and Word file keep ${cover.chars.length === 1 ? 'it' : 'them'}.`);
    cover = missingGlyphs(printBook, family);
  }

  let pageCount = 200;
  let pdfMade = false;
  if (rtl || cover.missing > 0) {
    notes.push('The print PDF was skipped: this language uses letters our print fonts do not have yet. The EPUB and Word files are ready, and Word can make a PDF from the .docx (File > Save As > PDF).');
  } else {
    onProgress('Making the print PDF', 0);
    const pdf = await makePdf(printBook, { ...opts, font: family, lang });
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
  return { files, pageCount, notes, font: family, book: b, lang, pdfMade, aboutAuthorText };
}

module.exports = { readBook, buildAll, safeName, findAboutAuthor, authorChapter, ABOUT_AUTHOR_RE };
