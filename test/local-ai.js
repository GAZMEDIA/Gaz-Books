// Downloads GazBook's built-in AI and asks it for a listing (run in CI):
//   node test/local-ai.js <modelDir>
const { localJson } = require('../app/local-ai');
const { writeListing } = require('../src/review');
const { checkMetadata } = require('../src/review');

(async () => {
  const dir = process.argv[2] || 'models';
  const local = (o) => localJson(dir, o, (m) => { if (/0%$|Starting/.test(m)) console.log(m); });
  const book = { title: 'The River Remembers', author: 'Ada Okoro', chapters: [{ title: 'One', blocks: [{ runs: [{ text: 'When the river flooded the village, Ada found a letter from her grandmother hidden in the roof. It told of a promise made long ago, and of a door under the old mango tree that no one had opened since.' }] }] }] };
  const t0 = Date.now();
  const raw = await writeListing(book, { local }, 'English');
  const { listing, warnings } = checkMetadata(raw, book);
  console.log(JSON.stringify(listing, null, 1).slice(0, 3000));
  console.log('warnings', warnings, 'seconds', Math.round((Date.now() - t0) / 1000));
  if (listing.description.split(/\s+/).length < 120 || listing.keywords.length < 7 || listing.categories.length < 3) throw new Error('listing looks too thin');
  console.log('built-in AI ok');
})().catch((e) => { console.error(e); process.exit(1); });
