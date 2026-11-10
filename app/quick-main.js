// The one-click screens (app/ui/quick.html), main-process side: open the
// book, the author's photo and words, make everything, open Gemini for the
// cover picture, and redraw every cover when the picture comes back.
const { app, ipcMain, dialog, shell, clipboard, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { readBook, safeName } = require('../src/engine');
const { makeEverything, drawCovers, backCover, updateBack, finish, blanks } = require('../src/quick');
const { writeGooglePlay, isbnOk, PARTNER_CENTER } = require('../src/googleplay');
const coverDesign = require('../src/cover-design');
const marketingKit = require('../src/marketing-kit');
const { KDP_LANGUAGES } = require('../src/kdp-languages');
const { offlineTranslate, modelsDir } = require('./offline-main');
const { fastLanguageCodes, getManifest } = require('../src/fast-translate');

const GEMINI_APP_PAGE = 'https://gemini.google/desktop/';
const GEMINI_WEB = 'https://gemini.google.com/app';

module.exports = function quickMain({ getWin, loadSettings, saveSettings, need, renderCover, saveAsJpeg, previewCover }) {
  let current = null; // { book, file, summary }
  let last = null; // the last result, so the covers can be redrawn with the picture
  let kitFiles = []; // the author's own marketing kit (Word, PDF or text files)

  const send = (d) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send('quick-progress', d); };

  async function open(file) {
    const { book, summary } = await readBook(fs.readFileSync(file), file);
    current = { book, file, summary };
    last = null;
    const s = loadSettings();
    const saved = (s.authors || {})[(summary.author || '').trim().toLowerCase()] || s.lastAuthor || {};
    const photo = saved.photo && fs.existsSync(saved.photo) ? photoFromFile(saved.photo) : null;
    return {
      ...summary, file: path.basename(file),
      aboutAuthorText: summary.aboutAuthor || saved.text || '',
      aboutBook: saved.aboutBook && saved.title === summary.title ? saved.aboutBook : '',
      photo,
    };
  }
  ipcMain.handle('quick-pick-book', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose your book', properties: ['openFile'], filters: [{ name: 'Books', extensions: ['docx', 'pdf', 'txt', 'md'] }] });
    return r.canceled || !r.filePaths[0] ? null : open(r.filePaths[0]);
  });
  ipcMain.handle('quick-open-book', (_e, file) => open(file));

  // ------------------------------------------------------------ the author's marketing kit

  // One file or several; each new file adds to the kit (a part comes from the first file that has it).
  async function addKit(files) {
    const ok = files.filter((f) => /\.(docx|pdf|txt|md)$/i.test(f));
    if (!ok.length) throw new Error('GazBook reads marketing kits saved as Word (.docx), PDF or text files.');
    kitFiles = [...new Set([...kitFiles, ...ok])];
    return kitNow();
  }
  async function kitNow() {
    if (!kitFiles.length) return null;
    const k = await marketingKit.readKit(kitFiles);
    const f = marketingKit.found(k);
    if (!f.has.length) throw new Error('GazBook could not find a description, cover prompt, keywords or categories in that file. Check it has headings such as "Description", "Keywords" and "Categories".');
    return { ...f, title: k.title, subtitle: k.subtitle, series: k.series, bio: k.bio, tagline: k.tagline, files: k.files,
      coverPrompt: k.coverPrompt, keywords: k.keywords, categories: k.categories, description: k.description };
  }
  ipcMain.handle('quick-pick-kit', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose your marketing kit (you can pick several files)', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Marketing kit', extensions: ['docx', 'pdf', 'txt', 'md'] }] });
    return r.canceled || !r.filePaths.length ? null : addKit(r.filePaths);
  });
  ipcMain.handle('quick-drop-kit', (_e, files) => addKit(files));
  ipcMain.handle('quick-clear-kit', () => { kitFiles = []; return null; });

  // ------------------------------------------------------------ author photo

  // Square-ish portrait crop, at most 900 px wide, plus a black-and-white copy for the paperback.
  function photoFromFile(file) {
    let img = nativeImage.createFromPath(file);
    if (img.isEmpty()) throw new Error('That photo could not be opened. Try a JPG or PNG photo.');
    const { width: w, height: h } = img.getSize();
    const ratio = 4 / 5;
    const cw = Math.min(w, Math.round(h * ratio)); const ch = Math.min(h, Math.round(cw / ratio));
    img = img.crop({ x: Math.round((w - cw) / 2), y: Math.round((h - ch) * 0.3), width: cw, height: ch });
    if (cw > 900) img = img.resize({ width: 900, quality: 'best' });
    const size = img.getSize();
    const bmp = img.toBitmap(); // BGRA
    for (let i = 0; i < bmp.length; i += 4) {
      const y = Math.round(0.114 * bmp[i] + 0.587 * bmp[i + 1] + 0.299 * bmp[i + 2]);
      bmp[i] = y; bmp[i + 1] = y; bmp[i + 2] = y;
    }
    const grey = nativeImage.createFromBitmap(bmp, size);
    return {
      file,
      photo: `data:image/jpeg;base64,${img.toJPEG(90).toString('base64')}`,
      photoGrey: `data:image/jpeg;base64,${grey.toJPEG(90).toString('base64')}`,
      small: cw < 450 ? 'This photo is a bit small and may look blurry in print. Use a bigger one if you have it.' : '',
    };
  }
  ipcMain.handle('quick-pick-photo', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose your photo', properties: ['openFile'], filters: [{ name: 'Photos', extensions: ['jpg', 'jpeg', 'png'] }] });
    return r.canceled || !r.filePaths[0] ? null : keepPhoto(r.filePaths[0]);
  });
  ipcMain.handle('quick-drop-photo', (_e, file) => keepPhoto(file));
  function keepPhoto(file) {
    // a copy in GazBook's own folder, so it is there for the next book too
    const dir = path.join(app.getPath('userData'), 'author');
    fs.mkdirSync(dir, { recursive: true });
    const keep = path.join(dir, `photo${path.extname(file).toLowerCase() || '.jpg'}`);
    if (path.resolve(file) !== path.resolve(keep)) fs.copyFileSync(file, keep);
    return photoFromFile(keep);
  }

  // ------------------------------------------------------------ languages

  ipcMain.handle('quick-languages', async () => {
    try { await getManifest(modelsDir()); } catch { /* offline and never used: show them all */ }
    const have = fastLanguageCodes(modelsDir());
    const ready = (code) => fs.existsSync(path.join(modelsDir(), 'ready-' + code));
    return KDP_LANGUAGES.filter((l) => l.code === 'en' || !have || have.includes(l.code)).map((l) => ({ ...l, ready: l.code === 'en' || ready(l.code) }));
  });

  // ------------------------------------------------------------ make everything

  ipcMain.handle('quick-make', async (_e, o) => {
    if (!current) throw new Error('Put your book in first.');
    need('format');
    const translations = o.languages.filter((c) => c !== 'en');
    if (translations.length) need('translate');
    if (translations.length > 1) need('many');
    need('cover');
    const s = loadSettings();
    const key = (o.author || '').trim().toLowerCase();
    const remember = { text: o.aboutAuthor.text, photo: o.photoFile || '', aboutBook: o.aboutBook, title: o.title };
    saveSettings({ ...s, trim: o.trim, authors: { ...(s.authors || {}), [key]: remember }, lastAuthor: remember, lastLanguages: o.languages });
    const folder = path.join(app.getPath('documents'), 'GazBook', safeName(o.title || current.summary.title));
    fs.rmSync(folder, { recursive: true, force: true });
    const isbns = {};
    for (const m of String(o.isbns || '').matchAll(/([a-z]{2})\s*[:=]?\s*(97[89][\d\s-]{10,16})/gi)) {
      const v = m[2].replace(/[\s-]/g, '');
      if (!isbnOk(v)) throw new Error(`"${m[2].trim()}" is not a valid ISBN. It should be 13 digits starting with 978 or 979.`);
      isbns[m[1].toLowerCase()] = v;
    }
    const kit = kitFiles.length ? await marketingKit.readKit(kitFiles) : null;
    const res = await makeEverything(current.book, { ...o, isbns, folder, kit }, {
      offline: (texts, src, tgt, onPart) => offlineTranslate(texts, src, tgt, { onStatus: (msg) => send({ step: msg, p: -1 }), onProgress: onPart }),
      renderCover,
    }, send);
    for (const c of o.languages) try { fs.writeFileSync(path.join(modelsDir(), 'ready-' + c), ''); } catch { /* not important */ }
    last = res;
    return withWrap(summary(res));
  });
  // the whole paperback cover (back, spine, front) of the original, to check on screen
  const withWrap = async (sum) => {
    const e = last && (last.editions.find((x) => x.code === last.source) || last.editions[0]);
    if (e && e.printMade && previewCover) sum.wrap = await previewCover(e.coverSpec).catch(() => '');
    return sum;
  };
  const summary = (res) => ({
    folder: res.folder, zip: res.zipPath, seconds: res.seconds, genre: res.genre, notes: res.notes,
    editions: res.editions.map((e) => ({ code: e.code, name: e.name, pages: e.pages, printMade: e.printMade, files: e.files.map((f) => path.basename(f)) })),
    back: backCover(res),
    fromKit: !!res.fromKit, kitPrompt: res.fromKit && res.prompt !== res.designRequest ? res.prompt : '',
    blanks: blanks(res),
    finished: !!res.finished,
    kindleCover: res.editions[0] ? `data:image/jpeg;base64,${fs.readFileSync(path.join(res.editions[0].dir, `${res.editions[0].base} - Kindle cover.jpg`)).toString('base64')}` : '',
  });

  // ------------------------------------------------------------ Gemini

  // The Gemini app for Windows has no published way for other programs to open it,
  // so we look for its Start-menu shortcut (or the program itself) like a person would.
  function findGemini() {
    const starts = [
      path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ];
    const found = [];
    const look = (dir, depth) => {
      let list = [];
      try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const d of list) {
        const p = path.join(dir, d.name);
        if (d.isDirectory() && depth < 2) look(p, depth + 1);
        else if (/^(google )?gemini\b.*\.lnk$/i.test(d.name) && !/cli|uninstall/i.test(d.name)) found.push(p);
      }
    };
    for (const s of starts) look(s, 0);
    const exes = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Gemini', 'Gemini.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Google', 'Gemini', 'Gemini.exe'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Gemini', 'Gemini.exe'),
    ];
    return found[0] || exes.find((e) => fs.existsSync(e)) || null;
  }
  // what: the text to copy (a cover idea or the words request)
  ipcMain.handle('quick-gemini', async (_e, how, what) => {
    if (what) clipboard.writeText(what); else if (last) clipboard.writeText(last.prompt);
    if (how === 'web') { await shell.openExternal(GEMINI_WEB); saveSettings({ ...loadSettings(), geminiWay: 'web' }); return { opened: 'web' }; }
    if (how === 'get') { await shell.openExternal(GEMINI_APP_PAGE); return { opened: 'get' }; }
    const g = process.platform === 'win32' ? findGemini() : null;
    if (g) {
      const err = await shell.openPath(g);
      if (!err) { saveSettings({ ...loadSettings(), geminiWay: 'app' }); return { opened: 'app' }; }
    }
    if (loadSettings().geminiWay === 'web') { await shell.openExternal(GEMINI_WEB); return { opened: 'web' }; }
    return { opened: null }; // the window offers: get the free app, or use Gemini on the web
  });

  // ------------------------------------------------------------ the cover picture

  // The no-words picture from Gemini (+ the design card): every language's covers
  // are drawn with the same art, fonts, colours and places.
  // ready: the picture is a finished front cover with the title and name already on it
  async function drawAll(card, ready) {
    const design = ready ? null : coverDesign.readCard(card);
    const pic = last.coverPic;
    let bg; let ink = '#ffffff';
    if (!design) { // no card: the back takes a deep colour from the picture
      const avg = nativeImage.createFromPath(pic.path).resize({ width: 1, height: 1, quality: 'best' }).toBitmap();
      bg = `#${[avg[2], avg[1], avg[0]].map((v) => Math.round(v * 0.35).toString(16).padStart(2, '0')).join('')}`;
    }
    let n = 0;
    const others = [];
    for (const ed of last.editions) {
      // a finished cover has the original's words on it: it is used for the original language only
      if (ready && ed.code !== last.source) { others.push(ed.name); continue; }
      send({ step: `Drawing the ${ed.name} covers`, p: n++ / last.editions.length });
      await drawCovers(ed, renderCover, { image: pic.path, imageMode: 'front', design: design || null, frontReady: !!ready, ...(design ? {} : { bg, ink }) });
    }
    last.design = design;
    last.finished = false; // the zip is made again at "Finish my books"
    send({ step: 'Covers ready', p: 1 });
    const sharpW = 1838; // pixels across the front for a sharp 6x9 print
    const notes = [];
    if (others.length) notes.push(`Your finished cover has the words in your original language, so it is used for that book only. ${others.join(', ')} keep${others.length === 1 ? 's' : ''} GazBook's cover in ${others.length === 1 ? 'its' : 'their'} own language.`);
    if (ready) notes.push('The back cover and spine are made by GazBook to match. Check that your title and name are not too close to the edges of the front.');
    if (pic.w < sharpW * 0.66) notes.push('This picture is a little small for a sharp paperback cover. If you can, ask Gemini for the same picture "in high resolution".');
    if (card && card.trim() && !design) notes.push('GazBook could not read that design card, so it used its own simple style. Paste the lines that start with TITLE:, SUBTITLE:, AUTHOR: and BACK:.');
    for (const e of design ? [design.title, design.subtitle, design.author].filter(Boolean) : []) if (!e.fontKnown && e.asked) notes.push(`Gemini used "${e.asked}", which GazBook doesn't have; it used ${e.font}, the closest.`);
    return withWrap({ ...summary(last), warn: notes.join(' '), understood: coverDesign.describe(design) });
  }
  async function usePicture(file, card, ready) {
    if (!last) throw new Error('Make your books first, then add the cover picture.');
    const ext = path.extname(file).slice(1).toLowerCase();
    last.coverPic = await saveAsJpeg(fs.readFileSync(file), `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    return drawAll(card, ready);
  }
  ipcMain.handle('quick-apply-design', (_e, card) => {
    if (!last || !last.coverPic) throw new Error('First put in the picture WITHOUT words from Gemini (step 3).');
    return drawAll(card);
  });
  ipcMain.handle('quick-pick-picture', async (_e, card, ready) => {
    const r = await dialog.showOpenDialog(getWin(), { title: ready ? 'Choose your finished front cover' : 'Choose your cover picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
    return r.canceled || !r.filePaths[0] ? null : usePicture(r.filePaths[0], card, ready);
  });
  ipcMain.handle('quick-drop-picture', (_e, file, card, ready) => usePicture(file, card, ready));
  // "Check your back cover": new words or photo, every language redone
  ipcMain.handle('quick-update-back', async (_e, vals) => {
    if (!last) throw new Error('Make your books first.');
    last.finished = false;
    await updateBack(last, vals, {
      offline: (texts, src, tgt, onPart) => offlineTranslate(texts, src, tgt, { onStatus: (msg) => send({ step: msg, p: -1 }), onProgress: onPart }),
      renderCover,
    }, send);
    // remember the author's words for the next book
    const s = loadSettings();
    const key = (last.editions[0].author || '').trim().toLowerCase();
    const remember = { ...((s.authors || {})[key] || {}), text: vals.bio, photo: vals.photoFile || ((s.authors || {})[key] || {}).photo || '' };
    saveSettings({ ...s, authors: { ...(s.authors || {}), [key]: remember }, lastAuthor: remember });
    return withWrap(summary(last));
  });
  // the last stage: Google Play folder and the zip
  ipcMain.handle('quick-finish', async () => {
    if (!last) throw new Error('Make your books first.');
    send({ step: 'Putting everything in one zip file', p: 0.5 });
    await finish(last);
    send({ step: 'Done', p: 1 });
    return summary(last);
  });
  ipcMain.handle('quick-prompt', () => (last ? { design: last.designRequest, words: last.wordsPrompt } : null));
  ipcMain.handle('quick-copy', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
  ipcMain.handle('quick-google-play', async (_e, what) => {
    if (what === 'site') return shell.openExternal(PARTNER_CENTER);
    if (last) return shell.openPath(path.join(last.folder, 'Google Play Books'));
    return null;
  });
};
