// Cover maker, main-process side: picture download and clean-up, preview
// pictures, and the exact-size print PDF + Kindle cover JPG.
const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { coverSize, coverHtml, imagePrompts, printEstimate } = require('../src/cover');
const { searchImages } = require('../src/images');
const { writeBackCover } = require('../src/ai');

module.exports = function coverMain({ getWin, getBook, loadSettings, saveSettings, need = () => {} }) {
  const workDir = () => { const d = path.join(app.getPath('userData'), 'cover'); fs.mkdirSync(d, { recursive: true }); return d; };

  // A hidden window that draws HTML. Used for previews, the PDF and picture conversion.
  async function withPage(html, fn, { width = 1200, height = 800 } = {}) {
    const file = path.join(workDir(), `page-${crypto.randomUUID()}.html`);
    fs.writeFileSync(file, html);
    const w = new BrowserWindow({ show: false, width, height, useContentSize: true, webPreferences: { offscreen: true, sandbox: true } });
    try {
      await w.loadFile(file);
      await w.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all([...document.images].map((i) => i.decode().catch(() => {}))))');
      await w.webContents.executeJavaScript(`Promise.all([...document.querySelectorAll('.art')].map((el) => new Promise((res) => {
        const m = /url\\("?(.*?)"?\\)/.exec(getComputedStyle(el).backgroundImage); if (!m) return res();
        const i = new Image(); i.onload = i.onerror = res; i.src = m[1]; })))`);
      return await fn(w);
    } finally {
      w.destroy();
      fs.rmSync(file, { force: true });
    }
  }

  // Save any picture as a JPEG we can print (Openverse can return WebP, GIF and more).
  async function saveAsJpeg(buf, mime) {
    let img = nativeImage.createFromBuffer(buf);
    let jpg;
    if (!img.isEmpty()) {
      jpg = img.toJPEG(94);
    } else {
      const data = `data:${mime || 'image/webp'};base64,${buf.toString('base64')}`;
      const html = '<!doctype html><html><body></body></html>';
      const url = await withPage(html, (w) => w.webContents.executeJavaScript(`new Promise((res, rej) => { const i = new Image();
        i.onload = () => { const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
          c.getContext('2d').drawImage(i, 0, 0); res(c.toDataURL('image/jpeg', 0.94)); };
        i.onerror = () => rej(new Error('That picture could not be opened.')); i.src = ${JSON.stringify(data)}; })`));
      jpg = Buffer.from(url.split(',')[1], 'base64');
      img = nativeImage.createFromBuffer(jpg);
    }
    const file = path.join(workDir(), `art-${crypto.randomUUID()}.jpg`);
    fs.writeFileSync(file, jpg);
    const size = img.getSize();
    const thumb = img.resize({ width: 480 }).toDataURL();
    return { path: file, w: size.width, h: size.height, thumb };
  }

  ipcMain.handle('cover-size', (_e, o) => ({ size: coverSize(o), estimate: printEstimate(o) }));

  ipcMain.handle('cover-prompts', (_e, o) => imagePrompts({ ...o, size: coverSize(o) }));

  ipcMain.handle('cover-ai', async (_e, o) => {
    const book = getBook();
    if (!book) throw new Error('Choose your book first (step 1).');
    need('ai');
    const { claudeKey, geminiKey } = loadSettings();
    if (!claudeKey && !geminiKey) throw new Error('Add your free Gemini key in Settings to have the back cover written for you. You can also type it yourself.');
    return writeBackCover(book, { ...o, claudeKey, geminiKey });
  });

  ipcMain.handle('cover-search', async (_e, o) => searchImages({ ...o, pexelsKey: loadSettings().pexelsKey }));

  ipcMain.handle('cover-fetch', async (_e, url) => {
    if (!/^https:\/\//.test(url)) throw new Error('Bad picture address.');
    const r = await fetch(url, { headers: { 'User-Agent': 'GazBook/1.0 (gazgoc.com.ng)' } });
    if (!r.ok) throw new Error(`Could not download that picture (${r.status}).`);
    return saveAsJpeg(Buffer.from(await r.arrayBuffer()), r.headers.get('content-type'));
  });

  ipcMain.handle('cover-pick-file', async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: 'Choose a cover picture', properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const f = r.filePaths[0];
    const ext = path.extname(f).slice(1).toLowerCase();
    return saveAsJpeg(fs.readFileSync(f), `image/${ext === 'jpg' ? 'jpeg' : ext}`);
  });

  const specFrom = (o) => ({ ...o, size: coverSize(o) });

  // Offscreen pages paint a little after a change; wait for fresh frames before a snapshot.
  async function settle(w) {
    await w.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
    w.webContents.invalidate();
    await new Promise((res) => setTimeout(res, 600));
  }

  ipcMain.handle('cover-preview', async (_e, o) => {
    const spec = specFrom(o);
    const W = 1400;
    const cssW = spec.size.width * 96; const cssH = spec.size.height * 96;
    const z = W / cssW;
    return withPage(coverHtml(spec), async (w) => {
      w.webContents.setZoomFactor(z);
      w.setContentSize(W, Math.ceil(cssH * z));
      await settle(w);
      return (await w.webContents.capturePage()).toDataURL();
    }, { width: W, height: Math.ceil(cssH * z) });
  });

  // The print PDF (exact size) and the Kindle front cover JPG for a cover spec.
  async function renderCover(o) {
    const spec = specFrom({ ...o, guides: false });
    const s = spec.size;
    const html = coverHtml(spec);
    const pdf = await withPage(html, (w) => w.webContents.printToPDF({
      pageSize: { width: s.width, height: s.height }, margins: { top: 0, bottom: 0, left: 0, right: 0 },
      printBackground: true, preferCSSPageSize: true,
    }));
    // Kindle cover: the front cover only (inside the trim), 1600 pixels wide.
    const kW = 1600;
    const z = kW / (s.trimW * 96);
    const kindle = await withPage(html, async (w) => {
      w.webContents.setZoomFactor(z);
      const fullW = Math.ceil(s.width * 96 * z); const fullH = Math.ceil(s.height * 96 * z);
      w.setContentSize(fullW, fullH);
      await settle(w);
      const shot = await w.webContents.capturePage({ x: Math.round(s.front.x * 96 * z), y: Math.round(s.bleed * 96 * z), width: kW, height: Math.round(s.trimH * 96 * z) });
      return shot.toJPEG(92);
    }, { width: 1200, height: 900 });
    return { pdf, kindle, size: s };
  }

  ipcMain.handle('cover-export', async (_e, o) => {
    need('cover');
    const { pdf, kindle, size: s } = await renderCover(o);

    const settings = loadSettings();
    const r = await dialog.showOpenDialog(getWin(), {
      title: 'Where should I save your cover?', buttonLabel: 'Save here',
      defaultPath: settings.lastFolder || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true, kindle: `data:image/jpeg;base64,${kindle.toString('base64')}` };
    const folder = r.filePaths[0];
    saveSettings({ ...settings, lastFolder: folder });
    const base = (o.title || 'book').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'book';
    const pdfPath = path.join(folder, `${base} - paperback cover ${o.trim} ${s.pages}p.pdf`);
    const jpgPath = path.join(folder, `${base} - Kindle cover.jpg`);
    fs.writeFileSync(pdfPath, pdf);
    fs.writeFileSync(jpgPath, kindle);
    return { folder, pdfPath, jpgPath, size: s, kindle: `data:image/jpeg;base64,${kindle.toString('base64')}` };
  });

  return { renderCover, saveAsJpeg };
};
