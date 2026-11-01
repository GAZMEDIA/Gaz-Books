// Gemini designs the cover; GazBook redraws it in every language.
//   1. designRequest(): one prompt built from the book. Gemini makes the full
//      front cover using ONLY GazBook's fonts, then the same picture with no
//      words, then a short "design card" (fonts, colours, places).
//   2. readCard(): reads the card the author pastes back (forgiving about
//      layout, spelling and missing parts).
//   3. The cover maker (src/cover.js) puts each language's words on the
//      no-words picture with exactly those fonts and colours.
const fs = require('fs');
const path = require('path');
const { coverSize } = require('./cover');

const FONT_DIR = path.join(__dirname, '..', 'fonts', 'cover');
let catalog = null;
function fonts() {
  if (!catalog) catalog = JSON.parse(fs.readFileSync(path.join(FONT_DIR, 'fonts.json'), 'utf8'));
  return catalog;
}

// ---------------------------------------------------------------- the request

function designRequest(book, { genre, mood, look, images = [], themes = [], trim = '6x9', cyrillic = false } = {}) {
  const size = coverSize({ trim, pages: 200 });
  const h = Math.round((size.px.frontW * size.trimH) / (size.trimW + size.bleed));
  const fam = fonts().families;
  const list = Object.entries(fam).filter(([, v]) => !cyrillic || v.cyrillic)
    .map(([name, v]) => `${name} (${v.kind})`).join(', ');
  const pics = images.length ? images.map((i) => i.thing).join('; ') : '';
  return `You are an award-winning book cover designer. Design a bestselling, eye-catching FRONT COVER for this book.

Title: ${book.title}
${book.subtitle ? `Subtitle: ${book.subtitle}\n` : ''}Author: ${book.author || ''}
Kind of book: ${genre}
${pics ? `Images from the book: ${pics}\n` : ''}${themes.length ? `Themes: ${themes.join(', ')}\n` : ''}Mood: ${mood}. Colour ideas: ${look} (you may choose better ones).

Rules:
- Tall portrait, 2 wide to 3 high (for example ${size.px.frontW} × ${h} pixels), high resolution.
- It must stand out as a small thumbnail on Amazon: one strong focal point, bold contrast, a clear readable title.
- Use ONLY these fonts for the words (they are the fonts my software has): ${list}.
- Spell the title, subtitle and author name exactly as written above.

Please give me THREE things, in this order:

1. The finished front cover, with the title, subtitle and author name on it.

2. The SAME picture again with ALL words removed: no title, no subtitle, no author name, no letters at all. Keep everything else the same and fill the places where the words were with the background.

3. This design card, filled in exactly in this format (one line each, colours as #hex codes):

GAZBOOK DESIGN CARD
TITLE: font=…; weight=…; colour=#……; position=top|middle|bottom; align=center|left|right; case=upper|title; size=small|medium|large|huge; spacing=tight|normal|wide; effect=none|shadow|glow|outline
SUBTITLE: font=…; weight=…; style=normal|italic; colour=#……; case=upper|title|normal; size=small|medium; spacing=tight|normal|wide
AUTHOR: font=…; weight=…; colour=#……; position=top|bottom; case=upper|title; size=small|medium|large; spacing=tight|normal|wide
BACK: background=#……; text=#……; accent=#……
`;
}

// ---------------------------------------------------------------- reading the card

const squash = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const WORD_WEIGHT = { thin: 100, light: 300, regular: 400, normal: 400, book: 400, medium: 500, semibold: 600, demibold: 600, bold: 700, extrabold: 800, heavy: 800, black: 900 };

// The nearest font GazBook has, with the nearest weight it carries.
function matchFont(name, weightWanted, styleWanted) {
  const fam = fonts().families;
  const want = squash(name);
  let family = Object.keys(fam).find((f) => squash(f) === want)
    || Object.keys(fam).find((f) => want && (want.includes(squash(f)) || squash(f).includes(want)));
  if (!family) { // unknown font: pick one of the same kind
    const n = String(name || '').toLowerCase();
    family = /script|hand|brush|callig/.test(n) ? 'Great Vibes'
      : /condensed|narrow|bebas|impact|league gothic/.test(n) ? 'Bebas Neue'
        : /sans|grotesk|helvetica|arial|gotham|futura|inter|roboto|open/.test(n) ? 'Montserrat'
          : /trajan|roman|capital/.test(n) ? 'Cinzel' : 'Playfair Display';
  }
  const faces = fonts().faces.filter((f) => f.family === family);
  const italic = styleWanted === 'italic' && faces.some((f) => f.style === 'italic');
  const usable = [...new Set(faces.filter((f) => f.style === (italic ? 'italic' : 'normal')).map((f) => f.weight))];
  const w = weightWanted || 700;
  const weight = usable.sort((a, b) => Math.abs(a - w) - Math.abs(b - w))[0] || 400;
  return { family, weight, style: italic ? 'italic' : 'normal', known: squash(family) === want };
}

function readLine(text, label) {
  const m = new RegExp(`^\\s*[*#\\-\\s]*${label}\\s*[:\\-–]\\s*(.+)$`, 'im').exec(text);
  if (!m) return null;
  const o = {};
  for (const part of m[1].replace(/\*\*/g, '').split(/[;|]|,(?=\s*[a-z]+\s*[=:])/i)) {
    const kv = /^\s*([a-z ]+?)\s*[=:]\s*(.+?)\s*$/i.exec(part);
    if (kv) o[kv[1].toLowerCase().replace(/\s+/g, '').replace('color', 'colour')] = kv[2].trim();
  }
  return o;
}
const NAMED = { white: '#ffffff', black: '#111111', gold: '#d4af37', golden: '#d4af37', cream: '#f5ecd7', ivory: '#fffff0', silver: '#c0c0c0', grey: '#9e9e9e', gray: '#9e9e9e', red: '#c62828', crimson: '#b0122b', navy: '#14213d', blue: '#1e4b8f', yellow: '#f4c430', orange: '#e8731a', green: '#2e7d4f', purple: '#5b2a86', brown: '#6b4226', beige: '#e8dcc4', teal: '#127a7a' };
const hex = (v) => {
  const m = /#([0-9a-f]{6}|[0-9a-f]{3})\b/i.exec(v || '') || /\b([0-9a-f]{6})\b/i.exec(v || '');
  if (m) return `#${m[1]}`;
  const w = Object.keys(NAMED).find((k) => new RegExp(`\\b${k}\\b`, 'i').test(v || ''));
  return w ? NAMED[w] : null;
};
const pick = (v, allowed, dflt) => { const s = String(v || '').toLowerCase(); return allowed.find((a) => s.includes(a)) || dflt; };
function weightOf(v) {
  if (!v) return null;
  const n = parseInt(v, 10);
  if (n >= 100 && n <= 900) return n;
  return WORD_WEIGHT[squash(v)] || null;
}

function element(o, defaults) {
  if (!o) return null;
  const style = /italic/i.test(`${o.style || ''} ${o.weight || ''}`) ? 'italic' : 'normal';
  const f = matchFont(o.font, weightOf(o.weight), style);
  return {
    font: f.family, weight: f.weight, style: f.style, fontKnown: f.known, asked: o.font || '',
    colour: hex(o.colour) || defaults.colour,
    position: pick(o.position, ['top', 'middle', 'bottom'], defaults.position),
    align: pick(o.align, ['center', 'left', 'right'], 'center'),
    case: pick(o.case, ['upper', 'title', 'normal', 'lower'], defaults.case),
    size: pick(o.size, ['small', 'medium', 'large', 'huge'], defaults.size),
    spacing: pick(o.spacing || o.letterspacing, ['tight', 'normal', 'wide'], 'normal'),
    effect: pick(o.effect, ['shadow', 'glow', 'outline', 'none'], 'shadow'),
  };
}

// The pasted design card → a design GazBook can draw, or null if nothing usable.
function readCard(text) {
  const t = String(text || '');
  const title = element(readLine(t, 'title'), { colour: '#ffffff', position: 'top', case: 'title', size: 'large' });
  if (!title) return null;
  const sub = element(readLine(t, 'sub-?title'), { colour: title.colour, position: title.position, case: 'normal', size: 'small' });
  const author = element(readLine(t, 'author'), { colour: title.colour, position: 'bottom', case: 'upper', size: 'medium' });
  const back = readLine(t, 'back') || {};
  return {
    title, subtitle: sub, author: author || { ...title, position: 'bottom', size: 'medium', case: 'upper' },
    back: { bg: hex(back.background || back.bg), ink: hex(back.text || back.ink), accent: hex(back.accent) },
  };
}

// In plain words, so the author can see GazBook understood the card.
function describe(d) {
  if (!d) return '';
  const one = (label, e) => (e ? `${label}: ${e.font}${e.fontKnown ? '' : ` (closest to "${e.asked}")`}, ${e.colour}, ${e.position || ''}`.replace(/, $/, '') : '');
  return [one('Title', d.title), one('Subtitle', d.subtitle), one('Author', d.author), d.back.bg ? `Back: ${d.back.bg}` : ''].filter(Boolean).join(' · ');
}

// @font-face rules for the fonts a design uses.
function fontFaceCss(design, toUrl) {
  if (!design) return '';
  const used = new Set([design.title, design.subtitle, design.author].filter(Boolean).map((e) => e.font));
  return fonts().faces.filter((f) => used.has(f.family)).map((f) => `@font-face{font-family:"${f.family}";font-style:${f.style};font-weight:${f.weight};src:url("${toUrl(path.join(FONT_DIR, f.file))}") format("woff2");unicode-range:${f.range}}`).join('\n');
}

module.exports = { designRequest, readCard, matchFont, describe, fontFaceCss, fonts };
