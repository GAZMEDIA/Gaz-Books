// Drives the Gaz account screen in the real app against a stand-in website:
//   GAZ_ACCOUNT_BASE=http://127.0.0.1:8899/?rest_route=/gazpresenter/v1/account \
//   electron test/selftest-account.js <outdir>
// Opens GazBook with no account (sign-in screen), tries a short password,
// creates an account, checks the app opens, signs out, signs back in.
const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const out = process.argv[process.argv.length - 1];
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
app.setPath('userData', path.join(out, 'userdata'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const email = `book${Date.now()}@example.com`;

require('../app/main.js');
let driving = false;
app.on('browser-window-created', (_e, win) => {
  if (driving) return;
  driving = true;
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    const until = async (c, s = 20) => { for (let i = 0; i < s * 4; i++) { try { if (await js(c)) return true; } catch {} await wait(250); } throw new Error(`timed out: ${c}`); };
    const shot = async (name) => { await wait(400); fs.writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG()); };
    const page = () => js('location.pathname.split("/").pop()');
    const type = (id, v) => js(`document.getElementById(${JSON.stringify(id)}).value = ${JSON.stringify(v)}`);
    const step = (m) => console.log('ok:', m);
    try {
      if ((await page()) !== 'account.html') throw new Error('should open on the sign-in screen');
      await until("document.getElementById('title').textContent.includes('Create')");
      await shot('1-create.png');
      step('opens on Create your Gaz account');
      await type('name', 'Ada Writer'); await type('email', email); await type('phone', '0803 123 4567'); await type('church', 'Ada Books'); await type('password', 'short');
      await js("document.getElementById('go').click()");
      await until("document.getElementById('msg').textContent.includes('8 characters')");
      step('short password refused');
      await type('password', 'longpassword1');
      await js("document.getElementById('go').click()");
      await until('location.pathname.endsWith("quick.html")');
      await until("document.getElementById('accountBtn').textContent.includes('Ada')");
      await shot('2-signed-in.png');
      step('account made, GazBook opens');
      const s = JSON.parse(fs.readFileSync(path.join(out, 'userdata', 'settings.json'), 'utf8'));
      if (!s.accountToken || s.email !== email) throw new Error('token or plan email not saved');
      if (JSON.stringify(s).includes('longpassword1')) throw new Error('password saved!');
      step('token saved, password not saved, plan email filled in');
      await js("window.gaz.signOut()");
      await until('location.pathname.endsWith("account.html")');
      await until("document.getElementById('title').textContent.includes('Sign in')");
      if ((await js("document.getElementById('email').value")) !== email) throw new Error('email not filled in');
      step('sign out goes back to Sign in, email filled in');
      await js("window.gaz.openQuick()"); await wait(500);
      if ((await page()) !== 'account.html') throw new Error('got past the sign-in screen');
      step('cannot get past sign-in');
      await type('password', 'wrongpassword');
      await js("document.getElementById('go').click()");
      await until("document.getElementById('msg').textContent.includes('wrong')");
      await shot('3-wrong.png');
      step('wrong password refused');
      await type('password', 'longpassword1');
      await js("document.getElementById('go').click()");
      await until('location.pathname.endsWith("quick.html")');
      step('signed back in');
      console.log('ALL OK');
      app.exit(0);
    } catch (err) {
      console.error('FAILED', err);
      await shot('failed.png').catch(() => {});
      app.exit(1);
    }
  });
});
