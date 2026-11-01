// The languages Amazon KDP accepts (kdp.amazon.com/help/topic/G200673300),
// with what GazBook can make in each.
//   print: GazBook makes the paperback PDF too (left-to-right Latin, Greek
//          and Cyrillic letters). Otherwise the eBook and Word file only.
//   kdpPrint: Amazon accepts a paperback in this language at all.
const LANGS = [
  ['en', 'English', '🇬🇧'], ['fr', 'French', '🇫🇷'], ['es', 'Spanish', '🇪🇸'], ['de', 'German', '🇩🇪'],
  ['it', 'Italian', '🇮🇹'], ['pt', 'Portuguese', '🇵🇹'], ['nl', 'Dutch', '🇳🇱'], ['pl', 'Polish', '🇵🇱'],
  ['uk', 'Ukrainian', '🇺🇦'], ['da', 'Danish', '🇩🇰'], ['sv', 'Swedish', '🇸🇪'], ['no', 'Norwegian', '🇳🇴'],
  ['fi', 'Finnish', '🇫🇮'], ['is', 'Icelandic', '🇮🇸'], ['ga', 'Irish', '🇮🇪'], ['cy', 'Welsh', '🏴'],
  ['gd', 'Scottish Gaelic', '🏴'], ['ca', 'Catalan', '🏳️'], ['gl', 'Galician', '🏳️'], ['eu', 'Basque', '🏳️'],
  ['af', 'Afrikaans', '🇿🇦'], ['lb', 'Luxembourgish', '🇱🇺'], ['fy', 'Frisian', '🇳🇱'], ['br', 'Breton', '🇫🇷'],
  ['oc', 'Occitan (Provençal)', '🇫🇷'], ['la', 'Latin', '🏛️'], ['co', 'Corsican', '🇫🇷'], ['rm', 'Romansh', '🇨🇭'],
  // Amazon takes paperbacks in these, but GazBook makes only the eBook and Word file for now
  ['ja', 'Japanese', '🇯🇵', { print: false }], ['he', 'Hebrew', '🇮🇱', { print: false }], ['yi', 'Yiddish', '🏳️', { print: false }],
  // Amazon: eBook only
  ['ar', 'Arabic', '🇸🇦', { print: false, kdpPrint: false }], ['hi', 'Hindi', '🇮🇳', { print: false, kdpPrint: false }],
  ['gu', 'Gujarati', '🇮🇳', { print: false, kdpPrint: false }], ['mr', 'Marathi', '🇮🇳', { print: false, kdpPrint: false }],
  ['ml', 'Malayalam', '🇮🇳', { print: false, kdpPrint: false }], ['ta', 'Tamil', '🇮🇳', { print: false, kdpPrint: false }],
  ['fa', 'Persian', '🇮🇷', { print: false, kdpPrint: false }],
].map(([code, name, flag, o = {}]) => ({ code, name, flag, print: o.print !== false, kdpPrint: o.kdpPrint !== false }));

const byCode = Object.fromEntries(LANGS.map((l) => [l.code, l]));

// "About the Author" and other headings, so they read right in each edition.
const HEADINGS = {
  aboutAuthor: {
    en: 'About the Author', fr: 'À propos de l\'auteur', es: 'Sobre el autor', de: 'Über den Autor', it: 'L\'autore',
    pt: 'Sobre o autor', nl: 'Over de auteur', pl: 'O autorze', uk: 'Про автора', da: 'Om forfatteren',
    sv: 'Om författaren', no: 'Om forfatteren', fi: 'Kirjoittajasta', is: 'Um höfundinn', ga: 'Faoin Údar',
    cy: 'Am yr Awdur', gd: 'Mun Ùghdar', ca: 'Sobre l\'autor', gl: 'Sobre o autor', eu: 'Egileari buruz',
    af: 'Oor die skrywer', lb: 'Iwwer den Auteur', fy: 'Oer de skriuwer', br: 'Diwar-benn ar skrivagner',
    oc: 'A prepaus de l\'autor', la: 'De auctore', co: 'Nantu à l\'autore', rm: 'Davart l\'autur', ja: '著者について', he: 'על המחבר', yi: 'וועגן דעם מחבר', ar: 'عن المؤلف',
    hi: 'लेखक के बारे में', gu: 'લેખક વિશે', mr: 'लेखकाविषयी', ml: 'ഗ്രന്ഥകർത്താവിനെക്കുറിച്ച്', ta: 'ஆசிரியர் பற்றி',
    fa: 'درباره نویسنده',
  },
};
const heading = (key, code) => HEADINGS[key][code] || HEADINGS[key][String(code || '').split('-')[0]] || HEADINGS[key].en;

module.exports = { KDP_LANGUAGES: LANGS, kdpLanguage: (c) => byCode[c], heading };
