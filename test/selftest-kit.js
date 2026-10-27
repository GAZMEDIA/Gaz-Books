// The complete Amazon kit through the real window, with a stand-in for Gemini:
//   electron test/selftest-kit.js <book> <outdir>
// Gemini's text answers are faked from the request; its picture call fails like
// a free key does, so the free-photo fallback is used.
const { app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const [book, out] = process.argv.slice(2).filter((a) => !a.startsWith('-') && !a.endsWith('selftest-kit.js'));
dialog.showOpenDialog = async (w, o) => ({ canceled: false, filePaths: [o.properties.includes('openDirectory') ? out : book] });

const realFetch = globalThis.fetch;
const calls = {};
globalThis.fetch = async (url, o = {}) => {
  if (!String(url).includes('generativelanguage.googleapis.com')) return realFetch(url, o);
  const body = JSON.parse(o.body);
  const reply = (obj, status = 200) => ({ ok: status === 200, status, json: async () => obj });
  if (body.generationConfig.responseModalities) { calls.image = (calls.image || 0) + 1; return reply({ error: { message: 'Quota exceeded (free tier has no picture allowance)' } }, 429); }
  const props = Object.keys(body.generationConfig.responseSchema.properties);
  const prompt = body.contents[0].parts[0].text;
  let ans;
  if (props.includes('changes')) {
    const items = JSON.parse(prompt.slice(prompt.lastIndexOf('\n[') + 1));
    ans = { items: items.map((t) => t.replace(/\bthe the\b/g, 'the')), changes: [{ before: 'the the', after: 'the', why: 'doubled word' }] };
    calls.proof = (calls.proof || 0) + 1;
  } else if (props.includes('styleSheet')) {
    ans = { language: /edition is in (\w+)/.exec(prompt)?.[1] || 'English', styleSheet: { spelling: 'US English', capitals: 'God capitalised', quotes: '“…”', voiceAndTense: 'past tense', other: '' }, explicitContent: false, explicitDetail: '', issues: [{ area: 'consistency', detail: 'The heroine is called Ada and Adah.', fix: 'Pick one spelling.' }], bibleTranslation: '', scripture: [] };
  } else if (props.includes('aboutBook')) {
    ans = { description: 'When the river rises, everything changes.\n\n• **Feel the pull** of a village on the edge\n• **Meet Ada**, who must choose\n\nThe river remembers. Buy it today.', aboutBook: 'A story of floods and family.', keywords: ['river novel', 'Nigerian family saga', 'free kindle books', 'flood survival story', 'coming of age Africa', 'village life fiction', 'grandmother letters', 'literary fiction Nigeria', 'women fiction Africa', 'climate fiction', 'family secrets novel', 'Lagos novels', 'african literature', 'bestseller fiction 2026'], categories: ['Books > Literature & Fiction > African', 'Books > Literature & Fiction > Family Life', 'Books > Literature & Fiction > Literary', 'Books > Literature & Fiction > Women\'s Fiction', 'Books > Literature & Fiction > Genre Fiction > Coming of Age', 'Books > Literature & Fiction > World Literature', 'Books > Literature & Fiction > Contemporary'], coverPrompt: 'A captivating cover with a river at dusk…' };
  } else {
    ans = { tagline: 'Every flood leaves something behind.', blurb: 'When the river floods her village, Ada finds a letter.\n\nShe must decide what to keep.', genre: 'literary fiction', mood: 'hopeful', setting: 'river village', details: 'a canoe on a wide river at dawn', searchWords: ['river sunrise', 'canoe river'], coverPrompt: 'A captivating cover…' };
  }
  return reply({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(ans) }] } }] });
};

require('../app/main.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let first = true;
app.on('browser-window-created', (_e, win) => {
  if (!first) return; first = false;
  win.webContents.once('did-finish-load', async () => {
    const js = (c) => win.webContents.executeJavaScript(c);
    win.webContents.on('console-message', (_ev, level, msg) => { if (level >= 2) console.log('RENDERER', msg); });
    await js("window.gaz.setSettings({ geminiKey: 'test-key' })");
    await wait(500);
    await js("document.getElementById('pickBtn').click()");
    await wait(2500);
    await js(`(() => {
      document.getElementById('doTranslate').checked = true; document.getElementById('doTranslate').dispatchEvent(new Event('change'));
      const e = document.getElementById('engine'); e.value = 'gfree'; e.dispatchEvent(new Event('change'));
    })()`);
    for (let i = 0; i < 40; i++) { await wait(500); if (await js("[...document.getElementById('lang').options].some((o) => o.value === 'de')")) break; }
    await js("document.getElementById('lang').value = 'de'");
    await js("document.getElementById('makeBtn').click()");
    for (let i = 0; i < 900; i++) {
      await wait(1000);
      if (i % 15 === 0) console.log('PROGRESS', await js("document.getElementById('progressText').textContent"));
      if (await js("!document.getElementById('result').classList.contains('hidden') || !document.getElementById('error').classList.contains('hidden')")) break;
    }
    const h = await js('document.documentElement.scrollHeight');
    win.setContentSize(1100, Math.min(h, 3000)); await wait(400);
    fs.writeFileSync(path.join(out, 'ui-kit.png'), (await win.webContents.capturePage()).toPNG());
    console.log('RESULT', await js("document.getElementById('result').innerText + ' | ' + document.getElementById('error').innerText"));
    console.log('CALLS', JSON.stringify(calls));
    app.quit();
  });
});
