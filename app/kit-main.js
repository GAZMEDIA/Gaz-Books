// The complete Amazon kit: one click makes, for the original and every
// translation, the checked and corrected book (paperback PDF, Kindle EPUB,
// Word), the cover picture, the paperback and Kindle covers, and a Word file
// with the Amazon listing and every check.
const path = require('path');
const { buildAll, safeName } = require('../src/engine');
const { translateStrings } = require('../src/translate');
const { writeBackCover } = require('../src/ai');
const { geminiImage } = require('../src/gemini');
const { searchImages } = require('../src/images');
const { coverSize, imagePrompts } = require('../src/cover');
const { reviewBook, proofreadBook, writeListing, checkMetadata, fileChecks } = require('../src/review');
const { makeKitDocx, kitBlocks } = require('../src/kit-docx');

const LABELS = {
  pdf: 'Paperback inside pages (upload in KDP › Paperback › Manuscript)',
  epub: 'Kindle eBook (upload in KDP › eBook › Manuscript)',
  docx: 'Word file (to edit or keep)',
  coverpdf: 'Paperback cover (upload in KDP › Paperback › Cover)',
  coverjpg: 'Kindle cover (upload in KDP › eBook › Cover)',
  art: 'Cover picture on its own',
  kit: 'Marketing kit: Amazon description, About the Book, keywords, categories, cover prompt and quality checks',
};

// The picture: Gemini makes it; without picture access on the key, a free
// stock photo that fits the book is used instead.
async function makePicture({ back, title, trim, keys, settings, saveAsJpeg, status }) {
  const size = coverSize({ trim, pages: 200 });
  const prompt = `${imagePrompts({ title, genre: back.genre, mood: back.mood, setting: back.setting, details: back.details, size }).front} Make it look like the cover art of a bestselling book on Amazon: bold, simple and striking, still clear as a small thumbnail.`;
  let why = '';
  if (keys.geminiKey) {
    try {
      status('Gemini is painting the cover picture');
      const g = await geminiImage(keys.geminiKey, prompt);
      const img = await saveAsJpeg(g.buffer, g.mime);
      return { ...img, note: `Made by Google Gemini from this prompt: ${prompt}` };
    } catch (e) { why = e.message; }
  }
  status('Finding a free cover photo');
  const words = [...(back.searchWords || []), back.setting, back.genre].filter(Boolean);
  for (const q of words) {
    let list = [];
    try { list = await searchImages({ query: q, orientation: 'portrait', minPx: { w: size.px.frontW, h: size.px.h }, pexelsKey: settings.pexelsKey }); } catch { continue; }
    const pick = list.find((r) => !r.needsCredit) || list[0];
    if (!pick) continue;
    try {
      const r = await fetch(pick.full, { headers: { 'User-Agent': 'GazBook/1.0 (gazgoc.com.ng)' } });
      if (!r.ok) continue;
      const img = await saveAsJpeg(Buffer.from(await r.arrayBuffer()), r.headers.get('content-type'));
      const gemNote = keys.geminiKey ? ` Gemini could not paint a picture (${why}). Google's picture maker needs billing turned on in Google AI Studio (a few cents a picture).` : '';
      return { ...img, credit: pick.needsCredit ? pick.credit : '', note: `Free photo found for "${q}": ${pick.credit} (${pick.license}, ${pick.link}).${gemNote}` };
    } catch { /* try the next search */ }
  }
  return { path: '', note: `No picture could be made or found${why ? ` (${why})` : ''}, so the cover uses plain colour. You can add a picture in "Make my cover".` };
}

module.exports = function kitMain({ renderCover, saveAsJpeg }) {
  async function coverFiles(spec, b, pages, tr, base) {
    let s = { ...spec, title: b.title, subtitle: b.subtitle || '' };
    if (tr) {
      const [tagline, blurb, bio] = await translateStrings([spec.tagline, spec.blurb, spec.bio], tr);
      s = { ...s, tagline, blurb, bio };
    }
    const { pdf, kindle } = await renderCover({ ...s, pages });
    return {
      back: { tagline: s.tagline, blurb: s.blurb },
      kindle: `data:image/jpeg;base64,${kindle.toString('base64')}`,
      files: [
        { name: `${base} - paperback cover ${spec.trim} ${pages}p.pdf`, buffer: pdf, kind: 'coverpdf' },
        { name: `${base} - Kindle cover.jpg`, buffer: kindle, kind: 'coverjpg' },
      ],
    };
  }

  // book: as read; opts: the build options from the window; langs: translation jobs
  async function makeKit(book, opts, langs, { settings, keys, progress }) {
    const status = (step, p = 0) => progress(step, p);

    status('Reading your whole book for Amazon\'s checks');
    const review0 = await reviewBook(book, keys, null);
    const language0 = review0.language || 'Original';
    const fixed0 = await proofreadBook(book, keys, { language: language0, styleSheet: review0.styleSheet, onProgress: (p) => status('Checking spelling, grammar and consistency', p) });
    const book0 = fixed0.book;
    const title = opts.title || book0.title; const author = opts.author || book0.author;
    const subtitle = opts.subtitle !== undefined && opts.subtitle !== '' ? opts.subtitle : book0.subtitle;

    // The cover: what was made in "Make my cover", with anything missing
    // (back cover words, picture) made here.
    const given = opts.coverSpec || {};
    let picture = null;
    let extraCopyright = '';
    let back = { tagline: given.tagline, blurb: given.blurb };
    if (!given.blurb || !given.image) {
      status('Writing the back cover');
      const ai = await writeBackCover({ ...book0, title, author, subtitle }, keys);
      if (!given.blurb) back = ai;
      if (!given.image) {
        picture = await makePicture({ back: ai, title, trim: opts.trim, keys, settings, saveAsJpeg, status });
        if (picture.credit) extraCopyright = `Cover picture: ${picture.credit}`;
      }
    }
    const spec = {
      paper: 'white', listPrice: 0, bio: '', imageMode: 'front', style: 'classic', bg: '#1d2433', ink: '#ffffff',
      ...given,
      trim: opts.trim || given.trim || '6x9', title, subtitle: subtitle || '', author,
      tagline: back.tagline || '', blurb: back.blurb || '',
      image: given.image || picture?.path || '',
      ...(given.image ? {} : { imageMode: 'front' }),
    };
    const baseOpts = { ...opts, coverSpec: undefined, copyrightExtra: [opts.copyrightExtra, extraCopyright].filter(Boolean).join('\n') };

    const jobs = [{ language: language0, tr: null }, ...langs.map((t) => ({ language: t.language, tr: t }))];
    const results = [];
    for (const [i, job] of jobs.entries()) {
      const tag = ` ${job.language} (${i + 1} of ${jobs.length})`;
      let review = review0; let changes = fixed0.changes; let back = null;
      const o = {
        ...baseOpts,
        translate: job.tr || undefined,
        beforeLayout: job.tr ? async (b) => {
          status(`Reading the ${job.language} edition for Amazon's checks`);
          review = await reviewBook(b, keys, job.language);
          const r = await proofreadBook(b, keys, { language: job.language, styleSheet: review.styleSheet, onProgress: (p) => status('Checking spelling, grammar and consistency', p) });
          changes = r.changes;
          return r.book;
        } : undefined,
        makeCover: async (b, pages) => {
          const base = safeName(b.title) + (job.tr ? ` (${job.tr.target})` : '');
          const c = await coverFiles(spec, b, pages, job.tr, base);
          back = c.back;
          return c;
        },
        extraFiles: async (b, { pageCount, pdfMade, files }) => {
          status('Writing the Amazon listing');
          const raw = await writeListing(b, keys, job.language);
          const { listing, warnings } = checkMetadata(raw, b);
          const base = safeName(b.title) + (job.tr ? ` (${job.tr.target})` : '');
          const out = [];
          if (!job.tr && picture?.path) out.push({ name: `${base} - cover picture.jpg`, buffer: require('fs').readFileSync(picture.path), kind: 'art' });
          const kitName = `${base} - Marketing kit.docx`;
          const checks = fileChecks({ pageCount, trim: opts.trim, paper: spec.paper, pdfMade, cover: true });
          if (picture?.w && picture.w < coverSize({ trim: opts.trim, pages: pageCount }).px.frontW * 0.66) {
            checks.fix.push(`The cover picture is ${picture.w} pixels wide; for a sharp print Amazon needs about ${coverSize({ trim: opts.trim, pages: pageCount }).px.frontW}. It will look a little soft in print. Use a bigger picture for the paperback if you can.`);
          }
          const all = [...files, ...out, { name: kitName, kind: 'kit' }];
          const blocks = kitBlocks({
            book: b, language: job.language, translated: !!job.tr,
            files: all.map((f) => ({ name: f.name, label: LABELS[f.kind] || f.kind })),
            listing, metaWarnings: warnings, review, changes, fileChecks: checks, back,
            picture: picture?.note,
          });
          out.push({ name: kitName, buffer: await makeKitDocx(blocks), kind: 'kit' });
          return out;
        },
      };
      const res = await buildAll(book0, o, (step, p) => status(step + tag, p));
      results.push({ ...res, folder: job.language });
    }
    return { results, title };
  }

  return { makeKit, coverFiles, LABELS };
};
