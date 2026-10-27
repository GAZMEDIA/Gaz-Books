// GazBook desktop app (Windows). The window is plain HTML in app/ui; all the
// book work happens here in the main process using the engine in src/.
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');
const { readBook, buildAll } = require('../src/engine');
const { googleLanguages } = require('../src/translate');
const { TRIM_SIZES } = require('../src/kdp');

let win;
let current = null; // { book, file }

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    for (const k of ['googleKey', 'claudeKey']) {
      if (s[k] && s[`${k}Enc`] && safeStorage.isEncryptionAvailable()) s[k] = safeStorage.decryptString(Buffer.from(s[k], 'base64'));
      delete s[`${k}Enc`];
    }
    return s;
  } catch { return {}; }
}
function saveSettings(s) {
  const out = { ...s };
  for (const k of ['googleKey', 'claudeKey']) {
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

ipcMain.handle('info', () => ({ version: app.getVersion(), trims: Object.keys(TRIM_SIZES) }));
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

ipcMain.handle('languages', async (_e, key) => googleLanguages(key));

ipcMain.handle('build', async (_e, opts) => {
  if (!current) throw new Error('Choose your book first.');
  const s = loadSettings();
  if (opts.translate) {
    opts.translate.googleKey = s.googleKey;
    opts.translate.claudeKey = s.claudeKey;
    if (opts.translate.engine === 'google' && !s.googleKey) throw new Error('Add your Google Translate key in Settings first.');
    if (opts.translate.engine === 'claude' && !s.claudeKey) throw new Error('Add your Claude key in Settings first.');
  }
  const result = await buildAll(current.book, opts, (step, p) => win.webContents.send('progress', { step, p }));
  const r = await dialog.showOpenDialog(win, {
    title: 'Where should I save your 3 book files?', buttonLabel: 'Save here',
    defaultPath: s.lastFolder || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  const folder = r.filePaths[0];
  saveSettings({ ...s, lastFolder: folder });
  const saved = result.files.map((f) => { const p = path.join(folder, f.name); fs.writeFileSync(p, f.buffer); return { name: f.name, path: p, kind: f.kind }; });
  return { folder, saved, pageCount: result.pageCount, notes: result.notes };
});

ipcMain.handle('open-path', (_e, p) => shell.openPath(p));
ipcMain.handle('show-in-folder', (_e, p) => shell.showItemInFolder(p));
ipcMain.handle('open-link', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
