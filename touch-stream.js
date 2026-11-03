'use strict';
// One physical Android device can accept only one owner's gesture at a time.
function createTouchStream({send, fallbackTap, fallbackSwipe, width=720, height=1560, maxHoldMs=45000}) {
  let active = null;
  const coords = m => Number.isFinite(m.x) && Number.isFinite(m.y) ? {x:Math.max(0,Math.min(width-1,Math.round(m.x))),y:Math.max(0,Math.min(height-1,Math.round(m.y)))} : null;
  function release(owner, point, performFallback=true) {
    if (!active || active.owner !== owner) return;
    const gesture=active; active=null; clearTimeout(gesture.timer);
    const p=point || gesture.last;
    if (gesture.hadStreaming) {
      // Release at most once; never replay a gesture that Android may have received.
      send('up', p);
    } else if (performFallback) {
      const duration=Math.max(40,Math.min(1000,Date.now()-gesture.started));
      const distance=Math.hypot(p.x-gesture.first.x,p.y-gesture.first.y);
      if(distance<20 && duration<450) fallbackTap(gesture.first.x,gesture.first.y);
      else fallbackSwipe(gesture.first.x,gesture.first.y,p.x,p.y,distance<20?650:duration);
    }
  }
  function handle(owner, msg) {
    const p=coords(msg); if(!p) return;
    if(msg.type==='pointer_down') {
      if(active) return;
      const g={owner,first:p,last:p,started:Date.now(),streaming:send('down',p)};
      g.hadStreaming=g.streaming; active=g; g.timer=setTimeout(()=>release(owner,null,false),maxHoldMs); g.timer.unref?.();
    } else if(msg.type==='pointer_move') {
      if(!active || active.owner!==owner)return;
      active.last=p;
      if(active.streaming && !send('move',p)) { active.streaming=false; }
    } else if(msg.type==='pointer_up') {
      release(owner,p);
    }
  }
  return {handle, release};
}
module.exports=createTouchStream;
