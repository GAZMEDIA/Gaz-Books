// GazBook's own AI that runs on the computer: Qwen3 (Apache 2.0, free for
// commercial use, about 100 languages) through llama.cpp. Two sizes: small
// (1.7B, about 1.1 GB, the default, quick on ordinary laptops) and large (4B,
// about 2.5 GB, better writing). Downloaded once into the app's folder; after
// that it works with no internet and no key. Used when Gemini is offline,
// busy or not set up.
const path = require('path');
const fs = require('fs');

const SIZES = {
  small: { uris: ['hf:unsloth/Qwen3-1.7B-GGUF:Q4_K_M', 'hf:Qwen/Qwen3-1.7B-GGUF:Q8_0'], file: /qwen3-1\.7b.*\.gguf$/i, gb: '1.1', thinks: true },
  large: { uris: ['hf:unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M', 'hf:Qwen/Qwen3-4B-GGUF:Q4_K_M'], file: /qwen3-4b.*\.gguf$/i, gb: '2.5', thinks: false },
};
const MODELS = SIZES.large.uris;
const CONTEXT = 8192;

let loading = null;
let loadedSize = '';
// dir: where the model is kept; onStatus(text) shows download progress;
// size: 'small' or 'large' (offline, a model of the other size already here
// is used instead)
function load(dir, onStatus = () => {}, size = 'small') {
  if (loading && loadedSize !== size) {
    loading.then((l) => l.model.dispose()).catch(() => {});
    loading = null;
  }
  if (!loading) {
    loadedSize = size;
    loading = (async () => {
      const { getLlama, resolveModelFile } = await import('node-llama-cpp');
      fs.mkdirSync(dir, { recursive: true });
      // already here (downloaded before, or installed from an AI pack): no internet needed
      const want = SIZES[size] || SIZES.small;
      let file = localFile(dir, size); let last = '';
      for (const uri of file ? [] : want.uris) {
        try {
          file = await resolveModelFile(uri, {
            directory: dir,
            cli: false,
            onProgress: ({ totalSize, downloadedSize }) => {
              const pct = totalSize ? Math.floor((downloadedSize / totalSize) * 100) : 0;
              if (`${pct}` !== last) { last = `${pct}`; onStatus(`Downloading GazBook's built-in AI (only the first time, about ${want.gb} GB): ${pct}%`); }
            },
          });
          break;
        } catch (e) { file = null; last = e.message; }
      }
      if (!file) file = localFile(dir, size === 'small' ? 'large' : 'small');
      if (!file) throw new Error(`The built-in AI could not be downloaded. Connect to the internet once to get it. (${last})`);
      onStatus('Starting the built-in AI');
      const llama = await getLlama();
      const model = await llama.loadModel({ modelPath: file });
      const context = await model.createContext({ contextSize: CONTEXT });
      return { llama, model, context, thinks: SIZES.small.file.test(file) };
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// The model file, if it is already on this computer (then the kit works offline).
function localFile(dir, size) {
  const re = size ? (SIZES[size] || SIZES.small).file : /qwen3-.*\.gguf$/i;
  try {
    const f = fs.readdirSync(dir).find((n) => re.test(n) && fs.statSync(path.join(dir, n)).size > 5e8);
    return f ? path.join(dir, f) : null;
  } catch { return null; }
}
const isDownloaded = (dir) => !!localFile(dir);

// node-llama-cpp's JSON grammar takes plain JSON schema without extras.
function plainSchema(s) {
  if (Array.isArray(s)) return s.map(plainSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) if (['type', 'properties', 'required', 'items', 'enum', 'minItems', 'maxItems'].includes(k)) out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([p, x]) => [p, plainSchema(x)])) : plainSchema(v);
  if (out.type === 'object' && out.properties && !out.required) out.required = Object.keys(out.properties);
  return out;
}

let queue = Promise.resolve();
// One JSON answer, one at a time (the model has one context).
function localJson(dir, { system, prompt, schema, maxTokens = 4000 }, onStatus, size = 'small') {
  const run = async () => {
    const { llama, context, thinks } = await load(dir, onStatus, size);
    const { LlamaChatSession } = await import('node-llama-cpp');
    const grammar = await llama.createGrammarForJsonSchema(plainSchema(schema));
    const sequence = context.getSequence();
    try {
      const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: system });
      // keep the prompt inside the context, leaving room for the answer
      const room = Math.floor((CONTEXT - Math.min(maxTokens, 4000) - 300) * 2.5);
      const text = prompt.length > room ? `${prompt.slice(0, room - 2000)}\n…\n${prompt.slice(-2000)}` : prompt;
      // the small model can "think out loud" first; for these short jobs it answers straight away
      const answer = await session.prompt(thinks ? `${text}\n/no_think` : text, {
        grammar, budgets: { thoughtTokens: 0 }, maxTokens: Math.min(maxTokens, 4000), temperature: 0.4,
        // small models like to loop; this keeps them from repeating a phrase over and over
        repeatPenalty: { lastTokens: 128, penalty: 1.06 },
      });
      return grammar.parse(answer);
    } finally {
      sequence.dispose();
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

module.exports = { localJson, isDownloaded, load, MODELS, SIZES };
