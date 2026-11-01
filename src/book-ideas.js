// Ideas drawn from each book itself, so no two books get the same prompts:
//   - the book's images (a barricade, a river, chains, a crown…) from its title,
//     subtitle, chapter titles and text;
//   - its themes (the phrases it uses most);
//   - three different cover concepts for an AI picture maker (Gemini);
//   - one "words" prompt that asks Gemini for catchy back-cover copy, taglines
//     and keywords, using the book's own details.
// No AI runs here: GazBook builds the prompts, the author pastes them into Gemini.
const { plain } = require('./read');
const { coverSize } = require('./cover');

// word (and its forms) → how it looks on a cover
const IMAGES = [
  [/barricade|barrier/, 'a towering barricade of rough timber and barbed wire', 'a figure stepping through a broken gap in the barricade'],
  [/border|frontier|boundar/, 'an open gate on a border line', 'a lone figure crossing a glowing border line into new land'],
  [/prison|cell|captiv|jail/, 'iron prison bars', 'bars bent open with light pouring through'],
  [/chain|shackle|bondage/, 'heavy iron chains', 'chains breaking apart in mid-air'],
  [/fire|flame|burn/, 'a living flame', 'a single flame rising from open hands'],
  [/river|stream/, 'a wide river', 'a winding river catching the first light'],
  [/ocean|sea|wave/, 'a vast ocean', 'a lone figure facing towering waves'],
  [/storm|thunder|tempest/, 'a dark storm', 'a beam of light cutting through storm clouds'],
  [/rain/, 'falling rain', 'rain falling past a lit window'],
  [/mountain|hill|summit/, 'a high mountain', 'a climber reaching a summit above the clouds'],
  [/desert|wilderness|backside/, 'an endless desert', 'footprints crossing desert dunes toward a distant light'],
  [/door|gate/, 'a tall door', 'a great door opening onto blinding light'],
  [/key/, 'an old key', 'a glowing key turning in an ancient lock'],
  [/crown|throne|king|queen|royal/, 'a royal crown', 'a crown resting on a stone step bathed in light'],
  [/eagle|wing/, 'an eagle', 'an eagle with wings spread wide above the clouds'],
  [/lion/, 'a lion', 'a lion standing on a rock at sunrise'],
  [/sword/, 'a sword', 'a sword planted in rock, light glinting on the blade'],
  [/shield|armou?r/, 'a shield', 'a battered shield raised against arrows of fire'],
  [/seed|harvest|sow|reap/, 'seeds and harvest', 'a green shoot breaking through dry ground'],
  [/tree|root|branch/, 'a great tree', 'a lone tree with deep roots and wide branches'],
  [/garden/, 'a garden', 'a hidden garden behind an old wall'],
  [/road|path|journey|way/, 'a long road', 'a road winding toward a bright horizon'],
  [/bridge/, 'a bridge', 'a narrow bridge spanning a deep gorge'],
  [/wall/, 'a high wall', 'a crack of light splitting a high wall'],
  [/ladder|stair|step/, 'a ladder', 'a ladder rising into the light'],
  [/light|lamp|shine/, 'radiant light', 'a single shaft of light falling on a lone figure'],
  [/dawn|sunrise|morning/, 'a sunrise', 'the first rays of dawn over the horizon'],
  [/night|dark/, 'the night', 'a small light in a vast dark landscape'],
  [/star/, 'stars', 'a single bright star over a quiet landscape'],
  [/water|well|fountain|spring/, 'a fountain of water', 'clear water springing from rock'],
  [/wind|breath|spirit/, 'a rushing wind', 'wind sweeping through tall grass, cloth billowing'],
  [/heart/, 'a heart', 'hands cupped around a glowing heart'],
  [/hand/, 'open hands', 'two hands reaching toward each other'],
  [/cross|calvary/, 'a cross', 'a cross on a hill against a dramatic sky'],
  [/blood/, 'blood red', 'a single red thread through a pale scene'],
  [/city/, 'a city', 'a city skyline at dusk'],
  [/village/, 'an African village', 'a village at dusk, warm lights in the windows'],
  [/home|house/, 'a house', 'a lit doorway of a house at night'],
  [/mother|child|daughter|son/, 'a mother and child', 'a mother holding a child against a warm sky'],
  [/wings|fly|soar/, 'wings', 'a figure rising with outstretched arms'],
  [/mirror|reflect/, 'a mirror', 'a reflection showing a different, stronger self'],
  [/time|clock|hour/, 'a clock', 'a clock face cracking open'],
  [/gold|treasure|wealth|money|riches/, 'gold', 'a treasure chest glowing in the dark'],
  [/battle|war|fight|enemy/, 'a battlefield', 'a lone figure standing firm as dust swirls'],
  [/destiny|purpose|calling/, 'a path of destiny', 'a figure at a crossroads, one road glowing'],
  [/signature|nature|dna|identity/, 'a signature of light', 'a handprint of light on a stone wall'],
  [/book|scroll|word/, 'an open book', 'an open book with light rising from its pages'],
];

const STOP = new Set(('a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves also one two three may might must shall upon even still yet every many much like well back way made make said says say know see go come get got went came take took let us thing things time day days man men woman women people never always something nothing someone anyone everyone again chapter part book page').split(' '));

function texts(book) {
  const chapters = book.chapters.filter((c) => !c.aboutAuthor);
  return {
    title: `${book.title || ''}`,
    subtitle: `${book.subtitle || ''}`,
    heads: chapters.map((c) => c.title || '').filter(Boolean),
    body: chapters.map((c) => c.blocks.filter((b) => b.runs).map((b) => plain(b.runs)).join('\n')).join('\n'),
  };
}

// The book's own pictures: title words count most, then subtitle, chapter titles, text.
function findImages(book, n = 3) {
  const t = texts(book);
  const low = { title: t.title.toLowerCase(), sub: t.subtitle.toLowerCase(), heads: t.heads.join(' ').toLowerCase(), body: t.body.toLowerCase() };
  const words = Math.max(1, low.body.split(/\s+/).length);
  const scored = IMAGES.map(([re, thing, scene]) => {
    const g = new RegExp(`\\b(${re.source})\\w*`, 'g');
    const count = (s) => (s.match(g) || []).length;
    const score = count(low.title) * 50 + count(low.sub) * 30 + count(low.heads) * 8 + Math.min(20, (count(low.body) / words) * 4000);
    return { thing, scene, score };
  }).filter((x) => x.score > 0.5).sort((a, b) => b.score - a.score);
  return scored.slice(0, n);
}

// The phrases the book uses most (two words, then single words), for keywords and prompts.
function themes(book, n = 6) {
  const t = texts(book);
  const words = (t.body.toLowerCase().match(/\p{L}[\p{L}'’-]*/gu) || []);
  const pairs = {}; const singles = {};
  for (let i = 0; i < words.length; i++) {
    const a = words[i]; const b = words[i + 1];
    if (!STOP.has(a) && a.length > 3) singles[a] = (singles[a] || 0) + 1;
    if (b && !STOP.has(a) && !STOP.has(b) && a.length > 2 && b.length > 2 && a !== b) pairs[`${a} ${b}`] = (pairs[`${a} ${b}`] || 0) + 1;
  }
  const top = (o, min) => Object.entries(o).filter(([, c]) => c >= min).sort((x, y) => y[1] - x[1]).map(([k]) => k);
  const out = [];
  for (const k of [...top(pairs, 3), ...top(singles, 5)]) {
    if (out.length >= n) break;
    if (!out.some((o) => o.includes(k) || k.includes(o))) out.push(k);
  }
  return out;
}

// Three different cover concepts, each built around this book's own images.
function coverConcepts(book, genre, g, trim = '6x9') {
  const size = coverSize({ trim, pages: 200 });
  const h = Math.round((size.px.frontW * size.trimH) / (size.trimW + size.bleed));
  const imgs = findImages(book, 3);
  const main = imgs[0] || { thing: 'a symbol of the book\'s message', scene: g.scene };
  const second = imgs[1] || main;
  const what = `${genre === 'fiction' || genre === 'romance' || genre === 'thriller' || genre === 'fantasy' ? 'novel' : 'book'} titled "${book.title}"${book.subtitle ? ` (${book.subtitle})` : ''}`;
  const rules = `Shape: tall portrait, ${size.px.frontW} × ${h} pixels (2 wide to 3 high), high resolution, print quality.
Leave the top third calm and uncluttered for the title, and a quiet strip at the bottom for the author's name.
It must grab attention as a small thumbnail on Amazon: one clear focal point, strong contrast, bold shapes.
IMPORTANT: no words, letters, titles, logos or watermarks anywhere in the picture.`;
  return [
    {
      name: 'The big moment',
      idea: `${main.scene[0].toUpperCase()}${main.scene.slice(1)}`,
      prompt: `Create a bestselling, cinematic book cover illustration for the ${what}.
Scene: ${main.scene}${second !== main ? `, with ${second.thing} in the background` : ''}. Capture the turning point: struggle giving way to breakthrough.
Mood: ${g.mood}, dramatic and hopeful. Colours: ${g.look}, with one glowing highlight that draws the eye.
Style: rich, painterly realism, epic scale, volumetric light, cinematic depth of field.
${rules}`,
    },
    {
      name: 'One bold symbol',
      idea: `${main.thing[0].toUpperCase()}${main.thing.slice(1)}, as one striking symbol`,
      prompt: `Create a bold, modern, minimalist book cover image for the ${what}.
One single striking symbol in the centre: ${main.thing}, shown in a fresh, surprising way that tells the book's message at a glance${second !== main ? ` (hinting at ${second.thing})` : ''}.
Plain, deep-coloured background with lots of empty space. Colours: ${g.look}, high contrast, one accent colour.
Style: clean graphic design, sharp edges, premium and confident, like a top-selling non-fiction cover.
${rules}`,
    },
    {
      name: 'A person\'s journey',
      idea: `A person facing ${main.thing}`,
      prompt: `Create an emotional, eye-catching book cover illustration for the ${what}.
A lone African person seen from behind, standing before ${main.thing}, ready to move forward. ${second !== main ? `Around them, ${second.scene}.` : ''}
The feeling: courage, resolve and new beginnings. Mood: ${g.mood}. Colours: ${g.look}, warm light on the figure against a darker surround.
Style: cinematic photography look, golden-hour light, shallow depth of field, strong silhouette.
${rules}`,
    },
  ];
}

// One prompt for Gemini to write the back-cover words, from this book's details.
function wordsPrompt(book, genre, g, { introExcerpt = '' } = {}) {
  const t = texts(book);
  const heads = t.heads.filter((h) => !/^(introduction|preface|foreword|dedication|acknowledg|contents|about the author)/i.test(h)).slice(0, 14);
  const th = themes(book, 6);
  const novel = ['fiction', 'romance', 'thriller', 'fantasy', 'children'].includes(genre);
  const show = novel ? 'introduce the main character and what is at stake, without giving away the ending' : 'show what the reader will gain';
  return `You are a top book marketer who writes Amazon descriptions that sell. Write marketing copy for this ${g.name.toLowerCase()} book.

Title: ${book.title}
${book.subtitle ? `Subtitle: ${book.subtitle}\n` : ''}Author: ${book.author || ''}
Main themes: ${th.join(', ')}
Chapters: ${heads.join('; ')}
${introExcerpt ? `From the book's opening: "${introExcerpt}"\n` : ''}
Please give me:
1. THREE different back-cover descriptions (120–150 words each). Start each with a hook that stops the reader, ${show}, and end with a short call to action. Use short paragraphs. No made-up facts, reviews or awards.
2. FIVE short, punchy taglines (under 12 words) for the top of the back cover.
3. SEVEN Amazon keywords or phrases readers would actually type into the search box (not the title words).
4. A one-sentence "elevator pitch".

Write in plain, warm English that a busy reader understands at once.`;
}

module.exports = { findImages, themes, coverConcepts, wordsPrompt, IMAGES };
