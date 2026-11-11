// The author's own marketing kit: description, cover prompt, keywords and
// categories they already have (Word, text or PDF, one file or several).
// GazBook uses every part they give exactly as written, and only makes up
// the parts that are missing.
const path = require('path');

// ---------------------------------------------------------------- reading the files

async function kitText(buffer, file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    return (await mammoth.extractRawText({ buffer })).value;
  }
  if (ext === '.pdf') {
    const { pdfToHtml } = require('./read-pdf');
    const html = await pdfToHtml(buffer);
    return html.replace(/<\/(p|h\d|li|div)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
  }
  return buffer.toString('utf8');
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
];
// A heading line that names several parts at once ("Cover Prompt, Keywords & Categories") is a title, not a part.
const multiHead = (line) => HEADS.filter(([, re]) => re.test(line.replace(/[,&]/g, ' ').split(/\s{2,}/)[0])).length > 1
  || /(prompt|description).*(keywords?|categor)|(keywords?).*(categor)/i.test(line);
const clean = (s) => String(s || '').replace(/ /g, ' ').replace(/[ \t]+/g, ' ').trim();
// lines that only explain the list ("Mix of beginner…", "Selected for genre fit…")
const EXPLAIN = /^(mix of|selected for|chosen for|these (are|keywords|categories)|use (these|them)|tip:|note:|reflecting|for (best|more))/i;
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
    .filter((l) => !/^word count\b/i.test(l))
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // descriptions written one paragraph per line: give each its own paragraph
  if (kit.description && !kit.description.includes('\n\n')) kit.description = kit.description.split('\n').join('\n\n');

  kit.coverPrompt = block('coverPrompt').split('\n')
    .filter((l, i) => !(i < 2 && kit.title && l.toLowerCase().startsWith(kit.title.toLowerCase()) && l.split(' ').length <= 16))
    .join('\n').trim();

  kit.keywords = (parts.keywords || []).map(bullet).filter((l) => l && !EXPLAIN.test(l) && !/:$/.test(l) && l.length <= 80)
    .flatMap((l) => (l.includes(';') || (l.split(',').length > 2 && !/\s{2}/.test(l)) ? l.split(/[;,]/) : [l]))
    .map((k) => k.trim().replace(/[.]$/, '')).filter(Boolean);
  kit.categories = (parts.categories || []).map(bullet).filter((l) => l && !EXPLAIN.test(l) && !/:$/.test(l) && (l.includes('>') || l.split(' ').length <= 8));
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
    const k = parseKit(await kitText(fs.readFileSync(f), f));
    k.file = path.basename(f);
    kits.push(k);
  }
  return mergeKits(kits);
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

module.exports = { kitText, parseKit, mergeKits, readKit, found, packKeywords, backBlurb, titleCase };
