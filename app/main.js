// GazBook desktop app (Windows). The window is plain HTML in app/ui; all the
// book work happens here in the main process using the engine in src/.
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { readBook, buildAll, safeName } = require('../src/engine');
const { googleLanguages, googleFreeLanguages, translateStrings } = require('../src/translate');
const { offlineTranslate, offlineLanguages } = require('./offline-main');
const { TRIM_SIZES } = require('../src/kdp');
const license = require('../src/license');

let win;
let current = null; // { book, file }

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    for (const k of ['googleKey', 'claudeKey', 'pexelsKey']) {
      if (s[k] && s[`${k}Enc`] && safeStorage.isEncryptionAvailable()) s[k] = safeStorage.decryptString(Buffer.from(s[k], 'base64'));
      delete s[`${k}Enc`];
    }
    return s;
  } catch { return {}; }
}
function saveSettings(s) {
  const out = { ...s };
  for (const k of ['googleKey', 'claudeKey', 'pexelsKey']) {
    if (out[k] && safeStorage.isEncryptionAvailable()) { out[k] = safeStorage.encryptString(out[k]).toString('base64'); out[`${k}Enc`] = true; }
  }
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(out, null, 2));
}

async function openBook(file) {
  const { book, summary } = await readBook(fs.readFileSync(file), file);
  current = { book, file };
  return { ...summary, file: path.basename(file) };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100, height: 820, minWidth: 820, minHeight: 600,
    title: 'GazBook', backgroundColor: '#f6f3ee',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

// The free week starts the first time the app opens.
function licenseNow() {
  const s = loadSettings();
  if (!s.firstRun) { s.firstRun = new Date().toISOString().slice(0, 10); saveSettings(s); }
  return license.licenseState(s);
}
const need = (feature) => license.need(licenseNow(), feature);

ipcMain.handle('info', () => ({ version: app.getVersion(), trims: Object.keys(TRIM_SIZES) }));
ipcMain.handle('license-get', () => ({ ...licenseNow(), email: loadSettings().email || '', buyUrl: license.BUY_URL }));
ipcMain.handle('license-set', (_e, { email, code }) => {
  const plan = license.readCode(email, code);
  if (!plan) throw new Error('That code does not work with this email. Check both, or copy the code again from your email.');
  if (plan.ends < new Date().toISOString().slice(0, 10)) throw new Error(`That code ended on ${plan.ends}. Buy or renew a plan to get a new one.`);
  saveSettings({ ...loadSettings(), email: email.trim().toLowerCase(), code: code.trim() });
  return licenseNow();
});
ipcMain.handle('settings-get', () => loadSettings());
ipcMain.handle('settings-set', (_e, s) => { saveSettings({ ...loadSettings(), ...s }); return true; });

ipcMain.handle('pick-book', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose your book', properties: ['openFile'],
    filters: [{ name: 'Books', extensions: ['docx', 'pdf', 'txt', 'md'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  return openBook(r.filePaths[0]);
});
ipcMain.handle('open-book-path', (_e, file) => openBook(file));

ipcMain.handle('pick-cover', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose your Kindle cover picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png'] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const f = r.filePaths[0];
  const type = /\.png$/i.test(f) ? 'png' : 'jpeg';
  return `data:image/${type};base64,${fs.readFileSync(f).toString('base64')}`;
});

ipcMain.handle('languages', async (_e, engine, key) => (engine === 'gfree' ? googleFreeLanguages()
  : engine === 'offline' ? offlineLanguages() : googleLanguages(key)));

async function translatedCover(spec, b, pages, tr) {
  const [tagline, blurb, bio, subtitle] = await translateStrings([spec.tagline, spec.blurb, spec.bio, spec.subtitle], tr);
  const { pdf, kindle } = await renderCover({ ...spec, title: b.title, subtitle, tagline, blurb, bio, pages });
  const base = `${safeName(b.title)} (${tr.target})`;
  return {
    kindle: `data:image/jpeg;base64,${kindle.toString('base64')}`,
    files: [
      { name: `${base} - paperback cover ${spec.trim} ${pages}p.pdf`, buffer: pdf, kind: 'coverpdf' },
      { name: `${base} - Kindle cover.jpg`, buffer: kindle, kind: 'coverjpg' },
    ],
  };
}

ipcMain.handle('build', async (_e, opts) => {
  if (!current) throw new Error('Choose your book first.');
  need('format');
  const s = loadSettings();
  // one build per language; Studio can add more languages to one go
  const jobs = [opts];
  if (opts.translate) {
    const langs = [opts.translate, ...(opts.translate.more || [])];
    need('translate');
    if (langs.length > 1) need('many');
    jobs.length = 0;
    for (const t of langs) {
      const tr = { engine: t.engine, target: t.target, language: t.language, source: opts.source || 'en', googleKey: s.googleKey, claudeKey: s.claudeKey };
      if (tr.engine === 'google' && !s.googleKey) throw new Error('Add your Google Translate key in Settings first, or choose "Google free".');
      if (tr.engine === 'claude' && !s.claudeKey) throw new Error('Add your Claude key in Settings first.');
      if (tr.engine === 'claude') need('ai');
      if (tr.engine === 'offline') {
        tr.offline = (texts, src, tgt) => offlineTranslate(texts, src, tgt, { onStatus: (msg) => win.webContents.send('progress', { step: msg, p: 0 }) });
      }
      const job = { ...opts, translate: tr };
      // the cover in this language too: same design, translated words, spine fitted to the new page count
      if (opts.coverSpec) {
        need('cover');
        job.makeCover = (b, pages) => translatedCover(opts.coverSpec, b, pages, tr);
      }
      jobs.push(job);
    }
  }
  const results = [];
  for (const [i, job] of jobs.entries()) {
    const tag = jobs.length > 1 ? ` ${job.translate.language} (${i + 1} of ${jobs.length})` : '';
    results.push(await buildAll(current.book, job, (step, p) => win.webContents.send('progress', { step: step + tag, p })));
  }
  const r = await dialog.showOpenDialog(win, {
    title: `Where should I save your ${results.reduce((n, res) => n + res.files.length, 0)} book files?`, buttonLabel: 'Save here',
    defaultPath: s.lastFolder || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const folder = r.filePaths[0];
  saveSettings({ ...loadSettings(), lastFolder: folder });
  const saved = results.flatMap((res) => res.files).map((f) => { const p = path.join(folder, f.name); fs.writeFileSync(p, f.buffer); return { name: f.name, path: p, kind: f.kind }; });
  return { folder, saved, pageCount: results[0].pageCount, notes: [...new Set(results.flatMap((res) => res.notes))] };
});

const { renderCover } = require('./cover-main')({ getWin: () => win, getBook: () => current && current.book, loadSettings, saveSettings, need });

ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('open-link', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
