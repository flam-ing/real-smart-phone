'use strict';
// One narrow interface: decide({system, history, image, text}) -> parsed JSON object.
// The provider is configuration: AI_PROVIDER=meta (Muse Spark on the Meta Model API), gemini, or any openai-compatible endpoint.
const gemini = require('./gemini');
const openaiCompatible = require('./openai-compatible');

function provider(env = process.env) {
  const name = env.AI_PROVIDER || 'meta';
  if (name === 'meta') return openaiCompatible({ baseUrl: env.AI_BASE_URL || 'https://api.meta.ai/v1', apiKey: env.MODEL_API_KEY || env.AI_API_KEY, model: env.AI_MODEL || 'muse-spark-1.3' });
  if (name === 'gemini') return gemini({ apiKey: env.GEMINI_API_KEY, model: env.AI_MODEL || 'gemini-2.5-flash-lite' });
  if (name === 'openai-compatible') return openaiCompatible({ baseUrl: env.AI_BASE_URL, apiKey: env.AI_API_KEY, model: env.AI_MODEL });
  throw new Error(`Unknown AI_PROVIDER ${name}`);
}

function parseJson(text) {
  const body = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '');
  try { return JSON.parse(body); } catch {}
  const match = /\{[\s\S]*\}/.exec(body);
  if (match) return JSON.parse(match[0]);
  throw new Error('The model did not return JSON');
}

module.exports = { provider, parseJson };
