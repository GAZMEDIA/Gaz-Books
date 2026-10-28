// Word (.docx) version set up for a KDP paperback: trim size, mirrored
// margins and gutter, chapters on right-hand pages, real Word drop caps,
// running heads, page numbers starting at chapter one, Heading 1 chapters
// (so Word and Kindle can build the contents).
const JSZip = require('jszip');
const { layoutSettings } = require('./kdp');
const { splitChapterTitle } = require('./pdf');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tw = (pt) => Math.round(pt * 20); // points to twips
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';

function run(text, { i, b, size, caps, spacing } = {}) {
  const props = [b && '<w:b/>', i && '<w:i/>', caps && '<w:caps/>', spacing && `<w:spacing w:val="${spacing}"/>`, size && `<w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/>`].filter(Boolean).join('');
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}
const runs = (rs, extra = {}) => rs.map((r) => run(r.text, { ...extra, i: r.i, b: r.b })).join('');
const para = (style, inner, pPrExtra = '') => `<w:p><w:pPr><w:pStyle w:val="${style}"/>${pPrExtra}</w:pPr>${inner}</w:p>`;
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
// Empty lines push text down the page (Word drops "space before" after a page break).
const blankLines = (n) => '<w:p><w:pPr><w:pStyle w:val="Spacer"/></w:pPr></w:p>'.repeat(Math.max(0, Math.round(n)));

function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xFF) { i++; continue; }
    const m = buf[i + 1];
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

async function makeDocx(book, opts = {}, pageCount = 200) {
  const s = layoutSettings(opts, pageCount);
  const font = opts.docxFont || 'Garamond';
  const size = s.size + 0.5; // Garamond runs small next to Crimson
  const lineTw = tw(s.leading);
  const zip = new JSZip();
  const media = [];
  let docPrId = 1;

  const imagePara = (src) => {
    const m = /^data:image\/(png|jpe?g);base64,(.*)$/i.exec(src || '');
    if (!m) return '';
    const buf = Buffer.from(m[2], 'base64');
    const dim = imageSize(buf);
    if (!dim) return '';
    const ext = m[1].toLowerCase() === 'png' ? 'png' : 'jpeg';
    const rid = `rIdImg${media.length + 1}`;
    const name = `image${media.length + 1}.${ext}`;
    media.push({ rid, name, buf });
    const maxW = (s.pageW - s.inside - s.outside) / 72; // inches
    let wIn = Math.min(maxW, dim.w / 96);
    let hIn = (dim.h / dim.w) * wIn;
    const maxH = (s.pageH - s.top - s.bottom) / 72 * 0.8;
    if (hIn > maxH) { hIn = maxH; wIn = (dim.w / dim.h) * hIn; }
    const cx = Math.round(wIn * 914400); const cy = Math.round(hIn * 914400);
    const id = docPrId++;
    return `<w:p><w:pPr><w:pStyle w:val="Figure"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  };

  const pg = `<w:pgSz w:w="${tw(s.pageW)}" w:h="${tw(s.pageH)}"/><w:pgMar w:top="${tw(s.top)}" w:right="${tw(s.outside)}" w:bottom="${tw(s.bottom)}" w:left="${tw(s.inside)}" w:header="${tw(s.top * 0.45)}" w:footer="${tw(s.bottom * 0.4)}" w:gutter="0"/>`;
  const frontSect = `<w:sectPr><w:type w:val="nextPage"/>${pg}</w:sectPr>`;
  const chapterSect = (first) => `<w:sectPr><w:headerReference w:type="default" r:id="rIdHOdd"/><w:headerReference w:type="even" r:id="rIdHEven"/><w:headerReference w:type="first" r:id="rIdHFirst"/><w:footerReference w:type="default" r:id="rIdF"/><w:footerReference w:type="even" r:id="rIdF"/><w:footerReference w:type="first" r:id="rIdF"/><w:type w:val="${opts.rectoChapters === false && !first ? 'nextPage' : 'oddPage'}"/>${pg}${first ? '<w:pgNumType w:start="1"/>' : ''}<w:titlePg/></w:sectPr>`;

  const body = [];
  // Title page
  const perPage = Math.floor((s.pageH - s.top - s.bottom) / s.leading);
  body.push(blankLines(perPage * 0.18));
  body.push(para('BookTitle', run(book.title || 'Untitled')));
  if (book.subtitle) body.push(para('BookSubtitle', run(book.subtitle)));
  if (book.author) body.push(para('BookAuthor', run(book.author)));
  body.push(pageBreak);
  // Copyright page (text sits at the bottom of the page)
  const year = opts.year || new Date().getFullYear();
  body.push(blankLines(perPage * 0.5));
  body.push(para('Copyright', run(`Copyright © ${year} ${book.author || ''}`.trim())));
  body.push(para('Copyright', run('All rights reserved.')));
  body.push(para('Copyright', run('No part of this book may be reproduced in any form without written permission from the author, except for brief quotations in reviews.')));
  if (opts.isbn) body.push(para('Copyright', run(`ISBN: ${opts.isbn}`)));
  if (opts.copyrightExtra) for (const l of String(opts.copyrightExtra).split('\n')) body.push(para('Copyright', run(l)));
  if (opts.dedication) {
    body.push(pageBreak);
    body.push(blankLines(perPage * 0.25));
    body.push(para('Dedication', run(opts.dedication, { i: true })));
  }
  if (opts.toc !== false && book.chapters.filter((c) => c.title).length > 1) {
    body.push(pageBreak);
    body.push(para('TOCHeading', run(opts.labels?.contents || 'Contents')));
    // A real Word contents field. Word fills in page numbers when the file opens.
    const entries = book.chapters.filter((c) => c.title).map((c) => para('TOC1', run(c.title)));
    entries[0] = entries[0].replace('<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>', '<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-1" \\h \\z </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>');
    entries[entries.length - 1] = entries[entries.length - 1].replace(/<\/w:p>$/, '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>');
    body.push(...entries);
  }
  // End of front matter section: put its sectPr on a final empty paragraph.
  body.push(`<w:p><w:pPr>${frontSect}</w:pPr></w:p>`);

  book.chapters.forEach((ch, ci) => {
    const t = splitChapterTitle(ch.title || '');
    if (t.label) body.push(para('ChapterLabel', run(t.label)));
    else body.push(para('Spacer', '', `<w:spacing w:before="${tw(s.pageH * 0.2)}"/>`));
    body.push(para('Heading1', run(t.name || ' ')));
    let afterBreak = true;
    let dropDone = opts.dropCaps === false;
    for (const b of ch.blocks) {
      if (b.type === 'break') { body.push(para('SceneBreak', run('*   *   *'))); afterBreak = true; continue; }
      if (b.type === 'h2') { body.push(para('Heading2', runs(b.runs))); afterBreak = true; continue; }
      if (b.type === 'img') { const p = imagePara(b.src); if (p) body.push(p); afterBreak = true; continue; }
      if (b.type === 'quote') { body.push(para('BlockQuote', runs(b.runs))); continue; }
      let rs = b.runs;
      if (!dropDone) {
        dropDone = true;
        const m = rs[0] && /^([“‘"'(«]?)(\p{L})/u.exec(rs[0].text);
        if (m) {
          // Word's own drop cap: a framed paragraph three lines tall.
          const dropSize = (s.leading * 2 + size * 0.68) / 0.68;
          body.push(`<w:p><w:pPr><w:pStyle w:val="BodyFirst"/><w:keepNext/><w:framePr w:dropCap="drop" w:lines="3" w:wrap="around" w:vAnchor="text" w:hAnchor="text"/><w:spacing w:after="0" w:line="${lineTw * 3 - 20}" w:lineRule="exact"/><w:textAlignment w:val="baseline"/></w:pPr><w:r><w:rPr><w:position w:val="${-Math.round(size * 0.35)}"/><w:sz w:val="${Math.round(dropSize * 2)}"/></w:rPr><w:t>${esc(m[0])}</w:t></w:r></w:p>`);
          rs = [{ ...rs[0], text: rs[0].text.slice(m[0].length) }, ...rs.slice(1)];
          body.push(para('BodyFirst', runs(rs)));
          afterBreak = false;
          continue;
        }
      }
      body.push(para(b.list ? 'BodyFirst' : (afterBreak ? 'BodyFirst' : 'Normal'), runs(rs)));
      afterBreak = false;
    }
    const last = ci === book.chapters.length - 1;
    if (!last) body.push(`<w:p><w:pPr>${chapterSect(ci === 0)}</w:pPr></w:p>`);
    else body.push(chapterSect(ci === 0));
  });
  if (!book.chapters.length) body.push(frontSect);

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${NS}><w:body>${body.join('')}</w:body></w:document>`;

  const pStyle = (id, name, pPr, rPr = '', extra = '') => `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${id}"><w:name w:val="${name}"/>${extra}<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}"/><w:sz w:val="${Math.round(size * 2)}"/><w:szCs w:val="${Math.round(size * 2)}"/><w:lang w:val="${opts.lang || 'en-US'}"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:after="0" w:line="${lineTw}" w:lineRule="exact"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:ind w:firstLine="${tw(s.size * 1.4)}"/><w:jc w:val="both"/></w:pPr></w:style>
${pStyle('BodyFirst', 'Body First', '<w:ind w:firstLine="0"/>')}
${pStyle('Heading1', 'heading 1', `<w:keepNext/><w:spacing w:before="0" w:after="${lineTw * 2}" w:line="${tw(30)}" w:lineRule="atLeast"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="0"/>`, `<w:sz w:val="${Math.round(Math.min(s.size * 1.9, 24) * 2)}"/>`, '<w:next w:val="BodyFirst"/>')}
${pStyle('ChapterLabel', 'Chapter Label', `<w:keepNext/><w:spacing w:before="${tw(s.pageH * 0.2)}" w:after="${lineTw}"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`, `<w:caps/><w:spacing w:val="40"/><w:sz w:val="${Math.round(size * 0.9 * 2)}"/>`)}
${pStyle('Heading2', 'heading 2', `<w:keepNext/><w:spacing w:before="${lineTw}" w:after="${lineTw}"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="1"/>`, '<w:b/>')}
${pStyle('SceneBreak', 'Scene Break', `<w:keepNext/><w:spacing w:before="${lineTw}" w:after="${lineTw}"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`)}
${pStyle('BlockQuote', 'Block Quote', `<w:spacing w:before="${lineTw / 2}" w:after="${lineTw / 2}"/><w:ind w:left="${tw(s.size * 2)}" w:right="${tw(s.size * 2)}" w:firstLine="0"/>`)}
${pStyle('Figure', 'Figure', `<w:spacing w:before="${lineTw / 2}" w:after="${lineTw / 2}" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`)}
${pStyle('Spacer', 'Spacer', '<w:ind w:firstLine="0"/>')}
${pStyle('BookTitle', 'Book Title', `<w:spacing w:after="${lineTw}" w:line="${tw(36)}" w:lineRule="atLeast"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`, '<w:sz w:val="56"/>')}
${pStyle('BookSubtitle', 'Book Subtitle', `<w:ind w:firstLine="0"/><w:jc w:val="center"/>`, '<w:i/><w:sz w:val="28"/>')}
${pStyle('BookAuthor', 'Book Author', `<w:spacing w:before="${tw(s.pageH * 0.25)}"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`, '<w:caps/><w:spacing w:val="40"/>')}
${pStyle('Copyright', 'Copyright', `<w:spacing w:after="120" w:line="240" w:lineRule="auto"/><w:ind w:firstLine="0"/><w:jc w:val="left"/>`, `<w:sz w:val="${Math.round(size * 0.85 * 2)}"/>`)}
${pStyle('Dedication', 'Dedication', '<w:ind w:firstLine="0"/><w:jc w:val="center"/>')}
${pStyle('TOCHeading', 'TOC Heading', `<w:spacing w:before="${tw(s.pageH * 0.1)}" w:after="${lineTw * 2}"/><w:ind w:firstLine="0"/><w:jc w:val="center"/>`, '<w:caps/><w:spacing w:val="40"/>')}
${pStyle('TOC1', 'toc 1', `<w:tabs><w:tab w:val="right" w:leader="none" w:pos="${tw(s.pageW - s.inside - s.outside)}"/></w:tabs><w:ind w:firstLine="0"/><w:jc w:val="left"/>`)}
${pStyle('RunningHead', 'Running Head', '<w:ind w:firstLine="0"/><w:jc w:val="center"/>', `<w:caps/><w:spacing w:val="24"/><w:sz w:val="${Math.round(size * 0.8 * 2)}"/>`)}
<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/></w:style>
</w:styles>`;

  const hdr = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr ${NS}>${inner}</w:hdr>`;
  const ftr = (inner) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr ${NS}>${inner}</w:ftr>`;
  zip.file('word/header1.xml', hdr(para('RunningHead', run(book.title || ''))));
  zip.file('word/header2.xml', hdr(para('RunningHead', run(book.author || book.title || ''))));
  zip.file('word/header3.xml', hdr('<w:p/>'));
  zip.file('word/footer1.xml', ftr(para('RunningHead', '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>')));

  zip.file('word/settings.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings ${NS}><w:mirrorMargins/><w:evenAndOddHeaders/><w:updateFields w:val="true"/><w:defaultTabStop w:val="720"/><w:autoHyphenation/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`);
  zip.file('word/document.xml', document);
  zip.file('word/styles.xml', styles);
  for (const m of media) zip.file(`word/media/${m.name}`, m.buf);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
<Relationship Id="rIdHOdd" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdHEven" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
<Relationship Id="rIdHFirst" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header3.xml"/>
<Relationship Id="rIdF" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
${media.map((m) => `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('\n')}
</Relationships>`);
  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`);
  zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(book.title || '')}</dc:title><dc:creator>${esc(book.author || '')}</dc:creator></cp:coreProperties>`);
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/header3.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

module.exports = { makeDocx };
