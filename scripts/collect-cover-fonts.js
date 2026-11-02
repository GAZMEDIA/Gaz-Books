// Copies GazBook's cover fonts (free, SIL Open Font License, from the
// @fontsource packages on npm) into fonts/cover/ with a list file, so the
// design card from Gemini can name any of them and every language's cover
// uses exactly that font.
//   cd <folder with the @fontsource packages installed> && node <repo>/scripts/collect-cover-fonts.js <repo>/fonts/cover
const fs = require('fs');
const path = require('path');

const out = process.argv[2];
const SUBSETS = ['latin', 'latin-ext', 'cyrillic', 'cyrillic-ext'];
// family: [package, kind, weights ("700" or "400i")]
const FONTS = {
  'Playfair Display': ['playfair-display', 'elegant serif', ['400', '700', '900', '400i', '700i']],
  'Cinzel': ['cinzel', 'classical capitals', ['400', '700', '900']],
  'Cormorant Garamond': ['cormorant-garamond', 'refined serif', ['500', '700', '500i']],
  'EB Garamond': ['eb-garamond', 'classic book serif', ['500', '700', '500i']],
  'Libre Baskerville': ['libre-baskerville', 'traditional serif', ['400', '700', '400i']],
  'DM Serif Display': ['dm-serif-display', 'high-contrast display serif', ['400', '400i']],
  'Bodoni Moda': ['bodoni-moda', 'fashion serif', ['500', '800', '500i']],
  'Abril Fatface': ['abril-fatface', 'heavy display serif', ['400']],
  'Merriweather': ['merriweather', 'sturdy serif', ['400', '700', '900', '400i']],
  'Lora': ['lora', 'warm serif', ['400', '700', '400i']],
  'Marcellus': ['marcellus', 'carved capitals', ['400']],
  'Bebas Neue': ['bebas-neue', 'tall condensed sans', ['400']],
  'Anton': ['anton', 'heavy condensed sans', ['400']],
  'Oswald': ['oswald', 'condensed sans', ['400', '600', '700']],
  'Archivo Black': ['archivo-black', 'heavy sans', ['400']],
  'Montserrat': ['montserrat', 'modern geometric sans', ['300', '500', '700', '900']],
  'Poppins': ['poppins', 'friendly geometric sans', ['300', '600', '800']],
  'Raleway': ['raleway', 'light elegant sans', ['300', '500', '800']],
  'Josefin Sans': ['josefin-sans', 'vintage geometric sans', ['300', '600', '700']],
  'League Spartan': ['league-spartan', 'bold geometric sans', ['500', '800']],
  'Great Vibes': ['great-vibes', 'flowing script', ['400']],
  'Dancing Script': ['dancing-script', 'casual script', ['500', '700']],
};

fs.mkdirSync(out, { recursive: true });
const list = [];
const families = {};
for (const [family, [pkg, kind, weights]] of Object.entries(FONTS)) {
  const dir = path.dirname(require.resolve(`@fontsource/${pkg}/package.json`, { paths: [process.cwd()] }));
  const subsetsFound = new Set();
  for (const w of weights) {
    const italic = w.endsWith('i');
    const weight = parseInt(w, 10);
    const css = path.join(dir, `${weight}${italic ? '-italic' : ''}.css`);
    if (!fs.existsSync(css)) { console.warn(`missing ${family} ${w}`); continue; }
    const text = fs.readFileSync(css, 'utf8');
    for (const m of text.matchAll(/\/\* ([\w-]+?)-(\d+)-(normal|italic) \*\/\s*@font-face\s*\{([^}]*)\}/g)) {
      const subset = m[1].slice(pkg.length + 1);
      if (!SUBSETS.includes(subset)) continue;
      const src = /url\(\.\/files\/([^)]+\.woff2)\)/.exec(m[4]);
      const range = /unicode-range:\s*([^;]+);/.exec(m[4]);
      if (!src) continue;
      fs.copyFileSync(path.join(dir, 'files', src[1]), path.join(out, src[1]));
      list.push({ family, weight, style: italic ? 'italic' : 'normal', file: src[1], range: range ? range[1].trim() : '' });
      subsetsFound.add(subset);
    }
  }
  families[family] = { kind, weights, cyrillic: subsetsFound.has('cyrillic') };
}
fs.writeFileSync(path.join(out, 'fonts.json'), JSON.stringify({ families, faces: list }, null, 1));
fs.writeFileSync(path.join(out, 'LICENSE.txt'), `These fonts are free software under the SIL Open Font License 1.1 (https://openfontlicense.org).
They come from the Fontsource project (https://fontsource.org), which packages Google Fonts.
${Object.keys(FONTS).join(', ')}.
`);
const bytes = fs.readdirSync(out).reduce((n, f) => n + fs.statSync(path.join(out, f)).size, 0);
console.log(`${Object.keys(families).length} families, ${list.length} font files, ${(bytes / 1e6).toFixed(1)} MB`);
console.log('with Cyrillic (Ukrainian):', Object.entries(families).filter(([, v]) => v.cyrillic).map(([k]) => k).join(', '));
