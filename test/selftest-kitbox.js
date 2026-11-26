// The marketing kit box: a kit without headings is taken, an old .doc file
// gets a clear message inside the box.   electron test/selftest-kitbox.js <file> <outdir>
const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const [file, out] = process.argv.slice(-2);
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'userdata'));
try { require('./signed-in'); } catch (e) { /* builds without the Gaz account */ }
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
require('../app/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', (_e, win) => {
  win.webContents.on('did-finish-load', async () => {
    if (!win.webContents.getURL().endsWith('quick.html')) return;
    const js = (c) => win.webContents.executeJavaScript(c);
    await wait(800);
    await js("document.getElementById('kitDrop').click()");
    await wait(2500);
    console.log('RESULT', JSON.stringify(await js("({err: document.getElementById('kitError').classList.contains('hidden') ? '' : document.getElementById('kitError').innerText, found: document.getElementById('kitFound').classList.contains('hidden') ? '' : document.getElementById('kitHas').innerText + ' | ' + document.getElementById('kitMissing').innerText})")));
    app.quit();
  });
});
