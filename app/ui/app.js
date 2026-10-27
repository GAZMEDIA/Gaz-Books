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
}

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
  const claude = $('engine').value === 'claude';
  $('langPick').classList.toggle('hidden', claude);
  $('langType').classList.toggle('hidden', !claude);
  $('langCodeBox').classList.toggle('hidden', !claude);
};
async function loadLanguages() {
  if (!settings.googleKey) return;
  try {
    const langs = await window.gaz.languages(settings.googleKey);
    const sel = $('lang');
    sel.innerHTML = '<option value="">Choose a language…</option>';
    for (const l of langs) sel.add(new Option(l.name, l.code));
  } catch (e) {
    $('lang').innerHTML = '<option value="">Google key did not work, check Settings</option>';
  }
}

// Settings
$('settingsBtn').onclick = () => {
  for (const k of ['googleKey', 'claudeKey', 'pexelsKey']) $(k).value = settings[k] || '';
  $('settings').showModal();
};
$('settingsCancel').onclick = () => $('settings').close();
$('settingsSave').onclick = async () => {
  settings.googleKey = $('googleKey').value.trim();
  settings.claudeKey = $('claudeKey').value.trim();
  settings.pexelsKey = $('pexelsKey').value.trim();
  await window.gaz.setSettings({ googleKey: settings.googleKey, claudeKey: settings.claudeKey, pexelsKey: settings.pexelsKey });
  $('settings').close();
  loadLanguages();
};

// Make the files
window.gaz.onProgress(({ step, p }) => {
  $('progressText').textContent = `${step}…`;
  $('barFill').style.width = `${Math.round((step === 'Translating' ? p * 0.8 : step === 'Done' ? 1 : 0.85) * 100)}%`;
});

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
    const engine = $('engine').value;
    if (engine === 'google') {
      if (!$('lang').value) return showError('Choose a language to translate into.');
      opts.translate = { engine, target: $('lang').value, language: $('lang').selectedOptions[0].text };
    } else {
      const name = $('langName').value.trim();
      if (!name) return showError('Type the language name to translate into.');
      opts.translate = { engine, target: $('langCode').value.trim() || 'und', language: name };
    }
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
    const label = { pdf: 'Paperback PDF (upload to KDP Paperback)', epub: 'Kindle EPUB (upload to KDP eBook)', docx: 'Word file (to edit or keep)' };
    for (const f of r.saved) {
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
  } finally {
    $('makeBtn').disabled = false;
    $('progress').classList.add('hidden');
  }
};
$('openFolder').onclick = () => lastFolder && window.gaz.openPath(lastFolder);

init();
