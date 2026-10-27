// Finds cover pictures online that are free to use on a book you sell.
//  - Openverse (no key): Creative Commons pictures that allow commercial use and changes.
//  - Pexels (free key): stock photos under the Pexels licence.
// Each result says how big it is, so we can warn when it is too small to print sharply.

async function getJson(url, headers = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': 'GazBook/1.0 (gazgoc.com.ng)', ...headers } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || j.detail || j.message || `Picture search failed (${r.status}).`);
  return j;
}

async function openverse(query, orientation) {
  const q = new URLSearchParams({ q: query, license_type: 'commercial,modification', page_size: '40', mature: 'false' });
  if (orientation === 'landscape') q.set('aspect_ratio', 'wide');
  if (orientation === 'portrait') q.set('aspect_ratio', 'tall');
  const j = await getJson(`https://api.openverse.org/v1/images/?${q}`);
  return (j.results || []).map((r) => ({
    source: 'Openverse', id: r.id, thumb: r.thumbnail || r.url, full: r.url, w: r.width || 0, h: r.height || 0,
    credit: r.attribution || `${r.title || 'Picture'} by ${r.creator || 'unknown'} (${(r.license || '').toUpperCase()} ${r.license_version || ''})`.trim(),
    license: `${(r.license || '').toUpperCase()} ${r.license_version || ''}`.trim(), link: r.foreign_landing_url || r.url,
    needsCredit: !/^(cc0|pdm)$/i.test(r.license || ''),
  }));
}

async function pexels(query, orientation, key) {
  const q = new URLSearchParams({ query, per_page: '40' });
  if (orientation) q.set('orientation', orientation);
  const j = await getJson(`https://api.pexels.com/v1/search?${q}`, { Authorization: key });
  return (j.photos || []).map((p) => ({
    source: 'Pexels', id: String(p.id), thumb: p.src.medium, full: p.src.original, w: p.width, h: p.height,
    credit: `Photo by ${p.photographer} on Pexels`, license: 'Pexels licence', link: p.url, needsCredit: false,
  }));
}

// minPx: { w, h } needed for 300 DPI. Results that reach at least 200 DPI are kept,
// best fit first.
async function searchImages({ query, orientation, minPx, pexelsKey }) {
  const jobs = [openverse(query, orientation).catch((e) => ({ error: e }))];
  if (pexelsKey) jobs.push(pexels(query, orientation, pexelsKey).catch((e) => ({ error: e })));
  const got = await Promise.all(jobs);
  const errors = got.filter((g) => g.error).map((g) => g.error.message);
  let all = got.filter(Array.isArray).flat();
  if (!all.length && errors.length) throw new Error(errors[0]);
  if (minPx) {
    const scale = (r) => Math.min(r.w / minPx.w, r.h / minPx.h);
    all = all.map((r) => ({ ...r, dpi: Math.round(300 * scale(r)) }));
    all = all.filter((r) => r.dpi >= 200 || !r.w);
    all.sort((a, b) => Math.min(b.dpi, 300) - Math.min(a.dpi, 300) || (b.source === 'Pexels') - (a.source === 'Pexels'));
  }
  return all;
}

module.exports = { searchImages };
