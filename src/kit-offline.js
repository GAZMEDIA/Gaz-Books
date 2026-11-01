// The Amazon marketing kit, made on this computer with no AI and no keys:
// what kind of book it is, keywords, categories, a description, a pull-quote
// for the back cover, the cover-picture prompt for Gemini, and a plain-words
// upload guide. Everything is read from the book itself.
const { plain } = require('./read');
const { coverSize } = require('./cover');

// ---------------------------------------------------------------- what kind of book

const GENRES = {
  faith: {
    words: 'god lord jesus christ spirit holy prayer pray faith scripture bible church grace blessing anointing prophetic heaven salvation gospel worship psalm kingdom righteousness covenant apostle pastor ministry miracle',
    name: 'Christian / inspirational', mood: 'uplifting, reverent, full of hope',
    scene: 'golden light breaking through clouds over a quiet landscape at dawn, rays of light, a sense of divine presence',
    look: 'deep royal blue and gold, soft heavenly glow',
    categories: ['Religion & Spirituality > Christian Books & Bibles > Christian Living > Spiritual Growth', 'Religion & Spirituality > Christian Books & Bibles > Christian Living > Inspirational', 'Religion & Spirituality > Christian Books & Bibles > Bible Study & Reference'],
    seeds: ['christian living', 'spiritual growth', 'faith and prayer', 'christian books for adults', 'holy spirit power', 'bible teaching', 'devotional'],
  },
  romance: {
    words: 'love kiss heart lips embrace romance wedding bride groom desire passion darling beloved smile tender',
    name: 'Romance', mood: 'warm, tender, romantic',
    scene: 'two silhouettes at sunset, warm soft light, gentle bokeh', look: 'warm rose and gold tones',
    categories: ['Romance > Contemporary', 'Romance > Romantic Comedy', 'Literature & Fiction > Women\'s Fiction'],
    seeds: ['romance novel', 'love story', 'contemporary romance', 'second chance romance', 'clean romance', 'african romance', 'emotional love story'],
  },
  thriller: {
    words: 'blood gun police detective murder killer dead body crime suspect knife scream shot investigation victim danger chase',
    name: 'Thriller / mystery', mood: 'tense, dark, suspenseful',
    scene: 'a lone figure on a dark rain-soaked street at night, dramatic shadows', look: 'high contrast, cold blues and deep blacks',
    categories: ['Mystery, Thriller & Suspense > Thrillers & Suspense > Suspense', 'Mystery, Thriller & Suspense > Mystery > Police Procedurals', 'Mystery, Thriller & Suspense > Thrillers & Suspense > Crime'],
    seeds: ['crime thriller', 'mystery novel', 'suspense thriller', 'detective story', 'page turner', 'murder mystery', 'psychological thriller'],
  },
  fantasy: {
    words: 'magic sword dragon kingdom king queen spell wizard witch prince princess realm throne curse ancient prophecy',
    name: 'Fantasy', mood: 'epic, magical, adventurous',
    scene: 'a vast mystical landscape with ancient mountains and a glowing sky', look: 'rich jewel tones, magical light',
    categories: ['Science Fiction & Fantasy > Fantasy > Epic', 'Science Fiction & Fantasy > Fantasy > Coming of Age', 'Teen & Young Adult > Science Fiction & Fantasy > Fantasy'],
    seeds: ['epic fantasy', 'fantasy adventure', 'magic and dragons', 'african fantasy', 'sword and sorcery', 'fantasy series', 'quest'],
  },
  business: {
    words: 'business money market customer sales profit company leadership strategy management team growth investment income entrepreneur brand success',
    name: 'Business / money', mood: 'confident, clear, professional',
    scene: 'clean modern abstract shapes suggesting growth and upward movement', look: 'navy, white and a bold accent colour',
    categories: ['Business & Money > Entrepreneurship', 'Business & Money > Management & Leadership > Leadership', 'Business & Money > Personal Finance'],
    seeds: ['business book', 'entrepreneurship', 'leadership skills', 'make money', 'small business', 'personal finance', 'success principles'],
  },
  selfhelp: {
    words: 'you your life purpose habit goal mindset success change confidence dream discipline potential growth happiness fear',
    name: 'Self-help', mood: 'positive, motivating, bright',
    scene: 'a sunrise over an open road or mountain path, bright sky, sense of new beginnings', look: 'bright sunrise colours, clean and fresh',
    categories: ['Self-Help > Personal Transformation', 'Self-Help > Motivational', 'Self-Help > Success'],
    seeds: ['self help', 'personal growth', 'motivation', 'purpose driven life', 'mindset', 'success habits', 'self improvement'],
  },
  children: {
    words: 'mummy daddy mommy little bunny puppy kitten teddy school friend play toys giggle',
    name: 'Children\'s', mood: 'playful, cheerful, friendly',
    scene: 'a cheerful illustrated scene with soft rounded shapes', look: 'bright playful colours, storybook illustration',
    categories: ['Children\'s Books > Growing Up & Facts of Life > Friendship, Social Skills & School Life', 'Children\'s Books > Literature & Fiction', 'Children\'s Books > Early Learning'],
    seeds: ['children\'s book', 'picture book', 'bedtime story', 'kids books ages 3-5', 'kids books ages 6-8', 'african children\'s books', 'early reader'],
  },
  memoir: {
    words: 'i my me mother father grandmother village childhood remember years born grew family memories',
    name: 'Memoir / biography', mood: 'personal, honest, reflective',
    scene: 'a softly lit path or doorway suggesting a life journey', look: 'warm muted tones, gentle film grain',
    categories: ['Biographies & Memoirs > Memoirs', 'Biographies & Memoirs > Personal Memoirs', 'Biographies & Memoirs > Leaders & Notable People'],
    seeds: ['memoir', 'true story', 'inspirational biography', 'life story', 'african memoir', 'overcoming adversity', 'autobiography'],
  },
  fiction: {
    words: '',
    name: 'Fiction', mood: 'atmospheric, emotional, intriguing',
    scene: 'an evocative scene from the story\'s world, a lone figure in a wide landscape, dramatic sky', look: 'rich cinematic colour',
    categories: ['Literature & Fiction > Literary Fiction', 'Literature & Fiction > Contemporary Fiction', 'Literature & Fiction > World Literature > African'],
    seeds: ['literary fiction', 'contemporary fiction', 'african fiction', 'family saga', 'book club fiction', 'novel', 'coming of age'],
  },
  health: {
    words: 'health body diet food weight exercise sleep doctor disease healing nutrition stress',
    name: 'Health', mood: 'fresh, calm, trustworthy',
    scene: 'fresh natural elements, green leaves and soft daylight', look: 'fresh greens and whites',
    categories: ['Health, Fitness & Dieting > Diets & Weight Loss', 'Health, Fitness & Dieting > Exercise & Fitness', 'Health, Fitness & Dieting > Mental Health'],
    seeds: ['healthy living', 'wellness', 'nutrition', 'weight loss', 'natural healing', 'fitness', 'self care'],
  },
};

const STOP = new Set(('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves also one two three may might must shall upon even still yet every many much like well back way made make said says say know see go come get got went came take took let us thing things time day days man men woman women people never always something nothing someone anyone everyone again chapter'
).split(' '));

function bookWords(book) {
  const text = book.chapters.map((c) => [c.title || '', ...c.blocks.filter((b) => b.runs).map((b) => plain(b.runs))].join('\n')).join('\n');
  return { text, words: text.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) || [] };
}

function detectGenre(book) {
  const { words } = bookWords(book);
  const n = Math.max(1, words.length);
  const counts = {};
  for (const w of words) counts[w] = (counts[w] || 0) + 1;
  let best = null; let bestScore = 0;
  for (const [key, g] of Object.entries(GENRES)) {
    if (!g.words) continue;
    const list = g.words.split(' ');
    // one word said again and again (a church bell in a novel) is not enough: it takes several different signs
    const distinct = list.filter((w) => (counts[w] || 0) >= 2).length;
    if (distinct < 4) continue;
    const hits = list.reduce((s, w) => s + Math.min(counts[w] || 0, n / 150), 0);
    const score = (hits / n) * Math.min(1, distinct / 8) * (key === 'memoir' || key === 'selfhelp' ? 0.35 : 1);
    if (score > bestScore) { best = key; bestScore = score; }
  }
  if (best && bestScore > 0.004) return best;
  // no clear signs: lots of dialogue means a novel
  const { text } = bookWords(book);
  const quotes = (text.match(/["“”]/g) || []).length / Math.max(1, text.split(/\n/).length);
  return quotes > 0.3 ? 'fiction' : 'selfhelp';
}

// ---------------------------------------------------------------- keywords, quote, description

function keywords(book, genre) {
  const { words } = bookWords(book);
  const titleWords = new Set(`${book.title} ${book.subtitle || ''} ${book.author || ''}`.toLowerCase().match(/\p{L}+/gu) || []);
  const pairs = {};
  for (let i = 0; i + 1 < words.length; i++) {
    const a = words[i]; const b = words[i + 1];
    if (STOP.has(a) || STOP.has(b) || a.length < 3 || b.length < 3 || a === b) continue;
    const k = `${a} ${b}`; pairs[k] = (pairs[k] || 0) + 1;
  }
  const fromBook = Object.entries(pairs).filter(([, c]) => c >= 3).sort((x, y) => y[1] - x[1])
    .map(([k]) => k).filter((k) => !k.split(' ').every((w) => titleWords.has(w))).slice(0, 3);
  const out = [];
  for (const k of [...fromBook, ...GENRES[genre].seeds]) {
    if (out.length >= 7) break;
    if (!out.some((o) => o.includes(k) || k.includes(o))) out.push(k);
  }
  return out;
}

// A short, strong line from the book for the top of the back cover.
function pullQuote(book) {
  const { text } = bookWords(book);
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim().replace(/^["“']|["”']$/g, ''));
  let best = ''; let bestScore = -1;
  for (const s of sentences) {
    const w = s.split(/\s+/).length;
    if (w < 7 || w > 20 || /[:;()\[\]]|chapter|\d/i.test(s) || !/[.!]$/.test(s)) continue;
    let score = 0;
    if (/\b(you|your)\b/i.test(s)) score += 2;
    if (/!$/.test(s)) score += 1;
    if (/\b(not|never|every|always|must|power|life|truth|nature|destiny|love|free)\b/i.test(s)) score += 1.5;
    if (w >= 9 && w <= 16) score += 1;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}

// The author's "About the Book" if they gave one; otherwise built from the book.
function description(book, aboutBook, genre) {
  if (aboutBook && aboutBook.trim()) return aboutBook.trim();
  const chapters = book.chapters.filter((c) => c.title && !c.aboutAuthor && !/^(about the author|acknowledg|dedication|contents|introduction|preface|foreword)/i.test(c.title));
  const first = book.chapters.find((c) => c.blocks.some((b) => b.type === 'p'));
  const opening = first ? first.blocks.filter((b) => b.type === 'p').map((b) => plain(b.runs)).join(' ').split(/\s+/).slice(0, 70).join(' ') : '';
  const fiction = ['romance', 'thriller', 'fantasy', 'children'].includes(genre);
  const lines = [];
  if (book.subtitle) lines.push(book.subtitle.trim().replace(/[.]*$/, '.'));
  if (opening) lines.push(`${opening.replace(/[,;:]?$/, '')}…`);
  if (!fiction && chapters.length > 1) lines.push(`Inside this book:\n${chapters.slice(0, 10).map((c) => `• ${c.title}`).join('\n')}`);
  return lines.join('\n\n');
}

// ---------------------------------------------------------------- the cover picture

function coverPrompt(book, genre, trim = '6x9') {
  const g = GENRES[genre];
  const size = coverSize({ trim, pages: 200 });
  const h = Math.round((size.px.frontW * size.trimH) / (size.trimW + size.bleed));
  return `Create a book cover illustration for a ${g.name.toLowerCase()} book called "${book.title}".

Picture: ${g.scene}.
Mood: ${g.mood}. Colours: ${g.look}.
Shape: tall portrait, ${size.px.frontW} × ${h} pixels (2 wide to 3 high), high resolution, sharp, print quality.
Keep the top third calm and simple (the title goes there) and the bottom strip simple (the author's name goes there). Strong single focal point, rich detail, cinematic light.

IMPORTANT: no words, no letters, no title, no logos, no watermark anywhere in the picture.`;
}

// ---------------------------------------------------------------- what goes in the zip

function listingText({ lang, title, subtitle, author, desc, keys, categories, bio, pages, printMade }) {
  return [
    `AMAZON LISTING — ${lang.name.toUpperCase()}`,
    '(Copy each part into the matching box on kdp.amazon.com)',
    '',
    `Language: ${lang.name}`,
    `Book title: ${title}`,
    subtitle ? `Subtitle: ${subtitle}` : null,
    `Author: ${author}`,
    '',
    'DESCRIPTION',
    desc,
    '',
    'KEYWORDS (one per box, 7 boxes)',
    ...keys.map((k, i) => `${i + 1}. ${k}`),
    '',
    'CATEGORIES (pick up to 3)',
    ...categories.map((c) => `• ${c}`),
    '',
    printMade ? `PAPERBACK: ${pages} pages` : 'PAPERBACK: not made for this language (eBook and Word file only).',
    '',
    bio ? 'ABOUT THE AUTHOR (for Amazon Author Central, author.amazon.com)' : null,
    bio || null,
  ].filter((l) => l !== null).join('\n');
}

function uploadGuide({ lang, trim, pages, printMade, aiCover }) {
  const s = coverSize({ trim, pages });
  const steps = [
    `HOW TO PUT YOUR ${lang.name.toUpperCase()} BOOK ON AMAZON`,
    '',
    '1. Go to kdp.amazon.com and sign in.',
    '2. Click "+ Create" and choose "Kindle eBook".',
    `3. Language: choose ${lang.name}. Copy the title, description, keywords and categories from the "Amazon listing" file in this folder.`,
    '4. IMPORTANT, AI question: Amazon asks if you used AI.',
    '   - Translations: choose YES, translated with AI tools.' + (lang.code === 'en' ? ' (Not needed for your original English book.)' : ''),
    aiCover ? '   - Images: choose YES, the cover picture was made with AI (Gemini).' : '   - Images: answer for your own cover picture.',
    '   Amazon can remove books that do not say this.',
    '5. Manuscript: upload the file ending in "Kindle.epub".',
    '6. Cover: choose "Upload a cover you already have" and upload the file ending in "Kindle cover.jpg".',
    '7. Click "Launch Previewer" to check the book, then set your price and publish.',
  ];
  if (printMade) {
    steps.push('', 'PAPERBACK',
      '8. Back on your Bookshelf, click "+ Create paperback" next to the eBook (the title and details copy over).',
      `9. Print options: ink and paper "Black & white interior with white paper", trim size ${trim.replace('x', ' x ')} in, bleed "No bleed", cover finish your choice.`,
      '10. Manuscript: upload the file ending in "paperback ... .pdf" (not the cover).',
      `11. Cover: choose "Upload a cover you already have" and upload the file ending in "paperback cover ... .pdf". It is made for ${s.pages} pages on white paper (spine ${s.spine} in).`,
      '    If you change paper colour or the page count changes, make the cover again in GazBook.',
      '12. Click "Launch Previewer", fix anything it flags, then set your price and publish.');
  } else {
    steps.push('', `PAPERBACK: GazBook did not make a paperback in ${lang.name}${lang.kdpPrint ? ' yet' : ' (Amazon sells it as an eBook only)'}.`);
  }
  steps.push('', 'Before you publish a translation, ask someone who reads this language well to read it. Machine translation can make mistakes.');
  return steps.join('\n');
}

module.exports = { GENRES, detectGenre, keywords, pullQuote, description, coverPrompt, listingText, uploadGuide };
