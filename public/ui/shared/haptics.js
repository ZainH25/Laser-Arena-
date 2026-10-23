// Phone haptics. Android (Chrome) uses the Vibration API. iPhones have no Vibration API in Safari, but Safari 18+
// gives a light haptic tick when a native switch control toggles, so iOS gets ticks instead of long buzzes.

const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
let iosSwitch = null;

function iosTick() {
  if (!iosSwitch) {
    const label = document.createElement('label');
    label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.appendChild(input);
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

/** Vibrate with a pattern (ms on/off…). On iOS each "on" segment becomes one tick. */
export function buzz(pattern) {
  const p = Array.isArray(pattern) ? pattern : [pattern];
  if (canVibrate) {
    try { navigator.vibrate(p); } catch {}
    return;
  }
  let t = 0;
  p.forEach((ms, i) => {
    if (i % 2 === 0) setTimeout(iosTick, t);
    t += ms;
  });
}

// Named patterns so every screen feels the same.
export const HAPTIC = {
  tick: 25,
  finalTick: [60],
  roundStart: [40, 60, 40],
  heartbeat: [35, 110, 25],
  shot: [18],
  hit: [220, 70, 220, 70, 320], // you were terminated
  otherHit: [45],
  drop: [90, 40, 140, 40, 200],
  alarm: [120, 80, 120, 80, 120],
  win: [80, 60, 80, 60, 300],
};
