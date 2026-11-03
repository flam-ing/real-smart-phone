'use strict';
// Frames to the browser pass through cloudflared, which buffers them where
// ws.bufferedAmount cannot see. Clients that acknowledge received frames keep
// at most `credits` frames in flight; while waiting, only the newest frame is kept.
function createFrameCredit({credits=2, send}) {
  const state = new WeakMap();
  function enable(client) { state.set(client, {inFlight:0, pending:null}); }
  function offer(client, frame) {
    const s = state.get(client);
    if (!s) return send(client, frame); // Older pages without acknowledgements keep the previous behaviour.
    if (s.inFlight >= credits) { s.pending = frame; return; }
    s.inFlight++; send(client, frame);
  }
  function ack(client) {
    const s = state.get(client);
    if (!s) return;
    s.inFlight = Math.max(0, s.inFlight - 1);
    if (s.pending && s.inFlight < credits) { const frame = s.pending; s.pending = null; s.inFlight++; send(client, frame); }
  }
  return {enable, offer, ack};
}
module.exports = createFrameCredit;
