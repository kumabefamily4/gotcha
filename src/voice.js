// Peer-to-peer mesh: one RTCPeerConnection per other player carrying voice and a fast,
// unreliable data channel for positions. Signalling goes over the room transport.

let iceConfigPromise = null;
function iceServers() {
  if (!iceConfigPromise) {
    iceConfigPromise = fetch('/api/turn')
      .then((r) => (r.ok ? r.json() : { iceServers: [] }))
      .catch(() => ({ iceServers: [] }))
      .then((j) => [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, ...(j.iceServers || [])]);
  }
  return iceConfigPromise;
}

export async function getMic() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  } catch (e) {
    console.warn('microphone unavailable', e);
    return null;
  }
}

export class PeerMesh {
  constructor(net, myId, { onData, onChange } = {}) {
    this.net = net;
    this.myId = myId;
    this.mic = null;
    this.peers = new Map(); // id -> { pc, dc, audio, open, pending: [] }
    this.onData = onData || (() => {});
    this.onChange = onChange || (() => {});
    this.audioBox = document.getElementById('audio-box');
    this.muted = false;
    this.off = net.on((m) => { if (m.t === 'rtc' && m.to === myId) this._signal(m.f, m.d); });
  }

  setMic(stream) {
    this.mic = stream;
    const track = stream ? stream.getAudioTracks()[0] : null;
    if (track) track.enabled = !this.muted;
    for (const p of this.peers.values()) if (p.sender) p.sender.replaceTrack(track).catch(() => {});
  }

  setMuted(m) {
    this.muted = m;
    if (this.mic) for (const t of this.mic.getAudioTracks()) t.enabled = !m;
  }

  // Call for every other player; the lower id makes the offer so both sides never collide.
  async ensure(peerId) {
    if (peerId === this.myId || this.peers.has(peerId)) return;
    if (this.myId < peerId) await this._create(peerId, true);
  }

  async _create(peerId, offerer) {
    const pc = new RTCPeerConnection({ iceServers: await iceServers() });
    const peer = { pc, dc: null, open: false, audio: null, sender: null, pendingIce: [] };
    this.peers.set(peerId, peer);

    pc.onicecandidate = (e) => { if (e.candidate) this.net.send('rtc', { kind: 'ice', c: e.candidate.toJSON() }, peerId); };
    pc.ontrack = (e) => {
      if (!peer.audio) {
        peer.audio = document.createElement('audio');
        peer.audio.autoplay = true;
        peer.audio.setAttribute('playsinline', '');
        this.audioBox.appendChild(peer.audio);
      }
      peer.audio.srcObject = e.streams[0] || new MediaStream([e.track]);
      peer.audio.play().catch(() => { /* resumed on next tap by resumeAudio() */ });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') {
        this.close(peerId);
        if (offerer) setTimeout(() => this.ensure(peerId), 3000);
      }
      this.onChange(peerId, pc.connectionState);
    };
    const bindDc = (dc) => {
      peer.dc = dc;
      dc.onopen = () => { peer.open = true; this.onChange(peerId, 'open'); };
      dc.onclose = () => { peer.open = false; this.onChange(peerId, 'closed'); };
      dc.onmessage = (e) => { try { this.onData(peerId, JSON.parse(e.data)); } catch { /* ignore bad packet */ } };
    };

    if (offerer) {
      const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
      peer.sender = tr.sender;
      const track = this.mic ? this.mic.getAudioTracks()[0] : null;
      if (track) await tr.sender.replaceTrack(track);
      bindDc(pc.createDataChannel('state', { ordered: false, maxRetransmits: 0 }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.net.send('rtc', { kind: 'offer', sdp: pc.localDescription.toJSON() }, peerId);
    } else {
      pc.ondatachannel = (e) => bindDc(e.channel);
    }
    return peer;
  }

  async _signal(from, d) {
    try {
      let peer = this.peers.get(from);
      if (d.kind === 'offer') {
        if (peer) this.close(from);
        peer = await this._create(from, false);
        await peer.pc.setRemoteDescription(d.sdp);
        const tr = peer.pc.getTransceivers().find((t) => t.receiver.track && t.receiver.track.kind === 'audio');
        if (tr) {
          tr.direction = 'sendrecv';
          peer.sender = tr.sender;
          const track = this.mic ? this.mic.getAudioTracks()[0] : null;
          if (track) await tr.sender.replaceTrack(track);
        }
        const ans = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(ans);
        this.net.send('rtc', { kind: 'answer', sdp: peer.pc.localDescription.toJSON() }, from);
        for (const c of peer.pendingIce) await peer.pc.addIceCandidate(c).catch(() => {});
        peer.pendingIce = [];
      } else if (d.kind === 'answer' && peer) {
        await peer.pc.setRemoteDescription(d.sdp);
        for (const c of peer.pendingIce) await peer.pc.addIceCandidate(c).catch(() => {});
        peer.pendingIce = [];
      } else if (d.kind === 'ice') {
        if (!peer || !peer.pc.remoteDescription) {
          if (!peer) return;
          peer.pendingIce.push(d.c);
        } else {
          await peer.pc.addIceCandidate(d.c).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('rtc signal error', e);
    }
  }

  // Sends to every peer with an open data channel; returns how many peers were reached.
  broadcast(obj) {
    const s = JSON.stringify(obj);
    let n = 0;
    for (const p of this.peers.values()) {
      if (p.open && p.dc.readyState === 'open') { try { p.dc.send(s); n++; } catch { /* channel closing */ } }
    }
    return n;
  }

  isOpen(peerId) { const p = this.peers.get(peerId); return !!(p && p.open); }

  resumeAudio() {
    for (const p of this.peers.values()) if (p.audio && p.audio.paused) p.audio.play().catch(() => {});
  }

  close(peerId) {
    const p = this.peers.get(peerId);
    if (!p) return;
    try { p.pc.close(); } catch { /* already closed */ }
    if (p.audio) { p.audio.srcObject = null; p.audio.remove(); }
    this.peers.delete(peerId);
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.close(id);
    if (this.off) this.off();
  }
}
