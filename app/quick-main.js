// The one-click screens (app/ui/quick.html), main-process side: open the
// book, the author's photo and words, make everything, open Gemini for the
// cover picture, and redraw every cover when the picture comes back.
const { app, ipcMain, dialog, shell, clipboard, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { readBook, safeName } = require('../src/engine');
const { makeEverything, drawCovers, zipAll } = require('../src/quick');
const { writeGooglePlay, isbnOk, PARTNER_CENTER } = require('../src/googleplay');
const { KDP_LANGUAGES } = require('../src/kdp-languages');
const { offlineTranslate, modelsDir } = require('./offline-main');
const { fastLanguageCodes, getManifest } = require('../src/fast-translate');

const GEMINI_APP_PAGE = 'https://gemini.google/desktop/';
const GEMINI_WEB = 'https://gemini.google.com/app';

module.exports = function quickMain({ getWin, loadSettings, saveSettings, need, renderCover, saveAsJpeg }) {
  let current = null; // { book, file, summary }
  let last = null; // the last result, so the covers can be redrawn with the picture

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
    const res = await makeEverything(current.book, { ...o, isbns, folder }, {
      offline: (texts, src, tgt, onPart) => offlineTranslate(texts, src, tgt, { onStatus: (msg) => send({ step: msg, p: -1 }), onProgress: onPart }),
      renderCover,
    }, send);
    for (const c of o.languages) try { fs.writeFileSync(path.join(modelsDir(), 'ready-' + c), ''); } catch { /* not important */ }
    last = res;
    return summary(res);
  });
  const summary = (res) => ({
    folder: res.folder, zip: res.zipPath, seconds: res.seconds, genre: res.genre, notes: res.notes,
    editions: res.editions.map((e) => ({ code: e.code, name: e.name, pages: e.pages, printMade: e.printMade, files: e.files.map((f) => path.basename(f)) })),
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
  ipcMain.handle('quick-gemini', async (_e, how) => {
    if (last) clipboard.writeText(last.prompt);
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

  // The picture from Gemini: every language's covers are drawn again with it.
  async function usePicture(file) {
    if (!last) throw new Error('Make your books first, then add the cover picture.');
    const ext = path.extname(file).slice(1).toLowerCase();
    const pic = await saveAsJpeg(fs.readFileSync(file), `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    const ed0 = last.editions[0];
    const sharpW = ed0 ? Math.round(ed0.coverSpec.size ? ed0.coverSpec.size.px.frontW : 1838) : 1838; // pixels for 300 dpi
    const warn = pic.w < sharpW * 0.66 ? 'This picture is a little small for a sharp paperback cover. If you can, ask Gemini again and add "high resolution".' : '';
    // the back cover takes a deep colour from the picture
    const avg = nativeImage.createFromPath(pic.path).resize({ width: 1, height: 1, quality: 'best' }).toBitmap();
    const dark = (v) => Math.round(v * 0.35);
    const bg = `#${[avg[2], avg[1], avg[0]].map((v) => dark(v).toString(16).padStart(2, '0')).join('')}`;
    let n = 0;
    for (const ed of last.editions) {
      send({ step: `Drawing the ${ed.name} covers`, p: n++ / last.editions.length });
      await drawCovers(ed, renderCover, { image: pic.path, imageMode: 'front', bg, ink: '#ffffff' });
    }
    writeGooglePlay(last.folder, last.editions, { genre: last.genre, isbns: last.isbns }); // the new covers there too
    fs.rmSync(last.zipPath, { force: true });
    last.zipPath = await zipAll(last.folder, path.basename(last.zipPath, '.zip'));
    send({ step: 'Covers ready', p: 1 });
    return { ...summary(last), warn };
  }
  ipcMain.handle('quick-pick-picture', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose your cover picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp'] }] });
    return r.canceled || !r.filePaths[0] ? null : usePicture(r.filePaths[0]);
  });
  ipcMain.handle('quick-drop-picture', (_e, file) => usePicture(file));
  ipcMain.handle('quick-prompt', () => (last ? last.prompt : ''));
  ipcMain.handle('quick-google-play', async (_e, what) => {
    if (what === 'site') return shell.openExternal(PARTNER_CENTER);
    if (last) return shell.openPath(path.join(last.folder, 'Google Play Books'));
    return null;
  });
};
