'use strict';
module.exports = function gemini({ apiKey, model }) {
  return {
    name: `gemini/${model}`,
    configured: Boolean(apiKey),
    async decide({ system, history, image, text }) {
      if (!apiKey) throw Object.assign(new Error('GEMINI_API_KEY is not set'), { code: 'ai_not_configured' });
      const contents = history.map(turn => ({ role: turn.role === 'model' ? 'model' : 'user', parts: [{ text: turn.text }] }));
      const parts = [{ text }];
      if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image.toString('base64') } });
      contents.push({ role: 'user', parts });
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { responseMimeType: 'application/json', temperature: 0.2, maxOutputTokens: 512 } }),
        signal: AbortSignal.timeout(45000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error?.message || `Gemini ${response.status}`), { code: 'ai_failed' });
      const out = data.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
      return { text: out, usage: data.usageMetadata };
    },
  };
};
