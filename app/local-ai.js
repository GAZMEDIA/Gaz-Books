// GazBook's own AI that runs on the computer: Qwen3 4B Instruct (Apache 2.0,
// free for commercial use, about 100 languages) through llama.cpp. Downloaded
// once (about 2.5 GB) into the app's folder; after that it works with no
// internet and no key. Used when Gemini is offline, busy or not set up.
const path = require('path');
const fs = require('fs');

const MODELS = [
  'hf:unsloth/Qwen3-4B-Instruct-2507-GGUF:Q4_K_M',
  'hf:Qwen/Qwen3-4B-GGUF:Q4_K_M',
];
const CONTEXT = 8192;

let loading = null;
// dir: where the model is kept; onStatus(text) shows download progress
function load(dir, onStatus = () => {}) {
  if (!loading) {
    loading = (async () => {
      const { getLlama, resolveModelFile } = await import('node-llama-cpp');
      fs.mkdirSync(dir, { recursive: true });
      let file; let last = '';
      for (const uri of MODELS) {
        try {
          file = await resolveModelFile(uri, {
            directory: dir,
            cli: false,
            onProgress: ({ totalSize, downloadedSize }) => {
              const pct = totalSize ? Math.floor((downloadedSize / totalSize) * 100) : 0;
              if (`${pct}` !== last) { last = `${pct}`; onStatus(`Downloading GazBook's built-in AI (only the first time, about 2.5 GB): ${pct}%`); }
            },
          });
          break;
        } catch (e) { file = null; last = e.message; }
      }
      if (!file) throw new Error(`The built-in AI could not be downloaded. Connect to the internet once to get it. (${last})`);
      onStatus('Starting the built-in AI');
      const llama = await getLlama();
      const model = await llama.loadModel({ modelPath: file });
      const context = await model.createContext({ contextSize: CONTEXT });
      return { llama, model, context };
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// Is the model already on this computer? (then the kit can work offline)
function isDownloaded(dir) {
  try { return fs.readdirSync(dir).some((f) => /qwen3-4b.*\.gguf$/i.test(f)); } catch { return false; }
}

// node-llama-cpp's JSON grammar takes plain JSON schema without extras.
function plainSchema(s) {
  if (Array.isArray(s)) return s.map(plainSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) if (['type', 'properties', 'required', 'items', 'enum'].includes(k)) out[k] = k === 'properties' ? Object.fromEntries(Object.entries(v).map(([p, x]) => [p, plainSchema(x)])) : plainSchema(v);
  if (out.type === 'object' && out.properties && !out.required) out.required = Object.keys(out.properties);
  return out;
}

let queue = Promise.resolve();
// One JSON answer, one at a time (the model has one context).
function localJson(dir, { system, prompt, schema, maxTokens = 4000 }, onStatus) {
  const run = async () => {
    const { llama, context } = await load(dir, onStatus);
    const { LlamaChatSession } = await import('node-llama-cpp');
    const grammar = await llama.createGrammarForJsonSchema(plainSchema(schema));
    const sequence = context.getSequence();
    try {
      const session = new LlamaChatSession({ contextSequence: sequence, systemPrompt: system });
      // keep the prompt inside the context, leaving room for the answer
      const room = Math.floor((CONTEXT - Math.min(maxTokens, 4000) - 300) * 2.5);
      const text = prompt.length > room ? `${prompt.slice(0, room - 2000)}\n…\n${prompt.slice(-2000)}` : prompt;
      const answer = await session.prompt(text, {
        grammar, maxTokens: Math.min(maxTokens, 4000), temperature: 0.4,
        // small models like to loop; this keeps them from repeating a phrase over and over
        repeatPenalty: { lastTokens: 256, penalty: 1.12, frequencyPenalty: 0.2, presencePenalty: 0.1 },
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

module.exports = { localJson, isDownloaded, load, MODELS };
