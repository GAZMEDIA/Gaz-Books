// One click: a manuscript in, every chosen language out, in one folder and
// one zip. For each language: paperback PDF, Kindle EPUB, Word file, Kindle
// cover JPG, paperback cover PDF, Amazon listing and an upload guide. Plus
// the cover-picture prompt for Gemini. All on this computer, no keys.
//
// Translations run one language after another on every core, and each
// language is formatted while the next one translates.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { buildAll, safeName, authorChapter, ABOUT_AUTHOR_RE } = require('./engine');
const { translateBook, translateStrings } = require('./translate');
const { kdpLanguage } = require('./kdp-languages');
const kit = require('./kit-offline');
const { writeGooglePlay } = require('./googleplay');

// The first two or three sentences (about 55 words): the bio on the back cover.
function shortBio(text) {
  const s = String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+/);
  let out = '';
  for (const x of s) {
    if (out && (out + x).split(' ').length > 55) break;
    out = out ? `${out} ${x}` : x;
  }
  return out;
}

const LOOKS = { // built-in cover colours by kind of book (used until the author adds a picture)
  faith: { bg: '#14254a', ink: '#f5e7c4', style: 'elegant' },
  romance: { bg: '#5a1f35', ink: '#ffe9ef', style: 'classic' },
  thriller: { bg: '#0d1117', ink: '#f2f2f2', style: 'modern' },
  fantasy: { bg: '#1f1640', ink: '#f3e6ff', style: 'classic' },
  business: { bg: '#0f2f4f', ink: '#ffffff', style: 'modern' },
  selfhelp: { bg: '#e8572a', ink: '#ffffff', style: 'modern' },
  children: { bg: '#2c7fb8', ink: '#ffffff', style: 'classic' },
  memoir: { bg: '#3b2f2a', ink: '#f6ecdf', style: 'elegant' },
  health: { bg: '#1f5e45', ink: '#ffffff', style: 'modern' },
  fiction: { bg: '#22313f', ink: '#fdf6e3', style: 'classic' },
};

// opts: { languages: ['en', 'fr', ...], source: 'en', trim, title, subtitle, author,
//         aboutAuthor: { text, photo, photoGrey }, aboutBook, folder,
//         cover: { image, bg, ink, style } (optional picture for the covers) }
// deps: { offline(texts, src, tgt, onPart) -> html[]  (the on-computer translator),
//         renderCover(spec) -> { pdf, kindle } (optional; the app draws covers),
//         need(feature) (licence checks) }
async function makeEverything(book0, opts, deps, onProgress = () => {}) {
  const t0 = Date.now();
  const source = opts.source || 'en';
  const langs = [...new Set(opts.languages && opts.languages.length ? opts.languages : [source])];
  const book = JSON.parse(JSON.stringify(book0));
  if (opts.title) book.title = opts.title;
  if (opts.subtitle !== undefined) book.subtitle = opts.subtitle;
  if (opts.author) book.author = opts.author;
  const a = opts.aboutAuthor || {};
  if (a.text || a.photo) {
    book.chapters = book.chapters.filter((c) => !ABOUT_AUTHOR_RE.test(c.title || ''));
    book.chapters.push(authorChapter(a));
  }

  // the marketing words, worked out once from the original
  const genre = kit.detectGenre(book);
  const words = {
    desc: kit.description(book, opts.aboutBook, genre),
    keys: kit.keywords(book, genre),
    quote: opts.tagline || '', // empty unless the author gives one (a line from the book is offered as a suggestion)
    bio: a.text || '',
    shortBio: shortBio(a.text),
  };
  const prompt = kit.coverPrompt(book, genre, opts.trim || '6x9');
  const look = { ...LOOKS[genre], ...(opts.cover || {}) };

  const folder = opts.folder;
  fs.mkdirSync(folder, { recursive: true });
  const promptFile = path.join(folder, 'Cover picture prompt (paste into Gemini).txt');
  fs.writeFileSync(promptFile, `${prompt}\n`);

  // translations: started one after another, each queued whole on the translator
  const tr = (target) => ({ engine: 'offline', target, language: (kdpLanguage(target) || {}).name || target, source, offline: deps.offline });
  const total = langs.length;
  const share = {};
  const report = (code, step, p) => {
    share[code] = p;
    const all = langs.reduce((n, c) => n + (share[c] || 0), 0) / total;
    onProgress({ step, p: all, seconds: (Date.now() - t0) / 1000 });
  };
  let chain = Promise.resolve();
  const translated = langs.map((code) => {
    if (code === source) return Promise.resolve({ book: { ...book, lang: source }, words });
    const job = chain.then(async () => {
      const name = (kdpLanguage(code) || {}).name || code;
      const b = await translateBook(book, tr(code), (p) => report(code, `Translating into ${name}`, p * 0.85));
      const list = [words.desc, words.keys.join('\n'), words.quote, words.bio, words.shortBio];
      const [desc, keys, quote, bio, sbio] = await translateStrings(list, tr(code));
      return { book: b, words: { desc, keys: keys.split('\n').map((k) => k.trim()).filter(Boolean), quote, bio, shortBio: sbio } };
    });
    chain = job.catch(() => {});
    return job;
  });

  // each language is formatted as soon as its translation is ready
  const editions = [];
  const notes = [];
  for (const [i, code] of langs.entries()) {
    const lang = kdpLanguage(code) || { code, name: code, print: true, kdpPrint: true };
    const { book: b, words: w } = await translated[i];
    report(code, `Making the ${lang.name} books`, 0.9);
    const res = await buildAll(b, { trim: opts.trim || '6x9', lang: code, dropCaps: opts.dropCaps });
    const dir = path.join(folder, safeName(`${lang.name}`));
    fs.mkdirSync(dir, { recursive: true });
    const base = safeName(res.book.title);
    const files = [];
    const save = (name, buf) => { const p = path.join(dir, name); fs.writeFileSync(p, buf); files.push(p); return p; };
    for (const f of res.files) save(f.name.replace(/ \(\w+\)/, ''), f.buffer);
    const pdfMade = res.files.some((f) => f.kind === 'pdf');
    if (!pdfMade && lang.print) notes.push(`${lang.name}: no paperback PDF (${res.notes.join(' ')})`);
    const coverSpec = {
      trim: opts.trim || '6x9', pages: res.pageCount, paper: 'white', title: res.book.title, subtitle: res.book.subtitle || '',
      author: res.book.author || '', tagline: w.quote, blurb: w.desc.replace(/\n?Inside this book:[\s\S]*$/, '').trim() || w.desc,
      bio: w.shortBio, authorPhoto: a.photo || '', imageMode: 'front', ...look,
    };
    save(`${base} - Amazon listing.txt`, kit.listingText({ lang, title: res.book.title, subtitle: res.book.subtitle, author: res.book.author, desc: w.desc, keys: w.keys, categories: kit.GENRES[genre].categories, bio: w.bio, pages: res.pageCount, printMade: pdfMade }));
    save('How to upload to Amazon.txt', kit.uploadGuide({ lang, trim: opts.trim || '6x9', pages: res.pageCount, printMade: pdfMade, aiCover: !!(opts.cover && opts.cover.image) }));
    const ed = { code, name: lang.name, dir, base, pages: res.pageCount, printMade: pdfMade, coverSpec, files,
      title: res.book.title, subtitle: res.book.subtitle || '', author: res.book.author || '', words: w, book: b, lang };
    if (deps.renderCover) await drawCovers(ed, deps.renderCover);
    editions.push(ed);
    report(code, `${lang.name} ready`, 1);
  }
  // the zip and the Google Play folder are made by finish(), after "Check before printing"
  return { folder, zipPath: path.join(folder, `${safeName(book.title)}.zip`), editions, genre, isbns: opts.isbns || {}, prompt, promptFile, notes,
    trim: opts.trim || '6x9', source, aboutAuthor: a, suggestion: kit.pullQuote(book), seconds: (Date.now() - t0) / 1000 };
}

// The last stage: every language ready for Google Play too, and everything in one zip.
async function finish(res) {
  writeGooglePlay(res.folder, res.editions, { genre: res.genre, isbns: res.isbns });
  fs.rmSync(res.zipPath, { force: true });
  res.zipPath = await zipAll(res.folder, path.basename(res.zipPath, '.zip'));
  res.finished = true;
  return res;
}

// What is still empty on the back cover, in plain words.
function blanks(res) {
  const b = backCover(res);
  const out = [];
  if (!b.desc) out.push('The book description is empty (it goes on the back cover and on Amazon).');
  if (!b.bio) out.push('"About the author" is empty (back cover and the last page of the book).');
  if (!b.photo) out.push('There is no author photo.');
  if (!b.tagline) out.push('The line at the top of the back cover is empty (you can leave this one out).');
  return out;
}

const blurbOf = (desc) => String(desc || '').replace(/\n?Inside this book:[\s\S]*$/, '').trim() || String(desc || '');

// What the back cover says now (in the original language), for the "Check your back cover" editor.
function backCover(res) {
  const e = res.editions.find((x) => x.code === res.source) || res.editions[0];
  return { tagline: e.words.quote, desc: blurbOf(e.words.desc), bio: e.words.bio, photo: res.aboutAuthor.photo || '', suggestion: res.suggestion || '' };
}

// The author changed the back cover: translate the new words for every language,
// redo each book's About the Author page, and redraw every cover.
// vals: { tagline, desc, bio, photo, photoGrey }
async function updateBack(res, vals, deps, onProgress = () => {}) {
  res.aboutAuthor = { text: vals.bio || '', photo: vals.photo || '', photoGrey: vals.photoGrey || vals.photo || '' };
  const list = [vals.desc || '', vals.tagline || '', vals.bio || '', shortBio(vals.bio)];
  let n = 0;
  for (const ed of res.editions) {
    onProgress({ step: `Updating ${ed.name}`, p: n++ / res.editions.length });
    const [desc, quote, bio, sbio] = ed.code === res.source || !list.some(Boolean) ? list
      : await translateStrings(list, { engine: 'offline', target: ed.code, language: ed.name, source: res.source, offline: deps.offline });
    Object.assign(ed.words, { desc, quote, bio, shortBio: sbio });
    // the About the Author page inside the books
    const b = ed.book;
    b.chapters = b.chapters.filter((c) => !c.aboutAuthor);
    if (bio || vals.photo) b.chapters.push(authorChapter({ text: bio, photo: vals.photo, photoGrey: vals.photoGrey }));
    const built = await buildAll(b, { trim: res.trim, lang: ed.code });
    for (const f of built.files) {
      const p = path.join(ed.dir, f.name.replace(/ \(\w+\)/, ''));
      fs.writeFileSync(p, f.buffer);
      if (!ed.files.includes(p)) ed.files.push(p);
    }
    if (built.pageCount !== ed.pages) { // a new page count means a new spine: the old cover file goes
      const old = path.join(ed.dir, `${ed.base} - paperback cover ${res.trim} ${ed.pages}p.pdf`);
      fs.rmSync(old, { force: true });
      ed.files = ed.files.filter((f) => f !== old);
      ed.pages = built.pageCount;
    }
    fs.writeFileSync(path.join(ed.dir, `${ed.base} - Amazon listing.txt`), kit.listingText({ lang: ed.lang, title: ed.title, subtitle: ed.subtitle, author: ed.author, desc, keys: ed.words.keys, categories: kit.GENRES[res.genre].categories, bio, pages: ed.pages, printMade: ed.printMade }));
    Object.assign(ed.coverSpec, { tagline: quote, blurb: blurbOf(desc), bio: sbio, authorPhoto: vals.photo || '', pages: ed.pages });
    if (deps.renderCover) await drawCovers(ed, deps.renderCover);
  }
  onProgress({ step: 'Back cover updated', p: 1 });
  return res;
}

// The two covers of one language: Kindle (front, JPG) and paperback (whole wrap, PDF).
async function drawCovers(ed, renderCover, extra = {}) {
  const spec = { ...ed.coverSpec, ...extra };
  const { pdf, kindle } = await renderCover(spec);
  const k = path.join(ed.dir, `${ed.base} - Kindle cover.jpg`);
  fs.writeFileSync(k, kindle);
  if (!ed.files.includes(k)) ed.files.push(k);
  if (ed.printMade) {
    const p = path.join(ed.dir, `${ed.base} - paperback cover ${spec.trim} ${ed.pages}p.pdf`);
    fs.writeFileSync(p, pdf);
    if (!ed.files.includes(p)) ed.files.push(p);
  }
  ed.coverSpec = spec;
}

// Everything in one zip, one folder per language.
async function zipAll(folder, name) {
  const zip = new JSZip();
  const root = safeName(name);
  const add = (dir, rel) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (f.endsWith('.zip')) continue;
      if (fs.statSync(p).isDirectory()) add(p, `${rel}${f}/`); else zip.file(`${root}/${rel}${f}`, fs.readFileSync(p));
    }
  };
  add(folder, '');
  const zipPath = path.join(folder, `${root}.zip`);
  // PDFs, JPGs and EPUBs are already compressed: store them as they are (much faster)
  fs.writeFileSync(zipPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' }));
  return zipPath;
}

module.exports = { makeEverything, drawCovers, zipAll, shortBio, LOOKS, backCover, updateBack, finish, blanks };
