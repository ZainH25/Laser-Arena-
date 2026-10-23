# Laser Arena: Cage Edition (web + phones)

A hidden-move laser showdown in a UFC-style octagon cage. The TV or browser shows the cage, and players use their phones as controllers.

## Run it
```bash
cd web
npm install
npm start
```

1. Open the printed URL (`http://<your-laptop-ip>:3000/`) on the TV or a browser. On a Fire TV, use the Silk browser.
2. Phones on the same Wi-Fi scan the QR code, or open `/play` and type the 4-letter room code.
3. The first phone to join is the captain: it can add bots and start the match. The TV's buttons work too, using the remote's D-pad and centre button.

## Rules
- **Move & aim (7 s):** run with the left stick and aim with the right stick on your phone. Your phone shows only you. The TV shows `?` where each fighter was last seen.
  - The server simulates all movement, so no phone ever receives another player's live position.
- **Reveal:** at zero everyone freezes and all lasers fire at once. Each laser stops at the first fighter it touches, so other fighters act as shields. Two fighters can hit each other, and two fighters standing on top of each other clash (both out).
- **Shrink:** from round 2 the cage edge glows red during the move phase and contracts at every reveal. Anyone left outside is out.
- The last fighter standing wins. If everyone left goes out in the same reveal, it's a draw.
- **Desktop testing:** in the phone page, WASD moves and the arrow keys aim.

## Code
| File | What it does |
|---|---|
| `src/engine.js` | Rules, state machine, ray–circle and ray–cage intersection, shrinking, bots |
| `src/server.js` | HTTP + WebSocket rooms, QR code, reconnect tokens, captain controls |
| `public/host.*`, `public/scene.js` | TV display: Three.js cage, shadows, chain-link fence, bloom lasers |
| `public/play.*` | Twin-stick phone controller |

Run the tests with `npm test`. They include 300 simulated bot matches.

## Hosting for $0
This is one Node process. You can deploy it to Render's free plan as a "Web Service" with:
- root directory: `web`
- build command: `npm install`
- start command: `npm start`
- environment variable: `PUBLIC_URL=https://<name>.onrender.com`, so the QR code points at the public URL

Phones and the TV can then be on any network.

## Scoring, sudden death, looks and voice chat

- **Points:** +5 for every fighter your laser terminates, +1 for every reveal you survive. Shown on the TV roster, on
  each phone (next to your name) and on the result screens.
- **No draws:** if a reveal leaves nobody standing, everyone eliminated in it comes back and play goes on until one
  fighter survives (after 10 wipe-outs in a row, the highest score wins).
- **Customise:** pick team colour, headgear (cap / helmet / hood / beanie) and laser colour (matches your team colour unless you pick one) when joining, or tap
  **Customise** in the phone lobby to change them; the fighter on the TV updates right away. Team colours are one per
  fighter.
- **Voice chat:** tap **Mic** on the phone. Everyone in the room hears everyone (phone to phone, WebRTC). Browsers
  only allow microphones on https pages, so the server also runs a secure copy on the next port (3001 by default)
  with a self-signed certificate it creates in `web/.cert/` using the system's `openssl`. The first Mic tap moves
  the phone there (same room, same fighter); the phone shows a one-time "not private" warning — tap
  **Advanced → Proceed**.

## TV menu, playing on the TV, skins

- The TV opens on a game menu (Esc / Back reopens it): **Enter Arena** (lobby + QR), **Quick Match** (play on the
  TV vs 3 bots, F1), **Customise Fighter** (name, suit, headgear, team + laser colour for the player on this screen,
  with a 3D preview), **Settings** (sound, graphics, FPS counter, fullscreen, leave as TV
  player) and **Terminate** (end the session, fresh room). The status bar shows real FPS, latency, room and players.
- **Playing on the TV:** keyboard (WASD/arrows move, Q/E aim), Fire TV remote (D-pad moves, OK turns the aim) or a
  gamepad (sticks). The TV player is a normal player; during the secret phase the TV shows only its own fighter.
- **Skins:** 13 suits + matching rifles (Digital/Desert/Woodland camo, Carbon/Toxic/Neon/Crimson circuit, Marble
  Gold, Magma, Galaxy, Crystal, Overgrown, Sandstone) plus the plain mannequin, drawn procedurally
  (`public/ui/character/skins.js`). Phones pick them under **Suit** when joining or in **Customise**.
- **Host:** always a connected human (never a bot). If the original host leaves, the next player hosts; when the
  original host comes back, the host role returns to them.
