const $ = (id) => document.getElementById(id);
const TRIM_NAMES = {
  '5x8': '5 × 8 in', '5.06x7.81': '5.06 × 7.81 in', '5.25x8': '5.25 × 8 in', '5.5x8.5': '5.5 × 8.5 in',
  '6x9': '6 × 9 in (most popular)', '6.14x9.21': '6.14 × 9.21 in', '6.69x9.61': '6.69 × 9.61 in', '7x10': '7 × 10 in',
  '7.44x9.69': '7.44 × 9.69 in', '7.5x9.25': '7.5 × 9.25 in', '8x10': '8 × 10 in', '8.5x11': '8.5 × 11 in (workbooks)',
};
let cover = null;
let settings = {};
let lastFolder = null;

function showError(msg) {
  const e = $('error');
  e.textContent = msg ? String(msg).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : '';
  e.classList.toggle('hidden', !msg);
}

async function init() {
  const info = await window.gaz.info();
  for (const t of info.trims) {
    $('trim').add(new Option(TRIM_NAMES[t] || t, t, t === '6x9', t === '6x9'));
    $('cTrim').add(new Option(TRIM_NAMES[t] || t, t, t === '6x9', t === '6x9'));
  }
  settings = await window.gaz.getSettings();
  if (settings.trim) { $('trim').value = settings.trim; $('cTrim').value = settings.trim; }
  if (window.coverInit) window.coverInit();
  loadLanguages();
  showPlan(await window.gaz.license());
}

// Plan badge: free trial, plan or locked
let lic = null;
function showPlan(l) {
  lic = l;
  const b = $('planBtn');
  b.className = `badge ${l.kind}`;
  b.textContent = l.kind === 'trial' ? `Free trial: ${l.daysLeft} day${l.daysLeft === 1 ? '' : 's'} left`
    : l.kind === 'plan' ? `${l.name}${l.forever ? ' (unlimited)' : ''}` : 'Trial ended: buy a plan';
  $('planNow').textContent = l.kind === 'trial' ? `You are on the free trial: everything works for ${l.daysLeft} more day${l.daysLeft === 1 ? '' : 's'}.`
    : l.kind === 'plan' ? `${l.name} plan for ${l.email}, ${l.forever ? 'unlimited, no end day' : `until ${l.ends}`}.`
      : (l.ended ? `Your plan ended on ${l.ended}. Renew it to keep making books.` : 'Your free trial has ended. Pick a plan to keep making books.');
}
$('planBtn').onclick = () => {
  $('licEmail').value = (lic && lic.email) || settings.email || '';
  $('licCode').value = '';
  $('licError').classList.add('hidden');
  $('planDlg').showModal();
};
$('planClose').onclick = () => $('planDlg').close();
$('buyBtn').onclick = () => window.gaz.openLink(`${lic.buyUrl}?email=${encodeURIComponent($('licEmail').value.trim())}`);
$('licSave').onclick = async () => {
  try {
    showPlan(await window.gaz.setLicense({ email: $('licEmail').value, code: $('licCode').value }));
    $('planDlg').close();
  } catch (e) {
    $('licError').textContent = String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    $('licError').classList.remove('hidden');
  }
};

function showBook(s) {
  $('bookInfo').classList.remove('hidden');
  $('bookFile').textContent = `✓ ${s.file} (${s.words.toLocaleString()} words, ${s.chapters.length} chapters)`;
  $('title').value = s.title || '';
  $('author').value = s.author || settings.author || '';
  $('subtitle').value = s.subtitle || '';
  $('chapterSummary').textContent = `Chapters found: ${s.chapters.length}`;
  $('chapters').innerHTML = '';
  for (const c of s.chapters) { const li = document.createElement('li'); li.textContent = c; $('chapters').append(li); }
  $('makeBtn').disabled = false;
  $('result').classList.add('hidden');
  if (window.coverBookChanged) window.coverBookChanged(s);
}

async function open(fn) {
  showError('');
  try { const s = await fn(); if (s) showBook(s); } catch (e) { showError(e.message); }
}
$('pickBtn').onclick = () => open(() => window.gaz.pickBook());
const drop = $('drop');
drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) open(() => window.gaz.openDropped(f)); };
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

$('coverBtn').onclick = async () => {
  const c = await window.gaz.pickCover();
  if (c) { cover = c; $('coverName').textContent = '✓ picture added'; }
};

// Translation
$('doTranslate').onchange = () => $('translateBox').classList.toggle('hidden', !$('doTranslate').checked);
$('engine').onchange = () => {
  const engine = $('engine').value;
  const claude = engine === 'claude' || engine === 'gemini';
  $('langPick').classList.toggle('hidden', claude);
  $('langType').classList.toggle('hidden', !claude);
  $('langCodeBox').classList.toggle('hidden', !claude);
  $('sourceBox').classList.toggle('hidden', engine !== 'offline');
  $('offlineNote').classList.toggle('hidden', engine !== 'offline');
  loadLanguages();
};
// Studio: more languages in one go
let moreLangs = [];
function currentLang() {
  const engine = $('engine').value;
  if (engine !== 'claude' && engine !== 'gemini') {
    if (!$('lang').value) throw new Error('Choose a language to translate into.');
    return { engine, target: $('lang').value, language: $('lang').selectedOptions[0].text };
  }
  const name = $('langName').value.trim();
  if (!name) throw new Error('Type the language name to translate into.');
  return { engine, target: $('langCode').value.trim() || 'und', language: name };
}
function showMoreLangs() {
  $('moreLangs').innerHTML = '';
  moreLangs.forEach((l, i) => {
    const li = document.createElement('li');
    li.textContent = l.language;
    const x = document.createElement('button'); x.textContent = '×'; x.title = 'Remove';
    x.onclick = () => { moreLangs.splice(i, 1); showMoreLangs(); };
    li.append(x);
    $('moreLangs').append(li);
  });
}
$('addLang').onclick = () => {
  showError('');
  try {
    const l = currentLang();
    if (!moreLangs.some((m) => m.target === l.target && m.language === l.language)) moreLangs.push(l);
    showMoreLangs();
    $('lang').value = ''; $('langName').value = ''; $('langCode').value = '';
  } catch (e) { showError(e.message); }
};

// each translator knows its own list of languages
const langCache = {};
async function loadLanguages() {
  const engine = $('engine').value;
  if (engine === 'claude' || engine === 'gemini') return;
  const sel = $('lang');
  if (engine === 'google' && !settings.googleKey) { sel.innerHTML = '<option value="">Add your Google key in Settings first</option>'; return; }
  sel.innerHTML = '<option value="">Loading languages…</option>';
  try {
    const key = engine === 'google' ? `google:${settings.googleKey}` : engine;
    const langs = langCache[key] || (langCache[key] = await window.gaz.languages(engine, settings.googleKey));
    if ($('engine').value !== engine) return;
    sel.innerHTML = '<option value="">Choose a language…</option>';
    for (const l of langs) sel.add(new Option(l.name, l.code));
    if (engine === 'offline' && !$('source').options.length) {
      for (const l of langs) $('source').add(new Option(l.name, l.code));
      $('source').value = 'en';
    }
  } catch (e) {
    delete langCache[engine];
    sel.innerHTML = engine === 'google' ? '<option value="">Google key did not work, check Settings</option>'
      : '<option value="">Could not load languages. Check the internet and pick the translator again.</option>';
  }
}

// Settings
$('settingsBtn').onclick = () => {
  for (const k of ['googleKey', 'claudeKey', 'geminiKey', 'pexelsKey']) $(k).value = settings[k] || '';
  $('settings').showModal();
};
$('geminiGet').onclick = (e) => { e.preventDefault(); window.gaz.geminiKeyPage(); };
$('settingsCancel').onclick = () => $('settings').close();
$('settingsSave').onclick = async () => {
  settings.googleKey = $('googleKey').value.trim();
  settings.claudeKey = $('claudeKey').value.trim();
  settings.geminiKey = $('geminiKey').value.trim();
  settings.pexelsKey = $('pexelsKey').value.trim();
  await window.gaz.setSettings({ googleKey: settings.googleKey, claudeKey: settings.claudeKey, geminiKey: settings.geminiKey, pexelsKey: settings.pexelsKey });
  $('settings').close();
  loadLanguages();
};

// Make the files
window.gaz.onProgress(({ step, p }) => {
  $('progressText').textContent = `${step}…`;
  if (/^(Translating|Checking)/.test(step)) { $('barFill').style.width = `${Math.round(p * 80)}%`; return; }
  if (step.startsWith('Downloading')) { $('progressText').textContent = step; $('barFill').style.width = `${parseInt(step.split(': ').pop(), 10) || 0}%`; return; }
  $('barFill').style.width = `${Math.round((step.startsWith('Translating') ? p * 0.8 : step.startsWith('Done') ? 1 : 0.85) * 100)}%`;
});

$('kit').onchange = () => { $('makeBtn').textContent = $('kit').checked ? 'Make my Amazon kit' : 'Make my book files'; };
$('makeBtn').onclick = async () => {
  showError('');
  const opts = {
    title: $('title').value.trim(), author: $('author').value.trim(), subtitle: $('subtitle').value.trim(),
    isbn: $('isbn').value.trim(), trim: $('trim').value, fontSize: $('fontSize').value,
    dropCaps: $('dropCaps').checked, rectoChapters: $('rectoChapters').checked, toc: $('toc').checked,
    hyphenate: $('hyphenate').checked, dedication: $('dedication').value.trim(),
    copyrightExtra: $('copyrightExtra').value.trim(), cover,
  };
  if ($('doTranslate').checked) {
    let first;
    try { first = currentLang(); } catch (e) {
      if (!moreLangs.length) return showError(e.message);
    }
    const all = first ? [first, ...moreLangs] : [...moreLangs];
    opts.translate = { ...all[0], more: all.slice(1) };
    opts.source = $('source').value || 'en';
    if ($('translateCover').checked && window.coverSpec) opts.coverSpec = window.coverSpec();
  }
  if ($('kit').checked) {
    opts.kit = true;
    if (window.coverSpec) opts.coverSpec = window.coverSpec();
  }
  window.gaz.setSettings({ trim: opts.trim, author: opts.author });
  $('makeBtn').disabled = true;
  $('progress').classList.remove('hidden');
  $('result').classList.add('hidden');
  try {
    const r = await window.gaz.build(opts);
    if (r.canceled) return;
    lastFolder = r.folder;
    $('files').innerHTML = '';
    const label = { pdf: 'Paperback PDF (upload to KDP Paperback)', epub: 'Kindle EPUB (upload to KDP eBook)', docx: 'Word file (to edit or keep)',
      coverpdf: 'Paperback cover PDF (upload to KDP Paperback › Cover)', coverjpg: 'Kindle cover JPG (upload to KDP eBook › Cover)',
      art: 'Cover picture on its own', kit: 'Marketing kit (description, keywords, categories, checks)', zip: 'Everything in one zip file' };
    let group = null;
    for (const f of r.saved) {
      if (f.group && f.group !== group) {
        group = f.group;
        const h = document.createElement('li'); h.className = 'group'; h.textContent = group; $('files').append(h);
      }
      const li = document.createElement('li');
      li.innerHTML = `<span><b></b><br><span class="hint"></span></span>`;
      li.querySelector('b').textContent = label[f.kind];
      li.querySelector('.hint').textContent = f.name;
      const b = document.createElement('button'); b.textContent = 'Open'; b.onclick = () => window.gaz.openPath(f.path);
      li.append(b);
      $('files').append(li);
    }
    if (r.pageCount && window.coverPagesKnown) window.coverPagesKnown(r.pageCount, opts.trim);
    $('notes').textContent = [r.pageCount ? `Paperback: ${r.pageCount} pages.` : '', ...r.notes].filter(Boolean).join(' ');
    $('result').classList.remove('hidden');
  } catch (e) {
    showError(e.message);
    if (/plan badge/.test(e.message)) $('planBtn').click();
  } finally {
    $('makeBtn').disabled = false;
    $('progress').classList.add('hidden');
  }
};
$('openFolder').onclick = () => lastFolder && window.gaz.openPath(lastFolder);

init();
