// The author's own marketing kit: description, cover prompt, keywords and
// categories they already have (Word, text or PDF, one file or several).
// GazBook uses every part they give exactly as written, and only makes up
// the parts that are missing.
const path = require('path');

// ---------------------------------------------------------------- reading the files

async function kitText(buffer, file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.docx') {
    try {
      // as HTML, so a table keeps its rows: each row becomes one line, cells split by " | "
      const mammoth = require('mammoth');
      const html = (await mammoth.convertToHtml({ buffer })).value;
      return htmlLines(html);
    } catch (e) { // some Word files trip the reader: take the words straight from the document
      const JSZip = require('jszip');
      const zip = await JSZip.loadAsync(buffer);
      const xml = await zip.file('word/document.xml').async('string');
      return (xml.match(/<w:p[\s>][\s\S]*?<\/w:p>/g) || []).map((p) => (p.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || [])
        .map((t) => t.replace(/<[^>]+>/g, '')).join('').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')).join('\n');
    }
  }
  if (ext === '.pdf') {
    const { pdfToHtml } = require('./read-pdf');
    const html = await pdfToHtml(buffer);
    return html.replace(/<\/(p|h\d|li|div)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  }
  return buffer.toString('utf8');
}

const ents = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
function htmlLines(html) {
  const cell = (c) => ents(c.replace(/<\/(p|li|h\d)>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  return html
    .replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, (_m, row) => `<p>${(row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(cell).join(' | ')}</p>`)
    .replace(/<li[^>]*>/gi, '• ') // bullets stay bullets
    .replace(/<\/(p|h\d|li|div)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .split('\n').map((l) => ents(l)).join('\n');
}

// A table row ("1 | a king in the baggage | title phrase | 1"): the cell under the
// header that names what we want ("Keyword phrase", "Category path").
function tableColumn(lines, want) {
  const rows = lines.filter((l) => l.includes(' | ')).map((l) => l.split(' | ').map((c) => c.trim()));
  if (!rows.length) return null;
  const head = rows.findIndex((r) => r.some((c) => want.test(c)));
  if (head < 0) return null;
  const col = rows[head].findIndex((c) => want.test(c));
  return rows.slice(head + 1).filter((r) => r.length === rows[head].length).map((r) => r[col]).filter(Boolean);
}

// ---------------------------------------------------------------- finding the parts

// Headings that start each part (a line that is mostly just the heading).
const HEADS = [
  ['description', /^(?:[A-Z0-9]{1,2}[.)]\s*)?(?:amazon\s+)?(?:book\s+)?(?:description|blurb|synopsis|book summary|back cover (?:copy|text))\b[^\n]{0,30}$/i],
  ['coverPrompt', /^(?:[A-Z0-9]{1,2}[.)]\s*)?(?:ai\s+)?(?:book\s+)?cover\b[^\n]{0,40}\bprompt\b[^\n]{0,20}$|^(?:[A-Z0-9]{1,2}[.)]\s*)?(?:ai\s+)?(?:image|picture)\s+prompt\b[^\n]{0,20}$/i],
  ['keywords', /^(?:[A-Z0-9]{1,2}[.)]\s*)?(?:\d+\s+)?(?:[\w-]+\s+){0,3}(?:amazon\s+)?(?:key\s?words|search terms)\b[^\n]{0,30}$/i],
  ['categories', /^(?:[A-Z0-9]{1,2}[.)]\s*)?(?:\d+\s+)?(?:[\w-]+\s+){0,2}(?:amazon\s+)?(?:categories|category|bisac)\b[^\n]{0,30}$/i],
  ['bio', /^(?:[A-Z0-9]{1,2}[.)]\s*)?about the author\b[^\n]{0,20}$/i],
  ['tagline', /^(?:[A-Z0-9]{1,2}[.)]\s*)?(?:tag\s?line|hook|top line)\b[^\n]{0,20}$/i],
  // other parts of a kit: they end the part above them, and are kept only in the kit file itself
  ['aboutBook', /^(?:[A-Z0-9]{1,2}[.)]\s*)?about the book\b[^\n]{0,40}$/i],
];
// A heading line that names several parts at once ("Cover Prompt, Keywords & Categories") is a title, not a part.
const multiHead = (line) => HEADS.filter(([, re]) => re.test(line.replace(/[,&]/g, ' ').split(/\s{2,}/)[0])).length > 1
  || /(prompt|description).*(keywords?|categor)|(keywords?).*(categor)/i.test(line);
const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
// lines that only explain the list ("Mix of beginner…", "Selected for genre fit…")
const EXPLAIN = /^(mix of|selected for|chosen for|these (are|keywords|categories)|use (these|them)|tip:|note:|reflecting|for (best|more)|kdp (gives|lets|allows)|at upload|paste (this|it|into)|put (two|these|them)|copy (this|it|into))/i;
const bullet = (s) => clean(s).replace(/^([-*•·▪◦–—]|\(?\d{1,2}[.)]|[a-z][.)])\s+/i, '').replace(/^["“]|["”]$/g, '').trim();

function parseKit(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(clean);
  const parts = { intro: [] };
  let cur = 'intro';
  for (const line of lines) {
    if (!line) { (parts[cur] = parts[cur] || []).push(''); continue; }
    const head = line.length < 90 && !multiHead(line) && HEADS.find(([, re]) => re.test(line));
    if (head) { cur = head[0]; parts[cur] = parts[cur] || []; continue; }
    (parts[cur] = parts[cur] || []).push(line);
  }
  const kit = { title: '', subtitle: '', series: '', description: '', coverPrompt: '', keywords: [], categories: [], bio: '', tagline: '' };

  // title (and series) from the line under the file's own heading, e.g. "A Catalyst Crown: The Alchemists of Ashvane, Book Three"
  const allLines = lines.filter(Boolean);
  const titleLine = allLines.find((l) => !HEADS.some(([, re]) => re.test(l)) && !multiHead(l) && l.split(' ').length <= 16 && /[:–—-]/.test(l) && !/[.!?]$/.test(l));
  if (titleLine) {
    const [t, ...rest] = titleLine.split(/\s*[:–—]\s*/);
    kit.title = t.trim();
    const after = rest.join(': ').trim();
    if (/\b(book|volume|vol\.?|part)\s+(\w+)\b/i.test(after) || /\bseries\b/i.test(after)) kit.series = after;
    else kit.subtitle = after;
  }

  const block = (k) => (parts[k] || []).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // the description: as written, without a repeated title line or a "Word count" note
  kit.description = block('description').split('\n')
    .filter((l, i) => !(i < 2 && kit.title && l.toLowerCase().startsWith(kit.title.toLowerCase()) && l.split(' ').length <= 16))
    .filter((l, i) => !(i < 2 && EXPLAIN.test(l))) // "Paste into the KDP "Description" box…"
    .filter((l) => !/^word count\b/i.test(l))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // descriptions written one paragraph per line: give each its own paragraph
  if (kit.description && !kit.description.includes('\n\n')) kit.description = kit.description.split('\n').join('\n\n');

  kit.coverPrompt = block('coverPrompt').split('\n')
    .filter((l, i) => !(i < 2 && kit.title && l.toLowerCase().startsWith(kit.title.toLowerCase()) && l.split(' ').length <= 16))
    .join('\n').trim();

  const kwTable = tableColumn(parts.keywords || [], /^(keyword|search term|phrase)/i);
  const catTable = tableColumn(parts.categories || [], /^(category|categories|bisac|path)/i);
  kit.keywords = kwTable ? kwTable.map((k) => k.replace(/[.]$/, '')) : (parts.keywords || []).map(bullet).filter((l) => l && !EXPLAIN.test(l) && !/:$/.test(l) && l.length <= 80)
    .flatMap((l) => (l.includes(';') || (l.split(',').length > 2 && !/\s{2}/.test(l)) ? l.split(/[;,]/) : [l]))
    .map((k) => k.trim().replace(/[.]$/, '')).filter(Boolean);
  kit.categories = catTable || (parts.categories || []).map(bullet).filter((l) => l && !EXPLAIN.test(l) && !/:$/.test(l) && (/[>›]/.test(l) || l.split(' ').length <= 8));
  kit.bio = block('bio');
  kit.tagline = bullet(block('tagline').split('\n')[0] || '');

  // the cover prompt often says the subtitle exactly: Subtitle "When Their Formula Becomes a Kingdom's Weapon"
  const sub = kit.coverPrompt.match(/subtitle\s*[:"“]\s*["“]?([^"”\n]{3,120})["”]/i);
  if (sub && !kit.subtitle) kit.subtitle = sub[1].trim();
  if (!kit.title) {
    const t = kit.coverPrompt.match(/title\s*[:"“]\s*["“]?([^"”\n]{2,120})["”]/i);
    if (t) kit.title = titleCase(t[1].trim());
  }
  return kit;
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to']);
function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().split(' ').map((w, i) => (i && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

// Several files make one kit: each part comes from the first file that has it.
function mergeKits(kits) {
  const out = { title: '', subtitle: '', series: '', description: '', coverPrompt: '', keywords: [], categories: [], bio: '', tagline: '', files: [] };
  for (const k of kits) {
    for (const key of ['title', 'subtitle', 'series', 'description', 'coverPrompt', 'bio', 'tagline']) if (!out[key] && k[key]) out[key] = k[key];
    for (const key of ['keywords', 'categories']) if (!out[key].length && k[key].length) out[key] = k[key];
    if (k.file) out.files.push(k.file);
  }
  return out;
}

async function readKit(files) {
  const fs = require('fs');
  const kits = [];
  for (const f of files) {
    let text;
    try { text = await kitText(fs.readFileSync(f), f); } catch (e) {
      // a PDF that is all pictures (a finished cover wrap, say) has no kit words: it is given back as it is
      if (/\.pdf$/i.test(f) && /no text in it/i.test(e.message)) text = '';
      else { e.file = f; throw e; }
    }
    const k = parseKit(text);
    k.file = path.basename(f);
    kits.push(k);
  }
  const kit = mergeKits(kits);
  kit.paths = files.slice();
  // files with kit words in them are translated; any other file (a finished cover wrap, say) is given back as it is
  kit.wordFiles = files.filter((f, i) => found(kits[i]).has.some((h) => !/^(title|subtitle|series)/.test(h))); // the files themselves, to give back exactly as they came
  return kit;
}

// What GazBook found, in plain words, for the screen.
function found(kit) {
  const has = [];
  if (kit.title) has.push(`title "${kit.title}"`);
  if (kit.subtitle) has.push('subtitle');
  if (kit.series) has.push('series');
  if (kit.description) has.push(`description (${kit.description.split(/\s+/).length} words)`);
  if (kit.coverPrompt) has.push('cover prompt');
  if (kit.keywords.length) has.push(`${kit.keywords.length} keywords`);
  if (kit.categories.length) has.push(`${kit.categories.length} categories`);
  if (kit.bio) has.push('about the author');
  const missing = [];
  if (!kit.description) missing.push('description');
  if (!kit.coverPrompt) missing.push('cover prompt');
  if (!kit.keywords.length) missing.push('keywords');
  if (!kit.categories.length) missing.push('categories');
  return { has, missing };
}

// ---------------------------------------------------------------- Amazon's limits

// Amazon has 7 keyword boxes of up to 50 characters each, and reads every
// word in a box. With more than 7 keywords, a box takes a second keyword
// when the new words fit in 50 characters (words already in the box are not
// repeated). Whatever still does not fit is kept as "extra keywords" (for
// Google Play and Kobo, which take more, or to swap in on Amazon later).
function packKeywords(keys, boxes = 7, max = 50) {
  const list = [...new Set(keys.map((k) => clean(k)).filter(Boolean))];
  if (list.length <= boxes) return { boxes: list.slice(), extra: [] };
  const out = list.slice(0, boxes);
  const extra = [];
  for (const k of list.slice(boxes)) {
    let placed = false;
    for (let b = 0; b < out.length && !placed; b++) {
      const have = new Set(out[b].toLowerCase().split(/\s+/));
      const add = k.split(/\s+/).filter((w) => !have.has(w.toLowerCase()));
      const joined = add.length ? `${out[b]} ${add.join(' ')}` : out[b];
      if (joined.length <= max && out[b].length < 40) { out[b] = joined; placed = true; }
    }
    if (!placed) extra.push(k);
  }
  return { boxes: out, extra };
}

// A back cover holds about 170 words: the description up to its list or call to action.
function backBlurb(desc, maxWords = 170) {
  const paras = String(desc || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out = [];
  let n = 0;
  for (const p of paras) {
    if (/:\s*$/.test(p) || /^(inside this|you'?ll get|in this book|scroll up|buy now|click|get your copy)/i.test(p)) break;
    const w = p.split(/\s+/).length;
    if (out.length && n + w > maxWords) break;
    out.push(p);
    n += w;
  }
  return out.join('\n\n') || paras[0] || '';
}

// ---------------------------------------------------------------- the kit itself, in every language

// A list mark ("•", "1.", "a)", "#") stays as it is; only the words after it are translated.
const MARK = /^(\s*(?:[-*•·▪◦–—]|\(?\d{1,3}[.)]|[a-z][.)]|#{1,6})\s+)/i;
const splitMark = (line) => { const m = String(line).match(MARK); return m ? [m[1], line.slice(m[1].length)] : ['', line]; };

// translate(strings) -> strings, one result per string, same order
async function translateLines(lines, translate) {
  const parts = lines.map(splitMark);
  const todo = [];
  parts.forEach(([, words], i) => { if (/\p{L}/u.test(words)) todo.push(i); }); // numbers and marks ("#", "1") stay as they are
  const got = todo.length ? await translate(todo.map((i) => parts[i][1])) : [];
  const out = parts.map(([mark, words]) => mark + words);
  todo.forEach((i, n) => { out[i] = parts[i][0] + (String(got[n] || '').replace(/\n+/g, ' ').trim() || parts[i][1]); });
  return out;
}

const xmlText = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// A Word kit, translated in place: every paragraph keeps its own style, list,
// heading, bold and layout; only the words change.
async function translateDocx(buffer, translate) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(buffer);
  const T = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:t\s*\/>/g;
  for (const name of Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n))) {
    const xml = await zip.file(name).async('string');
    const paras = [];
    xml.replace(/<w:p[\s>][\s\S]*?<\/w:p>/g, (p, at) => { paras.push({ p, at }); return p; });
    const texts = paras.map(({ p }) => { let t = ''; p.replace(T, (_m, x) => { t += xmlText(x || ''); return _m; }); return t; });
    const done = await translateLines(texts, translate);
    let out = '';
    let last = 0;
    paras.forEach(({ p, at }, i) => {
      out += xml.slice(last, at);
      last = at + p.length;
      if (!texts[i].trim() || done[i] === texts[i]) { out += p; return; }
      let first = true;
      out += p.replace(T, () => {
        if (!first) return '<w:t xml:space="preserve"></w:t>';
        first = false;
        return `<w:t xml:space="preserve">${xmlEsc(done[i])}</w:t>`;
      });
    });
    zip.file(name, out + xml.slice(last));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// A PDF kit, translated: the same lines in the same order, as a plain PDF.
function linesPdf(lines) {
  const PDFDocument = require('pdfkit');
  const fonts = path.join(__dirname, '..', 'fonts');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56 });
    const bufs = [];
    doc.on('data', (b) => bufs.push(b)); doc.on('end', () => resolve(Buffer.concat(bufs))); doc.on('error', reject);
    doc.registerFont('R', path.join(fonts, 'NotoSerif-Regular.ttf'));
    doc.font('R').fontSize(11);
    for (const l of lines) doc.text(l || ' ', { lineGap: 2 });
    doc.end();
  });
}

// The author's kit files for one language: the original language gets the
// files back exactly as they came; any other language gets the same files
// with every line translated, in the same order, the same layout and the same
// file type. Nothing is cut, merged or reworded.
// translate: async (strings) -> strings (omit for the original language)
async function writeKitFiles(kit, dir, { language, translate, plainOnly = false } = {}) {
  const fs = require('fs');
  const made = [];
  for (const f of (kit && kit.paths) || []) {
    if (!fs.existsSync(f)) continue;
    const ext = path.extname(f).toLowerCase();
    const stem = path.basename(f, path.extname(f));
    if (!translate || !(kit.wordFiles || kit.paths).includes(f)) {
      const to = path.join(dir, `Marketing kit - ${path.basename(f)}`);
      fs.copyFileSync(f, to);
      made.push(to);
      continue;
    }
    const name = (e) => path.join(dir, `Marketing kit (${language}) - ${stem}${e}`);
    const buf = fs.readFileSync(f);
    if (ext === '.docx') {
      const to = name('.docx');
      fs.writeFileSync(to, await translateDocx(buf, translate));
      made.push(to);
      continue;
    }
    const lines = await translateLines((await kitText(buf, f)).replace(/\r/g, '').split('\n'), translate);
    const to = ext === '.pdf' && !plainOnly ? name('.pdf') : name(ext === '.pdf' ? '.txt' : ext);
    fs.writeFileSync(to, to.endsWith('.pdf') ? await linesPdf(lines) : lines.join('\n'));
    made.push(to);
  }
  return made;
}

module.exports = { writeKitFiles, translateLines, translateDocx, kitText, parseKit, mergeKits, readKit, found, packKeywords, backBlurb, titleCase };
