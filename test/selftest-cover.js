// Drives the cover tab: electron test/selftest-cover.js <book> <picture> <outdir>
const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const [book, pic, out] = process.argv.slice(-3);
dialog.showOpenDialog = async (w, o) => ({ canceled: false, filePaths: [o.properties.includes('openDirectory') ? out : /picture/i.test(o.title) ? pic : book] });
require('../app/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', (_e, win) => {
  if (win.getTitle() !== 'GazBook' && fs.existsSync(path.join(out, 'started'))) return;
  fs.writeFileSync(path.join(out, 'started'), '1');
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    const shot = async (name) => {
      const h = await js('document.documentElement.scrollHeight');
      win.setContentSize(1100, Math.min(h, 3000)); await wait(500);
      fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
    };
    try {
      await wait(500);
      await js("document.getElementById('pickBtn').click()"); await wait(2500);
      await js("document.querySelector('[data-tab=cover]').click()"); await wait(800);
      await js(`document.getElementById('cTagline').value = 'One river. One night. Every secret rising.';
        document.getElementById('cBlurb').value = 'When the rain will not stop, Amaka and her brother must choose between the village that raised them and the truth the river is about to reveal.\\n\\nA story of courage, family and the secrets water keeps.';
        document.getElementById('cBio').value = 'Jones Jnr writes from Lagos.';
        document.getElementById('cPages').value = 240; document.getElementById('cPages').dispatchEvent(new Event('input'));
        document.querySelector('[data-st=own]').click(); document.getElementById('ownBtn').click();`);
      await wait(6000);
      await shot('cover-ui.png');
      fs.writeFileSync(path.join(out, 'cover-preview.png'), Buffer.from((await js("document.getElementById('previewImg').src")).split(',')[1], 'base64'));
      await js("document.getElementById('saveCoverBtn').click()");
      for (let i = 0; i < 60; i++) { await wait(500); if (await js("!document.getElementById('coverResult').classList.contains('hidden') || !document.getElementById('coverError').classList.contains('hidden')")) break; }
      console.log('RESULT', await js("document.getElementById('coverResult').innerText + ' | ' + document.getElementById('coverError').innerText + ' | ' + document.getElementById('sizeBox').innerText"));
    } catch (e) { console.log('FAIL', e); }
    app.quit();
  });
});
