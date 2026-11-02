// Paperback cover maker. Uses the same sums as Amazon KDP's cover calculator
// (https://kdp.amazon.com/cover-calculator): full cover = back + spine + front
// + 0.125" bleed all round, spine = pages x paper thickness.
// The cover is laid out as HTML; the app prints it to an exact-size PDF.
const path = require('path');
const { pathToFileURL } = require('url');
const { TRIM_SIZES } = require('./kdp');

const BLEED = 0.125;
const PAPER = {
  white: { name: 'Black ink, white paper', inch: 0.002252 },
  cream: { name: 'Black ink, cream paper', inch: 0.0025 },
  'color-standard': { name: 'Standard colour, white paper', inch: 0.002252 },
  'color-premium': { name: 'Premium colour, white paper', inch: 0.002347 },
};
const SPINE_TEXT_MIN_PAGES = 79; // KDP: spine text only for books over 79 pages
const BARCODE = { w: 2, h: 1.2 };

function coverSize({ trim = '6x9', pages = 200, paper = 'white' }) {
  const [tw, th] = TRIM_SIZES[trim] || TRIM_SIZES['6x9'];
  const p = PAPER[paper] || PAPER.white;
  const n = Math.max(24, Math.round(pages / 2) * 2); // KDP counts an even number of pages
  const spine = n * p.inch;
  const width = BLEED + tw + spine + tw + BLEED;
  const height = BLEED + th + BLEED;
  const r = (x) => Math.round(x * 1000) / 1000;
  return {
    trim, trimW: tw, trimH: th, pages: n, paper, paperName: p.name,
    spine: r(spine), width: r(width), height: r(height), bleed: BLEED,
    spineText: n >= SPINE_TEXT_MIN_PAGES,
    back: { x: 0, w: BLEED + tw },
    spineBox: { x: BLEED + tw, w: spine },
    front: { x: BLEED + tw + spine, w: tw + BLEED },
    // Pixels needed for a sharp print at 300 DPI.
    px: { w: Math.ceil(width * 300), h: Math.ceil(height * 300), frontW: Math.ceil((tw + BLEED) * 300) },
  };
}

// KDP US print cost and royalty for black-ink paperbacks (estimate; KDP shows the exact figure).
function printEstimate({ trim = '6x9', pages = 200, listPrice = 0 }) {
  const [tw, th] = TRIM_SIZES[trim] || TRIM_SIZES['6x9'];
  const large = tw > 6.12 || th > 9;
  const cost = pages <= 108 ? (large ? 2.84 : 2.30) : 1.00 + pages * (large ? 0.017 : 0.012);
  const rate = listPrice >= 9.99 ? 0.6 : 0.5;
  const royalty = listPrice ? Math.max(0, listPrice * rate - cost) : 0;
  const r2 = (x) => Math.round(x * 100) / 100;
  return { printCost: r2(cost), royaltyRate: rate, royalty: r2(royalty), minPrice: r2(cost / 0.6) };
}

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const paras = (s) => String(s || '').split(/\n\s*\n|\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join('');

const STYLES = {
  classic: { title: 'Abril', body: 'Crimson', titleCase: 'none', spacing: '0' },
  modern: { title: 'Bebas', body: 'Noto', titleCase: 'uppercase', spacing: '0.03em' },
  elegant: { title: 'Crimson', body: 'Crimson', titleCase: 'uppercase', spacing: '0.12em' },
};

// The words of a design card (see src/cover-design.js) as CSS.
function designCss(D, s) {
  const W = s.trimW;
  const sizes = { title: { small: 0.075, medium: 0.095, large: 0.12, huge: 0.15 }, sub: { small: 0.036, medium: 0.046, large: 0.056, huge: 0.066 }, author: { small: 0.036, medium: 0.046, large: 0.06, huge: 0.07 } };
  const spacing = { tight: '-0.01em', normal: '0.01em', wide: '0.14em' };
  const cases = { upper: 'uppercase', lower: 'lowercase', title: 'none', normal: 'none' };
  const effect = (e) => ({
    shadow: 'text-shadow:0 0.02in 0.09in rgba(0,0,0,.6)',
    glow: `text-shadow:0 0 0.12in ${e.colour}aa,0 0.02in 0.08in rgba(0,0,0,.5)`,
    outline: '-webkit-text-stroke:0.012in rgba(0,0,0,.7);paint-order:stroke fill;text-shadow:0 0.02in 0.06in rgba(0,0,0,.45)',
    none: 'text-shadow:none',
  }[e.effect] || 'text-shadow:0 0.02in 0.09in rgba(0,0,0,.6)');
  const rule = (sel, e, kind) => `${sel}{font-family:"${e.font}",serif;font-weight:${e.weight};font-style:${e.style};color:${e.colour};font-size:${(sizes[kind][e.size] || sizes[kind].medium) * W}in;letter-spacing:${spacing[e.spacing] || spacing.normal};text-transform:${cases[e.case] || 'none'};text-align:${e.align || 'center'};line-height:1.05;${effect(e)}}`;
  return [
    `.lay{position:absolute;left:0.35in;right:${BLEED + 0.35}in;top:${BLEED + 0.5}in;bottom:${BLEED + 0.45}in;display:flex;flex-direction:column;overflow:hidden}`,
    '.g-top,.g-bot{flex:0 0 auto}.g-mid{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;min-height:0}',
    rule('.lay h1', D.title, 'title'), '.lay h1{font-size-adjust:none}',
    D.subtitle ? rule('.lay h2', D.subtitle, 'sub') : '', '.lay h2{margin-top:0.16in;line-height:1.2}',
    rule('.lay .da', D.author, 'author'), '.lay .da{margin:0.1in 0}',
  ].join('\n');
}

// spec: { size, title, subtitle, author, tagline, blurb, bio, authorPhoto (data URL), image (file path or data URL),
//         imageMode: 'wrap' | 'front', bg, ink, style, guides,
//         design (from a Gemini design card: fonts, colours, places; src/cover-design.js) }
function coverHtml(spec) {
  const s = spec.size;
  const st = STYLES[spec.style] || STYLES.classic;
  const D = spec.design || null;
  const fontDir = path.join(__dirname, '..', 'fonts');
  const font = (name, file) => `@font-face{font-family:${name};src:url("${pathToFileURL(path.join(fontDir, file)).href}")}`;
  const img = spec.image ? (spec.image.startsWith('data:') ? spec.image : pathToFileURL(spec.image).href) : '';
  const bg = (D && D.back.bg) || spec.bg || '#1d2433';
  const ink = (D && D.back.ink) || spec.ink || '#ffffff';
  const wrap = spec.imageMode !== 'front';
  const safe = BLEED + 0.25; // keep words well inside the trim
  const spineWords = s.spineText ? `${esc(spec.title)}<span class="sep"></span>${esc(spec.author)}` : '';
  const guides = spec.guides ? `
<div class="g" style="left:${BLEED}in;top:${BLEED}in;right:${BLEED}in;bottom:${BLEED}in;border:1px dashed #f0f"></div>
<div class="g" style="left:${s.spineBox.x}in;width:${s.spine}in;top:0;bottom:0;border-left:1px dashed #0ff;border-right:1px dashed #0ff"></div>
<div class="g" style="left:${safe}in;top:${safe}in;width:${s.trimW - 0.5}in;bottom:${safe}in;border:1px dotted #ff0"></div>
<div class="g" style="left:${s.front.x + 0.25}in;top:${safe}in;width:${s.trimW - 0.5}in;bottom:${safe}in;border:1px dotted #ff0"></div>` : '';

  return `<!doctype html><html><head><meta charset="utf-8"><style>
${font('Abril', 'AbrilFatface-Regular.ttf')}${font('Bebas', 'BebasNeue-Regular.ttf')}
${font('Crimson', 'CrimsonText-Regular.ttf')}@font-face{font-family:Crimson;font-style:italic;src:url("${pathToFileURL(path.join(fontDir, 'CrimsonText-Italic.ttf')).href}")}
${font('Noto', 'NotoSerif-Regular.ttf')}
${D ? require('./cover-design').fontFaceCss(D, (f) => pathToFileURL(f).href) : ''}
@page{size:${s.width}in ${s.height}in;margin:0}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${s.width}in;height:${s.height}in;overflow:hidden;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{position:relative;background:${bg};color:${ink};font-family:${st.body},serif}
.art{position:absolute;top:0;bottom:0;background:url("${img}") center/cover no-repeat}
.panel{position:absolute;top:0;bottom:0}
.front .shade{position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,0) 38%,rgba(0,0,0,0) 62%,rgba(0,0,0,.6) 100%)}
.front .t{position:absolute;left:0.4in;right:${BLEED + 0.4}in;top:${BLEED + 0.7}in;text-align:center}
.front h1{font-family:${st.title},serif;font-weight:normal;font-size:${Math.min(0.62, s.trimW * 0.105)}in;line-height:1.05;text-transform:${st.titleCase};letter-spacing:${st.spacing};text-shadow:0 0.02in 0.08in rgba(0,0,0,.5)}
.front h2{font-style:italic;font-weight:normal;font-size:${Math.min(0.24, s.trimW * 0.042)}in;margin-top:0.18in;text-shadow:0 0.01in 0.05in rgba(0,0,0,.6)}
.front .a{position:absolute;left:0.4in;right:${BLEED + 0.4}in;bottom:${BLEED + 0.6}in;text-align:center;font-family:${st.title},serif;font-size:${Math.min(0.3, s.trimW * 0.05)}in;letter-spacing:.14em;text-transform:uppercase;text-shadow:0 0.01in 0.05in rgba(0,0,0,.6)}
.spine{display:flex;align-items:center;justify-content:center;overflow:hidden}
.spine .w{writing-mode:vertical-rl;white-space:nowrap;font-family:${st.title},serif;font-size:${Math.max(0.08, Math.min(0.3, (s.spine - 0.125) * 0.62))}in;letter-spacing:.08em;text-transform:uppercase}
.spine .sep{display:inline-block;height:0.35in}
.back .box{position:absolute;left:${safe}in;right:${0.25}in;top:${safe}in;max-height:${(s.height - safe - (BLEED + 0.25 + BARCODE.h + 0.2)).toFixed(3)}in;overflow:hidden;background:${wrap && img ? 'rgba(0,0,0,.42)' : 'transparent'};padding:0.28in 0.3in;border-radius:0.04in}
.back .tag{font-family:${st.title},serif;font-size:${Math.min(0.26, s.trimW * 0.045)}in;line-height:1.15;margin-bottom:0.16in;text-transform:${st.titleCase === 'uppercase' ? 'uppercase' : 'none'}}
.back .blurb p{font-size:${s.trimW < 5.6 ? 10.5 : 11.5}pt;line-height:1.38;margin-bottom:0.09in;text-align:justify}
.back .bio{margin-top:0.18in;font-style:italic;font-size:${s.trimW < 5.6 ? 9 : 10}pt;line-height:1.35;opacity:.9;overflow:hidden}
.back .bio .ap{float:left;width:0.85in;height:0.85in;object-fit:cover;border-radius:50%;margin:0.02in 0.16in 0.06in 0;border:0.03in solid ${ink}}
.barcode{position:absolute;right:0.25in;bottom:${BLEED + 0.25}in;width:${BARCODE.w}in;height:${BARCODE.h}in;background:#fff;color:#999;font:8pt sans-serif;display:flex;align-items:center;justify-content:center}
.g{position:absolute;pointer-events:none}
${D ? designCss(D, s) : ''}
${D ? `.spine .w{font-family:"${D.title.font}",serif;font-weight:${D.title.weight};color:${D.back.accent || D.title.colour}}
.back .tag{font-family:"${D.title.font}",serif;font-weight:${D.title.weight};color:${D.back.accent || D.title.colour};text-transform:none}` : ''}
</style></head><body>
${img && wrap ? `<div class="art" style="left:0;right:0"></div>` : ''}
${img && !wrap ? `<div class="art" style="left:${s.front.x}in;width:${s.front.w}in"></div>` : ''}
<div class="panel back" style="left:0;width:${s.back.w}in">
  <div class="box">${spec.tagline ? `<div class="tag">${esc(spec.tagline)}</div>` : ''}<div class="blurb">${paras(spec.blurb)}</div>${spec.bio || spec.authorPhoto ? `<div class="bio">${spec.authorPhoto ? `<img class="ap" src="${spec.authorPhoto}" alt="">` : ''}${paras(spec.bio)}</div>` : ''}</div>
  <div class="barcode">${spec.guides ? 'Barcode area (KDP adds it)' : ''}</div>
</div>
<div class="panel spine" style="left:${s.spineBox.x}in;width:${s.spine}in">${spineWords ? `<div class="w">${spineWords}</div>` : ''}</div>
<div class="panel front" style="left:${s.front.x}in;width:${s.front.w}in">
${D ? designedFront(spec, D) : `  ${img ? '<div class="shade"></div>' : ''}
  <div class="t"><h1>${esc(spec.title)}</h1>${spec.subtitle ? `<h2>${esc(spec.subtitle)}</h2>` : ''}</div>
  <div class="a">${esc(spec.author)}</div>`}
</div>
${guides}
<script>
// Longer languages (German runs about 30% longer than English): shrink the
// words a little at a time until they fit, so nothing is ever cut off.
(function () {
  function shrink(el, sel, ok, min) {
    if (!el) return;
    var parts = sel ? el.querySelectorAll(sel) : [el];
    for (var k = 0; k < 40 && !ok(); k++) {
      for (var i = 0; i < parts.length; i++) {
        var fs = parseFloat(getComputedStyle(parts[i]).fontSize);
        parts[i].style.fontSize = (fs * 0.95) + 'px';
      }
      if (parts.length && parseFloat(getComputedStyle(parts[0]).fontSize) < min) break;
    }
  }
  function fit() {
    var box = document.querySelector('.back .box');
    shrink(box, '.tag, .blurb p, .bio p', function () { return box.scrollHeight <= box.clientHeight + 1; }, 8);
    var h1 = document.querySelector('.front h1');
    var lh = h1 && parseFloat(getComputedStyle(h1).lineHeight);
    shrink(h1, '', function () { return h1.scrollWidth <= h1.clientWidth + 1 && h1.offsetHeight <= lh * 4.2; }, 14);
    var lay = document.querySelector('.lay');
    if (lay) { // a Gemini design: everything must fit on the front
      var au = lay.querySelector('.da');
      shrink(au, '', function () { return au.scrollWidth <= au.clientWidth + 1; }, 8);
      shrink(lay, 'h1, h2', function () { return lay.scrollHeight <= lay.clientHeight + 1; }, 10);
    }
    var sp = document.querySelector('.spine .w');
    shrink(sp, '', function () { return sp.scrollHeight <= sp.parentNode.clientHeight - 20; }, 6);
  }
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit); else window.addEventListener('load', fit);
})();
</script>
</body></html>`;
}

// The front words placed as the design card says: top, middle or bottom.
function designedFront(spec, D) {
  const titleBlock = `<div class="tb"><h1>${esc(spec.title)}</h1>${spec.subtitle ? `<h2>${esc(spec.subtitle)}</h2>` : ''}</div>`;
  const author = spec.author ? `<div class="da">${esc(spec.author)}</div>` : '';
  const tp = D.title.position || 'top';
  const ap = D.author.position === 'top' ? 'top' : 'bottom';
  const top = (ap === 'top' ? author : '') + (tp === 'top' ? titleBlock : '');
  const mid = tp === 'middle' ? titleBlock : '';
  const bot = (tp === 'bottom' ? titleBlock : '') + (ap === 'bottom' ? author : '');
  return `  <div class="lay"><div class="g-top">${top}</div><div class="g-mid">${mid}</div><div class="g-bot">${bot}</div></div>`;
}

// Ready-to-copy prompts for any AI picture maker (or ideas for a photo search).
function imagePrompts({ title, genre, mood, setting, details, size }) {
  const ratio = size ? `${size.width.toFixed(2)} x ${size.height.toFixed(2)} inches (about ${size.px.w} x ${size.px.h} pixels)` : 'a wide landscape shape';
  const frontRatio = size ? `${(size.front.w).toFixed(2)} x ${size.height.toFixed(2)} inches (portrait, about ${size.px.frontW} x ${size.px.h} pixels)` : 'a tall portrait shape';
  const what = [setting, details].filter(Boolean).join(', ') || 'a scene from the story';
  const g = genre || 'novel';
  const m = mood || 'atmospheric';
  return {
    wrap: `Book cover artwork for a ${g} called "${title}". ${what}. Mood: ${m}. One continuous wide image that wraps around a paperback: the right half is the front cover with a strong focal point and calm empty sky at the top for the title; the left half is the back cover with soft, low-detail texture so text can sit on it; the middle strip is the spine. Rich colour, cinematic light, high detail, print quality. No text, no letters, no watermark. Shape: ${ratio}.`,
    front: `Front cover illustration for a ${g} book "${title}". ${what}. Mood: ${m}. Strong single focal point in the lower two thirds, quiet space in the top third for the title and at the bottom for the author name. Cinematic light, high detail, print quality. No text, no letters, no watermark. Shape: ${frontRatio}.`,
    back: `Soft background texture for the back cover of a ${g} book "${title}", matching: ${what}. Mood: ${m}. Low detail and gentle contrast so a paragraph of text stays easy to read. No text, no letters. Portrait shape.`,
    search: [setting, g, m].filter(Boolean).join(' ').trim() || title,
  };
}

module.exports = { coverSize, coverHtml, imagePrompts, printEstimate, PAPER, BLEED, BARCODE, SPINE_TEXT_MIN_PAGES };
