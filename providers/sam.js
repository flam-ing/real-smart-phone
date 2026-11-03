'use strict';
// SAM 3.1 on the Meta Model API: give a screenshot and a short phrase ("send button"), get back the boxes
// of matching things on screen, best first. Coordinates come in the image's own pixels.
module.exports = function sam({ apiKey, baseUrl = 'https://api.meta.ai/v1', model = 'sam-3.1' }) {
  return {
    configured: Boolean(apiKey),
    async find(image, phrase, mime = 'image/jpeg') {
      if (!apiKey) throw Object.assign(new Error('MODEL_API_KEY is not set'), { code: 'ai_not_configured' });
      const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, input: [{ role: 'user', content: [
          { type: 'input_text', text: String(phrase).slice(0, 80) },
          { type: 'input_image', image_url: `data:${mime};base64,${image.toString('base64')}` },
        ] }] }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(data.error?.message || `SAM ${response.status}`), { code: 'ai_failed' });
      const text = (data.output || []).flatMap(o => o.content || []).map(c => c.text || '').join('');
      return parseBoxes(text);
    },
  };
};

/** `<|box;x1=..;y1=..;x2=..;y2=..;w=..;h=..|>` entries, in the order SAM ranked them. */
function parseBoxes(text) {
  const boxes = [];
  for (const m of String(text).matchAll(/<\|box;([^|]*)\|>/g)) {
    const v = Object.fromEntries(m[1].split(';').map(kv => kv.split('=')).map(([k, n]) => [k, Number(n)]));
    if ([v.x1, v.y1, v.x2, v.y2].every(Number.isFinite) && v.x2 > v.x1 && v.y2 > v.y1) boxes.push({ x1: v.x1, y1: v.y1, x2: v.x2, y2: v.y2, w: v.w, h: v.h });
  }
  return boxes;
}
module.exports.parseBoxes = parseBoxes;
