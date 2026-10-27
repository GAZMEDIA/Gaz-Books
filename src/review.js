// Amazon checks before the files are made: a review of the whole manuscript
// (content rules, consistency, scripture), a proofreading pass that corrects
// the text, and the Amazon listing (description, About the Book, keywords,
// categories, cover prompt). Uses Gemini or Claude through aiJson.
const { aiJson, sampleText, COVER_PROMPT_TASK } = require('./ai');
const { collect, batches } = require('./translate');
const { plain } = require('./read');
const { htmlToRuns, runsToHtml } = require('./translate');
const { languageToolFix, applyToRuns } = require('./languagetool');
const { findSuspects } = require('./spell');
const { MIN_PAGES, MAX_PAGES, gutterFor } = require('./kdp');
const { coverSize } = require('./cover');

// ---------------------------------------------------------------- review

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    language: { type: 'string' },
    styleSheet: {
      type: 'object',
      properties: {
        spelling: { type: 'string' },
        capitals: { type: 'string' },
        quotes: { type: 'string' },
        voiceAndTense: { type: 'string' },
        other: { type: 'string' },
      },
      required: ['spelling', 'capitals', 'quotes', 'voiceAndTense', 'other'],
    },
    explicitContent: { type: 'boolean' },
    explicitDetail: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: { area: { type: 'string' }, detail: { type: 'string' }, fix: { type: 'string' } },
        required: ['area', 'detail', 'fix'],
      },
    },
    bibleTranslation: { type: 'string' },
    scripture: {
      type: 'array',
      items: {
        type: 'object',
        properties: { reference: { type: 'string' }, problem: { type: 'string' } },
        required: ['reference', 'problem'],
      },
    },
  },
  required: ['language', 'styleSheet', 'explicitContent', 'explicitDetail', 'issues', 'bibleTranslation', 'scripture'],
};

async function reviewBook(book, keys, language) {
  return aiJson(keys, {
    system: 'You are a senior editor who prepares books for Amazon KDP. You know KDP content guidelines and how KDP review uses automated checks and human reviewers.',
    prompt: (big) => `Book: "${book.title || 'Untitled'}"${book.subtitle ? `, subtitle "${book.subtitle}"` : ''}, by ${book.author || 'unknown'}.${language ? ` This edition is in ${language}.` : ''}
<manuscript>
${sampleText(book, big ? 300000 : 6000)}
</manuscript>

Review the manuscript and answer:
- language: the language of the manuscript.
- styleSheet: the style the book mostly uses, so a proofreader can make everything consistent: spelling (e.g. "US English", "UK English", or the standard for the language), capitals (e.g. God, Holy Spirit, Word, Scripture and pronouns for God capitalised or not), quotes (the quotation marks the language should use, e.g. German „…“, French « … », English “…”), voiceAndTense (e.g. speaks to the reader as "you", present tense), other (Bible book names and verse notation for this language, e.g. German "Jesaja 61,3–4"; numbers; anything else to keep consistent).
- explicitContent: true if the book has sexually explicit content that needs Amazon's adult content setting; explicitDetail says where, or is empty.
- issues: problems Amazon's review may flag or a reader would notice: prohibited or offensive content, hate, violence glorification, plagiarism or public-domain text presented as the author's own, misleading claims (e.g. medical or money promises), missing chapters, duplicated sections, broken headings, inconsistent names. area is one of content, public-domain, claims, structure, consistency. fix says what the author should do. Empty list if none.
- bibleTranslation: the Bible translation the quotes appear to come from, or empty if there are none.
- scripture: Bible references where the reference looks wrong for the quoted words, the quote does not match the usual wording, or the notation does not follow the language's convention. Empty list if none.`,
    schema: REVIEW_SCHEMA,
    maxTokens: 16000,
  });
}

// ---------------------------------------------------------------- proofreading

function styleText(sheet = {}) {
  return Object.entries(sheet).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n');
}

// A correction must stay close to the original; anything else is kept as it was.
function closeEnough(a, b) {
  const x = plain(htmlToRuns(a)); const y = plain(htmlToRuns(b));
  if (!y.trim()) return false;
  const r = y.length / Math.max(1, x.length);
  return r > 0.75 && r < 1.3;
}

async function proofreadBook(book, keys, { language, code, styleSheet, onProgress = () => {} }) {
  const copy = JSON.parse(JSON.stringify(book));
  const items = collect(copy);
  // big pieces: fewer requests, so the free allowance lasts and busy moments matter less
  const cloud = !!(keys.geminiKey || keys.claudeKey);
  const groups = cloud ? batches(items, 30000, 150) : [];
  let skipped = 0;
  const missed = [];
  const changes = [];
  let done = 0;
  for (const g of groups) {
    const texts = g.map((it) => it.get());
    let r;
    try {
    r = await aiJson({ ...keys, local: null }, {
      system: 'You are a professional copy editor and proofreader for books published on Amazon KDP.',
      prompt: `Proofread each item of this JSON array${language ? ` (${language})` : ''}. Correct only: spelling, grammar, punctuation, typos, doubled words, wrong word forms, and inconsistencies with this style sheet:
${styleText(styleSheet)}
Use the correct letters and typography of the language (for example ä ö ü ß, correct quotation marks, Bible book names and verse notation of the language).
Do not rewrite sentences for style, do not change the meaning, theology or the author's voice, do not shorten or add content. Keep any <i> and <b> tags around the same words.
Return items: exactly one item for each input item, in the same order (unchanged if nothing needs fixing), and changes: each correction you made (before, after, why in a few words).

${JSON.stringify(texts)}`,
      schema: {
        type: 'object',
        properties: {
          items: { type: 'array', items: { type: 'string' } },
          changes: {
            type: 'array',
            items: { type: 'object', properties: { before: { type: 'string' }, after: { type: 'string' }, why: { type: 'string' } }, required: ['before', 'after', 'why'] },
          },
        },
        required: ['items', 'changes'],
      },
      think: false,
    });
    } catch (e) {
      // one part failing must not stop the book: keep that part as it was and say so
      if (/key did not work/.test(e.message)) throw e;
      skipped += g.length; r = {}; missed.push(...g);
    }
    if (Array.isArray(r.items) && r.items.length === texts.length) {
      g.forEach((it, i) => {
        if (r.items[i] !== texts[i] && closeEnough(texts[i], r.items[i])) {
          it.set(it.plainText ? plain(htmlToRuns(r.items[i])) : r.items[i]);
        }
      });
      changes.push(...(r.changes || []).filter((c) => c.before !== c.after));
    } else if (r.items) {
      skipped += g.length; missed.push(...g);
    }
    done += g.length;
    onProgress(done / items.length);
  }
  // Parts Gemini could not do: the free LanguageTool checker corrects their
  // spelling and grammar instead (no key needed).
  if (!cloud) { missed.push(...items); skipped = items.length; }
  let backup = '';
  if (missed.length && cloud) {
    const paras = missed.filter((it) => !it.plainText).map((it) => ({ runs: htmlToRuns(it.get()), set: (runs) => it.set(runsToHtml(runs)) }));
    try {
      const lt = await languageToolFix(paras, { code, styleSheet, onProgress });
      if (!lt.unsupported) {
        changes.push(...lt.changes.map((c) => ({ ...c, why: `${c.why}, LanguageTool` })));
        backup = `Gemini was busy for ${skipped} of ${items.length} paragraphs; the free LanguageTool checker corrected their spelling and grammar instead.`;
        skipped = 0;
      }
    } catch { /* LanguageTool unreachable (offline): the built-in AI below */ }
  }
  if (skipped && keys.local) {
    const lp = await localProofread(missed.filter((it) => !it.plainText), keys, { code, language, styleSheet, onProgress });
    changes.push(...lp.changes);
    if (lp.supported) {
      backup = `${cloud ? `Gemini could not check ${skipped} of ${items.length} paragraphs. ` : ''}Spelling was checked on this computer (dictionary + GazBook's built-in AI). For a full grammar check, run the kit again when you are online with your Gemini key.`;
      skipped = 0;
    } else {
      backup = `There is no offline dictionary for ${language || 'this language'} yet, so ${skipped} paragraphs were not proofread. Run the kit again when you are online with your Gemini key.`;
      skipped = 0;
    }
  }
  return { book: copy, changes, skipped, total: items.length, backup };
}

// Offline proofreading: dictionaries find sentences with unknown words, the
// built-in AI fixes only those sentences, and the fixes go back into the text
// word by word (so italics and bold stay where they were).
async function localProofread(missed, keys, { code, language, styleSheet, onProgress = () => {} }) {
  const paras = missed.map((it) => ({ it, runs: htmlToRuns(it.get()) }));
  const texts = paras.map((p) => plain(p.runs));
  const { supported, suspects } = findSuspects(texts, { code, language });
  if (!supported) return { supported, changes: [] };
  const changes = [];
  const words = (t) => [...t.matchAll(/\p{L}+(?:['’]\p{L}+)?/gu)].map((m) => ({ w: m[0], at: m.index }));
  const fixes = paras.map(() => []);
  for (let i = 0; i < suspects.length; i += 10) {
    const group = suspects.slice(i, i + 10);
    let r;
    try {
      r = await aiJson({ local: keys.local }, {
        system: 'You are a careful proofreader.',
        prompt: `Correct the spelling (and any obvious grammar mistake) in each sentence of this JSON array${language ? ` (${language})` : ''}. Words that look wrong: ${[...new Set(group.flatMap((g) => g.words))].join(', ')}. Keep everything else exactly the same. ${styleText(styleSheet)}
Return items: one corrected sentence for each input sentence, in the same order.
${JSON.stringify(group.map((g) => g.sentence))}`,
        schema: { type: 'object', properties: { items: { type: 'array', items: { type: 'string' } } }, required: ['items'] },
        maxTokens: 2000,
      });
    } catch { continue; }
    (r.items || []).slice(0, group.length).forEach((fixed, k) => {
      const g = group[k];
      const a = words(g.sentence); const b = words(fixed || '');
      if (a.length !== b.length) return; // the AI rewrote too much: leave the sentence
      const start = texts[g.para].indexOf(g.sentence);
      if (start < 0) return;
      a.forEach((x, n) => {
        if (x.w !== b[n].w && g.words.includes(x.w)) {
          fixes[g.para].push({ offset: start + x.at, length: x.w.length, value: b[n].w });
          changes.push({ before: x.w, after: b[n].w, why: 'spelling, checked on this computer' });
        }
      });
    });
    onProgress(Math.min(1, (i + 10) / suspects.length));
  }
  paras.forEach((p, k) => { if (fixes[k].length) p.it.set(runsToHtml(applyToRuns(p.runs, fixes[k]))); });
  return { supported, changes };
}

// ---------------------------------------------------------------- listing

const LISTING_SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
    aboutBook: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    categories: { type: 'array', items: { type: 'string' } },
    coverPrompt: { type: 'string' },
  },
  required: ['description', 'aboutBook', 'keywords', 'categories', 'coverPrompt'],
};

async function writeListing(book, keys, language) {
  const name = [book.title, book.subtitle].filter(Boolean).join(': ');
  return aiJson(keys, {
    system: 'You are an Amazon KDP marketing expert and copywriter. You follow Amazon KDP metadata rules.',
    prompt: (big) => `Book: "${name}" by ${book.author || 'the author'}.${language ? ` Write everything in ${language}, for the Amazon store of that language.` : ' Write in the language of the manuscript.'}
<manuscript>
${sampleText(book, big ? 120000 : 5000)}
</manuscript>

Write:
1. description: an Amazon-optimised book description of about 300 words that opens with a strong emotional hook, speaks directly to the reader's pain points, positions the book as the solution, stresses actionable results rather than passive learning, has bold benefit-driven bullet points, repeats the main keywords of the title and subtitle at least 4 times naturally, keeps a confident and authoritative tone, and ends with a strong call to action. No fluff: every sentence sells clarity, confidence and results. Never repeat the same sentence or phrase. If the book is fiction, keep the same structure but sell the story: the reader's longing for the experience instead of pain points, what they will feel instead of actionable results, and never present a novel as self-help. Format: paragraphs separated by a blank line; bullet lines start with "• "; wrap bold words in **double stars**.
2. aboutBook: an "About the Book" section of about 100 words that reinforces credibility, restates the transformation the reader will experience, and matches Amazon's tone and formatting.
3. keywords: 18 high-impact Amazon search keywords, best first (phrases buyers really type), mixing beginner, problem-based and solution-focused terms. Each at most 50 characters.
4. categories: 7 Amazon book categories as full paths (e.g. "Books > Religion & Spirituality > Christian Living > Spiritual Growth") that fit the content, have strong traffic and help ranking. Only categories that truly match this book's genre and subject; Amazon removes books from misleading categories.
5. coverPrompt: ${COVER_PROMPT_TASK(book)}

Amazon rules you must follow: do not claim the book is a bestseller or #1, no words like "free", "bestseller", "Kindle Unlimited", "Amazon", "KDP", "new release", "on sale" or "limited time" in the description or keywords, no other authors' or books' names in keywords, no misleading categories, no reviews or quotes you made up, no contact details or links.`,
    schema: LISTING_SCHEMA,
    maxTokens: 16000,
  });
}

// ---------------------------------------------------------------- metadata rules

const BANNED = [
  [/best[\s-]?sell(er|ing)/i, 'says "bestseller"'],
  [/#\s?1\b|number one|no\. ?1\b/i, 'claims #1'],
  [/\bfree\b/i, 'says "free"'],
  [/kindle unlimited|\bKU\b/i, 'mentions Kindle Unlimited'],
  [/\bamazon\b|\bkdp\b|\bkindle\b/i, 'mentions Amazon or Kindle'],
  [/new release|on sale|limited time|discount/i, 'uses a sales phrase'],
  [/https?:\/\/|www\.|@\w+\.\w+/i, 'has a link or email'],
];

// Keywords that break a rule are dropped (Amazon can reject the book for them);
// the description is only reported, since words like "free" can be fine there.
function checkMetadata(listing, book) {
  const warnings = [];
  const keywords = [];
  for (const k of listing.keywords || []) {
    const bad = BANNED.find(([re]) => re.test(k));
    if (bad) { warnings.push(`Keyword "${k}" was removed: it ${bad[1]}, which Amazon does not allow in keywords.`); continue; }
    if (k.length > 50) { warnings.push(`Keyword "${k}" is longer than 50 characters; KDP will cut it.`); }
    if (book.title && k.toLowerCase() === book.title.toLowerCase()) { warnings.push(`Keyword "${k}" is just the title; Amazon already searches the title, so use the box for something else.`); }
    keywords.push(k);
  }
  for (const [re, why] of BANNED.slice(0, 2)) if (re.test(listing.description || '')) warnings.push(`The description ${why}; Amazon does not allow that claim. Remove it before you paste it.`);
  for (const t of [book.title, book.subtitle].filter(Boolean)) {
    const bad = BANNED.find(([re]) => re.test(t));
    if (bad) warnings.push(`The ${t === book.title ? 'title' : 'subtitle'} ${bad[1]}; Amazon may reject that in the title.`);
  }
  return { listing: { ...listing, keywords: keywords.slice(0, 14), categories: (listing.categories || []).slice(0, 7) }, warnings };
}

// ---------------------------------------------------------------- file checks

function fileChecks({ pageCount, trim = '6x9', paper = 'white', pdfMade, cover }) {
  const ok = []; const fix = [];
  if (pdfMade) {
    (pageCount >= MIN_PAGES ? ok : fix).push(`Page count: ${pageCount} (Amazon allows ${MIN_PAGES} to ${MAX_PAGES}).`);
    if (pageCount > MAX_PAGES) fix.push(`Too many pages for one paperback: choose a bigger page size or smaller text.`);
    ok.push(`Trim size ${trim} in, inside margin ${(gutterFor(pageCount) + 0.125).toFixed(3)} in (Amazon's minimum for ${pageCount} pages is ${gutterFor(pageCount)} in), outside margins 0.5 in, no bleed, all fonts embedded.`);
  } else {
    fix.push('No print PDF was made for this language (see the notes in the app). Make one from the Word file before you upload the paperback.');
  }
  if (cover) {
    const s = coverSize({ trim, pages: pageCount, paper });
    ok.push(`Paperback cover: ${s.width} x ${s.height} in with 0.125 in bleed, spine ${s.spine} in for ${s.pages} pages on ${s.paperName} paper${s.spineText ? '' : ' (too thin for spine text, so the spine is left plain as Amazon requires)'}.`);
    ok.push('Kindle cover: 1600 pixels wide, JPG, at Amazon\'s 1.6 height-to-width ratio.');
  } else {
    fix.push('No cover was made in GazBook for this book. Check your own cover with Amazon\'s cover calculator for this page count.');
  }
  ok.push('Kindle EPUB 3 with a working contents page and chapter links (the same file passes the official EPUBCheck).');
  return { ok, fix };
}

module.exports = { reviewBook, proofreadBook, writeListing, checkMetadata, fileChecks, BANNED };
