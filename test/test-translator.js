// A test translator of the real size (random weights) on a local copy of the
// download page, so tests need no internet. Used by test/speed.js and the app self-test.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFileSync } = require('child_process');

async function testTranslator(langs, sampleText) {
  const py = process.env.GAZBOOK_BUILD_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'gazbook-tr-'));
  const model = path.join(work, 'model');
  const site = path.join(work, 'site');
  const txt = path.join(work, 'sample.txt');
  if (sampleText) fs.writeFileSync(txt, sampleText);
  // like a real translator, its word pieces are learned from real text (about 1.3 pieces a word)
  execFileSync(py, [path.join(__dirname, '..', 'translator', 'make_test_model.py'), model, ...(sampleText ? [txt] : [])], { stdio: 'inherit' });
  execFileSync(py, [path.join(__dirname, '..', 'translator', 'pack_model.py'), model, 'test-opus', site, ...langs.flatMap((l) => ['--lang', l])], { stdio: 'inherit' });
  const server = http.createServer((req, res) => {
    const f = path.join(site, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, ''));
    if (!f.startsWith(site) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-length': fs.statSync(f).size });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  return { url, work, close: () => { server.close(); fs.rmSync(work, { recursive: true, force: true }); } };
}

module.exports = { testTranslator };
