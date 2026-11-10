// The "Google Play Books" folder: every language edition ready for Google's
// Partner Center (play.google.com/books/publish), so putting the books there
// takes a few clicks. Google has no public upload API, so GazBook prepares
// everything and the author uploads.
//   - Books with an ISBN: files named the way Google wants (ISBN.epub, ISBN.jpg)
//     plus a filled-in book list, so every language goes up in one go
//     ("Upload book list", then "Upload files").
//   - Books without one: a folder per language with the eBook, the cover and
//     the details to copy into "Add book" (Google gives each one a free ID).
// Rules: support.google.com/books/partner/answer/3289689 and 3058975.
const fs = require('fs');
const path = require('path');

// Google's language codes (ISO 639-2/B)
const ISO3 = {
  en: 'eng', fr: 'fre', es: 'spa', de: 'ger', it: 'ita', pt: 'por', nl: 'dut', pl: 'pol', uk: 'ukr', da: 'dan',
  sv: 'swe', no: 'nor', fi: 'fin', is: 'ice', ga: 'gle', cy: 'wel', gd: 'gla', ca: 'cat', gl: 'glg', eu: 'baq',
  af: 'afr', lb: 'ltz', fy: 'fry', br: 'bre', oc: 'oci', la: 'lat', co: 'cos', rm: 'roh', ja: 'jpn', he: 'heb',
  yi: 'yid', ar: 'ara', hi: 'hin', gu: 'guj', mr: 'mar', ml: 'mal', ta: 'tam', fa: 'per',
};
// Google's subject codes (BISAC) for each kind of book
const BISAC = {
  faith: 'REL012120', romance: 'FIC027000', thriller: 'FIC031000', fantasy: 'FIC009000', business: 'BUS000000',
  selfhelp: 'SEL000000', children: 'JUV000000', memoir: 'BIO026000', health: 'HEA000000', fiction: 'FIC000000',
};
const PARTNER_CENTER = 'https://play.google.com/books/publish/';

const isbnOk = (s) => /^97[89]\d{10}$/.test(String(s || '').replace(/[-\s]/g, ''));
const html = (t) => String(t || '').trim().split(/\n\s*\n/).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>')}</p>`).join('');
const cell = (v) => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ');

// editions: from quick.js (code, name, dir, base, pages, files, words: { desc, bio }, title, subtitle, author)
// isbns: { en: '978…', fr: '978…' } (eBook ISBNs, optional)
// genres: [{ code, name }] (7, from src/genres.js); falls back to one code per kind of book
function writeGooglePlay(folder, editions, { genre, genres = [], isbns = {}, publisher = '' } = {}) {
  const list = genres.length ? genres : (BISAC[genre] ? [{ code: BISAC[genre], name: '' }] : []);
  const gp = path.join(folder, 'Google Play Books');
  fs.rmSync(gp, { recursive: true, force: true });
  fs.mkdirSync(gp, { recursive: true });
  const withIsbn = editions.filter((e) => isbnOk(isbns[e.code]));
  const without = editions.filter((e) => !isbnOk(isbns[e.code]));
  const today = new Date().toISOString().slice(0, 10);
  const find = (e, end) => e.files.find((f) => f.endsWith(end));

  // books with an ISBN: one folder of files + one book list for all of them
  if (withIsbn.length) {
    const up = path.join(gp, 'Books with ISBN - upload these files');
    fs.mkdirSync(up, { recursive: true });
    const head = ['Identifier', 'Enable for Sale?', 'Title', 'Subtitle', 'Book Format', 'Contributor [Role], Semicolon-Separated',
      'Biographical Note', 'Language', 'Subject Code [Schema], Semicolon-Separated', 'Age Group, Comma-Separated', 'Description',
      'Publication Date', 'Page Count', 'Publisher Name'];
    const rows = [head];
    for (const e of withIsbn) {
      const id = String(isbns[e.code]).replace(/[-\s]/g, '');
      fs.copyFileSync(find(e, 'Kindle.epub'), path.join(up, `${id}.epub`));
      const cover = find(e, 'Kindle cover.jpg');
      if (cover) fs.copyFileSync(cover, path.join(up, `${id}.jpg`));
      rows.push([id, 'Yes', e.title, e.subtitle, 'Digital', `${e.author} [Author]`, html(e.words.bio), ISO3[e.code] || e.code,
        list.map((g) => `${g.code} [BISAC]`).join('; '), genre === 'children' ? '3-8' : '18+', html(e.words.amazonDesc || e.words.desc), today, e.pages, publisher || e.author]);
    }
    // Google wants tab-separated text in UTF-16
    const tsv = rows.map((r) => r.map(cell).join('\t')).join('\r\n');
    fs.writeFileSync(path.join(gp, 'Book list (upload this first).tsv'), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(tsv, 'utf16le')]));
  }

  // books without an ISBN: a folder per language with what to copy into "Add book"
  for (const e of without) {
    const dir = path.join(gp, e.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(find(e, 'Kindle.epub'), path.join(dir, `${e.base} - ${e.name}.epub`));
    const cover = find(e, 'Kindle cover.jpg');
    if (cover) fs.copyFileSync(cover, path.join(dir, `${e.base} - ${e.name} - cover.jpg`));
    fs.writeFileSync(path.join(dir, 'Book details (copy into Google).txt'), [
      `GOOGLE PLAY BOOKS — ${e.name.toUpperCase()}`,
      '',
      `Title: ${e.title}`,
      e.subtitle ? `Subtitle: ${e.subtitle}` : null,
      `Author (Contributor, role "Author"): ${e.author}`,
      `Language: ${e.name}`,
      'Book format: Digital',
      list.length ? '' : null,
      list.length ? 'GENRES (on the "Genres" page: keep "BISAC (North America)", type the code, pick the matching name; press "+ Add a genre" for the next)' : null,
      ...list.map((g, i) => `${i + 1}. ${g.code}  ${g.name}`),
      `Page count: ${e.pages}`,
      '',
      'DESCRIPTION',
      e.words.amazonDesc || e.words.desc,
      '',
      e.words.bio ? 'ABOUT THE AUTHOR (Biographical note)' : null,
      e.words.bio || null,
    ].filter((l) => l !== null).join('\n'));
  }

  fs.writeFileSync(path.join(gp, 'How to put your books on Google Play.txt'), guide(withIsbn, without));
  return gp;
}

function guide(withIsbn, without) {
  const g = [
    'HOW TO PUT YOUR BOOKS ON GOOGLE PLAY BOOKS',
    '',
    `Go to ${PARTNER_CENTER} and sign in with your Google account.`,
    'The first time only: create your Partner Center account and add your payment and tax details (Google asks for these before books can go on sale).',
    '',
  ];
  if (withIsbn.length) {
    g.push(`BOOKS WITH AN ISBN (${withIsbn.map((e) => e.name).join(', ')}): all at once`,
      '1. Click "Book catalog".',
      '2. Click "Advanced" (top right), then "Upload book list". Choose the file "Book list (upload this first).tsv".',
      '3. Click "Advanced" again, then "Upload files". Choose ALL the files in the folder "Books with ISBN - upload these files".',
      '4. Open each book, click "Pricing" and add your price.',
      '5. Click "Publish". Google checks each book; this can take a few days.',
      '');
  }
  if (without.length) {
    g.push(`BOOKS WITHOUT AN ISBN (${without.map((e) => e.name).join(', ')}): one at a time, about 2 minutes each`,
      'For each language folder:',
      '1. Click "Book catalog", then "Add book".',
      '2. Choose to add an ebook, and when asked for an ISBN, pick the option for a book without one. Google gives it a free ID.',
      '3. Copy the details from "Book details (copy into Google).txt": title, author, language, description, and the 7 genres (Genres page).',
      '4. On the "Content" page, upload the .epub file and the cover .jpg from that folder.',
      '5. On the "Pricing" page, add your price. Then click "Publish".',
      '');
  }
  g.push('These books were translated with AI tools. If Google asks about AI-generated content, answer YES for the translations (and for the cover picture if you made it with Gemini).',
    'Before you publish a translation, ask someone who reads that language well to read it.');
  return g.join('\n');
}

module.exports = { writeGooglePlay, isbnOk, PARTNER_CENTER, ISO3, BISAC };
