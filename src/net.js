// Room messaging. Two transports with the same interface:
//  - Ably (production): one channel per game room, token auth through /api/ably-token.
//  - Local (testing): BroadcastChannel between tabs of the same browser.
// Envelope: { t: type, f: fromId, to?: targetId, d: data }

export async function connectRoom(room, myId) {
  const params = new URLSearchParams(location.search);
  const forceLocal = params.get('net') === 'local';
  if (!forceLocal) {
    try {
      return await ablyTransport(room, myId);
    } catch (err) {
      console.warn('Ably unavailable, falling back to local tabs only', err);
      const t = localTransport(room, myId);
      t.warning = 'Online play is not configured on this server; only tabs in this browser can see each other.';
      return t;
    }
  }
  return localTransport(room, myId);
}

function makeHub(myId) {
  const handlers = new Set();
  return {
    handlers,
    deliver(msg) {
      if (!msg || msg.f === myId) return;
      if (msg.to && msg.to !== myId) return;
      for (const h of handlers) { try { h(msg); } catch (e) { console.error(e); } }
    },
  };
}

function localTransport(room, myId) {
  const bc = new BroadcastChannel('gotcha-' + room);
  const hub = makeHub(myId);
  bc.onmessage = (e) => hub.deliver(e.data);
  return {
    kind: 'local',
    send(t, d, to) { bc.postMessage({ t, f: myId, to, d }); },
    on(h) { hub.handlers.add(h); return () => hub.handlers.delete(h); },
    close() { bc.close(); },
  };
}

let ablyLoaded = null;
function loadAbly() {
  if (window.Ably) return Promise.resolve();
  if (!ablyLoaded) {
    ablyLoaded = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL('../vendor/ably.min.js', import.meta.url).href;
      s.onload = res;
      s.onerror = () => rej(new Error('ably script failed to load'));
      document.head.appendChild(s);
    });
  }
  return ablyLoaded;
}

async function ablyTransport(room, myId) {
  // Fail fast if the token endpoint is missing or the key isn't configured.
  const probe = await fetch(`/api/ably-token?clientId=${encodeURIComponent(myId)}`);
  if (!probe.ok) throw new Error('token endpoint ' + probe.status);
  await loadAbly();
  const client = new window.Ably.Realtime({
    authUrl: '/api/ably-token',
    authParams: { clientId: myId },
    clientId: myId,
    echoMessages: false,
    closeOnUnload: true,
  });
  await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('ably connect timeout')), 10000);
    client.connection.once('connected', () => { clearTimeout(timer); res(); });
    client.connection.once('failed', (s) => { clearTimeout(timer); rej(s.reason || new Error('ably failed')); });
  });
  const channel = client.channels.get('gotcha:' + room);
  const hub = makeHub(myId);
  await channel.subscribe('m', (m) => hub.deliver(m.data));
  return {
    kind: 'ably',
    send(t, d, to) { channel.publish('m', { t, f: myId, to, d }).catch((e) => console.warn('publish failed', e)); },
    on(h) { hub.handlers.add(h); return () => hub.handlers.delete(h); },
    close() { try { channel.detach(); client.close(); } catch { /* already closed */ } },
  };
}
