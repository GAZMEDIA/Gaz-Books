# Builds GazBook's translator files for every Amazon KDP language and packs
# them for the GitHub release (run by .github/workflows/models.yml).
# Free, open models only:
#   - OPUS-MT (University of Helsinki, CC-BY 4.0): one small model per language
#     or language family, fast and good.
#   - M2M100 418M (Meta, MIT): one bigger model for the languages OPUS-MT lacks.
# Each is converted to CTranslate2 with 8-bit weights.
#   python translator/build_models.py <out folder> [only these codes]
import json
import os
import subprocess
import sys

import ctranslate2
from ctranslate2.converters import TransformersConverter

OUT = sys.argv[1]
ONLY = set(sys.argv[2:])
WORK = os.path.join(OUT, "_work")
HERE = os.path.dirname(os.path.abspath(__file__))

# GazBook code: candidates in order of preference: (Hugging Face model, [target tags to try])
OPUS = {
    "fr": [("Helsinki-NLP/opus-mt-en-fr", [])],
    "es": [("Helsinki-NLP/opus-mt-en-es", [])],
    "de": [("Helsinki-NLP/opus-mt-en-de", [])],
    "it": [("Helsinki-NLP/opus-mt-en-it", [])],
    "nl": [("Helsinki-NLP/opus-mt-en-nl", [])],
    "da": [("Helsinki-NLP/opus-mt-en-da", [])],
    "sv": [("Helsinki-NLP/opus-mt-en-sv", [])],
    "fi": [("Helsinki-NLP/opus-mt-en-fi", [])],
    "is": [("Helsinki-NLP/opus-mt-en-is", [])],
    "ga": [("Helsinki-NLP/opus-mt-en-ga", [])],
    "cy": [("Helsinki-NLP/opus-mt-en-cy", [])],
    "gd": [("Helsinki-NLP/opus-mt-en-gd", [])],
    "af": [("Helsinki-NLP/opus-mt-en-af", [])],
    "uk": [("Helsinki-NLP/opus-mt-en-uk", [])],
    "he": [("Helsinki-NLP/opus-mt-en-he", [])],
    "eu": [("Helsinki-NLP/opus-mt-en-eu", [])],
    "ca": [("Helsinki-NLP/opus-mt-en-ca", []), ("Helsinki-NLP/opus-mt-en-ROMANCE", [">>ca<<"])],
    "gl": [("Helsinki-NLP/opus-mt-en-gl", []), ("Helsinki-NLP/opus-mt-en-ROMANCE", [">>gl<<"])],
    "pt": [("Helsinki-NLP/opus-mt-en-ROMANCE", [">>pt<<", ">>pt_PT<<"])],
    "oc": [("Helsinki-NLP/opus-mt-en-ROMANCE", [">>oc<<"])],
    "la": [("Helsinki-NLP/opus-mt-en-ROMANCE", [">>la<<"])],
    "co": [("Helsinki-NLP/opus-mt-en-ROMANCE", [">>co<<"])],
    "rm": [("Helsinki-NLP/opus-mt-en-ROMANCE", [">>rm<<"])],
    "pl": [("Helsinki-NLP/opus-mt-en-zlw", [">>pol<<", ">>pl<<"]), ("Helsinki-NLP/opus-mt-en-sla", [">>pol<<", ">>pl<<"])],
    "no": [("Helsinki-NLP/opus-mt-en-gmq", [">>nob<<", ">>no<<"]), ("Helsinki-NLP/opus-mt-en-no", [])],
    "hi": [("Helsinki-NLP/opus-mt-en-hi", [])],
    "mr": [("Helsinki-NLP/opus-mt-en-mr", [])],
    "ml": [("Helsinki-NLP/opus-mt-en-ml", [])],
    "gu": [("Helsinki-NLP/opus-mt-en-gu", [])],
    "ar": [("Helsinki-NLP/opus-mt-en-ar", [">>ara<<", ">>arb<<", ""])],
}
# The backup for everything else (and for books not written in English).
M2M = "facebook/m2m100_418M"
M2M_CODES = ("af ar br ca cy da de en es fa fi fr fy ga gd gl gu he hi is it ja lb ml mr nl no oc pl pt "
             "sv ta uk yi").split()

LOG = []


def say(*a):
    print(*a, flush=True)
    LOG.append(" ".join(str(x) for x in a))


def vocab_tokens(folder):
    for f in ("shared_vocabulary.json", "target_vocabulary.json", "source_vocabulary.json"):
        p = os.path.join(folder, f)
        if os.path.exists(p):
            return set(json.load(open(p, encoding="utf-8")))
    return set()


converted = {}


def convert(model, files, cfg):
    """Converts a Hugging Face model once; returns its folder or None."""
    if model in converted:
        return converted[model]
    folder = os.path.join(WORK, model.split("/")[-1])
    try:
        TransformersConverter(model, copy_files=files).convert(folder, quantization="int8", force=True)
        json.dump(cfg, open(os.path.join(folder, "gazbook.json"), "w"))
        converted[model] = folder
    except Exception as e:  # the model does not exist or will not convert: try the next one
        say(f"  skip {model}: {type(e).__name__}: {str(e).splitlines()[0][:160]}")
        converted[model] = None
    return converted[model]


def smoke(folder, src, tgt, prefix):
    """Translates one line, to show in the log that the model works."""
    out = subprocess.run([sys.executable, os.path.join(HERE, "worker.py")], text=True, capture_output=True,
                         input=json.dumps({"id": 1, "model": folder, "src": src, "tgt": tgt, "prefix": prefix,
                                           "sentences": ["The river was quiet that morning, and she smiled."]}) + "\n")
    try:
        return json.loads(out.stdout.strip().splitlines()[-1]).get("out", ["?"])[0]
    except Exception:
        return f"FAILED: {out.stderr[-300:]}"


def pack(folder, name, langs=(), fallback=None):
    args = [sys.executable, os.path.join(HERE, "pack_model.py"), folder, name, OUT]
    for code, prefix in langs:
        args += ["--lang", f"{code}:{prefix}" if prefix else code]
    if fallback:
        args += ["--fallback", " ".join(fallback)]
    subprocess.run(args, check=True)


def main():
    os.makedirs(WORK, exist_ok=True)
    served = {}  # model folder -> [(code, prefix)]
    for code, cands in OPUS.items():
        if ONLY and code not in ONLY:
            continue
        for model, tags in cands:
            folder = convert(model, ["source.spm", "target.spm"], {"src_spm": "source.spm", "tgt_spm": "target.spm"})
            if not folder:
                continue
            vocab = vocab_tokens(folder)
            prefix = None
            if not tags:
                prefix = ""
            else:
                prefix = next((t for t in tags if t == "" or t in vocab), None)
            if prefix is None:
                say(f"  {model} has no tag for {code} (tried {tags})")
                continue
            say(f"{code}: {model} {prefix} -> {smoke(folder, 'en', code, prefix)}")
            served.setdefault(folder, []).append((code, prefix))
            break
        else:
            say(f"{code}: no OPUS-MT model, uses the backup")
    for folder, langs in served.items():
        pack(folder, "opus-" + os.path.basename(folder).replace("opus-mt-", "").lower(), langs)
    if not ONLY or "m2m" in ONLY:
        folder = convert(M2M, ["sentencepiece.bpe.model"], {"src_spm": "sentencepiece.bpe.model", "lang_tokens": "__{}__"})
        if folder:
            say(f"backup: {M2M} -> {smoke(folder, 'en', 'fr', '')}")
            pack(folder, "m2m100-418m", fallback=M2M_CODES)
    open(os.path.join(OUT, "build-log.txt"), "w", encoding="utf-8").write("\n".join(LOG) + "\n")


if __name__ == "__main__":
    main()
