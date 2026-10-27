// "Make my cover" tab.
(() => {
  const c = {
    image: null, // { path, w, h, thumb, credit }
    size: null,
  };
  const val = (id) => $(id).value.trim();
  const err = (msg) => { const e = $('coverError'); e.textContent = msg ? String(msg).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''; e.classList.toggle('hidden', !msg); if (/plan badge/.test(msg || '')) $('planBtn').click(); };

  // Tabs
  document.querySelectorAll('.tab').forEach((b) => { b.onclick = () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === b));
    $('tab-book').classList.toggle('hidden', b.dataset.tab !== 'book');
    $('tab-cover').classList.toggle('hidden', b.dataset.tab !== 'cover');
    if (b.dataset.tab === 'cover') updateSize();
  }; });
  document.querySelectorAll('.subtabs .st').forEach((b) => { b.onclick = () => {
    document.querySelectorAll('.subtabs .st').forEach((x) => x.classList.toggle('on', x === b));
    for (const k of ['search', 'own', 'prompts']) $(`st-${k}`).classList.toggle('hidden', b.dataset.st !== k);
  }; });

  const sizeOpts = () => ({ trim: $('cTrim').value, pages: +$('cPages').value || 200, paper: $('cPaper').value, listPrice: +$('cPrice').value || 0 });

  async function updateSize() {
    const { size: s, estimate: e } = await window.gaz.coverSize(sizeOpts());
    c.size = s;
    $('sizeBox').innerHTML = `<b>Full cover: ${s.width.toFixed(3)} × ${s.height.toFixed(3)} in</b> (${(s.width * 25.4).toFixed(1)} × ${(s.height * 25.4).toFixed(1)} mm)<br>
      Spine: ${s.spine.toFixed(3)} in · ${s.pages} pages · ${s.paperName}<br>
      Picture for the whole cover: at least <b>${s.px.w} × ${s.px.h} pixels</b> · front only: ${s.px.frontW} × ${s.px.h}<br>
      ${s.spineText ? 'Title and author will be printed on the spine.' : `Spine text is left off: Amazon only allows it on books over 79 pages.`}`;
    $('estBox').innerHTML = `Printing cost (US, estimate): <b>$${e.printCost.toFixed(2)}</b><br>` +
      (sizeOpts().listPrice ? `You earn about <b>$${e.royalty.toFixed(2)}</b> per book on Amazon.com (${Math.round(e.royaltyRate * 100)}% royalty minus printing).` : `Lowest price Amazon allows: about $${e.minPrice.toFixed(2)}.`);
  }
  for (const id of ['cTrim', 'cPages', 'cPaper', 'cPrice']) $(id).addEventListener('input', updateSize);
  $('kdpCalc').onclick = (e) => { e.preventDefault(); window.gaz.openLink('https://kdp.amazon.com/cover-calculator'); };

  window.coverInit = () => updateSize();
  window.coverBookChanged = (s) => {
    $('cTitle').value = s.title || ''; $('cAuthor').value = s.author || settings.author || ''; $('cSubtitle').value = s.subtitle || '';
    // About 250 words a printed page, until the real count is known.
    $('cPages').value = Math.max(24, Math.round(s.words / 250 / 2) * 2 + 8);
    updateSize();
  };
  window.coverPagesKnown = (pages, trim) => { $('cPages').value = pages; $('cTrim').value = trim; updateSize(); };

  // Back cover words
  $('aiBtn').onclick = async () => {
    err('');
    $('aiBtn').disabled = true; $('aiNote').textContent = 'Reading your book and writing…';
    try {
      const r = await window.gaz.coverAi({ genre: val('pGenre') });
      $('cTagline').value = r.tagline; $('cBlurb').value = r.blurb;
      $('pGenre').value = $('pGenre').value || r.genre; $('pMood').value = r.mood; $('pSetting').value = r.setting; $('pDetails').value = r.details;
      if (r.searchWords?.length) $('q').value = r.searchWords[0];
      $('aiNote').textContent = 'Done. Change anything you like. Picture ideas and search words were filled in too.';
      showSearchIdeas(r.searchWords || []);
    } catch (e) { err(e.message); $('aiNote').textContent = ''; } finally { $('aiBtn').disabled = false; }
  };
  function showSearchIdeas(words) {
    $('searchNote').innerHTML = '';
    if (!words.length) return;
    $('searchNote').append('Ideas: ');
    for (const w of words) { const b = document.createElement('button'); b.className = 'link'; b.textContent = w; b.onclick = () => { $('q').value = w; search(); }; $('searchNote').append(b); }
  }

  // Picture search
  async function search() {
    err('');
    const q = val('q');
    if (!q) return;
    $('results').innerHTML = '<p class="hint">Searching…</p>';
    try {
      await updateSize();
      const s = c.size;
      const front = $('orient').value === 'portrait';
      const minPx = front ? { w: s.px.frontW, h: s.px.h } : { w: s.px.w, h: s.px.h };
      const list = await window.gaz.coverSearch({ query: q, orientation: $('orient').value, minPx });
      $('results').innerHTML = list.length ? '' : '<p class="hint">Nothing big enough was found. Try other words, or "Whole cover" vs "Front only".</p>';
      for (const r of list.slice(0, 40)) {
        const f = document.createElement('figure');
        f.innerHTML = '<img alt=""><figcaption></figcaption>';
        f.querySelector('img').src = r.thumb;
        f.querySelector('figcaption').textContent = `${r.source} · ${r.w}×${r.h}${r.dpi ? ` · ${Math.min(r.dpi, 300)} dpi` : ''}`;
        f.title = r.credit;
        f.onclick = () => choose(r, front);
        $('results').append(f);
      }
    } catch (e) { $('results').innerHTML = ''; err(e.message); }
  }
  $('searchBtn').onclick = search;
  $('q').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

  async function choose(r, front) {
    err('');
    $('chosen').classList.remove('hidden');
    $('chosenInfo').textContent = 'Downloading the full-size picture…';
    try {
      const img = await window.gaz.coverFetch(r.full);
      c.image = { ...img, credit: r.needsCredit ? r.credit : '' };
      $('cMode').value = front ? 'front' : 'wrap';
      showChosen(r.credit, r.license, r.needsCredit);
      preview();
    } catch (e) { err(e.message); $('chosenInfo').textContent = ''; }
  }
  function showChosen(credit, license, needsCredit) {
    $('chosenImg').src = c.image.thumb;
    const s = c.size;
    const need = $('cMode').value === 'front' ? { w: s.px.frontW, h: s.px.h } : { w: s.px.w, h: s.px.h };
    const dpi = Math.round(300 * Math.min(c.image.w / need.w, c.image.h / need.h));
    $('chosenInfo').textContent = `${c.image.w} × ${c.image.h} pixels · prints at about ${Math.min(dpi, 300)} dpi ${dpi >= 280 ? '(sharp)' : dpi >= 200 ? '(OK)' : '(too small, may look blurry)'}`;
    $('chosenCredit').textContent = credit ? `${credit}${license ? ` · ${license}` : ''}${needsCredit ? ' · Please add this credit on your copyright page.' : ''}` : '';
  }
  $('ownBtn').onclick = async () => {
    err('');
    try {
      const img = await window.gaz.coverPickFile();
      if (!img) return;
      c.image = { ...img, credit: '' };
      $('chosen').classList.remove('hidden');
      showChosen('', '', false);
      preview();
    } catch (e) { err(e.message); }
  };

  // Prompts
  $('promptBtn').onclick = async () => {
    const p = await window.gaz.coverPrompts({ ...sizeOpts(), title: val('cTitle'), genre: val('pGenre'), mood: val('pMood'), setting: val('pSetting'), details: val('pDetails') });
    $('prompts').innerHTML = '';
    for (const [k, label] of [['wrap', 'Whole cover (front, spine and back)'], ['front', 'Front cover only'], ['back', 'Back cover background']]) {
      const d = document.createElement('div');
      d.className = 'prompt';
      d.innerHTML = '<b><span></span><button>Copy</button></b><div></div>';
      d.querySelector('span').textContent = label;
      d.querySelector('div').textContent = p[k];
      d.querySelector('button').onclick = (e) => { navigator.clipboard.writeText(p[k]); e.target.textContent = 'Copied'; };
      $('prompts').append(d);
    }
    if (!val('q')) $('q').value = p.search;
  };

  // Preview and save
  const spec = (guides) => ({
    ...sizeOpts(), title: val('cTitle'), subtitle: val('cSubtitle'), author: val('cAuthor'),
    tagline: val('cTagline'), blurb: $('cBlurb').value, bio: $('cBio').value,
    image: c.image?.path || '', imageMode: $('cMode').value, style: $('cStyle').value,
    bg: $('cBg').value, ink: $('cInk').value, guides,
  });
  async function preview() {
    err('');
    try { $('previewImg').src = await window.gaz.coverPreview(spec($('cGuides').checked)); } catch (e) { err(e.message); }
  }
  $('previewBtn').onclick = preview;
  for (const id of ['cMode', 'cStyle', 'cBg', 'cInk', 'cGuides']) $(id).addEventListener('change', () => { if (c.image && id === 'cMode') showChosen($('chosenCredit').textContent, '', false); preview(); });

  $('saveCoverBtn').onclick = async () => {
    err('');
    if (!val('cTitle')) return err('Type the book title first (step B).');
    $('saveCoverBtn').disabled = true;
    try {
      const r = await window.gaz.coverExport(spec(false));
      cover = r.kindle; // the ebook uses the new front cover
      $('coverName').textContent = '✓ made in "Make my cover"';
      if (r.canceled) return;
      $('coverFiles').innerHTML = '';
      for (const [p, label] of [[r.pdfPath, 'Paperback cover PDF (upload to KDP Paperback › Cover)'], [r.jpgPath, 'Kindle cover JPG (upload to KDP eBook › Cover)']]) {
        const li = document.createElement('li');
        li.innerHTML = '<span><b></b><br><span class="hint"></span></span>';
        li.querySelector('b').textContent = label;
        li.querySelector('.hint').textContent = p.split(/[\\/]/).pop();
        const b = document.createElement('button'); b.textContent = 'Open'; b.onclick = () => window.gaz.openPath(p);
        li.append(b);
        $('coverFiles').append(li);
      }
      $('coverResult').classList.remove('hidden');
    } catch (e) { err(e.message); } finally { $('saveCoverBtn').disabled = false; }
  };
})();
