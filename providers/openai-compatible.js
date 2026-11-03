'use strict';
// For the Meta Model API (Muse) or any OpenAI-compatible chat completions endpoint with image input.
module.exports = function openaiCompatible({ baseUrl, apiKey, model }) {
  return {
    name: `openai-compatible/${model}`,
    configured: Boolean(baseUrl && apiKey && model),
    async decide({ system, history, image, text }) {
      if (!baseUrl || !apiKey || !model) throw Object.assign(new Error('AI_BASE_URL, AI_API_KEY and AI_MODEL are required'), { code: 'ai_not_configured' });
      const content = [{ type: 'text', text }];
      if (image) content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.toString('base64')}` } });
      const messages = [{ role: 'system', content: system },
        ...history.map(turn => ({ role: turn.role === 'model' ? 'assistant' : 'user', content: turn.text })),
        { role: 'user', content }];
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 512, response_format: { type: 'json_object' } }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error?.message || `AI ${response.status}`), { code: 'ai_failed' });
      return { text: data.choices?.[0]?.message?.content || '', usage: data.usage };
    },
  };
};
