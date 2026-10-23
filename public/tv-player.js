// "Play on this TV": the TV joins its own room as a normal player over a second connection, so every game rule
// (secret positions, host rules, scoring) is exactly the same as for a phone.
//
// Controls (active while the menu is closed):
//   Laptop     WASD moves · arrow keys aim (combine two for diagonals) · or aim with the mouse
//   Fire TV    D-pad moves (you aim where you last moved) · OK / Select snaps the aim 45° clockwise
//   Gamepad    left stick moves · right stick aims

const DEAD = 0.25;
// On a Fire TV / Android TV the remote's D-pad sends arrow keys and there is no WASD, so arrows move there.
const REMOTE = /AFT|Silk|Fire ?TV|Android TV|BRAVIA|SMART-TV/i.test(navigator.userAgent);

export function createTvPlayer({ room, onMessage }) {
  let ws = null;
  let id = null;
  let token = sessionStorage.getItem('la-tv-token');
  let aim = 0;
  let enabled = false; // controls only drive the fighter while the menu is closed
  const keys = new Set();
  let lastSent = '';
  let wantJoin = null;
  let move = { x: 0, y: 0 }; // current stick / keys, for local prediction on the TV
  let aimSource = 'walk'; // 'walk' (face where you move), 'keys' (arrow keys) or 'mouse'

  function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }

  function connect() {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => {
      if (wantJoin) send(wantJoin);
      else if (token && room()) send({ t: 'join', auto: true, room: room(), token });
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.t === 'joined') {
        id = m.id;
        token = m.token;
        sessionStorage.setItem('la-tv-token', token);
        wantJoin = null;
      } else if (m.t === 'kicked' || (m.t === 'error' && m.msg === 'expired')) {
        id = null;
        token = null;
        sessionStorage.removeItem('la-tv-token');
      }
      onMessage(m);
    };
    ws.onclose = () => { ws = null; if (id || wantJoin) setTimeout(connect, 800); };
  }

  /** Join (or re-join) the current room as the TV player with a look from the Locker. */
  function join(look) {
    wantJoin = { t: 'join', room: room(), name: look.name || 'TV', token, color: look.color, laserColor: look.laserColor, outfit: look.outfit, skin: look.skin };
    if (!ws) connect();
    else if (ws.readyState === 1) send(wantJoin);
  }

  function leave() {
    id = null;
    token = null;
    wantJoin = null;
    sessionStorage.removeItem('la-tv-token');
    try { ws?.close(); } catch {}
    ws = null;
  }

  // ---------------------------------------------------------------- input

  addEventListener('keydown', (e) => {
    if (!enabled || !id) return;
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd', 'q', 'e'].includes(k)) { keys.add(k); e.preventDefault(); }
    if (!REMOTE && k.startsWith('arrow')) aimSource = 'keys';
    if (k === 'enter' || k === ' ' || k === 'select') { aim = (aim + 45) % 360; e.preventDefault(); }
  });
  addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  addEventListener('blur', () => keys.clear());

  /** Called every frame by the TV page. */
  function update(dt) {
    if (!enabled || !id) return;
    const arrowsMove = REMOTE;
    let mx = (keys.has('d') || (arrowsMove && keys.has('arrowright')) ? 1 : 0) - (keys.has('a') || (arrowsMove && keys.has('arrowleft')) ? 1 : 0);
    let my = (keys.has('s') || (arrowsMove && keys.has('arrowdown')) ? 1 : 0) - (keys.has('w') || (arrowsMove && keys.has('arrowup')) ? 1 : 0);
    if (!REMOTE) {
      // Laptop: the arrow keys point the aim (two at once = diagonal).
      const ax = (keys.has('arrowright') ? 1 : 0) - (keys.has('arrowleft') ? 1 : 0);
      const ay = (keys.has('arrowdown') ? 1 : 0) - (keys.has('arrowup') ? 1 : 0);
      if (ax || ay) aim = ((Math.atan2(ay, ax) * 180) / Math.PI + 360) % 360;
    }
    if (keys.has('q')) aim = (aim - 140 * dt + 360) % 360;
    if (keys.has('e')) aim = (aim + 140 * dt) % 360;
    let padAim = false;
    for (const gp of navigator.getGamepads?.() || []) {
      if (!gp) continue;
      const [lx = 0, ly = 0, rx = 0, ry = 0] = gp.axes;
      if (Math.hypot(lx, ly) > DEAD) { mx = lx; my = ly; }
      if (Math.hypot(rx, ry) > 0.4) { aim = ((Math.atan2(ry, rx) * 180) / Math.PI + 360) % 360; padAim = true; }
      if (gp.buttons[12]?.pressed) my = -1; // d-pad on the gamepad
      if (gp.buttons[13]?.pressed) my = 1;
      if (gp.buttons[14]?.pressed) mx = -1;
      if (gp.buttons[15]?.pressed) mx = 1;
      break;
    }
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    // Remote (no aim stick, no mouse): face the way you walk. On a laptop the aim stays where the arrows / mouse put it.
    if (m > DEAD && !padAim && !keys.has('q') && !keys.has('e') && aimSource === 'walk') aim = ((Math.atan2(my, mx) * 180) / Math.PI + 360) % 360;
    move = { x: mx, y: my };
    const msg = { t: 'input', mx: +mx.toFixed(2), my: +my.toFixed(2), aim: Math.round(aim) };
    const key = `${msg.mx},${msg.my},${msg.aim}`;
    if (key !== lastSent || Math.random() < 0.1) { lastSent = key; send(msg); }
  }

  return {
    join, leave, update, send,
    setEnabled(on) { enabled = on; if (!on) { keys.clear(); move = { x: 0, y: 0 }; send({ t: 'input', mx: 0, my: 0, aim: Math.round(aim) }); } },
    get move() { return enabled && id ? move : { x: 0, y: 0 }; },
    /** Mouse aim from the page (angle in degrees, game coordinates). */
    pointerAim(deg) { if (!enabled || !id) return; aim = (deg + 360) % 360; aimSource = 'mouse'; },
    get remote() { return REMOTE; },
    get id() { return id; },
    get aim() { return aim; },
    resume() { if (token && !ws) connect(); },
  };
}
