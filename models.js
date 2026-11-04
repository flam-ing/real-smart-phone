'use strict';
// Which AI runs each phone. Meta's Muse Spark is built in (the server's key); testers may connect their own
// provider key, then pick its model and reasoning level. Keys stay on the server and are never sent back.
const fs = require('fs');
const path = require('path');
const gemini = require('./providers/gemini');
const openaiCompatible = require('./providers/openai-compatible');
const anthropic = require('./providers/anthropic');

const CATALOG = [
  { id: 'meta', name: 'Meta · Muse', icon: 'meta-color.svg', kind: 'openai', builtIn: true, baseUrl: 'https://api.meta.ai/v1',
    reasoning: ['minimal', 'low', 'medium', 'high'], defaultModel: 'muse-spark-1.3', keep: m => /^muse-spark/.test(m) },
  { id: 'openai', name: 'OpenAI', icon: 'openai.svg', kind: 'openai', baseUrl: 'https://api.openai.com/v1',
    reasoning: ['minimal', 'low', 'medium', 'high'], keep: m => /^(gpt-|o\d)/.test(m) && !/audio|realtime|tts|transcribe|search|image|embed|instruct/.test(m) },
  { id: 'anthropic', name: 'Anthropic', icon: 'claude-color.svg', kind: 'anthropic', reasoning: null, keep: m => /^claude/.test(m) },
  { id: 'google', name: 'Google Gemini', icon: 'gemini-color.svg', kind: 'gemini', reasoning: ['low', 'medium', 'high'], keep: m => /^gemini/.test(m) && !/embedding|tts|image|aqa/.test(m) },
  { id: 'openrouter', name: 'OpenRouter', icon: 'openrouter.svg', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', reasoningStyle: 'openrouter',
    reasoning: ['low', 'medium', 'high'], keep: () => true },
  { id: 'xai', name: 'xAI Grok', icon: 'grok.svg', kind: 'openai', baseUrl: 'https://api.x.ai/v1', reasoning: null, keep: m => /^grok/.test(m) && !/image/.test(m) },
];
const byId = id => CATALOG.find(p => p.id === id);

function createModels({ dataDir, env = process.env }) {
  const file = n => path.join(dataDir, `model-${n}.json`);
  const defaults = () => ({ active: 'meta', model: env.AI_MODEL || 'muse-spark-1.3', reasoning: env.AI_REASONING || 'low', keys: {} });
  const load = n => { try { return { ...defaults(), ...JSON.parse(fs.readFileSync(file(n), 'utf8')) }; } catch { return defaults(); } };
  const save = (n, cfg) => { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(file(n), JSON.stringify(cfg), { mode: 0o600 }); };
  const keyFor = (cfg, id) => id === 'meta' ? (env.MODEL_API_KEY || env.AI_API_KEY) : cfg.keys[id];

  const cache = new Map(); // `${n}:${id}` -> { at, models }
  /** Models that take images, newest naming first, straight from the provider. */
  async function listModels(n, id, apiKey) {
    const p = byId(id);
    if (!p) throw Object.assign(new Error('Unknown provider'), { status: 400 });
    const key = apiKey || keyFor(load(n), id);
    if (!key) throw Object.assign(new Error('Add an API key first'), { status: 400 });
    const hit = cache.get(`${n}:${id}`);
    if (!apiKey && hit && Date.now() - hit.at < 10 * 60000) return hit.models;
    let ids = [];
    const get = async (url, headers) => {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error?.message || `The provider answered ${res.status}. Check the key.`), { status: 400 });
      return data;
    };
    if (p.kind === 'anthropic') ids = (await get('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': key, 'anthropic-version': '2023-06-01' })).data.map(m => m.id);
    else if (p.kind === 'gemini') ids = (await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': key })).models
      .filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
    else {
      const data = await get(`${p.baseUrl}/models`, { authorization: `Bearer ${key}` });
      ids = (data.data || []).filter(m => id !== 'openrouter' || (m.architecture?.input_modalities || []).includes('image')).map(m => m.id);
    }
    const models = [...new Set(ids.filter(p.keep))].sort().reverse().slice(0, 80);
    cache.set(`${n}:${id}`, { at: Date.now(), models });
    return models;
  }

  /** What the page shows: every provider, which are usable, and the phone's current choice. */
  function view(n) {
    const cfg = load(n);
    return {
      active: cfg.active, model: cfg.model, reasoning: cfg.reasoning,
      providers: CATALOG.map(p => ({ id: p.id, name: p.name, icon: `icons/providers/${p.icon}`, builtIn: !!p.builtIn, connected: Boolean(keyFor(cfg, p.id)), reasoning: p.reasoning })),
    };
  }

  async function connect(n, id, apiKey) {
    const p = byId(id);
    if (!p || p.builtIn) throw Object.assign(new Error('This provider cannot take a key'), { status: 400 });
    const key = String(apiKey || '').trim();
    if (!/^[\x21-\x7e]{8,400}$/.test(key)) throw Object.assign(new Error('That does not look like an API key'), { status: 400 });
    const models = await listModels(n, id, key); // proves the key works before it is stored
    const cfg = load(n); cfg.keys[id] = key; save(n, cfg);
    return { models };
  }
  function disconnect(n, id) {
    const cfg = load(n);
    delete cfg.keys[id];
    if (cfg.active === id) Object.assign(cfg, { active: 'meta', model: defaults().model, reasoning: defaults().reasoning });
    cache.delete(`${n}:${id}`); save(n, cfg);
  }
  function choose(n, { active, model, reasoning }) {
    const cfg = load(n), previous = cfg.active, p = byId(active || cfg.active);
    if (!p || !keyFor(cfg, p.id)) throw Object.assign(new Error('Connect this provider first'), { status: 400 });
    cfg.active = p.id;
    if (typeof model === 'string' && /^[\w.:/@-]{1,120}$/.test(model)) cfg.model = model;
    if (!model && p.id !== previous) cfg.model = p.defaultModel || '';
    cfg.reasoning = p.reasoning?.includes(reasoning) ? reasoning : (p.reasoning?.includes(cfg.reasoning) ? cfg.reasoning : p.reasoning?.[0] || '');
    save(n, cfg);
  }

  /** The adapter the AI uses on this phone. */
  function providerFor(n) {
    const cfg = load(n), p = byId(cfg.active) || byId('meta'), apiKey = keyFor(cfg, p.id), model = cfg.model || p.defaultModel;
    let ai;
    if (p.kind === 'anthropic') ai = anthropic({ apiKey, model });
    else if (p.kind === 'gemini') ai = gemini({ apiKey, model, reasoning: cfg.reasoning });
    else ai = openaiCompatible({ baseUrl: p.baseUrl, apiKey, model, reasoning: p.reasoning ? cfg.reasoning : '', reasoningStyle: p.reasoningStyle });
    return Object.assign(ai, { providerId: p.id, builtIn: !!p.builtIn });
  }

  return { view, listModels, connect, disconnect, choose, providerFor };
}

module.exports = { createModels, CATALOG };
