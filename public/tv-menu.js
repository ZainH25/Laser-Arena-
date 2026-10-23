// TV intro / pause menu: ENTER ARENA, QUICK MATCH, CUSTOMISE FIGHTER, SETTINGS, TERMINATE.
// Works with a mouse, a keyboard and the Fire TV remote (up/down to move, OK/Enter to choose, Back/Esc to go back).
// The page (host.js) supplies what each item does; this module only handles views, focus and the status bar.
import { SKINS } from '/ui/character/skins.js';
import { TEAM_COLORS as TEAM, LASER_COLORS as LASERS, GEAR } from '/ui/shared/looks.js';

const $ = (id) => document.getElementById(id);

export function createMenu(actions) {
  const menu = $('menu');
  let view = 'main';
  let isOpen = true;
  let look = { name: 'TV', skin: 'carbon', outfit: 'helmet', color: TEAM[0], laserColor: TEAM[0], laserMatch: true };
  try { look = { ...look, ...JSON.parse(localStorage.getItem('la-tv-look') || '{}') }; } catch {}
  if (!GEAR.some(([id]) => id === look.outfit)) look.outfit = 'helmet'; // older saves had gear that no longer exists
  if (look.laserMatch) look.laserColor = look.color;

  function show(v) {
    view = v;
    $('lkSummary').classList.toggle('hidden', v !== 'locker');
    for (const el of menu.querySelectorAll('.menu-panel')) el.classList.toggle('hidden', el.dataset.view !== v);
    actions.onView?.(v, look);
    focusFirst();
  }
  function focusFirst() {
    const panel = menu.querySelector(`.menu-panel[data-view="${view}"]`);
    setTimeout(() => panel?.querySelector('.menu-item, .lk-skin.on, input')?.focus(), 30);
  }
  function open(v = 'main') {
    isOpen = true;
    menu.classList.remove('closed');
    document.body.classList.add('menu-open');
    show(v);
    actions.onOpenChange?.(true);
  }
  function close() {
    isOpen = false;
    menu.classList.add('closed');
    $('lkSummary').classList.add('hidden');
    document.body.classList.remove('menu-open');
    actions.onView?.('closed', look);
    actions.onOpenChange?.(false);
    document.activeElement?.blur?.();
  }

  // ---------------------------------------------------------------- locker
  function saveLook() {
    localStorage.setItem('la-tv-look', JSON.stringify(look));
    actions.onLook?.(look);
    $('lkHint').textContent = 'LOOK SAVED';
  }
  function paintLocker() {
    $('lkName').value = look.name;
    const skin = SKINS.find((k) => k.id === look.skin) || SKINS[0];
    $('lkSkins').innerHTML = SKINS.map((k) => `<button class="lk-skin${k.id === look.skin ? ' on' : ''}" data-skin="${k.id}" type="button"><i style="--a:${k.swatch[0]};--b:${k.swatch[1]}"></i>${k.name.toUpperCase()}</button>`).join('');
    $('lkGear').innerHTML = GEAR.map(([id, l]) => `<button class="lk-chip${id === look.outfit ? ' on' : ''}" data-gear="${id}" type="button">${l.toUpperCase()}</button>`).join('');
    const taken = actions.takenColors?.() || new Set();
    $('lkColor').innerHTML = TEAM.map((c) => `<button class="lk-sw${c === look.color ? ' on' : ''}${taken.has(c) ? ' taken' : ''}" data-color="${c}" style="--c:${c}" type="button" aria-label="team colour ${c}${taken.has(c) ? ' (taken)' : ''}"></button>`).join('');
    // Laser: "Match team" follows the team colour; or pick any neon shade.
    $('lkLaser').innerHTML = `<button class="lk-chip match${look.laserMatch ? ' on' : ''}" data-laser="match" type="button" style="--c:${look.color}"><i></i>MATCH TEAM</button>`
      + LASERS.map(([c, n]) => `<button class="lk-sw${!look.laserMatch && c === look.laserColor ? ' on' : ''}" data-laser="${c}" style="--c:${c}" type="button" aria-label="${n} laser" title="${n}"></button>`).join('');
    $('lkSkinName').textContent = skin.name.toUpperCase();
    $('lkLaserName').textContent = look.laserMatch ? 'MATCHES TEAM' : (LASERS.find(([c]) => c === look.laserColor)?.[1] || '').toUpperCase();
    $('lkSumName').textContent = look.name;
    $('lkSumSub').textContent = `${skin.name} · ${(GEAR.find(([id]) => id === look.outfit) || GEAR[0])[1]}`;
    $('lkSumName').style.color = look.color;
  }
  $('menuLocker').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.skin) look.skin = b.dataset.skin;
    else if (b.dataset.gear) look.outfit = b.dataset.gear;
    else if (b.dataset.color) { if (b.classList.contains('taken')) return; look.color = b.dataset.color; if (look.laserMatch) look.laserColor = look.color; }
    else if (b.dataset.laser === 'match') { look.laserMatch = true; look.laserColor = look.color; }
    else if (b.dataset.laser) { look.laserMatch = false; look.laserColor = b.dataset.laser; }
    else return;
    const focusKey = Object.entries(b.dataset)[0];
    saveLook();
    paintLocker();
    const again = $('menuLocker').querySelector(`[data-${focusKey[0]}="${focusKey[1]}"]`);
    again?.focus();
  });
  $('lkName').addEventListener('input', () => {
    look.name = ($('lkName').value || 'TV').toUpperCase().slice(0, 12);
    saveLook();
    $('lkSumName').textContent = look.name;
  });

  // ---------------------------------------------------------------- items
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('.menu-item');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') return show('main');
    if (act === 'locker') { paintLocker(); return show('locker'); }
    if (act === 'settings') { actions.paintSettings?.(); return show('settings'); }
    actions[act]?.(look);
  });

  // ---------------------------------------------------------------- keys (remote, keyboard)
  addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'F11') { e.preventDefault(); actions.fullscreen?.(); return; }
    if (e.target?.tagName === 'INPUT' && !['Escape', 'ArrowUp', 'ArrowDown', 'Enter'].includes(k)) return;
    if (k === 'm' || k === 'M') { if (e.target?.tagName !== 'INPUT') actions.setSound?.(); return; }
    if (k === 'F1') { e.preventDefault(); actions.quick?.(look); return; }
    if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack' || k === 'Backspace') {
      if (k === 'Backspace' && e.target?.tagName === 'INPUT') return;
      e.preventDefault();
      if (!isOpen) open('main');
      else if (view !== 'main') show('main');
      else if (actions.canClose?.()) close();
      return;
    }
    if (!isOpen) return;
    if (k === ' ' && view === 'main' && e.target?.tagName !== 'INPUT') { e.preventDefault(); actions.enter?.(look); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp' || ((k === 'ArrowLeft' || k === 'ArrowRight') && view === 'locker')) {
      // Move focus through the visible buttons of the current panel (TV remote D-pad).
      const panel = menu.querySelector(`.menu-panel[data-view="${view}"]`);
      const items = [...panel.querySelectorAll('button, input')].filter((x) => x.offsetParent);
      const i = items.indexOf(document.activeElement);
      const step = k === 'ArrowDown' || k === 'ArrowRight' ? 1 : -1;
      items[(i + step + items.length) % items.length]?.focus();
      e.preventDefault();
    }
  });

  return {
    open, close, show,
    get isOpen() { return isOpen; },
    get view() { return view; },
    get look() { return look; },
    paintLocker,
    /** Status bar + live labels. */
    setStatus({ fps, latency, room, players, online, active, tvPlaying }) {
      $('mSync').textContent = `SYS.SYNC: ${fps >= 50 ? 'OPTIMAL' : fps >= 30 ? 'STABLE' : 'DEGRADED'} [${fps} FPS] // LATENCY ${latency == null ? '—' : latency}MS`;
      $('mRoom').textContent = `ROOM ${room || '····'}`;
      $('mSeed').textContent = `ROOM // ${room || '····'}`;
      $('mPlayers').textContent = `${players}/8 FIGHTERS`;
      $('mOnline').textContent = online ? 'ONLINE' : 'OFFLINE';
      $('mOnline').classList.toggle('off', !online);
      $('mActive').textContent = `${active} ACTIVE`;
      $('mEnterSub').textContent = tvPlaying ? 'RESUME // YOU ARE PLAYING ON THIS TV' : 'OPEN THE LOBBY // PLAYERS SCAN TO JOIN';
    },
  };
}
