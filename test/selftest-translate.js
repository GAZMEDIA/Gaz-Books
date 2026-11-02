// Translated book + translated cover through the real window:
//   electron test/selftest-translate.js <book> <outdir> [engine] [lang]
const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const args = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('selftest-translate.js'));
const [book, out, engine = 'gfree', lang = 'yo'] = args;
dialog.showOpenDialog = async (w, o) => ({ canceled: false, filePaths: [o.properties.includes('openDirectory') ? out : book] });
require('../app/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', (_e, win) => {
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    win.webContents.on('ipc-message', () => {});
    await wait(500);
    await js("document.getElementById('pickBtn').click()");
    await wait(2500);
    await js(`(() => {
      const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input')); };
      set('cTitle', 'The Rising Tide'); set('cAuthor', 'Ada Okoro'); set('cTagline', 'Every storm hides a door.');
      set('cBlurb', 'When the river floods her village, Ada finds a letter from her grandmother.\\n\\nShe must decide what to keep and what to let go.');
      set('cBio', 'Ada Okoro lives in Lagos with her family.');
      document.getElementById('doTranslate').checked = true; document.getElementById('doTranslate').dispatchEvent(new Event('change'));
      const e = document.getElementById('engine'); e.value = ${JSON.stringify(engine)}; e.dispatchEvent(new Event('change'));
    })()`);
    for (let i = 0; i < 40; i++) { await wait(500); if (await js(`[...document.getElementById('lang').options].some((o) => o.value === ${JSON.stringify(lang)})`)) break; }
    await js(`document.getElementById('lang').value = ${JSON.stringify(lang)}`);
    await js("document.getElementById('makeBtn').click()");
    let last = '';
    for (let i = 0; i < 3600; i++) {
      await wait(1000);
      const t = await js("document.getElementById('progressText').textContent");
      if (t !== last && i % 10 === 0) { console.log('PROGRESS', t); last = t; }
      if (await js("!document.getElementById('result').classList.contains('hidden') || !document.getElementById('error').classList.contains('hidden')")) break;
    }
    const h = await js('document.documentElement.scrollHeight');
    win.setContentSize(1100, Math.min(h, 2400)); await wait(400);
    fs.writeFileSync(path.join(out, 'ui-translate.png'), (await win.webContents.capturePage()).toPNG());
    const res = await js("document.getElementById('result').innerText + ' | ' + document.getElementById('error').innerText");
    console.log('RESULT', res);
    app.exitCode = /Kindle cover JPG/.test(res) && /paperback cover/.test(res) ? 0 : 1;
    app.quit();
  });
});
app.on('quit', () => process.exit(app.exitCode || 0));
