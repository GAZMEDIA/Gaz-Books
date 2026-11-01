// Puts a small private Python with the translator engine (CTranslate2 and
// SentencePiece) into build/python, for the Windows installer. Customers
// never install anything; GazBook runs translator/worker.py with it.
// Needs a Python with pip on the build computer (GitHub's Windows runner has one).
//   node scripts/bundle-python.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const JSZip = require('jszip');

const VERSION = '3.12.10';
const PY = '312';
const out = path.join(__dirname, '..', 'build', 'python');

(async () => {
  if (fs.existsSync(path.join(out, 'python.exe')) && fs.existsSync(path.join(out, 'Lib', 'site-packages', 'ctranslate2'))) {
    console.log('build/python is ready');
    return;
  }
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const url = `https://www.python.org/ftp/python/${VERSION}/python-${VERSION}-embed-amd64.zip`;
  console.log(`Getting ${url}`);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  const zip = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
  for (const [name, f] of Object.entries(zip.files)) {
    if (f.dir) continue;
    const p = path.join(out, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, await f.async('nodebuffer'));
  }
  // let the private Python see its own packages
  const pth = path.join(out, `python${PY}._pth`);
  fs.writeFileSync(pth, `python${PY}.zip\n.\nLib\\site-packages\n`);
  const site = path.join(out, 'Lib', 'site-packages');
  fs.mkdirSync(site, { recursive: true });
  const pip = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  execFileSync(pip, ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-compile',
    '--only-binary=:all:', '--platform', 'win_amd64', '--python-version', PY, '--implementation', 'cp',
    '--target', site, 'ctranslate2>=4.5', 'sentencepiece>=0.2'], { stdio: 'inherit' });
  // what the translator doesn't need
  fs.rmSync(path.join(site, 'bin'), { recursive: true, force: true }); // command-line tools the app never runs
  console.log('build/python is ready');
})().catch((e) => { console.error(e); process.exit(1); });
