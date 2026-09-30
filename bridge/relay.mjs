// A WebSocket-to-UDP relay for the browser build of Armagetron Advanced.
//
// WHY THIS EXISTS. The game speaks UDP and nothing else; a browser page can
// never open a UDP socket. Every browser transport requires the far end to
// perform a handshake it understands, and a 2003 game server understands
// none of them. So the datagrams have to be carried by something outside the
// page. That is this.
//
// WHO MAY CONNECT. Bound to loopback (the default) it trusts whoever can reach
// it, because only this machine can. Bound anywhere else it is a door into UDP
// 4533-4599 -- a reflector anyone could aim at community game servers -- so it
// REFUSES TO START unless it has at least one way to tell who is asking:
//
//   * a token, carried as the URL path (wss://relay/<token>): whoever holds the
//     link may connect, from anywhere;
//   * an Origin allowlist (M-C): a browser on one of the listed pages may
//     connect to wss://relay/ with no token at all. That is what lets the
//     published page go online for every visitor.
//
// Either way, every connection is held to limits.mjs: connections per client
// IP and in total, sockets per connection, datagrams and bytes per second, and
// new destinations per minute. TLS is not done here: a deployment terminates
// it in front (Fly's proxy does).
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { encode, decode, TYPE } from './frame.mjs';
import { checkDestination } from './policy.mjs';
import { DEFAULT_LIMITS, bucket, destinationWindow, ipCounter, originAllowed, parseOrigins } from './limits.mjs';
import { DEFAULT_RESOURCE_HOSTS, fetchResource } from './resource.mjs';

// A TESTING AID AND NOTHING ELSE, see `drop` below.
export function startRelay({
  port = 8010, allowPrivate = false, drop = 0, log = () => {},
  host = '127.0.0.1',
  // The shared secret a public relay demands, carried as the URL PATH:
  // wss://relay.example/<token>. A path rather than a query string because the
  // page reads its own ?bridge= value with URLSearchParams, and an '&' inside a
  // query-string token would silently split it. No client change is needed.
  token = null,
  // Pages whose visitors may connect WITHOUT the token, e.g.
  // ['https://escapedcat.github.io']. See originAllowed() for the ':*' form.
  origins = null,
  // Overrides for DEFAULT_LIMITS (limits.mjs), mainly so a test can make a
  // limit small enough to hit.
  limits = {},
  // The request header that carries the real client address when the relay
  // sits behind a proxy ('fly-client-ip' on Fly). Without it every client would
  // share the proxy's address and the per-IP limit would be one global limit.
  // Only ever set this behind a proxy that overwrites the header: a client
  // talking to the relay directly could otherwise claim any address it liked.
  clientIpHeader = null,
  // Hosts the /resource route may fetch from (resource.mjs). Replaces the
  // default when given; tests list their local upstream as 'host:port'.
  resourceHosts = DEFAULT_RESOURCE_HOSTS,
  // Injectable ONLY so a test can count resolutions. That count is the only
  // way to observe from outside that a destination the policy REFUSED is not
  // left behind in the cache below; the default is real DNS and the relay
  // never resolves any other way.
  lookup = (host) => dns.lookup(host, { family: 4 }).then((r) => r.address),
} = {}) {
  // THE LOSS OPTION. `drop` is the fraction of DATA frames to throw away, in
  // both directions, and it exists so a gate can ask what the game does when
  // datagrams go missing -- the question WebSocket makes interesting, because
  // WebSocket is TCP and a lost segment stalls everything queued behind it.
  //
  // It deliberately does NOT touch BIND/BOUND/CLOSE/ERROR. Those are the
  // relay's own control channel, not the network path being modelled; a
  // client that cannot bind is a broken relay rather than a lossy link, and
  // measuring that would answer a different question.
  let dropped = 0;
  const lose = () => {
    if (!(drop > 0) || Math.random() >= drop) return false;
    ++dropped;
    // Logged in batches: a live round is hundreds of datagrams a second and a
    // line each would bury the bind lines a gate reads. The count is the far
    // end's half of "loss actually happened" -- nothing inside the page can
    // see a datagram that never arrived, so without this the loss gate would
    // pass identically against a clean relay.
    if (dropped % 25 === 0) log('discarded ' + dropped + ' datagrams so far (--drop ' + drop + ')');
    return true;
  };
  const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost';
  const allowlist = Array.isArray(origins) && origins.length ? origins.slice() : null;
  if (!loopback && !token && !allowlist) {
    throw new Error('refusing to listen on ' + host + ' without a token or an origin ' +
                    'allowlist: a public relay that admits anyone is an open UDP ' +
                    'reflector into game servers');
  }
  const L = { ...DEFAULT_LIMITS, ...limits };
  const perIp = ipCounter(L.perIp);
  let limited = 0; // datagrams dropped by the per-connection rate limits
  const noteLimited = (ip) => {
    ++limited;
    // Logged in batches for the same reason as `lose` below.
    if (limited === 1 || limited % 100 === 0) log('rate limit dropped ' + limited + ' datagrams so far (latest from ' + ip + ')');
  };
  if (token !== null && String(token).length < 16) {
    throw new Error('token is too short to be a secret (need at least 16 characters)');
  }
  const expected = token === null ? null : Buffer.from('/' + token);
  // Constant-time, so response timing cannot be used to guess the token byte by byte.
  const tokenMatches = (url) => {
    if (expected === null) return false;
    const got = Buffer.from(String(url || '').split('?')[0]);
    return got.length === expected.length && crypto.timingSafeEqual(got, expected);
  };
  // null when the upgrade may proceed, otherwise the HTTP status to refuse it
  // with: 401 for a wrong token, 403 for a tokenless request from a page not on
  // the allowlist.
  const admission = (req) => {
    if (expected === null && !allowlist) return null; // loopback, no rules set
    if (tokenMatches(req.url)) return null;
    const path = String(req.url || '').split('?')[0];
    if (allowlist && (path === '/' || path === '')) {
      return originAllowed(req.headers.origin, allowlist) ? null : 403;
    }
    return 401;
  };
  const clientIp = (req) => {
    const h = clientIpHeader && req.headers[clientIpHeader.toLowerCase()];
    return (typeof h === 'string' && h.trim()) || req.socket.remoteAddress || '?';
  };
  const refuse = (socket, status, text) => {
    socket.write('HTTP/1.1 ' + status + ' ' + text + '\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    socket.destroy();
  };

  // Plain HTTP answers /health (for the platform's checks) and the /resource
  // map-download route (resource.mjs), and 404s everything else -- including a
  // plain GET on the token path, and any /resource request that is not
  // admitted, so probing cannot tell a right guess from a wrong one.
  const resourceBuckets = new Map(); // client ip -> bucket
  let resourcesInFlight = 0;
  // The same admission as an upgrade, for /resource and /<token>/resource.
  const resourceAdmitted = (req, path) => {
    if (expected === null && !allowlist) return path === '/resource';
    if (path.endsWith('/resource') && path !== '/resource' && tokenMatches(path.slice(0, -'/resource'.length))) return true;
    return path === '/resource' && !!allowlist && originAllowed(req.headers.origin, allowlist);
  };
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    const path = String(req.url || '').split('?')[0];
    if (req.method !== 'GET' || !resourceAdmitted(req, path)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ip = clientIp(req);
    // Every admitted answer carries CORS, refusals included: without it the
    // page sees a network error (status 0) instead of the reason.
    const cors = typeof req.headers.origin === 'string' ? { 'access-control-allow-origin': req.headers.origin, vary: 'Origin' } : {};
    // The URL is logged, and it arrives decoded from ?url=, so anything outside
    // printable ASCII (a newline would forge a log line) is re-escaped first.
    const printable = (u) => String(u).replace(/[^\x21-\x7e]/g, (c) => encodeURIComponent(c));
    const answer = (status, body, url) => {
      const text = typeof body === 'string';
      res.writeHead(status, { ...cors, 'content-type': text ? 'text/plain' : 'text/xml',
                              ...(status === 200 ? { 'cache-control': 'public, max-age=86400' } : {}) });
      res.end(body);
      log('resource ' + status + ' ' + (text ? 0 : body.length) + ' ' + printable(url) + ' (' + ip + ')');
    };
    // AN ASYNC HANDLER MUST NOT THROW: in Node 22 an unhandled rejection ends
    // the process, and this is the only relay. Anything unexpected is a 500.
    try {
      const url = new URL(req.url, 'http://relay').searchParams.get('url');
      if (!url) return answer(400, 'missing ?url=', '-');
      if (resourceBuckets.size > 10_000) resourceBuckets.clear(); // bounded memory; a reset only forgives
      if (!resourceBuckets.has(ip)) resourceBuckets.set(ip, bucket(L.resourcesPerMinute / 60, L.resourceBurst));
      if (!resourceBuckets.get(ip).take(1)) return answer(429, 'too many map downloads, try again in a minute', url);
      if (resourcesInFlight >= L.resourceConcurrent) return answer(503, 'the relay is busy, try again', url);
      ++resourcesInFlight;
      try {
        const r = await fetchResource(url, { hosts: resourceHosts });
        answer(r.status, r.status === 200 ? r.body : r.reason, url);
      } finally {
        --resourcesInFlight;
      }
    } catch (e) {
      log('resource handler error: ' + e.message);
      if (!res.headersSent) { res.writeHead(500, cors); res.end(); } else res.destroy();
    }
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const ip = clientIp(req);
    const status = admission(req);
    if (status === 403) {
      log('refused an upgrade from origin ' + JSON.stringify(req.headers.origin || null) + ' (' + ip + ')');
      return refuse(socket, 403, 'Forbidden');
    }
    if (status !== null) {
      log('refused an upgrade without the token from ' + ip);
      return refuse(socket, 401, 'Unauthorized');
    }
    if (wss.clients.size >= L.total) {
      log('refused an upgrade from ' + ip + ': ' + L.total + ' connections already open');
      return refuse(socket, 503, 'Service Unavailable');
    }
    if (!perIp.tryOpen(ip)) {
      log('refused an upgrade from ' + ip + ': ' + L.perIp + ' connections already open from there');
      return refuse(socket, 429, 'Too Many Requests');
    }
    wss.handleUpgrade(req, socket, head, (ws) => { ws.clientIp = ip; wss.emit('connection', ws, req); });
  });
  server.listen(port, host);
  // The server binds asynchronously; address() is null until 'listening' fires.
  const ready = new Promise((res) => server.on('listening', res));
  const all = new Set();

  wss.on('connection', (ws) => {
    ws.binaryType = 'nodebuffer';
    const ip = ws.clientIp;
    const packets = bucket(L.packetsPerSecond, L.packetBurst);
    const bytes = bucket(L.bytesPerSecond, L.byteBurst);
    const destinations = destinationWindow(L.destinationsPerMinute);
    const sockets = new Map(); // handle -> dgram socket
    all.add(sockets);
    const resolved = new Map(); // host text -> ip. A DNS CACHE AND NOTHING ELSE.
    // handle -> Map<"ip:port", the address text the client actually sent to>.
    //
    // WHY NOT A REVERSE SCAN OF `resolved`. This used to find the echo name by
    // walking `resolved` for the first host whose IP matched rinfo.address,
    // which is only correct while no two host names share an address. Two
    // names on one IP -- an alias, a shared host, several servers behind one
    // NAT -- would echo the WRONG token, and the client matches replies to
    // peers BY THAT TEXT (see eWebNet::Recv), so the datagram would be
    // attributed to the wrong server. Latent in M-A, which talks to one
    // server at a time; live the moment M-B pings twenty from one page. It is
    // the same defect class as the client-side critical already fixed in this
    // milestone, so it is keyed the same way: to the destination the datagram
    // was actually sent to, not to a guess made backwards from the reply.
    const peers = new Map();

    const send = (frame) => { if (ws.readyState === ws.OPEN) ws.send(encode(frame)); };
    const fail = (handle, reason) => send({ type: TYPE.ERROR, handle, port: 0, addr: '', payload: Buffer.from(reason, 'ascii') });

    ws.on('message', async (raw) => {
      let f;
      try {
        f = decode(Buffer.from(raw));
      } catch (e) {
        log('dropped a bad frame: ' + e.message);
        return;
      }

      if (f.type === TYPE.BIND) {
        if (sockets.has(f.handle)) return fail(f.handle, 'handle ' + f.handle + ' is already bound');
        if (peers.size >= L.socketsPerConnection) {
          return fail(f.handle, 'too many sockets on one connection (limit ' + L.socketsPerConnection + ')');
        }
        const sock = dgram.createSocket('udp4');
        peers.set(f.handle, new Map());
        sock.on('message', (msg, rinfo) => {
          // Echo back the text the client used for this peer, not rinfo.address:
          // the client cannot resolve names and matches replies by that text.
          // Keyed by ip:port, i.e. by the destination we sent to, so two names
          // on one IP cannot be confused with each other.
          const byPeer = peers.get(f.handle);
          const addr = (byPeer && byPeer.get(rinfo.address + ':' + rinfo.port)) || rinfo.address;
          if (lose()) return;
          send({ type: TYPE.DATA, handle: f.handle, port: rinfo.port, addr, payload: msg });
        });
        sock.on('error', (e) => { log('udp error on handle ' + f.handle + ': ' + e.message); });
        sock.bind(0, () => {
          sockets.set(f.handle, sock);
          log('handle ' + f.handle + ' bound to udp port ' + sock.address().port);
          send({ type: TYPE.BOUND, handle: f.handle, port: sock.address().port, addr: '' });
        });
        return;
      }

      if (f.type === TYPE.CLOSE) {
        const sock = sockets.get(f.handle);
        if (sock) { sock.close(); sockets.delete(f.handle); }
        peers.delete(f.handle);
        return;
      }

      if (f.type === TYPE.DATA) {
        const sock = sockets.get(f.handle);
        if (!sock) return fail(f.handle, 'handle ' + f.handle + ' is not bound');
        // The rate limits come before everything else, name resolution
        // included, so a flood costs the relay as little as possible.
        if (!packets.take(1) || !bytes.take(f.payload.length)) return noteLimited(ip);
        if (!destinations.allow(f.addr + ':' + f.port)) {
          return fail(f.handle, 'too many new destinations this minute (limit ' + L.destinationsPerMinute + ')');
        }
        let dst = resolved.get(f.addr);
        if (!dst) {
          try {
            dst = await lookup(f.addr);
          } catch (e) {
            return fail(f.handle, 'cannot resolve ' + f.addr);
          }
        }
        const refusal = checkDestination(dst, f.port, { allowPrivate });
        if (refusal) return fail(f.handle, refusal);
        // CACHE ONLY WHAT THE POLICY LET THROUGH. Caching before the check
        // meant a refused destination was remembered anyway, so the cache
        // filled up with names the relay will never send to and a later
        // policy change would be answered from stale state.
        resolved.set(f.addr, dst);
        const byPeer = peers.get(f.handle);
        if (byPeer) byPeer.set(dst + ':' + f.port, f.addr);
        if (lose()) return;
        sock.send(f.payload, f.port, dst);
        return;
      }
    });

    let tornDown = false;
    const teardown = () => {
      // 'error' is followed by 'close', so this runs twice; the IP slot must
      // be given back exactly once.
      if (tornDown) return;
      tornDown = true;
      perIp.close(ip);
      for (const sock of sockets.values()) sock.close();
      sockets.clear();
      peers.clear();
      all.delete(sockets);
    };
    ws.on('close', teardown);
    ws.on('error', teardown);
  });

  return {
    ready,
    get port() { return server.address().port; },
    socketCount() { let n = 0; for (const s of all) n += s.size; return n; },
    droppedCount() { return dropped; },
    limitedCount() { return limited; },
    close() {
      // Clear each connection's socket map as we close it: a WebSocket close
      // handshake finishes asynchronously, and the per-connection teardown()
      // below runs later and would otherwise try to close these same
      // sockets again, which throws ERR_SOCKET_DGRAM_NOT_RUNNING.
      for (const s of all) { for (const sock of s.values()) sock.close(); s.clear(); }
      all.clear();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close();
    },
  };
}

// CLI: node relay.mjs --port 8010 [--allow-private] [--drop <fraction>]
if (import.meta.url === 'file://' + process.argv[1]) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf('--' + name);
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
  };
  const drop = Number(arg('drop', 0));
  if (!(drop >= 0 && drop <= 1)) {
    console.error('[bridge] --drop takes a fraction between 0 and 1, got: ' + arg('drop', 0));
    process.exit(2);
  }
  // Environment variables win over flags, because a platform like Fly injects
  // configuration that way; the token in particular must never be a flag,
  // where it would show up in `ps` and in the platform's process listings.
  const host = process.env.BRIDGE_HOST || arg('host', '127.0.0.1');
  let relay;
  try {
    relay = startRelay({
      port: Number(process.env.PORT || arg('port', 8010)),
      host,
      token: process.env.BRIDGE_TOKEN || null,
      origins: parseOrigins(process.env.BRIDGE_ORIGINS),
      clientIpHeader: process.env.BRIDGE_CLIENT_IP_HEADER || null,
      // parseOrigins is a plain comma splitter; reusing it for hosts is deliberate.
      resourceHosts: parseOrigins(process.env.BRIDGE_RESOURCE_HOSTS).length
        ? parseOrigins(process.env.BRIDGE_RESOURCE_HOSTS) : undefined,
      allowPrivate: process.argv.includes('--allow-private'),
      drop,
      log: (m) => console.log('[bridge] ' + m),
    });
  } catch (e) {
    console.error('[bridge] ' + e.message);
    process.exit(2);
  }
  relay.ready.then(() => {
    console.log('[bridge] listening on ws://' + host + ':' + relay.port +
                (process.env.BRIDGE_TOKEN ? ' (token accepted)' : ' (no token)') +
                (parseOrigins(process.env.BRIDGE_ORIGINS).length ? ' (open to pages from ' + parseOrigins(process.env.BRIDGE_ORIGINS).join(', ') + ')' : '') +
                (process.env.BRIDGE_CLIENT_IP_HEADER ? ' (client IP from ' + process.env.BRIDGE_CLIENT_IP_HEADER + ')' : '') +
                (process.env.BRIDGE_RESOURCE_HOSTS ? ' (map downloads from ' + process.env.BRIDGE_RESOURCE_HOSTS + ')' : '') +
                (process.argv.includes('--allow-private') ? ' (private destinations ALLOWED - local testing only)' : '') +
                (drop > 0 ? ' DISCARDING ' + (drop * 100) + '% OF DATAGRAMS - testing aid, see README' : ''));
  });
}
