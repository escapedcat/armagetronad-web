// M-C: the rules that let the relay run WITHOUT a token.
//
// With a token, only people handed the link can use the relay. Without one,
// anybody can, and the relay is a machine on the internet that sends UDP
// wherever it is told. The destination policy (policy.mjs) already confines
// that to game ports on public addresses. What it does not bound is HOW MUCH:
// a single client could flood one server, sweep every address for game
// servers, or hold open enough connections to starve everyone else. These are
// the bounds, each generous for a real player and small for abuse.
//
// Pure data structures with an injectable clock, so every limit is tested by
// moving time rather than by sleeping.

export const DEFAULT_LIMITS = Object.freeze({
  // Connections at once from one client IP. A player with a few tabs is fine.
  perIp: 4,
  // Connections at once in total, so one small machine cannot be exhausted.
  total: 200,
  // UDP sockets one connection may hold. The client binds one or two.
  socketsPerConnection: 8,
  // Datagrams per second one connection may SEND into the world, with a burst
  // allowance on top. A running game sends a few dozen a second; the server
  // browser's refresh pings every listed server (~140) at once, which is what
  // the burst is sized for. Beyond it, datagrams are dropped silently: UDP
  // loses packets anyway and the game is built to live with that.
  packetsPerSecond: 200,
  packetBurst: 600,
  // The same for bytes. Game datagrams are small; this is the flood bound.
  bytesPerSecond: 100_000,
  byteBurst: 300_000,
  // Different destinations (address text + port) one connection may start
  // talking to per minute. The server browser needs ~140; a sweep needs
  // thousands. Counted BEFORE name resolution, so it also bounds DNS lookups.
  destinationsPerMinute: 300,
  // Map downloads (resource.mjs) one client IP may ask for. Joining a server
  // costs at most one or two; a burst of 10 covers hopping between servers.
  resourcesPerMinute: 30,
  resourceBurst: 10,
  // Upstream fetches in flight at once, across all clients, so a crowd cannot
  // turn the relay into a download mirror.
  resourceConcurrent: 8,
});

// A token bucket: `rate` tokens a second, holding at most `burst`.
export function bucket(rate, burst, now = Date.now) {
  let tokens = burst;
  let last = now();
  return {
    take(n = 1) {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) / 1000) * rate);
      last = t;
      if (tokens < n) return false;
      tokens -= n;
      return true;
    },
  };
}

// Destinations first seen within a sliding minute. A destination already in
// the window is always allowed; a NEW one is allowed only below the cap.
export function destinationWindow(cap, now = Date.now, spanMs = 60_000) {
  const seen = new Map(); // key -> last time it was used
  return {
    allow(key) {
      const t = now();
      for (const [k, at] of seen) if (t - at >= spanMs) seen.delete(k);
      if (seen.has(key)) { seen.set(key, t); return true; }
      if (seen.size >= cap) return false;
      seen.set(key, t);
      return true;
    },
    get size() { return seen.size; },
  };
}

// Counts open connections per client IP.
export function ipCounter(cap) {
  const open = new Map();
  return {
    tryOpen(ip) {
      const n = open.get(ip) || 0;
      if (n >= cap) return false;
      open.set(ip, n + 1);
      return true;
    },
    close(ip) {
      const n = (open.get(ip) || 0) - 1;
      if (n > 0) open.set(ip, n); else open.delete(ip);
    },
    count(ip) { return open.get(ip) || 0; },
  };
}

// The Origin allowlist. Entries are exact origins ("https://example.org"), or
// end in ":*" to allow any port on that scheme and host
// ("http://localhost:*"). A missing Origin header is refused: every browser
// sends one on a WebSocket upgrade, so only a non-browser client omits it --
// and a non-browser client can claim any origin it likes, which is why the
// allowlist keeps OTHER WEBSITES off the relay and the limits above are what
// keep everyone else in bounds.
export function originAllowed(origin, allowlist) {
  if (typeof origin !== 'string' || origin === '') return false;
  for (const entry of allowlist) {
    if (entry === origin) return true;
    if (entry.endsWith(':*')) {
      const base = entry.slice(0, -2);
      if (origin === base) return true;
      if (origin.startsWith(base + ':') && /^\d+$/.test(origin.slice(base.length + 1))) return true;
    }
  }
  return false;
}

export function parseOrigins(text) {
  return String(text || '').split(',').map((s) => s.trim()).filter(Boolean);
}
