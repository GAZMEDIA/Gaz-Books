# GazBook's on-computer translator.
# Runs CTranslate2 (8-bit) on every CPU core. GazBook starts it once and sends
# one JSON request per line on stdin; each answer is one JSON line on stdout.
#
#   {"id": 1, "model": "<folder>", "src": "en", "tgt": "fr", "prefix": ">>fra<<", "sentences": ["..."]}
#   -> {"id": 1, "out": ["..."]}            or {"id": 1, "error": "..."}
#   {"id": 2, "ping": true} -> {"id": 2, "ok": true, "threads": 8}
#
# Each model folder holds the converted model plus gazbook.json:
#   {"src_spm": "source.spm", "tgt_spm": "target.spm",
#    "lang_tokens": "__{}__"   (multilingual models such as M2M100; optional)}
import json
import os
import sys

import ctranslate2
import sentencepiece as spm

THREADS = max(1, min(int(os.environ.get("GAZBOOK_THREADS") or os.cpu_count() or 2), 32))
# beam 2 reads a little better; greedy (1) is twice as fast. Big computers can afford beam 2.
BEAM = int(os.environ.get("GAZBOOK_BEAM") or (2 if THREADS >= 8 else 1))
_models = {}


def load(folder):
    m = _models.get(folder)
    if m:
        return m
    with open(os.path.join(folder, "gazbook.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    src = spm.SentencePieceProcessor(model_file=os.path.join(folder, cfg["src_spm"]))
    tgt = src if cfg.get("tgt_spm", cfg["src_spm"]) == cfg["src_spm"] else \
        spm.SentencePieceProcessor(model_file=os.path.join(folder, cfg["tgt_spm"]))
    # inter_threads: one batch per core at the same time; that is what makes it fast
    tr = ctranslate2.Translator(folder, device="cpu", compute_type="int8",
                                inter_threads=THREADS, intra_threads=1)
    m = {"cfg": cfg, "src": src, "tgt": tgt, "tr": tr}
    while len(_models) >= 3:  # keep the last few languages in memory
        _models.pop(next(iter(_models)))
    _models[folder] = m
    return m


def translate(req):
    m = load(req["model"])
    cfg = m["cfg"]
    sents = req["sentences"]
    lt = cfg.get("lang_tokens")
    head = [lt.format(req["src"])] if lt else ([req["prefix"]] if req.get("prefix") else [])
    tokens = [head + m["src"].encode(s, out_type=str)[:400] + ["</s>"] for s in sents]
    target_prefix = [[lt.format(req["tgt"])] for _ in sents] if lt else None
    # shortest first so batches hold sentences of similar length
    order = sorted(range(len(tokens)), key=lambda i: len(tokens[i]))
    toks = [tokens[i] for i in order]
    pref = [target_prefix[i] for i in order] if target_prefix else None
    opts = dict(beam_size=BEAM, max_batch_size=24, batch_type="examples",
                repetition_penalty=1.1, replace_unknowns=True)
    if cfg.get("test_length"):
        # random-weight test models never stop by themselves: make each answer
        # about as long as its question, like a real translation
        jobs = []
        for a in range(0, len(toks), 24):
            n = int(len(toks[min(a + 23, len(toks) - 1)]) * cfg["test_length"]) + 1
            jobs += m["tr"].translate_batch(toks[a:a + 24], target_prefix=pref[a:a + 24] if pref else None,
                                            min_decoding_length=n, max_decoding_length=n,
                                            asynchronous=True, **opts)
        res = [j.result() for j in jobs]
    else:
        longest = max((len(t) for t in toks), default=8)
        res = m["tr"].translate_batch(toks, target_prefix=pref,
                                      max_decoding_length=min(512, 3 * longest + 10), **opts)
    out = [""] * len(sents)
    for k, r in zip(order, res):
        hyp = r.hypotheses[0]
        if lt and hyp and hyp[0] == lt.format(req["tgt"]):
            hyp = hyp[1:]
        out[k] = m["tgt"].decode_pieces(hyp) if hasattr(m["tgt"], "decode_pieces") else m["tgt"].decode(hyp)
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stdin.reconfigure(encoding="utf-8")
    for line in sys.stdin:
        if not line.strip():
            continue
        req = {}
        try:
            req = json.loads(line)
            if req.get("ping"):
                ans = {"id": req.get("id"), "ok": True, "threads": THREADS}
            else:
                ans = {"id": req.get("id"), "out": translate(req)}
        except Exception as e:  # report and keep running
            ans = {"id": req.get("id"), "error": f"{type(e).__name__}: {e}"}
        sys.stdout.write(json.dumps(ans, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
