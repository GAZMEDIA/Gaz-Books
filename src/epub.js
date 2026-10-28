// EPUB 3 ebook for Kindle (KDP) and other stores: reflowable text, a
// contents page and landmarks, Kindle-safe drop caps, optional cover.
const crypto = require('crypto');
const JSZip = require('jszip');
const { splitChapterTitle } = require('./pdf');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function runsHtml(runs) {
  return runs.map((r) => {
    let t = esc(r.text);
    if (r.i) t = `<i>${t}</i>`;
    if (r.b) t = `<b>${t}</b>`;
    return t;
  }).join('');
}

// Drop cap: a floated span, which Kindle renders reliably (::first-letter is not).
function dropCapHtml(runs) {
  const first = runs[0];
  const m = first && /^([“‘"'(«]?)(\p{L})/u.exec(first.text);
  if (!m) return runsHtml(runs);
  const rest = [{ ...first, text: first.text.slice(m[0].length) }, ...runs.slice(1)];
  // Keep the rest of the first word with the letter so readers do not split it.
  const wordEnd = /^\S*/.exec(rest[0].text)[0];
  rest[0] = { ...rest[0], text: rest[0].text.slice(wordEnd.length) };
  return `<span class="dropcap">${esc(m[0])}</span><span class="lead">${esc(wordEnd)}</span>${runsHtml(rest)}`;
}

const CSS = `@charset "utf-8";
body { margin: 0; padding: 0; }
p { margin: 0; text-indent: 1.2em; text-align: justify; line-height: 1.4; }
p.first, p.noindent, p.list { text-indent: 0; }
p.quote { margin: 0.6em 1.5em; text-indent: 0; }
h1 { text-align: center; font-weight: normal; margin: 3em 0 2em 0; page-break-before: always; line-height: 1.3; }
h1 .label { display: block; font-size: 0.6em; letter-spacing: 0.2em; text-transform: uppercase; margin-bottom: 0.6em; }
h2 { text-align: center; font-size: 1em; font-weight: bold; margin: 1.5em 0 1em 0; }
.scene { text-align: center; text-indent: 0; margin: 1em 0; }
.dropcap { float: left; font-size: 3.3em; line-height: 0.85; margin: 0.04em 0.08em 0 0; padding: 0; }
.lead { text-transform: uppercase; letter-spacing: 0.05em; }
.titlepage { text-align: center; margin-top: 25%; }
.titlepage h1 { page-break-before: auto; font-size: 2em; margin: 0 0 0.5em 0; }
.titlepage .sub { font-style: italic; font-size: 1.1em; text-indent: 0; text-align: center; }
.titlepage .author { margin-top: 3em; letter-spacing: 0.15em; text-transform: uppercase; text-indent: 0; text-align: center; }
.copyright p { font-size: 0.8em; text-indent: 0; text-align: left; margin-bottom: 0.8em; }
.dedication { text-align: center; font-style: italic; margin-top: 30%; text-indent: 0; }
.figure { text-align: center; text-indent: 0; margin: 1em 0; }
.figure img { max-width: 100%; }
nav ol { list-style-type: none; padding-left: 0; }
nav li { margin: 0.4em 0; }
@media amzn-kf8 { .dropcap { font-size: 3.2em; line-height: 0.8; margin-top: 0.06em; } }
@media amzn-mobi { .dropcap { float: none; font-size: 2em; } }
`;

function xhtml(title, lang, body, extraNs = '') {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"${extraNs} lang="${lang}" xml:lang="${lang}">
<head><meta charset="utf-8"/><title>${esc(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`;
}

async function makeEpub(book, opts = {}) {
  const lang = opts.lang || 'en';
  const dir = opts.rtl ? ' dir="rtl"' : '';
  const title = book.title || 'Untitled';
  const id = `urn:uuid:${crypto.randomUUID()}`;
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`);
  const files = []; // { id, href, type, props, spine, linear }
  const add = (fid, href, content, type = 'application/xhtml+xml', props = '', spine = true) => {
    zip.file(`OEBPS/${href}`, content);
    files.push({ id: fid, href, type, props, spine });
  };
  zip.file('OEBPS/style.css', CSS);
  files.push({ id: 'css', href: 'style.css', type: 'text/css', spine: false });

  let coverHtml = null;
  if (opts.cover) {
    const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(opts.cover);
    if (m) {
      const ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpg';
      zip.file(`OEBPS/images/cover.${ext}`, Buffer.from(m[2], 'base64'));
      files.push({ id: 'cover-image', href: `images/cover.${ext}`, type: ext === 'png' ? 'image/png' : 'image/jpeg', props: 'cover-image', spine: false });
      coverHtml = xhtml('Cover', lang, `<div style="text-align:center;margin:0;padding:0"><img src="images/cover.${ext}" alt="${esc(title)}" style="max-width:100%;height:100%"/></div>`);
    }
  }
  if (coverHtml) add('cover', 'cover.xhtml', coverHtml);

  add('titlepage', 'titlepage.xhtml', xhtml(title, lang, `<section class="titlepage" epub:type="titlepage"${dir}>
<h1>${esc(title)}</h1>
${book.subtitle ? `<p class="sub">${esc(book.subtitle)}</p>` : ''}
${book.author ? `<p class="author">${esc(book.author)}</p>` : ''}
</section>`));

  const year = opts.year || new Date().getFullYear();
  add('copyright', 'copyright.xhtml', xhtml('Copyright', lang, `<section class="copyright" epub:type="copyright-page"${dir}>
<p>Copyright © ${year} ${esc(book.author || '')}</p>
<p>All rights reserved.</p>
<p>No part of this book may be reproduced in any form without written permission from the author, except for brief quotations in reviews.</p>
${opts.isbn ? `<p>ISBN: ${esc(opts.isbn)}</p>` : ''}
${opts.copyrightExtra ? String(opts.copyrightExtra).split('\n').map((l) => `<p>${esc(l)}</p>`).join('\n') : ''}
</section>`));

  if (opts.dedication) add('dedication', 'dedication.xhtml', xhtml('Dedication', lang, `<section epub:type="dedication"${dir}><p class="dedication">${esc(opts.dedication)}</p></section>`));

  const navItems = [];
  let imgN = 0;
  book.chapters.forEach((ch, i) => {
    const href = `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;
    const t = splitChapterTitle(ch.title || '');
    const heading = ch.title ? `<h1>${t.label ? `<span class="label">${esc(t.label)}</span>` : ''}${esc(t.name)}</h1>` : '';
    const parts = [];
    let afterBreak = true;
    let dropDone = opts.dropCaps === false;
    for (const b of ch.blocks) {
      if (b.type === 'break') { parts.push('<p class="scene">* * *</p>'); afterBreak = true; continue; }
      if (b.type === 'h2') { parts.push(`<h2>${runsHtml(b.runs)}</h2>`); afterBreak = true; continue; }
      if (b.type === 'img') {
        const m = /^data:image\/(png|jpe?g|gif);base64,(.*)$/i.exec(b.src || '');
        if (!m) continue;
        const ext = m[1].toLowerCase().replace('jpeg', 'jpg');
        const name = `images/img${++imgN}.${ext}`;
        zip.file(`OEBPS/${name}`, Buffer.from(m[2], 'base64'));
        files.push({ id: `img${imgN}`, href: name, type: ext === 'jpg' ? 'image/jpeg' : `image/${ext}`, spine: false });
        parts.push(`<p class="figure"><img src="${name}" alt=""/></p>`);
        afterBreak = true;
        continue;
      }
      if (b.type === 'quote') { parts.push(`<p class="quote">${runsHtml(b.runs)}</p>`); continue; }
      const cls = b.list ? 'list' : (afterBreak ? 'first' : '');
      const inner = !dropDone ? dropCapHtml(b.runs) : runsHtml(b.runs);
      dropDone = true;
      parts.push(`<p${cls ? ` class="${cls}"` : ''}>${inner}</p>`);
      afterBreak = false;
    }
    add(`ch${i + 1}`, href, xhtml(ch.title || title, lang, `<section epub:type="chapter"${dir}>\n${heading}\n${parts.join('\n')}\n</section>`));
    navItems.push({ href, label: ch.title || `${i + 1}` });
  });

  const contentsLabel = opts.labels?.contents || 'Contents';
  const firstChapter = navItems[0]?.href || 'titlepage.xhtml';
  const nav = xhtml(contentsLabel, lang, `<nav epub:type="toc" id="toc"${dir}>
<h1 style="page-break-before:auto">${esc(contentsLabel)}</h1>
<ol>
${navItems.map((n) => `<li><a href="${n.href}">${esc(n.label)}</a></li>`).join('\n')}
</ol>
</nav>
<nav epub:type="landmarks" hidden="">
<ol>
${coverHtml ? '<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>' : ''}
<li><a epub:type="toc" href="nav.xhtml">${esc(contentsLabel)}</a></li>
<li><a epub:type="bodymatter" href="${firstChapter}">Start</a></li>
</ol>
</nav>`);
  // Contents goes after the copyright page, before chapter one.
  zip.file('OEBPS/nav.xhtml', nav);
  const navEntry = { id: 'nav', href: 'nav.xhtml', type: 'application/xhtml+xml', props: 'nav', spine: true };
  const firstCh = files.findIndex((f) => f.id === 'ch1');
  files.splice(firstCh === -1 ? files.length : firstCh, 0, navEntry);

  // Older Kindle and Apple readers still look for toc.ncx.
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${id}"/></head>
<docTitle><text>${esc(title)}</text></docTitle>
<navMap>
${navItems.map((n, i) => `<navPoint id="np${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(n.label)}</text></navLabel><content src="${n.href}"/></navPoint>`).join('\n')}
</navMap>
</ncx>`);
  files.push({ id: 'ncx', href: 'toc.ncx', type: 'application/x-dtbncx+xml', spine: false });

  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}"${opts.rtl ? ' dir="rtl"' : ''}>
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${id}</dc:identifier>
<dc:title>${esc(title)}</dc:title>
${book.author ? `<dc:creator id="creator">${esc(book.author)}</dc:creator>\n<meta refines="#creator" property="role" scheme="marc:relators">aut</meta>` : ''}
<dc:language>${lang}</dc:language>
${opts.isbn ? `<dc:source>urn:isbn:${esc(opts.isbn.replace(/[^0-9Xx]/g, ''))}</dc:source>` : ''}
<dc:rights>Copyright © ${year} ${esc(book.author || '')}</dc:rights>
<meta property="dcterms:modified">${modified}</meta>
${opts.cover ? '<meta name="cover" content="cover-image"/>' : ''}
</metadata>
<manifest>
${files.map((f) => `<item id="${f.id}" href="${f.href}" media-type="${f.type}"${f.props ? ` properties="${f.props}"` : ''}/>`).join('\n')}
</manifest>
<spine toc="ncx"${opts.rtl ? ' page-progression-direction="rtl"' : ''}>
${files.filter((f) => f.spine).map((f) => `<itemref idref="${f.id}"${f.id === 'cover' ? ' linear="yes"' : ''}/>`).join('\n')}
</spine>
</package>`;
  zip.file('OEBPS/content.opf', opf);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', mimeType: 'application/epub+zip' });
}

module.exports = { makeEpub };
