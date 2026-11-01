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
  for (const i of [1, 2, 3, 4]) {
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
$('title').oninput = () => { $('fTitle').textContent = $('title').value; };
$('author').oninput = () => { $('fBy').textContent = $('author').value ? `, by ${$('author').value}` : ''; };
$('subtitle').oninput = () => { $('fSub').textContent = $('subtitle').value ? `Subtitle: ${$('subtitle').value}` : ''; };
$('next1').onclick = () => {
  // a book needs its title on the cover and the spine
  if (!$('title').value.trim()) { $('title').focus(); showError('Type your book\'s title first. It goes on the front cover and the spine.'); return; }
  if (!$('author').value.trim()) { $('author').focus(); showError('Type the author\'s name first.'); return; }
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

// ---------------------------------------------------------------- screen 3: check before printing

function done(r) {
  result = r;
  $('madeInfo').textContent = `${r.editions.length} language${r.editions.length > 1 ? 's' : ''} made in ${Math.round(r.seconds)} seconds. Check the cover and the back, then press "Finish my books".`;
  if (r.kindleCover) $('coverNow').src = r.kindleCover;
  showBack(r.back); showWrap(r); showBlanks();
  $('copied').classList.add('hidden'); $('geminiTip').classList.add('hidden'); $('noGemini').classList.add('hidden'); $('picWarn').classList.add('hidden');
  $('bStatus').textContent = ''; $('wordsCopied').classList.add('hidden');
  loadIdeas();
  show(3);
}
$('back3').onclick = () => show(2);

// What is still empty, at the top and beside each box.
function emptyList() {
  const out = [];
  if (!$('bTitle').value.trim()) out.push('The book title is empty (front cover and spine).');
  if (!$('bAuthor').value.trim()) out.push('The author\'s name is empty (front cover and spine).');
  if (!$('bDesc').value.trim()) out.push('The book description is empty (back cover and Amazon).');
  if (!$('bBio').value.trim()) out.push('"About the author" is empty (back cover and the last page of the book).');
  if (!backPhoto) out.push('There is no author photo.');
  if (!$('bTag').value.trim()) out.push('The line at the top of the back cover is empty (optional).');
  return out;
}
function showBlanks() {
  for (const id of ['bTitle', 'bAuthor', 'bTag', 'bDesc', 'bBio']) {
    const empty = !$(id).value.trim();
    $(id).classList.toggle('missing', empty);
    document.querySelector(`.empty[data-for=${id}]`).classList.toggle('hidden', !empty);
  }
  $('bPhotoDrop').classList.toggle('missing', !backPhoto);
  const list = emptyList();
  $('blanks').classList.toggle('hidden', !list.length);
  $('blanks').innerHTML = list.length ? `<b>⚠ Still empty — fill these in before you finish:</b><ul>${list.map((x) => `<li>${x}</li>`).join('')}</ul>` : '';
}
for (const id of ['bTitle', 'bAuthor', 'bSub', 'bTag', 'bDesc', 'bBio']) $(id).addEventListener('input', () => { dirty = true; showBlanks(); });

// ---- the three cover ideas and the words request, built from this book
let prompts = null;
async function loadIdeas() {
  prompts = await q.prompt();
  const box = $('ideas');
  box.innerHTML = '';
  (prompts ? prompts.concepts : []).forEach((c, i) => {
    const lab = document.createElement('label');
    lab.className = `idea${i === 0 ? ' on' : ''}`;
    lab.innerHTML = '<input type="radio" name="idea"><span><b></b><span class="hint"></span></span>';
    lab.querySelector('b').textContent = `Idea ${i + 1}: ${c.name}`;
    lab.querySelector('.hint').textContent = c.idea;
    const r = lab.querySelector('input');
    r.value = i; r.checked = i === 0;
    r.onchange = () => { for (const x of box.children) x.classList.toggle('on', x === lab); $('copied').classList.add('hidden'); };
    box.append(lab);
  });
}
const chosenIdea = () => {
  const r = document.querySelector('input[name=idea]:checked');
  return prompts && prompts.concepts[r ? Number(r.value) : 0].prompt;
};
$('copyPrompt').onclick = async () => {
  await q.copy(chosenIdea());
  $('copied').classList.remove('hidden');
};
$('copyWords').onclick = async () => { await q.copy(prompts && prompts.words); $('wordsCopied').classList.remove('hidden'); };
$('wordsGemini').onclick = async () => {
  const r = await run(() => q.gemini(undefined, prompts && prompts.words));
  $('wordsCopied').classList.remove('hidden');
  if (r && r.opened === null) { $('noGemini').classList.remove('hidden'); $('noGemini').scrollIntoView({ block: 'center' }); }
};
let geminiText = null;
async function gemini(how) {
  const r = await run(() => q.gemini(how, geminiText || chosenIdea()));
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

// ---------------------------------------------------------------- back cover
let backPhoto = null;
let dirty = false;
function showWrap(r) {
  $('wrapImg').classList.toggle('hidden', !r.wrap);
  if (r.wrap) $('wrapImg').src = r.wrap;
}
function showBack(b) {
  if (!b) return;
  $('bTitle').value = b.title || ''; $('bSub').value = b.subtitle || ''; $('bAuthor').value = b.author || '';
  $('bTag').value = b.tagline || ''; $('bDesc').value = b.desc || ''; $('bBio').value = b.bio || '';
  suggestion = b.suggestion || '';
  $('suggest').classList.toggle('hidden', !suggestion);
  backPhoto = b.photo ? { photo: b.photo, photoGrey: (photo && photo.photoGrey) || b.photo, file: photo && photo.file } : null;
  setBackPhoto();
  dirty = false;
}
let suggestion = '';
$('suggest').onclick = () => { $('bTag').value = suggestion; dirty = true; showBlanks(); };
function setBackPhoto() {
  $('bPhotoImg').classList.toggle('hidden', !backPhoto);
  $('bPhotoHint').classList.toggle('hidden', !!backPhoto);
  if (backPhoto) $('bPhotoImg').src = backPhoto.photo;
  showBlanks();
}
const gotPhoto = (p) => { if (p) { backPhoto = p; dirty = true; setBackPhoto(); } };
dropZone($('bPhotoDrop'), (f) => run(() => q.dropPhoto(f)).then(gotPhoto), () => run(() => q.pickPhoto()).then(gotPhoto));

// Puts the words and photo on every language's cover and About the Author page.
async function applyBack() {
  $('bUpdate').disabled = true; $('finishBtn').disabled = true;
  $('bStatus').textContent = 'Updating every language…';
  const r = await run(() => q.updateBack({
    title: $('bTitle').value.trim(), subtitle: $('bSub').value.trim(), author: $('bAuthor').value.trim(),
    tagline: $('bTag').value.trim(), desc: $('bDesc').value.trim(), bio: $('bBio').value.trim(),
    photo: backPhoto && backPhoto.photo, photoGrey: backPhoto && backPhoto.photoGrey, photoFile: backPhoto && backPhoto.file,
  }));
  $('bUpdate').disabled = false; $('finishBtn').disabled = false; $('bStatus').textContent = '';
  if (!r) return false;
  result = r; dirty = false;
  if (r.kindleCover) $('coverNow').src = r.kindleCover;
  showWrap(r);
  $('bStatus').textContent = 'Done: see the cover above. Every language is updated.';
  showError('');
  return true;
}
$('bUpdate').onclick = applyBack;

// ---------------------------------------------------------------- finish → screen 4

$('finishBtn').onclick = async () => {
  if (!$('bTitle').value.trim() || !$('bAuthor').value.trim()) { showError('Type the book title and the author\'s name: they go on the front cover and the spine.'); $(!$('bTitle').value.trim() ? 'bTitle' : 'bAuthor').focus(); return; }
  const list = emptyList().filter((x) => !/optional/.test(x));
  if (list.length && !confirm(`These are still empty:\n\n• ${list.join('\n• ')}\n\nFinish anyway? (Press Cancel to fill them in.)`)) return;
  if (dirty && !(await applyBack())) return;
  $('finishBtn').disabled = true; $('finishBtn').textContent = 'Finishing…';
  const r = await run(() => q.finish());
  $('finishBtn').disabled = false; $('finishBtn').textContent = 'Finish my books';
  if (!r) return;
  result = r;
  $('doneInfo').textContent = `${r.editions.length} language${r.editions.length > 1 ? 's' : ''}, everything in one folder and one zip file.`;
  $('editions').innerHTML = r.editions.map((e) => `<li><b>${e.name}</b>${e.printMade ? `Paperback (${e.pages} pages), ` : ''}Kindle eBook, Word, covers, Amazon listing</li>`).join('');
  $('notes').textContent = (r.notes || []).join(' ');
  $('notes').classList.toggle('hidden', !(r.notes || []).length);
  show(4);
};
$('openBtn').onclick = () => window.gaz.openPath(result.folder);
$('back4').onclick = () => show(3);
$('again').onclick = () => { book = null; result = null; $('bookFound').classList.add('hidden'); $('bookDrop').classList.remove('hidden'); show(1); };

$('gpSite').onclick = () => q.googlePlay('site');
$('gpFolder').onclick = () => q.googlePlay('folder');
$('studioBtn').onclick = () => window.gaz.openStudio();

init();
