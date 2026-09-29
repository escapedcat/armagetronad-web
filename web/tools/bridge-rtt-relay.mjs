// A TRACING FRONT END FOR bridge/relay.mjs. It does not replace the relay and
// it does not change it: it patches dgram.createSocket in this process before
// relay.mjs is imported, so every UDP datagram the relay sends or receives is
// timestamped into a JSONL trace, and then it starts the REAL startRelay()
// with the real options. The bytes on the wire, the destination policy and
// the framing are all bridge/relay.mjs's, untouched.
//
//   node web/tools/bridge-rtt-relay.mjs --port 8010 [--allow-private] \
//        --trace /path/to/udp-trace.jsonl
//
// WHY THIS EXISTS. Task 4 measured inter-arrival GAPS between datagrams
// delivered to the page. A gap is not a round trip: it says how often the far
// end speaks, not how long it takes to answer. For gate B6 the question is
// what a real network adds, and that needs a round trip.
//
// AND THERE IS A REAL ONE TO BE HAD, because the game already measures it.
// nWaitForAck::Ackt (src/network/nNetwork.cpp:846) computes
//     REAL thisping = netTime - ack->timeFirstSent;
// when an acknowledgement for a message id arrives. That is the number the
// score table prints as "ping". The same pairing can be recovered from
// outside the game by reading the wire, because the layout is fixed and
// simple (nSendBuffer::AddMessage, nNetwork.cpp:2223, and the reading
// constructor at nNetwork.cpp:1060):
//
//     repeated:  descriptor : uint16be
//                messageID  : uint16be
//                dataLen    : uint16be   (in SHORTS, not bytes)
//                data       : dataLen * uint16be
//     trailer:   senderID   : uint16be   (the last short of the datagram --
//                                         rec_peer reads it at bend = buff +
//                                         len/2 - 1, nNetwork.cpp:2638)
//
// and descriptor 1 is "ack" (s_Acknowledge, nNetwork.cpp:740), whose data is
// nothing but a list of acknowledged message ids -- ack_handler loops
// `while (!m.End()) { m.Read(ack); nWaitForAck::Ackt(ack, ...) }`
// (nNetwork.cpp:729-737). So: remember when message id X left, and when an ack
// naming X comes back, the difference is a round trip that the game itself
// would have counted.
//
// WHAT THIS TRACE DOES NOT SEE, stated here so no reader over-claims it: it is
// taken at the relay's UDP socket, so it measures relay -> server -> relay. It
// EXCLUDES the browser leg (the WebSocket hop and the page's main thread).
// The browser-side sampler in web/tools/bridge-gate-b6.steps measures the same
// pairing from inside the page, i.e. the whole path. The two together are the
// decomposition: page-side RTT minus relay-side RTT is what the bridge itself
// costs, and relay-side RTT is what the internet and the server cost.
//
// MESSAGE IDS ARE 16 BITS AND DO WRAP. sn_ExpandMessageID exists in the game
// for exactly that reason. This tracer keeps only the most recent send time
// per raw id and drops the entry once it is paired, so a wrap can at worst
// attribute one sample to the wrong send; over a session of a few thousand
// messages that is noise, and the analysis reports the sample count so a
// reader can judge. It is not a replacement for the game's own averager.
import dgram from 'node:dgram';
import fs from 'node:fs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const tracePath = arg('trace', '');
if (!tracePath) {
  console.error('[trace] --trace <file> is required; without it use bridge/relay.mjs directly');
  process.exit(2);
}
const trace = fs.createWriteStream(tracePath, { flags: 'a' });
const t0 = Date.now();
const now = () => Math.round(performance.now() * 1000) / 1000;

// Parse one Armagetron datagram into its messages. Returns null when the bytes
// cannot be a packet at all, which is itself worth recording.
export function parsePacket(buf) {
  if (buf.length < 2 || (buf.length & 1)) return null;
  const end = buf.length - 2;           // the trailing senderID short
  const msgs = [];
  let p = 0;
  while (p + 6 <= end) {
    const d = buf.readUInt16BE(p);
    const id = buf.readUInt16BE(p + 2);
    const dl = buf.readUInt16BE(p + 4);
    p += 6;
    if (p + dl * 2 > end) { msgs.push({ truncated: true }); return { msgs, sender: buf.readUInt16BE(end), truncated: true }; }
    const m = { d, id, dl };
    if (d === 1) {
      const acks = [];
      for (let i = 0; i < dl; i++) acks.push(buf.readUInt16BE(p + i * 2));
      m.acks = acks;
    }
    p += dl * 2;
    msgs.push(m);
  }
  return { msgs, sender: buf.readUInt16BE(end), trailing: end - p };
}

const write = (rec) => { try { trace.write(JSON.stringify(rec) + '\n'); } catch (e) { /* a trace must never break the relay */ } };

const realCreate = dgram.createSocket;
let sockN = 0;
dgram.createSocket = function (...a) {
  const sock = realCreate.apply(dgram, a);
  const sid = ++sockN;
  const realSend = sock.send.bind(sock);
  sock.send = function (payload, port, addr, ...rest) {
    const buf = Buffer.from(payload);
    write({ t: now(), sock: sid, dir: 'out', addr, port, len: buf.length, pkt: parsePacket(buf) });
    return realSend(payload, port, addr, ...rest);
  };
  sock.on('message', (msg, rinfo) => {
    write({ t: now(), sock: sid, dir: 'in', addr: rinfo.address, port: rinfo.port, len: msg.length, pkt: parsePacket(msg) });
  });
  return sock;
};

// Only NOW import the relay, so the patch above is already in place when it
// calls dgram.createSocket. A static import would be hoisted above the patch.
const { startRelay } = await import('../../bridge/relay.mjs');

const drop = Number(arg('drop', 0));
if (!(drop >= 0 && drop <= 1)) {
  console.error('[bridge] --drop takes a fraction between 0 and 1, got: ' + arg('drop', 0));
  process.exit(2);
}
const allowPrivate = process.argv.includes('--allow-private');
const relay = startRelay({
  port: Number(arg('port', 8010)),
  allowPrivate,
  drop,
  log: (m) => console.log('[bridge] ' + m),
});
relay.ready.then(() => {
  console.log('[bridge] listening on ws://127.0.0.1:' + relay.port +
              (allowPrivate ? ' (private destinations ALLOWED - local testing only)' : '') +
              (drop > 0 ? ' DISCARDING ' + (drop * 100) + '% OF DATAGRAMS - testing aid, see README' : ''));
  console.log('[trace] udp trace -> ' + tracePath + ' (wall clock t0=' + new Date(t0).toISOString() + ')');
});
