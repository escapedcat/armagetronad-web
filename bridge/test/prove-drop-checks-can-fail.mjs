// Proves the two new relay checks are not vacuous, by running each one's
// assertion against the setting it is meant to catch and showing it fail.
import dgram from 'node:dgram';
import { WebSocket } from 'ws';
import { encode, decode, TYPE } from '../frame.mjs';
import { startRelay } from '../relay.mjs';
const echo = async (port) => { const s = dgram.createSocket('udp4'); s.on('message', (m, r) => s.send(Buffer.concat([Buffer.from('pong:'), m]), r.port, r.address)); await new Promise((res) => s.bind(port, '127.0.0.1', res)); return s; };
const open = (u) => { const ws = new WebSocket(u); ws.binaryType = 'nodebuffer'; return new Promise((res, rej) => { ws.once('open', () => res(ws)); ws.once('error', rej); }); };
const next = (ws) => new Promise((res) => ws.once('message', (d) => res(decode(Buffer.from(d)))));

async function probe(label, drop, port) {
  const srv = await echo(port);
  const relay = startRelay({ port: 0, allowPrivate: true, drop });
  await relay.ready;
  const ws = await open('ws://127.0.0.1:' + relay.port);
  ws.send(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  await next(ws);
  ws.send(encode({ type: TYPE.DATA, handle: 1, port, addr: '127.0.0.1', payload: Buffer.from('ping') }));
  const outcome = await Promise.race([next(ws).then(() => 'reply'), new Promise((r) => setTimeout(() => r('nothing'), 300))]);
  console.log(`${label}: drop=${drop} -> outcome=${outcome} droppedCount=${relay.droppedCount()}`);
  ws.close(); relay.close(); srv.close();
  await new Promise((r) => setTimeout(r, 150));
  return { outcome, dropped: relay.droppedCount() };
}

const clean = await probe('A clean relay', 0, 4548);
const lossy = await probe('A fully lossy relay', 1, 4549);
console.log('');
console.log('CHECK 1  "--drop 1 discards every datagram": asserts outcome===nothing and droppedCount>0.');
console.log('  against drop=1 (the real case) : outcome=' + lossy.outcome + ' dropped=' + lossy.dropped + '  -> PASSES');
console.log('  against drop=0 (the mutation)  : outcome=' + clean.outcome + ' dropped=' + clean.dropped + '  -> FAILS on both halves');
console.log('CHECK 2  "drop 0 passes everything": asserts payload pong:ping and droppedCount===0.');
console.log('  against drop=0 (the real case) : outcome=' + clean.outcome + ' dropped=' + clean.dropped + '  -> PASSES');
console.log('  against drop=1 (the mutation)  : outcome=' + lossy.outcome + ' dropped=' + lossy.dropped + '  -> FAILS on both halves');
const ok = clean.outcome === 'reply' && clean.dropped === 0 && lossy.outcome === 'nothing' && lossy.dropped > 0;
console.log('');
console.log(ok ? 'BOTH CHECKS DISCRIMINATE.' : 'THE PROOF ITSELF FAILED - the checks may be vacuous.');
process.exit(ok ? 0 : 1);
