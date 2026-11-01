// Drives the one-click screens like a person would:
//   electron test/selftest-quick.js <book> <author photo> <cover picture> <outdir>
// Puts the book in, adds the photo and words, ticks French, makes everything,
// tries "Open Gemini", then adds the cover picture. Screenshots land in <outdir>.
const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const [book, photo, pic, out] = process.argv.slice(-4);
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'userdata'));
app.setPath('documents', path.join(out, 'documents'));
process.env.GAZBOOK_TRANSLATOR_DIR = path.join(out, 'translator');
dialog.showOpenDialog = async (w, o) => ({ canceled: false, filePaths: [/photo/i.test(o.title) ? photo : /picture/i.test(o.title) ? pic : book] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const tt = await require('./test-translator').testTranslator(['fr'], fs.readFileSync(book, 'utf8').slice(0, 400000));
  process.env.GAZBOOK_MODELS_URL = tt.url;
  require('../app/main.js');
  let driving = false;
  app.on('browser-window-created', (_e, win) => {
    if (driving) return; // the hidden windows that draw covers
    driving = true;
    win.webContents.once('did-finish-load', async () => {
      const js = (c) => win.webContents.executeJavaScript(c);
      const until = async (c, s = 120) => { for (let i = 0; i < s * 2; i++) { if (await js(c)) return true; await wait(500); } return false; };
      const shot = async (name) => {
        const h = await js('document.documentElement.scrollHeight');
        win.setContentSize(1100, Math.min(h, 2400)); await wait(600);
        fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
      };
      const err = () => js("document.getElementById('error').innerText");
      try {
        await wait(800);
        await shot('1-start.png');
        await js("document.getElementById('bookDrop').click()");
        await until("!document.getElementById('bookFound').classList.contains('hidden')", 20);
        console.log('FOUND', await js("document.getElementById('fTitle').innerText + ' | ' + document.getElementById('fSub').innerText + ' | ' + document.getElementById('fBy').innerText"));
        await shot('2-book.png');
        await js("document.getElementById('isbns').value = 'en 978-0-306-40615-7'");
        await js("document.getElementById('next1').click()");
        await wait(500);
        await js("const c = document.querySelector('#langs input[value=fr]'); c.checked = true; c.dispatchEvent(new Event('change'))");
        await shot('3-languages.png');
        const t = Date.now();
        await js("document.getElementById('makeBtn').click()");
        await wait(3000);
        await shot('4-working.png');
        const ok = await until("!document.getElementById('s3').classList.contains('hidden') || document.getElementById('error').innerText", 600);
        console.log('MADE in', ((Date.now() - t) / 1000).toFixed(1), 's', ok, await err());
        await shot('5-ready.png');
        await js("document.getElementById('openGemini').click()");
        await wait(1500);
        await shot('6-gemini.png');
        await js("document.getElementById('picDrop').click()");
        await until("!document.getElementById('picWarn').classList.contains('hidden') || document.getElementById('error').innerText", 120);
        await shot('7-picture.png');
        // the back-cover editor: what GazBook wrote, then the author's own bio and photo
        console.log('BACK BEFORE', JSON.stringify(await js("({tag: bTag.value, desc: bDesc.value.slice(0, 160), bio: bBio.value, blanks: document.getElementById('blanks').innerText})")));
        await shot('7b-check-blank.png');
        await js(`bDesc.value = 'Every believer faces barricades. Some are built by the enemy, some by fear, and some by our own past.\\n\\nThis book shows how God brings his people from behind those barricades, and how to go beyond the borders that once held them back.'`);
        await js("document.getElementById('suggest').click()");
        await js(`bBio.value = 'Dr. Noble Nnakenyi is a petroleum geologist by training and a Prophetic Evangelist by calling. He leads Noble Transformation Ministries.\\n\\nHe is married with five children.'`);
        console.log('COVER WORDS', await js("bTitle.value + ' | ' + bSub.value + ' | ' + bAuthor.value"));
        await js("bAuthor.value = 'Dr. Noble Nnakenyi'; bAuthor.dispatchEvent(new Event('input')); 0");
        await js("document.getElementById('bPhotoDrop').click()");
        await until("!document.getElementById('bPhotoImg').classList.contains('hidden')", 20);
        await js("document.getElementById('bUpdate').click()");
        await until("document.getElementById('bStatus').innerText.startsWith('Done') || document.getElementById('error').innerText", 300);
        console.log('BACK AFTER', await js("bStatus.innerText"), await err());
        fs.writeFileSync(path.join(out, 'wrap.png'), Buffer.from((await js("wrapImg.src")).split(',')[1], 'base64'));
        await shot('8-back.png');
        await js('window.confirm = () => true; 0');
        await js("document.getElementById('finishBtn').click()");
        await until("!document.getElementById('s4').classList.contains('hidden') || document.getElementById('error').innerText", 120);
        await shot('9-download.png');
        console.log('FINISHED', await js("document.getElementById('doneInfo').innerText"), await err());
        const gp = path.join(await js('result.folder'), 'Google Play Books');
        const tsv = path.join(gp, 'Book list (upload this first).tsv');
        if (fs.existsSync(tsv)) console.log('BOOK LIST\n' + fs.readFileSync(tsv).slice(2).toString('utf16le').split('\r\n').map((l) => '  ' + l.split('\t').slice(0, 9).join(' | ').slice(0, 220)).join('\n'));
        console.log('PICTURE', await js("document.getElementById('picWarn').innerText"), await err());
        const folder = await js('result.folder');
        const list = (d, pre = '') => fs.readdirSync(d).flatMap((f) => (fs.statSync(path.join(d, f)).isDirectory() ? list(path.join(d, f), `${pre}${f}/`) : [`${pre}${f} (${Math.round(fs.statSync(path.join(d, f)).size / 1024)} KB)`]));
        console.log('FILES\n  ' + list(folder).join('\n  '));
      } catch (e) { console.log('FAIL', e); }
      require('../src/fast-translate').stopWorker();
      tt.close();
      app.quit();
    });
  });
})();
