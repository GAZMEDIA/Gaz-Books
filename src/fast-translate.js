// GazBook's fast on-computer translator: no keys, no fees, no internet once a
// language is ready. A small Python program (translator/worker.py, shipped
// inside the app) runs the CTranslate2 engine on every CPU core; this file
// gets the language files, cuts the book into sentences, and puts it back
// together.
//
// Language files come from GazBook's own GitHub release (built by
// .github/workflows/models.yml): manifest.json says which model each
// language uses and lists every file with its size and checksum.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const MODELS_URL = process.env.GAZBOOK_MODELS_URL || 'https://github.com/GAZMEDIA/gaz-books/releases/download/models-v1/';
const CHUNK = 600; // sentences per request: big enough to keep every core busy, small enough for a smooth progress bar

// ---------------------------------------------------------------- the worker

function pythonCommand() {
  if (process.env.GAZBOOK_PYTHON) return process.env.GAZBOOK_PYTHON;
  const packed = process.resourcesPath && path.join(process.resourcesPath, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
  if (packed && fs.existsSync(packed)) return packed;
  return process.platform === 'win32' ? 'python' : 'python3';
}
function workerScript() {
  const packed = process.resourcesPath && path.join(process.resourcesPath, 'translator', 'worker.py');
  return packed && fs.existsSync(packed) ? packed : path.join(__dirname, '..', 'translator', 'worker.py');
}

let worker = null;
function getWorker() {
  if (worker) return worker;
  const proc = spawn(pythonCommand(), ['-I', workerScript()], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  const waiting = new Map();
  let buf = '';
  let errText = '';
  let nextId = 1;
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let ans; try { ans = JSON.parse(line); } catch { continue; }
      const w = waiting.get(ans.id); if (!w) continue;
      waiting.delete(ans.id);
      if (ans.error) w.reject(new Error(`The translator stopped: ${ans.error}`)); else w.resolve(ans);
    }
  });
  proc.stderr.on('data', (d) => { errText = (errText + d).slice(-2000); });
  const fail = (e) => {
    worker = null;
    const why = e && e.code === 'ENOENT' ? 'its engine is missing. Please reinstall GazBook.' : (errText.trim().split('\n').pop() || (e && e.message) || 'it closed');
    for (const w of waiting.values()) w.reject(new Error(`The on-computer translator could not run: ${why}`));
    waiting.clear();
  };
  proc.on('error', fail);
  proc.on('exit', () => fail());
  worker = {
    ask: (req) => new Promise((resolve, reject) => {
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      proc.stdin.write(`${JSON.stringify({ ...req, id })}\n`);
    }),
    stop: () => { try { proc.kill(); } catch { /* gone */ } },
  };
  return worker;
}
function stopWorker() { if (worker) worker.stop(); worker = null; }

// ---------------------------------------------------------------- language files

const manifests = new Map(); // asked once per session
function getManifest(modelsDir) {
  if (!manifests.has(modelsDir)) manifests.set(modelsDir, loadManifest(modelsDir).catch((e) => { manifests.delete(modelsDir); throw e; }));
  return manifests.get(modelsDir);
}
async function loadManifest(modelsDir) {
  const local = path.join(modelsDir, 'manifest.json');
  try {
    const r = await fetch(`${MODELS_URL}manifest.json`, { headers: { 'User-Agent': 'GazBook' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(local, JSON.stringify(j));
    return j;
  } catch (e) {
    try { return JSON.parse(fs.readFileSync(local, 'utf8')); } catch { /* never downloaded */ }
    throw new Error('GazBook needs the internet once to get the translator for a new language. Connect and try again.');
  }
}

function pickModel(manifest, src, tgt) {
  const direct = src === 'en' && manifest.languages[tgt];
  if (direct) return { name: direct.model, prefix: direct.prefix || '' };
  const fb = manifest.fallback && manifest.models[manifest.fallback];
  if (fb && fb.codes && fb.codes.includes(tgt) && fb.codes.includes(src)) return { name: manifest.fallback, prefix: '', code: (c) => (fb.codeMap && fb.codeMap[c]) || c };
  throw new Error(`The on-computer translator does not have ${src} → ${tgt} yet.`);
}

const ready = (dir) => fs.existsSync(path.join(dir, 'gazbook.json'));

async function download(asset, file, onBytes) {
  const r = await fetch(MODELS_URL + asset, { headers: { 'User-Agent': 'GazBook' } });
  if (!r.ok || !r.body) throw new Error(`download failed (HTTP ${r.status})`);
  const hash = crypto.createHash('sha256');
  const tmp = `${file}.part`;
  const counter = new (require('stream').Transform)({ transform(chunk, _e, cb) { hash.update(chunk); onBytes(chunk.length); cb(null, chunk); } });
  await pipeline(Readable.fromWeb(r.body), counter, fs.createWriteStream(tmp));
  return { tmp, sha256: hash.digest('hex') };
}

// Downloads a model once; afterwards it is ready offline.
async function ensureModel(manifest, name, modelsDir, onStatus, label) {
  const dir = path.join(modelsDir, name);
  const m = manifest.models[name];
  if (ready(dir) && (!m || readVersion(dir) === m.version)) return dir;
  if (!m) throw new Error(`The translator files for ${label} are missing from GazBook's download page.`);
  fs.mkdirSync(dir, { recursive: true });
  const total = m.files.reduce((n, f) => n + f.bytes, 0);
  let got = 0;
  const say = () => onStatus(`Getting ${label} ready (only the first time, ${Math.round(total / 1e6)} MB): ${Math.round((got / total) * 100)}%`);
  say();
  for (const f of m.files) {
    const out = path.join(dir, f.path);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const before = got;
      try {
        const { tmp, sha256 } = await download(f.asset, out, (n) => { got += n; say(); });
        if (sha256 !== f.sha256) { fs.rmSync(tmp, { force: true }); throw new Error('the file arrived damaged'); }
        fs.renameSync(tmp, out);
        ok = true;
      } catch (e) {
        got = before;
        if (attempt === 2) throw new Error(`Could not get the ${label} translator: ${e.message}. Check the internet and try again.`);
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'version.txt'), String(m.version || ''));
  fs.copyFileSync(path.join(dir, 'gazbook.json.dl'), path.join(dir, 'gazbook.json')); // written last: the model is complete
  return dir;
}
function readVersion(dir) { try { return fs.readFileSync(path.join(dir, 'version.txt'), 'utf8'); } catch { return ''; } }

// ---------------------------------------------------------------- sentences

// Splits a paragraph into sentences; the models work best a sentence at a time.
function sentences(t) {
  const s = String(t).replace(/\s+/g, ' ').trim();
  if (!s) return [];
  const parts = s.split(/(?<=[.!?…]["”’')\]]*)\s+(?=["“‘(\[]?\p{Lu}|\d)/u);
  // very long "sentences" (lists, run-ons) go in pieces of about 60 words
  return parts.flatMap((p) => {
    const w = p.split(' ');
    if (w.length <= 80) return [p];
    const out = [];
    for (let i = 0; i < w.length; i += 60) out.push(w.slice(i, i + 60).join(' '));
    return out;
  });
}

// The translators learned from text with straight quotes: curly ones confuse them
// (they come back as stray dashes and dots). Straight in, curly again after.
const forModel = (t) => t.replace(/[“”„‟«»]/g, '"').replace(/[‘’‚‛]/g, '\'').replace(/\u2026/g, '...');
const STRAY = /^[\s\-–—.,;:]+(?=\p{L}|["'(¿¡])/u;
function fromModel(out, src) {
  let t = String(out || '')
    .replace(/\u2581/g, ' ').replace(/\u2047/g, ' ')        // translator markers
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')            // invisible characters
    .replace(/[\u2009\u202F]/g, '\u00A0').replace(/\u2028/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!/^[\s\-–—.,;:]/.test(src)) t = t.replace(STRAY, ''); // a dash or dot the source didn't start with
  const { tidyRuns } = require('./read');
  const runs = tidyRuns([{ text: t, i: false, b: false }]);
  return runs.length ? runs.map((r) => r.text).join('') : t;
}

// texts: plain strings (one paragraph each). Returns the translated strings.
async function translatePlain(texts, src, tgt, { modelsDir, onStatus = () => {}, onProgress = () => {}, languageName } = {}) {
  if (!texts.length) return [];
  const manifest = await getManifest(modelsDir);
  const pick = pickModel(manifest, src, tgt);
  const dir = await ensureModel(manifest, pick.name, modelsDir, onStatus, languageName || tgt);
  // every distinct sentence once (titles, refrains and repeated lines come up often)
  const unique = new Map();
  const plan = texts.map((t) => sentences(t).map((s) => { if (!unique.has(s)) unique.set(s, unique.size); return unique.get(s); }));
  const list = [...unique.keys()];
  const out = new Array(list.length);
  const w = getWorker();
  onStatus(`Translating into ${languageName || tgt}`);
  // all parts are queued at once, so the engine never waits for GazBook
  let done = 0;
  const jobs = [];
  for (let i = 0; i < list.length; i += CHUNK) {
    const part = list.slice(i, i + CHUNK);
    jobs.push(w.ask({ model: dir, src: pick.code ? pick.code(src) : src, tgt: pick.code ? pick.code(tgt) : tgt, prefix: pick.prefix, sentences: part.map(forModel) })
      .then((ans) => { ans.out.forEach((t, k) => { out[i + k] = fromModel(t, part[k]); }); done += part.length; onProgress(Math.min(1, done / list.length)); }));
  }
  await Promise.all(jobs);
  return plan.map((ids) => ids.map((k) => out[k]).join(' '));
}

// Which languages the on-computer translator has (from the cached manifest).
function fastLanguageCodes(modelsDir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(modelsDir, 'manifest.json'), 'utf8'));
    const fb = m.fallback && m.models[m.fallback];
    return [...new Set([...Object.keys(m.languages), ...((fb && fb.codes) || [])])];
  } catch { return null; }
}

module.exports = { translatePlain, fromModel, forModel, sentences, stopWorker, getManifest, fastLanguageCodes, MODELS_URL };
