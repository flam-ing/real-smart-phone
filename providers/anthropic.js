'use strict';
// Anthropic Messages API with an image, for testers who bring their own Claude key.
module.exports = function anthropic({ apiKey, model }) {
  return {
    name: `anthropic/${model}`,
    configured: Boolean(apiKey && model),
    async decide({ system, history, image, text }) {
      if (!apiKey || !model) throw Object.assign(new Error('Anthropic key or model is missing'), { code: 'ai_not_configured' });
      const content = [];
      if (image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } });
      content.push({ type: 'text', text });
      const messages = [...history.map(turn => ({ role: turn.role === 'model' ? 'assistant' : 'user', content: turn.text })), { role: 'user', content }];
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, system, messages, max_tokens: 1024, temperature: 0.2 }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error?.message || `Anthropic ${response.status}`), { code: 'ai_failed' });
      const usage = data.usage ? { prompt_tokens: data.usage.input_tokens, completion_tokens: data.usage.output_tokens } : undefined;
      return { text: (data.content || []).map(c => c.text || '').join(''), usage };
    },
  };
};
