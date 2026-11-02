// Seven BISAC genres for each book (Google Play's "Genres" page, and other
// stores), chosen from what the book talks about. Codes and names checked on
// the official BISAC lists (bisg.org, November 2026).
const { plain } = require('./read');

// kind of book → [code, name, base score, words that make it fit better]
const LISTS = {
  faith: [
    ['REL012000', 'RELIGION / Christian Living / General', 6, null],
    ['REL012120', 'RELIGION / Christian Living / Spiritual Growth', 5, /grow|mature|spirit|transform/],
    ['REL012070', 'RELIGION / Christian Living / Personal Growth', 4, /change|become|potential|purpose/],
    ['REL012040', 'RELIGION / Christian Living / Inspirational', 4, /hope|encourage|inspire|overcome/],
    ['REL077000', 'RELIGION / Faith', 3, /faith|believe|trust/],
    ['REL012080', 'RELIGION / Christian Living / Prayer', 2, /pray|prayer|fasting|intercession/],
    ['REL099000', 'RELIGION / Christian Living / Spiritual Warfare', 1, /enemy|devil|satan|warfare|battle|demon|barricade|stronghold/],
    ['REL079000', 'RELIGION / Christianity / Pentecostal & Charismatic', 1, /holy spirit|tongues|anointing|prophet|miracle/],
    ['REL012140', 'RELIGION / Christian Living / Calling & Vocation', 1, /calling|destiny|vocation|assignment|purpose/],
    ['REL108030', 'RELIGION / Christian Living / Leadership & Mentoring', 1, /leader|mentor|lead/],
    ['REL006000', 'RELIGION / Biblical Studies / General', 1, /scripture|verse|bible|psalm|genesis|exodus|matthew|romans/],
    ['REL012020', 'RELIGION / Christian Living / Devotional', 0, /devotion|day \d|daily/],
    ['REL067000', 'RELIGION / Christian Theology / General', 0, /doctrine|theolog|salvation|grace|redemption/],
    ['REL030000', 'RELIGION / Christian Ministry / Evangelism', 0, /evangel|soul|gospel|witness/],
    ['REL062000', 'RELIGION / Spirituality', 0, null],
  ],
  fiction: [
    ['FIC000000', 'FICTION / General', 5, null],
    ['FIC019000', 'FICTION / Literary', 4, null],
    ['FIC083000', 'FICTION / World Literature / Africa / General', 3, /africa|nigeria|cameroon|ghana|kenya|lagos|accra|limbe|douala|village|mama|wrapper/],
    ['FIC143000', 'FICTION / Places / Africa', 2, /africa|nigeria|cameroon|ghana|kenya|lagos|accra|limbe|douala|village/],
    ['FIC045000', 'FICTION / Family Life / General', 2, /mother|father|brother|sister|family|grandmother|son|daughter/],
    ['FIC051000', 'FICTION / Cultural Heritage', 1, /tradition|ancestor|culture|village|elders/],
    ['FIC043000', 'FICTION / Coming of Age', 1, /school|young|grew up|childhood|boy|girl/],
    ['FIC066000', 'FICTION / Small Town & Rural', 1, /village|farm|market|rural/],
    ['FIC044000', 'FICTION / Women', 1, /she|her|woman|women/],
    ['FIC025000', 'FICTION / Psychological', 0, /mind|memory|fear|dream/],
    ['FIC014000', 'FICTION / Historical / General', 0, /war|colonial|independence|century/],
  ],
  romance: [
    ['FIC027000', 'FICTION / Romance / General', 6, null],
    ['FIC027020', 'FICTION / Romance / Contemporary', 5, null],
    ['FIC027230', 'FICTION / Romance / Multicultural & Interracial', 2, /africa|nigeria|cameroon|ghana|lagos|accra/],
    ['FIC027270', 'FICTION / Romance / Clean & Wholesome', 2, null],
    ['FIC083000', 'FICTION / World Literature / Africa / General', 2, /africa|nigeria|cameroon|ghana|lagos|accra|village/],
    ['FIC044000', 'FICTION / Women', 1, null],
    ['FIC045000', 'FICTION / Family Life / General', 1, /family|mother|father/],
    ['FIC042040', 'FICTION / Christian / Romance / General', 0, /god|pray|church|faith/],
    ['FIC000000', 'FICTION / General', 0, null],
  ],
  thriller: [
    ['FIC031000', 'FICTION / Thrillers / General', 6, null],
    ['FIC030000', 'FICTION / Thrillers / Suspense', 5, null],
    ['FIC022000', 'FICTION / Mystery & Detective / General', 4, /detective|clue|mystery|investigat/],
    ['FIC050000', 'FICTION / Crime', 4, /crime|police|murder|gang|robbery/],
    ['FIC025000', 'FICTION / Psychological', 2, /mind|fear|memory|obsess/],
    ['FIC083000', 'FICTION / World Literature / Africa / General', 2, /africa|nigeria|cameroon|ghana|lagos|accra/],
    ['FIC000000', 'FICTION / General', 1, null],
  ],
  fantasy: [
    ['FIC009000', 'FICTION / Fantasy / General', 6, null],
    ['FIC009020', 'FICTION / Fantasy / Epic', 4, /kingdom|war|throne|army|prophecy/],
    ['FIC083000', 'FICTION / World Literature / Africa / General', 2, /africa|village|ancestor|spirit/],
    ['FIC051000', 'FICTION / Cultural Heritage', 2, /ancestor|tradition|culture/],
    ['FIC043000', 'FICTION / Coming of Age', 1, /young|boy|girl|grew/],
    ['FIC019000', 'FICTION / Literary', 1, null],
    ['FIC000000', 'FICTION / General', 1, null],
  ],
  business: [
    ['BUS000000', 'BUSINESS & ECONOMICS / General', 5, null],
    ['BUS025000', 'BUSINESS & ECONOMICS / Entrepreneurship', 4, /entrepreneur|start|startup|founder|own business/],
    ['BUS107000', 'BUSINESS & ECONOMICS / Personal Success', 4, /success|goal|achieve/],
    ['BUS071000', 'BUSINESS & ECONOMICS / Leadership', 3, /leader|lead|team/],
    ['BUS060000', 'BUSINESS & ECONOMICS / Small Business', 2, /small business|shop|customer/],
    ['BUS050000', 'BUSINESS & ECONOMICS / Personal Finance / General', 2, /money|saving|debt|income|wealth/],
    ['BUS050030', 'BUSINESS & ECONOMICS / Personal Finance / Money Management', 1, /budget|saving|spend|debt/],
    ['BUS046000', 'BUSINESS & ECONOMICS / Motivational', 1, /motivat|inspire|dream/],
    ['BUS041000', 'BUSINESS & ECONOMICS / Management', 1, /manage|staff|employee/],
    ['BUS043000', 'BUSINESS & ECONOMICS / Marketing / General', 0, /marketing|brand|sales|advert/],
    ['BUS012000', 'BUSINESS & ECONOMICS / Careers / General', 0, /career|job|interview/],
    ['BUS036000', 'BUSINESS & ECONOMICS / Investments & Securities / General', 0, /invest|stock|shares|real estate/],
  ],
  selfhelp: [
    ['SEL000000', 'SELF-HELP / General', 5, null],
    ['SEL021000', 'SELF-HELP / Motivational & Inspirational', 5, null],
    ['SEL031000', 'SELF-HELP / Personal Growth / General', 4, null],
    ['SEL027000', 'SELF-HELP / Personal Growth / Success', 3, /success|goal|achieve|win/],
    ['SEL023000', 'SELF-HELP / Personal Growth / Self-Esteem', 2, /confidence|worth|esteem|believe in yourself/],
    ['SEL016000', 'SELF-HELP / Personal Growth / Happiness', 1, /happy|joy|peace/],
    ['SEL032000', 'SELF-HELP / Spiritual', 1, /god|spirit|soul|pray/],
    ['SEL040000', 'SELF-HELP / Communication & Social Skills', 0, /talk|listen|relationship|communicat/],
    ['SEL035000', 'SELF-HELP / Self-Management / Time Management', 0, /time|habit|discipline|productiv/],
    ['SEL004000', 'SELF-HELP / Affirmations', 0, /affirm|declare|i am/],
  ],
  memoir: [
    ['BIO026000', 'BIOGRAPHY & AUTOBIOGRAPHY / Memoirs', 6, null],
    ['BIO000000', 'BIOGRAPHY & AUTOBIOGRAPHY / General', 5, null],
    ['BIO002000', 'BIOGRAPHY & AUTOBIOGRAPHY / Cultural & Regional', 3, /africa|nigeria|cameroon|ghana|village|culture/],
    ['BIO018000', 'BIOGRAPHY & AUTOBIOGRAPHY / Religious', 2, /god|church|pray|ministry|faith/],
    ['BIO022000', 'BIOGRAPHY & AUTOBIOGRAPHY / Women', 1, /she|her|woman|mother/],
    ['BIO003000', 'BIOGRAPHY & AUTOBIOGRAPHY / Business', 1, /business|company|career/],
    ['BIO019000', 'BIOGRAPHY & AUTOBIOGRAPHY / Educators', 1, /teacher|school|student|class/],
    ['SEL021000', 'SELF-HELP / Motivational & Inspirational', 1, /overcome|hope|inspire/],
  ],
  health: [
    ['HEA000000', 'HEALTH & FITNESS / General', 5, null],
    ['HEA010000', 'HEALTH & FITNESS / Healthy Living', 5, null],
    ['HEA048000', 'HEALTH & FITNESS / Diet & Nutrition / General', 3, /diet|food|eat|meal/],
    ['HEA017000', 'HEALTH & FITNESS / Diet & Nutrition / Nutrition', 2, /nutrition|vitamin|protein/],
    ['HEA019000', 'HEALTH & FITNESS / Diet & Nutrition / Weight Loss', 2, /weight|fat|slim/],
    ['HEA007000', 'HEALTH & FITNESS / Exercise / General', 2, /exercise|workout|walk|fitness/],
    ['HEA032000', 'HEALTH & FITNESS / Alternative Therapies', 1, /natural|herb|remedy/],
    ['HEA011000', 'HEALTH & FITNESS / Herbal Medicine', 1, /herb|leaf|root|plant/],
    ['HEA016000', 'HEALTH & FITNESS / Naturopathy', 0, /natural/],
    ['HEA024000', 'HEALTH & FITNESS / Women\'s Health', 0, /women|pregnan|menstru/],
  ],
  children: [
    ['JUV000000', 'JUVENILE FICTION / General', 6, null],
    ['JUV039060', 'JUVENILE FICTION / Social Themes / Friendship', 3, /friend/],
    ['JUV013000', 'JUVENILE FICTION / Family / General', 3, /mummy|daddy|mother|father|family/],
    ['JUV002000', 'JUVENILE FICTION / Animals / General', 2, /dog|cat|bird|lion|rabbit|bunny|puppy|animal/],
    ['JUV051000', 'JUVENILE FICTION / Imagination & Play', 2, /play|imagin|pretend|game/],
    ['JUV001000', 'JUVENILE FICTION / Action & Adventure / General', 1, /adventure|journey|explore/],
    ['JUV030020', 'JUVENILE FICTION / People & Places / Africa', 1, /africa|village|nigeria|cameroon|ghana/],
  ],
};

// The 7 that fit this book best, most fitting first.
function suggestGenres(book, kind) {
  const list = LISTS[kind] || LISTS.selfhelp;
  const text = `${book.title || ''} ${book.subtitle || ''} ${book.chapters.map((c) => `${c.title || ''} ${c.blocks.filter((b) => b.runs).map((b) => plain(b.runs)).join(' ')}`).join(' ')}`.toLowerCase();
  const words = Math.max(1, text.split(/\s+/).length);
  const scored = list.map(([code, name, base, re], order) => {
    let s = base;
    if (re) {
      const hits = (text.match(new RegExp(re.source, 'g')) || []).length;
      s += Math.min(5, (hits / words) * 2000); // how much the book talks about it
    }
    return { code, name, score: s, order };
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).slice(0, 7).map(({ code, name }) => ({ code, name }));
}

module.exports = { suggestGenres, GENRE_LISTS: LISTS };
