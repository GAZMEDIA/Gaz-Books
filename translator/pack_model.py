# Packs one converted model folder for GazBook's download page: copies each
# file to <out>/<name>__<file> (GitHub release files can't be in folders) and
# adds the model to <out>/manifest.json.
#   python translator/pack_model.py <model folder> <name> <out folder> [--lang fr[:>>fra<<] ...] [--fallback codes] [--codemap no=nb,...]
import argparse
import hashlib
import json
import os
import shutil

ap = argparse.ArgumentParser()
ap.add_argument("folder"); ap.add_argument("name"); ap.add_argument("out")
ap.add_argument("--lang", action="append", default=[], help="target language this model serves, optionally code:prefix")
ap.add_argument("--fallback", help="space-separated codes: this is the many-languages backup model")
ap.add_argument("--codemap", default="", help="GazBook code=model code, comma separated")
ap.add_argument("--version", default="1")
a = ap.parse_args()

os.makedirs(a.out, exist_ok=True)
mf = os.path.join(a.out, "manifest.json")
manifest = json.load(open(mf)) if os.path.exists(mf) else {"version": 1, "languages": {}, "models": {}, "fallback": None}

files = []
for f in sorted(os.listdir(a.folder)):
    src = os.path.join(a.folder, f)
    if not os.path.isfile(src) or f in ("version.txt",):
        continue
    path = "gazbook.json.dl" if f == "gazbook.json" else f  # gazbook.json is written last on the computer, when all files are in
    asset = f"{a.name}__{path}"
    shutil.copyfile(src, os.path.join(a.out, asset))
    h = hashlib.sha256()
    with open(src, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    files.append({"asset": asset, "path": path, "bytes": os.path.getsize(src), "sha256": h.hexdigest()})

entry = {"version": a.version, "files": files}
if a.fallback:
    entry["codes"] = a.fallback.split()
    entry["codeMap"] = dict(x.split("=") for x in a.codemap.split(",") if "=" in x)
    manifest["fallback"] = a.name
manifest["models"][a.name] = entry
for spec in a.lang:
    code, _, prefix = spec.partition(":")
    manifest["languages"][code] = {"model": a.name, **({"prefix": prefix} if prefix else {})}
json.dump(manifest, open(mf, "w"), indent=1)
print(f"packed {a.name}: {sum(f['bytes'] for f in files) / 1e6:.0f} MB")
