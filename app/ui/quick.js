// The one-click screens: 1 your book, 2 languages, 3 ready (with the Gemini cover step).
const $ = (id) => document.getElementById(id);
const q = window.gaz.quick;
const TRIMS = { '5x8': '5 × 8 in', '5.5x8.5': '5.5 × 8.5 in', '6x9': '6 × 9 in (most popular)', '7x10': '7 × 10 in', '8.5x11': '8.5 × 11 in (workbooks)' };
let book = null;
let photo = null;
let languages = [];
let result = null;
let settings = {};

const clean = (m) => String(m || '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
function showError(m) { $('error').textContent = clean(m); $('error').classList.toggle('hidden', !m); }
function show(n) {
  for (const i of [1, 2, 3]) {
    $(`s${i}`).classList.toggle('hidden', i !== n);
    $(`dot${i}`).className = `dot${i === n ? ' on' : i < n ? ' done' : ''}`;
  }
  window.scrollTo(0, 0);
}
function dropZone(el, onFile, onClick) {
  el.onclick = onClick;
  el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } };
  el.ondragover = (e) => { e.preventDefault(); el.classList.add('over'); };
  el.ondragleave = () => el.classList.remove('over');
  el.ondrop = (e) => { e.preventDefault(); el.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) onFile(f); };
}
async function run(fn) { showError(''); try { return await fn(); } catch (e) { showError(e.message); return null; } }

// ---------------------------------------------------------------- screen 1

async function init() {
  settings = await window.gaz.getSettings();
  for (const [v, t] of Object.entries(TRIMS)) $('trim').add(new Option(t, v, v === '6x9', v === (settings.trim || '6x9')));
  languages = await q.languages().catch(() => []);
}
function gotBook(s) {
  if (!s) return;
  book = s;
  $('bookFound').classList.remove('hidden');
  $('bookDrop').classList.add('hidden');
  $('fTitle').textContent = s.title || 'Untitled';
  $('fBy').textContent = s.author ? `, by ${s.author}` : '';
  $('fSub').textContent = s.subtitle ? `Subtitle: ${s.subtitle}` : '';
  if (!s.title) $('fTitle').textContent = '(no title found: type it below)';
  $('fInfo').textContent = `${s.words.toLocaleString()} words, ${s.chapters.length} chapter${s.chapters.length === 1 ? '' : 's'} (${s.file})`;
  $('title').value = s.title || ''; $('author').value = s.author || ''; $('subtitle').value = s.subtitle || '';
  if (!s.title || !s.author) $('fixBox').classList.remove('hidden');
  $('aboutAuthor').value = s.aboutAuthorText || '';
  $('aboutBook').value = s.aboutBook || '';
  setPhoto(s.photo);
}
function setPhoto(p) {
  photo = p || null;
  $('photoImg').classList.toggle('hidden', !p);
  $('photoHint').classList.toggle('hidden', !!p);
  if (p) $('photoImg').src = p.photo;
  $('photoWarn').textContent = (p && p.small) || '';
  $('photoWarn').classList.toggle('hidden', !(p && p.small));
}
dropZone($('bookDrop'), (f) => run(() => q.dropBook(f)).then(gotBook), () => run(() => q.pickBook()).then(gotBook));
dropZone($('photoDrop'), (f) => run(() => q.dropPhoto(f)).then((p) => p && setPhoto(p)), () => run(() => q.pickPhoto()).then((p) => p && setPhoto(p)));
$('fixBtn').onclick = () => $('fixBox').classList.toggle('hidden');
$('title').oninput = () => { $('fTitle').textContent = $('title').value; };
$('author').oninput = () => { $('fBy').textContent = $('author').value ? `, by ${$('author').value}` : ''; };
$('subtitle').oninput = () => { $('fSub').textContent = $('subtitle').value ? `Subtitle: ${$('subtitle').value}` : ''; };
$('next1').onclick = () => {
  // a book needs its title on the cover and the spine
  if (!$('title').value.trim()) { $('fixBox').classList.remove('hidden'); $('title').focus(); showError('Type your book\'s title first. It goes on the front cover and the spine.'); return; }
  if (!$('author').value.trim()) { $('fixBox').classList.remove('hidden'); $('author').focus(); showError('Type the author\'s name first.'); return; }
  showError('');
  showLanguages(); show(2);
};

// ---------------------------------------------------------------- screen 2

function showLanguages() {
  const box = $('langs');
  box.innerHTML = '';
  const wanted = new Set(['en', ...(settings.lastLanguages || [])]);
  for (const l of languages) {
    const lab = document.createElement('label');
    lab.className = 'lang';
    const note = l.code === 'en' ? 'your original' : !l.print ? (l.kdpPrint ? 'eBook (paperback later)' : 'eBook only on Amazon') : (l.ready ? 'ready' : 'first time: quick download');
    lab.innerHTML = `<input type="checkbox" value="${l.code}"><span class="flag">${l.flag}</span><span>${l.name}<small>${note}</small></span>`;
    const cb = lab.querySelector('input');
    cb.checked = wanted.has(l.code);
    lab.classList.toggle('on', cb.checked);
    cb.onchange = () => { lab.classList.toggle('on', cb.checked); estimate(); };
    box.append(lab);
  }
  $('ebookOnly').textContent = languages.some((l) => !l.kdpPrint) ? '"eBook only" languages (such as Arabic and Hindi): Amazon sells these as Kindle eBooks, not paperbacks.' : '';
  estimate();
}
const chosen = () => [...document.querySelectorAll('#langs input:checked')].map((c) => c.value);
function guess(n) {
  // measured: about 80 seconds of one processor core per language for a 50,000-word book
  const cores = Math.max(2, navigator.hardwareConcurrency || 4);
  return Math.round(4 + (n - 1) * ((book.words / 50000) * 80) / cores + n * 2);
}
function estimate() {
  const n = chosen().length;
  $('makeBtn').disabled = n === 0;
  $('makeBtn').textContent = n ? `Make my books (${n} language${n > 1 ? 's' : ''}, about ${guess(n)} seconds)` : 'Choose at least one language';
}
$('back2').onclick = () => show(1);

let started = 0;
q.onProgress((d) => {
  if (d.step) $('status').textContent = d.step;
  if (d.p >= 0) {
    $('barFill').style.width = `${Math.round(d.p * 100)}%`;
    const t = (Date.now() - started) / 1000;
    if (d.p > 0.05 && d.p < 1) $('timeLeft').textContent = `About ${Math.max(1, Math.round((t / d.p) * (1 - d.p)))} seconds left…`;
  }
});
$('makeBtn').onclick = async () => {
  const langs = chosen();
  $('makeBtn').disabled = true; $('back2').disabled = true;
  $('working').classList.remove('hidden');
  $('timeLeft').textContent = ''; $('barFill').style.width = '0';
  started = Date.now();
  const r = await run(() => q.make({
    languages: langs, trim: $('trim').value, title: $('title').value.trim(), author: $('author').value.trim(), subtitle: $('subtitle').value.trim(),
    aboutAuthor: { text: $('aboutAuthor').value.trim(), photo: photo && photo.photo, photoGrey: photo && photo.photoGrey },
    photoFile: photo && photo.file, aboutBook: $('aboutBook').value.trim(), isbns: $('isbns').value.trim(),
  }));
  $('makeBtn').disabled = false; $('back2').disabled = false;
  $('working').classList.add('hidden');
  if (r) { settings.lastLanguages = langs; done(r); }
};

// ---------------------------------------------------------------- screen 3

function done(r) {
  result = r;
  $('doneInfo').textContent = `${r.editions.length} language${r.editions.length > 1 ? 's' : ''} made in ${Math.round(r.seconds)} seconds. Everything is in one folder and one zip file.`;
  $('editions').innerHTML = r.editions.map((e) => `<li><b>${e.name}</b>${e.printMade ? `Paperback (${e.pages} pages), ` : ''}Kindle eBook, Word, covers, Amazon listing</li>`).join('');
  $('notes').textContent = (r.notes || []).join(' ');
  $('notes').classList.toggle('hidden', !(r.notes || []).length);
  if (r.kindleCover) $('coverNow').src = r.kindleCover;
  showBack(r.back); showWrap(r);
  $('copied').classList.add('hidden'); $('geminiTip').classList.add('hidden'); $('noGemini').classList.add('hidden');
  show(3);
}
$('openBtn').onclick = () => window.gaz.openPath(result.folder);
$('copyPrompt').onclick = async () => {
  const p = await q.prompt();
  await navigator.clipboard.writeText(p).catch(() => {});
  $('copied').classList.remove('hidden');
};
async function gemini(how) {
  const r = await run(() => q.gemini(how));
  if (!r) return;
  $('copied').classList.remove('hidden');
  if (r.opened === 'app' || r.opened === 'web') { $('geminiTip').classList.remove('hidden'); $('noGemini').classList.add('hidden'); }
  else if (r.opened === null) $('noGemini').classList.remove('hidden');
}
$('openGemini').onclick = () => gemini();
$('getGemini').onclick = () => gemini('get');
$('webGemini').onclick = () => gemini('web');
async function picture(fn) {
  $('picWarn').classList.add('hidden');
  $('picDrop').innerHTML = '<b>Making every cover with your picture…</b>';
  const r = await run(fn);
  $('picDrop').innerHTML = '<b>3. Put your picture here</b><br><span class="hint">drag it here or click</span>';
  if (!r) return;
  result = r;
  if (r.kindleCover) $('coverNow').src = r.kindleCover;
  showWrap(r);
  $('picWarn').textContent = r.warn || `Done! The covers for all ${r.editions.length} language${r.editions.length > 1 ? 's' : ''} now use your picture.`;
  $('picWarn').className = r.warn ? 'warn' : 'success';
}
dropZone($('picDrop'), (f) => picture(() => q.dropPicture(f)), () => picture(() => q.pickPicture()));
$('again').onclick = () => { book = null; result = null; $('bookFound').classList.add('hidden'); $('bookDrop').classList.remove('hidden'); show(1); };
// ---------------------------------------------------------------- back cover
let backPhoto = null;
function showWrap(r) {
  $('wrapImg').classList.toggle('hidden', !r.wrap);
  if (r.wrap) $('wrapImg').src = r.wrap;
}
function showBack(b) {
  if (!b) return;
  $('bTag').value = b.tagline || ''; $('bDesc').value = b.desc || ''; $('bBio').value = b.bio || '';
  backPhoto = b.photo ? { photo: b.photo, photoGrey: (photo && photo.photoGrey) || b.photo, file: photo && photo.file } : null;
  setBackPhoto();
}
function setBackPhoto() {
  $('bPhotoImg').classList.toggle('hidden', !backPhoto);
  $('bPhotoHint').classList.toggle('hidden', !!backPhoto);
  if (backPhoto) $('bPhotoImg').src = backPhoto.photo;
}
dropZone($('bPhotoDrop'), (f) => run(() => q.dropPhoto(f)).then((p) => { if (p) { backPhoto = p; setBackPhoto(); } }),
  () => run(() => q.pickPhoto()).then((p) => { if (p) { backPhoto = p; setBackPhoto(); } }));
$('bUpdate').onclick = async () => {
  $('bUpdate').disabled = true; $('bStatus').textContent = 'Updating every language…';
  const r = await run(() => q.updateBack({
    tagline: $('bTag').value.trim(), desc: $('bDesc').value.trim(), bio: $('bBio').value.trim(),
    photo: backPhoto && backPhoto.photo, photoGrey: backPhoto && backPhoto.photoGrey, photoFile: backPhoto && backPhoto.file,
  }));
  $('bUpdate').disabled = false; $('bStatus').textContent = '';
  if (!r) return;
  result = r;
  if (r.kindleCover) $('coverNow').src = r.kindleCover;
  showWrap(r);
  $('bStatus').textContent = `Done: the back cover and About the Author page are updated in all ${r.editions.length} language${r.editions.length > 1 ? 's' : ''}.`;
};

$('gpSite').onclick = () => q.googlePlay('site');
$('gpFolder').onclick = () => q.googlePlay('folder');
$('studioBtn').onclick = () => window.gaz.openStudio();

init();
