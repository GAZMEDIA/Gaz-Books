// Drives the real app window for a quick check: electron test/selftest-main.js <book> <outdir>
const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const [book, out] = process.argv.slice(-2);
dialog.showOpenDialog = async (w, o) => ({ canceled: false, filePaths: [o.properties.includes('openDirectory') ? out : book] });
require('../app/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    const shot = async (name) => {
      const h = await js('document.documentElement.scrollHeight');
      win.setContentSize(1100, Math.min(h, 2400)); await wait(400);
      fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
    };
    await wait(500);
    await js("document.getElementById('pickBtn').click()");
    await wait(2500);
    await shot('ui-1.png');
    await js("document.getElementById('makeBtn').click()");
    for (let i = 0; i < 120; i++) { await wait(500); if (await js("!document.getElementById('result').classList.contains('hidden') || !document.getElementById('error').classList.contains('hidden')")) break; }
    await shot('ui-2.png');
    console.log('RESULT', await js("document.getElementById('result').innerText + ' | ' + document.getElementById('error').innerText"));
    app.quit();
  });
});
