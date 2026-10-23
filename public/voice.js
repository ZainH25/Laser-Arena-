// Live voice chat between phones (WebRTC, peer to peer). The game server only relays the short setup messages
// ('rtc'); the audio itself goes straight between phones on the Wi-Fi.
//
//  • Every phone connects to every other phone in the room, so you hear the others even with your own mic off.
//  • Turning the mic on just puts your microphone track on those links (no reconnect needed).
//  • Browsers only allow the microphone on secure (https) pages; play.js moves the phone to the https copy first.

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }]; // free; only needed when phones aren't on the same network

export function createVoice({ send, myId }) {
  const peers = new Map(); // id -> { pc, sender, audio, pending: [], made: time }
  let track = null; // my microphone track while the mic is on
  let stream = null;

  function closePeer(id) {
    const p = peers.get(id);
    if (!p) return;
    try { p.pc.close(); } catch {}
    p.audio.srcObject = null;
    p.audio.remove();
    peers.delete(id);
  }

  function newPeer(id) {
    closePeer(id);
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    document.body.appendChild(audio);
    const p = { pc, sender: null, audio, pending: [], made: Date.now() };
    pc.onicecandidate = (e) => { if (e.candidate) send({ t: 'rtc', to: id, data: { candidate: e.candidate } }); };
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      audio.play().catch(() => {});
    };
    peers.set(id, p);
    return p;
  }

  /** The phone with the smaller id makes the offer, so two phones never both offer at once. */
  const iOffer = (id) => myId() < id;

  async function offer(id) {
    const p = newPeer(id);
    const tr = p.pc.addTransceiver('audio', { direction: 'sendrecv' });
    p.sender = tr.sender;
    if (track) await p.sender.replaceTrack(track);
    await p.pc.setLocalDescription(await p.pc.createOffer());
    send({ t: 'rtc', to: id, data: { sdp: p.pc.localDescription } });
  }

  async function handleRtc(from, data) {
    if (!from || from === myId()) return;
    try {
      if (data.hello) { if (iOffer(from)) await offer(from); return; } // they (re)loaded: start fresh
      if (data.sdp?.type === 'offer') {
        const p = newPeer(from);
        await p.pc.setRemoteDescription(data.sdp);
        const tr = p.pc.getTransceivers()[0];
        if (tr) { tr.direction = 'sendrecv'; p.sender = tr.sender; if (track) await p.sender.replaceTrack(track); }
        await p.pc.setLocalDescription(await p.pc.createAnswer());
        send({ t: 'rtc', to: from, data: { sdp: p.pc.localDescription } });
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
      } else if (data.sdp?.type === 'answer') {
        const p = peers.get(from);
        if (!p || p.pc.signalingState !== 'have-local-offer') return;
        await p.pc.setRemoteDescription(data.sdp);
        for (const c of p.pending.splice(0)) await p.pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate) {
        const p = peers.get(from);
        if (!p) return;
        if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate).catch(() => {});
        else p.pending.push(data.candidate);
      }
    } catch (e) {
      console.warn('voice:', e?.message || e);
    }
  }

  /** Keep one link to every other connected phone in the room. */
  function setPeers(ids) {
    const want = new Set(ids.filter((id) => id !== myId()));
    for (const id of [...peers.keys()]) if (!want.has(id)) closePeer(id);
    for (const id of want) {
      const p = peers.get(id);
      const dead = p && ['failed', 'closed'].includes(p.pc.connectionState);
      const stuck = p && p.pc.connectionState !== 'connected' && Date.now() - p.made > 8000;
      if (p && !dead && !stuck) continue;
      if (iOffer(id)) offer(id).catch(() => {});
      else if (!p || dead || stuck) {
        newPeer(id); // placeholder until their offer arrives
        send({ t: 'rtc', to: id, data: { hello: true } });
      }
    }
  }

  /** Turn the microphone on. Returns 'ok', 'insecure' (needs https), or 'denied'. */
  async function micOn() {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return 'insecure';
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch {
      return 'denied';
    }
    track = stream.getAudioTracks()[0];
    for (const p of peers.values()) await p.sender?.replaceTrack(track).catch(() => {});
    send({ t: 'voice', on: true });
    return 'ok';
  }

  function micOff() {
    for (const p of peers.values()) p.sender?.replaceTrack(null).catch(() => {});
    track?.stop();
    track = null;
    stream = null;
    send({ t: 'voice', on: false });
  }

  /** Make sure incoming voices play (call from a tap: some phones block audio until then). */
  function resumePlayback() {
    for (const p of peers.values()) p.audio.play().catch(() => {});
  }

  return { handleRtc, setPeers, micOn, micOff, resumePlayback, get micIsOn() { return !!track; } };
}
