// A WebSocket-to-UDP relay for the browser build of Armagetron Advanced.
//
// WHY THIS EXISTS. The game speaks UDP and nothing else; a browser page can
// never open a UDP socket. Every browser transport requires the far end to
// perform a handshake it understands, and a 2003 game server understands
// none of them. So the datagrams have to be carried by something outside the
// page. That is this.
//
// M-A SCOPE: local only. No TLS, no authentication, no rate limits, nothing
// meant to be reachable from the internet. Those belong to M-C.
import dgram from 'node:dgram';
import dns from 'node:dns/promises';
import { WebSocketServer } from 'ws';
import { encode, decode, TYPE } from './frame.mjs';
import { checkDestination } from './policy.mjs';

// A TESTING AID AND NOTHING ELSE, see `drop` below.
export function startRelay({
  port = 8010, allowPrivate = false, drop = 0, log = () => {},
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
  const wss = new WebSocketServer({ port, host: '127.0.0.1' });
  // wss binds asynchronously; wss.address() is null until 'listening' fires.
  const ready = new Promise((res) => wss.on('listening', res));
  const all = new Set();

  wss.on('connection', (ws) => {
    ws.binaryType = 'nodebuffer';
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
        let ip = resolved.get(f.addr);
        if (!ip) {
          try {
            ip = await lookup(f.addr);
          } catch (e) {
            return fail(f.handle, 'cannot resolve ' + f.addr);
          }
        }
        const refusal = checkDestination(ip, f.port, { allowPrivate });
        if (refusal) return fail(f.handle, refusal);
        // CACHE ONLY WHAT THE POLICY LET THROUGH. Caching before the check
        // meant a refused destination was remembered anyway, so the cache
        // filled up with names the relay will never send to and a later
        // policy change would be answered from stale state.
        resolved.set(f.addr, ip);
        const byPeer = peers.get(f.handle);
        if (byPeer) byPeer.set(ip + ':' + f.port, f.addr);
        if (lose()) return;
        sock.send(f.payload, f.port, ip);
        return;
      }
    });

    const teardown = () => {
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
    get port() { return wss.address().port; },
    socketCount() { let n = 0; for (const s of all) n += s.size; return n; },
    droppedCount() { return dropped; },
    close() {
      // Clear each connection's socket map as we close it: a WebSocket close
      // handshake finishes asynchronously, and the per-connection teardown()
      // below runs later and would otherwise try to close these same
      // sockets again, which throws ERR_SOCKET_DGRAM_NOT_RUNNING.
      for (const s of all) { for (const sock of s.values()) sock.close(); s.clear(); }
      all.clear();
      wss.close();
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
  const relay = startRelay({
    port: Number(arg('port', 8010)),
    allowPrivate: process.argv.includes('--allow-private'),
    drop,
    log: (m) => console.log('[bridge] ' + m),
  });
  relay.ready.then(() => {
    console.log('[bridge] listening on ws://127.0.0.1:' + relay.port +
                (process.argv.includes('--allow-private') ? ' (private destinations ALLOWED - local testing only)' : '') +
                (drop > 0 ? ' DISCARDING ' + (drop * 100) + '% OF DATAGRAMS - testing aid, see README' : ''));
  });
}
