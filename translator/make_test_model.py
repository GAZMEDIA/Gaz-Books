# Builds a test translator with the same size and shape as a real OPUS-MT
# model, but with random weights, so the speed of GazBook's translator can be
# checked anywhere without downloading anything. Its "translations" are
# nonsense; only the timing means something.
#   python translator/make_test_model.py <out folder> [sample text file]
import json
import os
import sys

import numpy as np
import sentencepiece as spm
from ctranslate2.converters import marian
from ctranslate2.specs import common_spec, transformer_spec

out = sys.argv[1]
text = sys.argv[2] if len(sys.argv) > 2 else None
os.makedirs(out, exist_ok=True)

# a small real tokenizer, trained on whatever text we have
corpus = os.path.join(out, "corpus.txt")
with open(corpus, "w", encoding="utf-8") as f:
    if text and os.path.exists(text):
        f.write(open(text, encoding="utf-8").read())
    else:
        words = "the river was quiet that morning and she opened the letter then smiled".split()
        rng = np.random.default_rng(1)
        for _ in range(4000):
            f.write(" ".join(rng.choice(words, 12)) + ".\n")
spm.SentencePieceTrainer.train(input=corpus, model_prefix=os.path.join(out, "sp"), vocab_size=8000,
                               character_coverage=1.0, hard_vocab_limit=False, minloglevel=2)
os.remove(corpus)
pieces = [l.split("\t")[0] for l in open(os.path.join(out, "sp.vocab"), encoding="utf-8")]
vocab = ["<unk>", "<s>", "</s>"] + [p for p in pieces if p not in ("<unk>", "<s>", "</s>")]
V = 58000  # OPUS-MT vocabulary size: pad with unused entries so the model is full size
vocab += [f"<pad{i}>" for i in range(V - len(vocab))]

d, ffn, layers, heads = 512, 2048, 6, 8  # OPUS-MT base
rng = np.random.default_rng(0)
r = lambda *s: (rng.standard_normal(s) * 0.02).astype(np.float32)
W = {"Wemb": r(V, d), "decoder_ff_logit_out_b": r(1, V)}
def att(p):
    for k in "qkvo":
        W[f"{p}_W{k}"] = r(d, d); W[f"{p}_b{k}"] = r(1, d)
    W[f"{p}_Wo_ln_scale"] = np.ones((1, d), np.float32); W[f"{p}_Wo_ln_bias"] = r(1, d)
def ff(p):
    W[f"{p}_W1"] = r(d, ffn); W[f"{p}_b1"] = r(1, ffn); W[f"{p}_W2"] = r(ffn, d); W[f"{p}_b2"] = r(1, d)
    W[f"{p}_ffn_ln_scale"] = np.ones((1, d), np.float32); W[f"{p}_ffn_ln_bias"] = r(1, d)
for i in range(layers):
    att(f"encoder_l{i+1}_self"); ff(f"encoder_l{i+1}_ffn")
    att(f"decoder_l{i+1}_self"); att(f"decoder_l{i+1}_context"); ff(f"decoder_l{i+1}_ffn")
spec = transformer_spec.TransformerSpec.from_config((layers, layers), heads, pre_norm=False,
                                                    activation=common_spec.Activation.SWISH)
marian.set_transformer_spec(spec, W)
spec.register_source_vocabulary(vocab)
spec.register_target_vocabulary(vocab)
spec.config.add_source_eos = False
spec.validate()
spec.optimize(quantization="int8")
spec.save(out)
with open(os.path.join(out, "gazbook.json"), "w") as f:
    json.dump({"src_spm": "sp.model", "tgt_spm": "sp.model", "test_length": 1.1}, f)
print("test model ready:", out)
