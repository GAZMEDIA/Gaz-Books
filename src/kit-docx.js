// The "Amazon listing and checks" Word file that goes with each language:
// description, About the Book, keywords, categories, cover prompt, back
// cover words, every correction made and what is left for the author.
const JSZip = require('jszip');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const run = (text, { b, i, size, color } = {}) => {
  const p = [b && '<w:b/>', i && '<w:i/>', color && `<w:color w:val="${color}"/>`, size && `<w:sz w:val="${size * 2}"/><w:szCs w:val="${size * 2}"/>`].filter(Boolean).join('');
  return `<w:r>${p ? `<w:rPr>${p}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
};
// **bold** inside a line
const rich = (line, extra = {}) => line.split(/(\*\*[^*]+\*\*)/).filter(Boolean)
  .map((part) => (/^\*\*.*\*\*$/.test(part) ? run(part.slice(2, -2), { ...extra, b: true }) : run(part, extra))).join('');
const p = (inner, { after = 120, indent = 0, keep = false } = {}) => `<w:p><w:pPr>${keep ? '<w:keepNext/>' : ''}<w:spacing w:after="${after}"/>${indent ? `<w:ind w:left="${indent}" w:hanging="240"/>` : ''}</w:pPr>${inner}</w:p>`;

function body(blocks) {
  return blocks.map((b) => {
    if (b.h1) return p(run(b.h1, { b: true, size: 20, color: 'E8731A' }), { after: 200, keep: true });
    if (b.h2) return `<w:p><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/></w:pPr>${run(b.h2, { b: true, size: 14 })}</w:p>`;
    if (b.bullet) return p(run('•  ') + rich(b.bullet), { indent: 360, after: 60 });
    if (b.mono) return p(run(b.mono, { size: 9, color: '444444' }));
    if (b.note) return p(run(b.note, { i: true, color: '666666' }));
    return p(rich(b.text || ''));
  }).join('');
}

async function makeKitDocx(blocks) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults></w:styles>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body(blocks)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// Amazon's description box takes simple HTML: <b>, <ul><li>, <p>.
function descriptionHtml(text) {
  const out = []; let list = [];
  const inline = (s) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  const flush = () => { if (list.length) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join('')}</ul>`); list = []; } };
  for (const line of String(text).split('\n')) {
    const t = line.trim();
    if (!t) { flush(); continue; }
    if (/^[•\-*]\s+/.test(t) && !/^\*\*/.test(t)) { list.push(t.replace(/^[•\-*]\s+/, '')); continue; }
    flush(); out.push(`<p>${inline(t)}</p>`);
  }
  flush();
  return out.join('');
}

const textBlocks = (text) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
  .map((l) => (/^[•\-]\s+/.test(l) ? { bullet: l.replace(/^[•\-]\s+/, '') } : { text: l }));

// kit: { book, language, files, listing, metaWarnings, review, changes, fileChecks, back, picture, translated, copyrightNote }
function kitBlocks(k) {
  const name = [k.book.title, k.book.subtitle].filter(Boolean).join(': ');
  const B = [];
  B.push({ h1: `${name} (${k.language})` });
  B.push({ text: `By ${k.book.author || ''}. Everything you need to publish this edition on Amazon KDP.` });

  if (k.problems?.length) {
    B.push({ h2: 'Not finished this time' });
    for (const x of k.problems) B.push({ bullet: x });
  }
  B.push({ h2: 'Files in this folder' });
  for (const f of k.files) B.push({ bullet: `**${f.label}**: ${f.name}` });

  if (k.listing) {
    B.push({ h2: '1. Amazon book description (about 300 words)' });
    B.push({ note: 'Paste into KDP › Book details › Description. The KDP box keeps bold and bullet points; the HTML version is at the end of this file.' });
    B.push(...textBlocks(k.listing.description));
    B.push({ h2: '2. About the Book (about 100 words)' });
    B.push(...textBlocks(k.listing.aboutBook));
    B.push({ h2: `3. ${k.listing.keywords.length} Amazon keywords` });
    B.push({ note: 'KDP has 7 keyword boxes of up to 50 characters. Put 2 keywords in each box, separated by a space.' });
    k.listing.keywords.forEach((w, i) => B.push({ bullet: `${i + 1}. ${w}` }));
    B.push({ h2: `4. ${k.listing.categories.length} Amazon categories` });
    B.push({ note: 'Choose the 3 that fit best when you set up the book in KDP.' });
    k.listing.categories.forEach((c, i) => B.push({ bullet: `${i + 1}. ${c}` }));
    B.push({ h2: '5. Cover prompt (for AI picture makers)' });
    B.push({ text: k.listing.coverPrompt });
  }
  if (k.back) {
    B.push({ h2: '6. Back cover words' });
    if (k.back.tagline) B.push({ text: `**${k.back.tagline}**` });
    B.push(...textBlocks(k.back.blurb));
  }
  if (k.picture) {
    B.push({ h2: 'Cover picture' });
    B.push({ text: k.picture });
  }

  B.push({ h2: '7. Quality checks done by GazBook' });
  if (k.changes) {
    B.push({ text: `**Spelling, grammar and consistency:** ${k.changes.length} correction${k.changes.length === 1 ? '' : 's'} made and already applied to the files in this folder.` });
    const same = new Map();
    for (const c of k.changes) { const key = `${c.before}\u0000${c.after}`; same.set(key, { ...c, n: (same.get(key)?.n || 0) + 1 }); }
    const list = [...same.values()];
    for (const c of list.slice(0, 400)) B.push({ bullet: `“${c.before}” → “${c.after}”${c.why ? ` (${c.why})` : ''}${c.n > 1 ? `, ${c.n} times` : ''}` });
    if (list.length > 400) B.push({ note: `…and ${list.length - 400} more.` });
  }
  if (k.review && !k.review.missing) {
    const r = k.review;
    B.push({ text: `**Style kept the same throughout:** ${Object.values(r.styleSheet || {}).filter(Boolean).join('; ')}` });
    B.push({ text: r.explicitContent
      ? `**Content maturity: needs the adult content setting.** ${r.explicitDetail} In KDP, answer "Yes" to the sexually explicit content question, or Amazon may remove the book and warn your account.`
      : '**Content maturity:** no sexually explicit content found. You can answer "No" to the explicit content question in KDP.' });
    B.push({ text: `**Amazon content review:** ${r.issues.length ? 'please fix these before you upload:' : 'nothing found that Amazon is likely to flag (prohibited content, public-domain text, misleading claims).'}` });
    for (const i of r.issues) B.push({ bullet: `**${i.area}:** ${i.detail} ${i.fix ? `Fix: ${i.fix}` : ''}` });
    if (r.bibleTranslation || r.scripture.length) {
      B.push({ text: `**Scripture:** quotes look like ${r.bibleTranslation || 'a mix of translations'}. Name it on the copyright page and check its permission rules (most allow up to about 500 verses with a notice).` });
      for (const s of r.scripture) B.push({ bullet: `${s.reference}: ${s.problem}` });
      if (!r.scripture.length) B.push({ bullet: 'No problems found in the references that were checked.' });
    }
  }
  if (k.metaWarnings) {
    B.push({ text: `**Title, description and keywords (metadata):** ${k.metaWarnings.length ? '' : 'no words Amazon forbids.'}` });
    for (const w of k.metaWarnings) B.push({ bullet: w });
  }
  if (k.fileChecks) {
    B.push({ text: '**Files and formatting:**' });
    for (const o of k.fileChecks.ok) B.push({ bullet: `✓ ${o}` });
    for (const f of k.fileChecks.fix) B.push({ bullet: `⚠ ${f}` });
  }

  B.push({ h2: '8. Before you press Publish (only you can do these)' });
  const steps = [
    'Listen to the whole book once with text-to-speech (Word: Review › Read Aloud) to catch awkward sentences the checks cannot judge.',
    'Look through the corrections above. Undo any that change what you meant (open the Word file, make the change, and make the files again).',
    'Ask a second person to proofread; you stop seeing your own errors.',
    'eBook: open the EPUB in Kindle Previewer (free from Amazon) and page through it.',
    'Paperback: upload the PDFs in KDP and check every page in the online previewer, then order a printed proof copy and read it.',
  ];
  if (k.translated) {
    steps.splice(2, 0, `Have a native ${k.language} speaker read this translation. Machine translation can look fine but read unnaturally.`);
    if (/german|deutsch/i.test(k.language)) steps.splice(3, 0, 'German: check umlauts and ß, German quotation marks („…“), hyphenation, and Bible notation like "Jesaja 61,3–4" with a German Bible (e.g. Lutherbibel, Elberfelder) and its licence.');
  }
  steps.forEach((s, i) => B.push({ bullet: `${i + 1}. ${s}` }));

  if (k.listing) {
    B.push({ h2: 'Description as HTML (if KDP asks for it)' });
    B.push({ mono: descriptionHtml(k.listing.description) });
  }
  return B;
}

module.exports = { makeKitDocx, kitBlocks, descriptionHtml };
