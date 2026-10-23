// Laser Arena: Cage Edition server. Serves the TV/browser display (/) and the phone controller (/play),
// and runs every room's Game so hidden positions never leave the server until the reveal.
//
// Messages to clients
//   state  {state, me}      full public state — sent only when something structural changes (phase, roster, looks)
//   pos    {p:[[id,x,y,a]]} lobby positions, 20 Hz while anyone is moving (cheap, so the lobby stays smooth)
//   you    {x,y,angle,...}  a phone's OWN live position during the action phase (never anyone else's)
//   clock  {msLeft}         timer sync, 5 Hz
//   joined / kicked / error / room
//   voice  {ids}            players whose mic is on (phones connect voice to each other; TV shows a mic icon)
//   rtc    {from, data}     WebRTC voice signalling relayed between two phones in the same room
import http from 'node:http';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { WebSocketServer } from 'ws';
import { Game } from './engine.js';

const PORT = Number(process.env.PORT) || 3000;
// Secure copy of the game (needed for the phone microphone: browsers only allow mics on https pages).
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || PORT + 1;
const PUBLIC_URL = process.env.PUBLIC_URL || '';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'public');
const THREE_ROOT = path.join(HERE, '..', 'node_modules', 'three');
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.mp3': 'audio/mpeg' };
const TICK_MS = 50;

// If the game's server code changes while this process runs, the running server is out of date (Node loaded the
// old code at start-up). Warn in the terminal and on every TV so nobody chases "it doesn't work" ghosts.
let staleCode = false;
try {
  fs.watch(HERE, (_, name) => {
    if (staleCode || !String(name).endsWith('.js')) return;
    staleCode = true;
    console.warn('\n  ⚠  Server code changed — stop this server (Ctrl+C) and run "npm start" again to use it.\n');
    for (const room of rooms.values()) for (const ws of room.displays) send(ws, { t: 'stale' });
  });
} catch {}

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) return a.address;
  }
  return 'localhost';
}

/**
 * room = { code, game, displays:Set<ws>, phones:Map<playerId,{ws, token}>, hostId, emptySince, timer }
 * The host is always a connected human phone. The TV never hosts.
 */
const rooms = new Map();

function newRoom() {
  let code;
  do code = Array.from({ length: 4 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
  while (rooms.has(code));
  const room = { code, game: new Game(), displays: new Set(), phones: new Map(), hostId: null, emptySince: 0, voice: new Set() };
  let n = 0;
  room.timer = setInterval(() => {
    const g = room.game;
    const r = g.tick();
    n++;
    if (r === 'phase') {
      broadcast(room);
    } else if (g.phase === 'lobby') {
      if (r === 'move') broadcastPositions(room);
      if (n % 20 === 0) {
        // Once a second: forget phones that left the lobby and never came back.
        const gone = g.sweepDisconnected();
        if (gone.length) {
          for (const id of gone) room.phones.delete(id);
          broadcast(room);
        }
      }
    } else if (g.phase === 'action') {
      echoPrivate(room);
      if (n % 4 === 0) broadcastClock(room);
    }
  }, TICK_MS);
  rooms.set(code, room);
  return room;
}

// Close rooms nobody has been connected to for 10 minutes.
setInterval(() => {
  for (const room of rooms.values()) {
    const empty = room.displays.size === 0 && [...room.phones.values()].every((p) => !p.ws);
    if (!empty) room.emptySince = 0;
    else if (!room.emptySince) room.emptySince = Date.now();
    else if (Date.now() - room.emptySince > 10 * 60_000) { clearInterval(room.timer); rooms.delete(room.code); }
  }
}, 60_000);

const send = (ws, msg) => {
  if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
};

/** Keeps the current host while they're connected; otherwise hands it to the longest-joined connected human. */
/**
 * Host = a connected human, never a bot. The room remembers its original host (ownerId): while they're away the
 * next connected human hosts, and when they come back the host role returns to them.
 */
function resolveHost(room) {
  const canHost = (id) => {
    const p = id && room.game.get(id);
    return !!p && !p.bot && p.connected && !!room.phones.get(id)?.ws;
  };
  if (canHost(room.ownerId)) return (room.hostId = room.ownerId);
  if (canHost(room.hostId)) return room.hostId;
  room.hostId = null;
  for (const id of room.phones.keys()) if (canHost(id)) { room.hostId = id; break; }
  if (!room.ownerId || !room.game.get(room.ownerId)) room.ownerId = room.hostId; // first human in owns the room
  return room.hostId;
}

function publicState(room) {
  const pub = room.game.publicState();
  resolveHost(room);
  const host = room.hostId ? room.game.get(room.hostId) : null;
  pub.hostId = room.hostId;
  pub.hostName = host ? host.name : null;
  return pub;
}

function broadcast(room) {
  const pub = publicState(room);
  const tvMsg = JSON.stringify({ t: 'state', state: pub });
  for (const ws of room.displays) send(ws, tvMsg);
  for (const [id, phone] of room.phones) {
    // Each phone additionally gets ONLY its own live position.
    send(phone.ws, { t: 'state', state: pub, me: room.game.privateView(id) });
  }
}

/** Tell everyone whose mic is on (TV shows icons; phones open voice links). */
function broadcastVoice(room) {
  const ids = [...room.voice].filter((id) => room.phones.get(id)?.ws);
  const msg = JSON.stringify({ t: 'voice', ids });
  for (const ws of room.displays) send(ws, msg);
  for (const phone of room.phones.values()) send(phone.ws, msg);
}

function broadcastPositions(room) {
  const p = room.game.players.map((q) => [q.id, +q.x.toFixed(3), +q.y.toFixed(3), Math.round(q.angle)]);
  const msg = JSON.stringify({ t: 'pos', p });
  for (const ws of room.displays) send(ws, msg);
  for (const phone of room.phones.values()) send(phone.ws, msg);
}

function echoPrivate(room) {
  const msLeft = Math.max(0, room.game.phaseEndsAt - Date.now());
  for (const [id, phone] of room.phones) {
    const v = room.game.privateView(id);
    if (v && v.alive) send(phone.ws, { t: 'you', ...v, msLeft });
  }
}

function broadcastClock(room) {
  const msg = JSON.stringify({ t: 'clock', msLeft: Math.max(0, room.game.phaseEndsAt - Date.now()) });
  for (const ws of room.displays) send(ws, msg);
  for (const phone of room.phones.values()) send(phone.ws, msg);
}

async function joinInfo(room, host) {
  const base = PUBLIC_URL || `http://${host.startsWith('localhost') || host.startsWith('127.') ? `${lanAddress()}:${PORT}` : host}`;
  const url = `${base}/play?room=${room.code}`;
  const qr = await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#0b0f14', light: '#ffffff' } });
  return { url, qr };
}

function serveFile(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') { res.end('ok'); return; }
  let file = url.pathname === '/' ? '/host.html' : url.pathname === '/play' ? '/play.html' : url.pathname;
  // Three.js is served from node_modules so the game works with no internet.
  const base = file.startsWith('/vendor/three/') ? THREE_ROOT : ROOT;
  if (base === THREE_ROOT) file = file.slice('/vendor/three'.length);
  file = path.normalize(path.join(base, file));
  if (!file.startsWith(base)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    // Game files: never cached (you edit them while testing). Three.js: cache, it never changes.
    const cache = base === THREE_ROOT ? 'public, max-age=86400' : 'no-store, max-age=0';
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
}

const server = http.createServer(serveFile);

/**
 * Self-signed certificate for the https copy, made once with the system's openssl and kept in web/.cert (remade if
 * the laptop's Wi-Fi address changes). Phones show a one-time "not private" warning for it: tap Advanced → Proceed.
 */
function loadCert() {
  const dir = path.join(HERE, '..', '.cert');
  const ip = lanAddress();
  const key = path.join(dir, 'key.pem');
  const cert = path.join(dir, 'cert.pem');
  const ipFile = path.join(dir, 'ip.txt');
  try {
    if (!fs.existsSync(cert) || fs.readFileSync(ipFile, 'utf8') !== ip) {
      fs.mkdirSync(dir, { recursive: true });
      execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '825',
        '-subj', '/CN=Laser Arena', '-addext', `subjectAltName=IP:${ip},IP:127.0.0.1,DNS:localhost`], { stdio: 'ignore' });
      fs.writeFileSync(ipFile, ip);
    }
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  } catch {
    return null; // no openssl: the game still works, only the phone mic is unavailable on the local network
  }
}
const tls = PUBLIC_URL ? null : loadCert(); // hosted (PUBLIC_URL) deployments are already https
const secureServer = tls ? https.createServer(tls, serveFile) : null;

// Voice signalling is a few KB per message (SDP offers), so allow bigger frames than the game needs.
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 65536, perMessageDeflate: false });
const wssSecure = secureServer ? new WebSocketServer({ server: secureServer, path: '/ws', maxPayload: 65536, perMessageDeflate: false }) : null;

wss.on('connection', onConnection);
wssSecure?.on('connection', onConnection);

function onConnection(ws, req) {
  ws._socket?.setNoDelay?.(true); // small realtime packets: don't let Nagle batch them
  let room = null;
  let playerId = null;
  let isDisplay = false;

  const isHost = () => !!room && !!playerId && resolveHost(room) === playerId;

  ws.on('message', async (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    try {
      switch (m.t) {
        case 'display': { // TV / browser screen: create or re-open a room
          room = (m.room && rooms.get(String(m.room).toUpperCase())) || newRoom();
          isDisplay = true;
          room.displays.add(ws);
          send(ws, { t: 'room', code: room.code, ...(await joinInfo(room, req.headers.host || 'localhost')) });
          send(ws, { t: 'state', state: publicState(room) });
          if (staleCode) send(ws, { t: 'stale' });
          break;
        }

        case 'join': { // phone: new player, or rejoin with a saved token
          const code = String(m.room || '').toUpperCase();
          room = rooms.get(code);
          if (!room) { send(ws, { t: 'error', msg: `Room ${code} not found — check the code on the TV`, quiet: !!m.auto }); return; }
          const existing = m.token && [...room.phones].find(([, ph]) => ph.token === m.token);
          if (existing) {
            playerId = existing[0];
            const old = existing[1].ws;
            existing[1].ws = ws;
            if (old && old !== ws) try { old.close(); } catch {}
            room.game.reconnect(playerId);
          } else if (m.auto) {
            send(ws, { t: 'error', msg: 'expired', quiet: true }); // stale token: show the join screen, no stray fighter
            return;
          } else {
            playerId = crypto.randomUUID();
            const r = room.game.addPlayer(playerId, m.name, { color: m.color, laserColor: m.laserColor, outfit: m.outfit, skin: m.skin });
            if (r.error) { send(ws, { t: 'error', msg: r.error }); playerId = null; return; }
            room.phones.set(playerId, { ws, token: crypto.randomBytes(16).toString('hex') });
          }
          resolveHost(room);
          send(ws, { t: 'joined', id: playerId, token: room.phones.get(playerId).token, room: room.code, httpsPort: secureServer ? HTTPS_PORT : null });
          broadcast(room);
          broadcastVoice(room);
          break;
        }

        case 'leaveMatch': { // a player walks out of the running match (forfeit) and watches the rest
          if (!room || !playerId) return;
          const r = room.game.forfeit(playerId);
          if (r.error) send(ws, { t: 'error', msg: r.error });
          broadcast(room);
          break;
        }

        case 'endMatch': { // host's phone or the TV: stop the match, everyone back to the lobby (same room)
          if (!room) return;
          if (!isDisplay && !isHost()) { send(ws, { t: 'error', msg: 'Only the host can end the match' }); return; }
          if (room.game.phase === 'lobby') return;
          room.game.backToLobby();
          const who = isDisplay ? 'The TV' : room.game.get(playerId)?.name || 'The host';
          const notice = JSON.stringify({ t: 'notice', msg: `${who} ended the match — back to the lobby`, ms: 3000 });
          for (const d of room.displays) send(d, notice);
          for (const phone of room.phones.values()) send(phone.ws, notice);
          broadcast(room);
          break;
        }

        case 'ping': // latency readout on the TV menu
          send(ws, { t: 'pong', at: m.at });
          break;

        case 'voice': { // phone turned its mic on / off
          if (!room || !playerId) return;
          if (m.on) room.voice.add(playerId); else room.voice.delete(playerId);
          broadcastVoice(room);
          break;
        }

        case 'rtc': { // WebRTC signalling (offer / answer / ICE) to one other phone in this room
          if (!room || !playerId) return;
          const to = room.phones.get(String(m.to || ''));
          if (to?.ws) send(to.ws, { t: 'rtc', from: playerId, data: m.data });
          break;
        }

        case 'input': { // live sticks (~20–30 Hz). Applied on the next tick; never triggers a broadcast itself.
          if (room && playerId) room.game.input(playerId, m);
          break;
        }

        case 'customize': {
          if (!room || !playerId) return;
          const r = room.game.customize(playerId, m);
          if (r.error) send(ws, { t: 'error', msg: r.error });
          else broadcast(room);
          break;
        }

        case 'newRoom': { // TV: abandon this room and show a fresh code (everyone re-joins by scanning)
          if (!isDisplay || !room) return;
          const old = room;
          for (const phone of old.phones.values()) {
            send(phone.ws, { t: 'kicked', msg: 'The TV opened a new room — scan the new code to join' });
            try { phone.ws?.close(); } catch {}
          }
          closeRoom(old);
          room = newRoom();
          room.displays.add(ws);
          send(ws, { t: 'room', code: room.code, ...(await joinInfo(room, req.headers.host || 'localhost')) });
          send(ws, { t: 'state', state: publicState(room) });
          break;
        }

        case 'start':
        case 'addBot':
        case 'rematch':
        case 'lobby':
        case 'kick': {
          if (!room) return;
          // The TV is a trusted shared screen: it can start the match and add bots from its lobby panel, and end a
          // finished match (rematch / back to lobby) so the game never gets stuck if the host's phone closed the
          // page. Removing players stays with the host's phone.
          const tvAllowed = isDisplay && ['lobby', 'rematch', 'start', 'addBot'].includes(m.t);
          if (!isHost() && !tvAllowed) {
            send(ws, { t: 'error', msg: 'Only the host can do that' });
            return;
          }
          const g = room.game;
          let r = {};
          if (m.t === 'start') r = g.phase === 'lobby' ? g.start() : { error: 'Match already running' };
          if (m.t === 'addBot') r = g.phase === 'lobby' ? g.addBot() : { error: 'Add bots in the lobby' };
          if (m.t === 'rematch') {
            if (g.phase !== 'over') r = { error: 'Rematch is available after a match' };
            else {
              r = g.rematch();
              if (r.missing) { lobbyAfterNotice(room, r.missing); r = {}; }
            }
          }
          if (m.t === 'lobby' && isDisplay) clearRoom(room, 'The TV ended the game — scan the code to join again');
          else if (m.t === 'lobby') r = g.backToLobby();
          if (m.t === 'kick') r = kick(room, String(m.id || ''));
          if (r?.error) send(ws, { t: 'error', msg: r.error });
          if (r?.notice) send(ws, { t: 'error', msg: r.notice });
          broadcast(room);
          break;
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  ws.on('close', () => {
    if (!room) return;
    if (isDisplay) room.displays.delete(ws);
    if (playerId) {
      const phone = room.phones.get(playerId);
      if (phone && phone.ws === ws) {
        phone.ws = null;
        room.game.disconnect(playerId); // keeps the slot; rejoining with the token restores it
        broadcast(room);
        if (room.voice.delete(playerId)) broadcastVoice(room);
      }
    }
  });
}

/** TV "back to lobby": everyone (players and bots) leaves; the room and its code stay so people can re-scan. */
function clearRoom(room, msg) {
  clearTimeout(room.lobbyTimer);
  room.lobbyTimer = null;
  for (const phone of room.phones.values()) {
    send(phone.ws, { t: 'kicked', msg });
    try { phone.ws?.close(); } catch {}
  }
  room.phones.clear();
  room.hostId = null;
  room.ownerId = null;
  room.game.players = [];
  room.game.backToLobby();
}

function closeRoom(room) {
  clearInterval(room.timer);
  clearTimeout(room.lobbyTimer);
  rooms.delete(room.code);
}

/** Tell everyone who is missing, then (after a beat to read it) send the whole room back to the lobby. */
function lobbyAfterNotice(room, missing) {
  if (room.lobbyTimer) return;
  const names = missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0];
  const msg = missing.length
    ? `Can't rematch — ${names} ${missing.length > 1 ? 'have' : 'has'} left. Back to the lobby…`
    : 'Nobody left to play — back to the lobby…';
  const notice = JSON.stringify({ t: 'notice', msg, ms: 3200 });
  for (const ws of room.displays) send(ws, notice);
  for (const phone of room.phones.values()) send(phone.ws, notice);
  room.lobbyTimer = setTimeout(() => {
    room.lobbyTimer = null;
    const g = room.game;
    if (g.phase !== 'over') return;
    // The missing players are gone for good: free their slots.
    for (const p of [...g.players]) {
      if (!p.bot && !p.connected) { g.players = g.players.filter((q) => q !== p); room.phones.delete(p.id); }
    }
    g.backToLobby();
    broadcast(room);
  }, 3200);
}

/** Host removes a bot or another player. A kicked phone is told why and can't silently rejoin. */
function kick(room, id) {
  const g = room.game;
  const p = g.get(id);
  if (!p) return { error: 'That fighter already left' };
  if (id === room.hostId) return { error: "You can't remove yourself — the host stays" };
  if (id === room.ownerId) return { error: "That's the room's original host — they get the host role back" };
  if (g.phase !== 'lobby' && !p.bot) return { error: 'Remove players from the lobby' };
  if (g.phase !== 'lobby' && p.bot) return { error: 'Remove bots from the lobby' };
  g.removePlayer(id);
  const phone = room.phones.get(id);
  if (phone) {
    send(phone.ws, { t: 'kicked', msg: 'The host removed you from the lobby' });
    try { phone.ws?.close(); } catch {}
    room.phones.delete(id);
  }
  return {};
}

server.listen(PORT, () => {
  const lan = lanAddress();
  console.log(`\n  LASER ARENA · CAGE EDITION`);
  console.log(`  TV / browser display:  http://${lan}:${PORT}/   (or http://localhost:${PORT}/)`);
  console.log(`  Phones join by scanning the QR code on that screen (same Wi-Fi).`);
  if (secureServer) console.log(`  Phone mic (voice chat) uses the secure copy on https://${lan}:${HTTPS_PORT}/ — players get there by tapping Mic.`);
  console.log('');
});
secureServer?.listen(HTTPS_PORT);
secureServer?.on('error', (e) => console.warn(`  (Voice chat unavailable: https port ${HTTPS_PORT} — ${e.code || e.message})`));
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use — another copy of the game is probably running.`);
    console.error(`  Stop it (Ctrl+C in its terminal), or run on another port:  PORT=3001 npm start\n`);
    process.exit(1);
  }
  throw e;
});
