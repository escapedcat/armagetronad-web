import test from 'node:test';
import assert from 'node:assert/strict';
import { encode, decode, TYPE, VERSION } from '../frame.mjs';

test('a DATA frame survives a round trip', () => {
  const payload = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
  const f = decode(encode({ type: TYPE.DATA, handle: 7, port: 4534, addr: 'tron.example.org', payload }));
  assert.equal(f.type, TYPE.DATA);
  assert.equal(f.handle, 7);
  assert.equal(f.port, 4534);
  assert.equal(f.addr, 'tron.example.org');
  assert.deepEqual([...f.payload], [...payload]);
});

test('a BIND frame carries no address and no payload', () => {
  const f = decode(encode({ type: TYPE.BIND, handle: 1, port: 0, addr: '' }));
  assert.equal(f.type, TYPE.BIND);
  assert.equal(f.handle, 1);
  assert.equal(f.addr, '');
  assert.equal(f.payload.length, 0);
});

test('the header is exactly seven bytes before the address', () => {
  const buf = encode({ type: TYPE.DATA, handle: 0x0102, port: 0x0304, addr: 'ab', payload: Buffer.from([9]) });
  assert.deepEqual([...buf], [VERSION, TYPE.DATA, 0x01, 0x02, 0x03, 0x04, 2, 0x61, 0x62, 9]);
});

test('a truncated frame is rejected rather than half-decoded', () => {
  const buf = encode({ type: TYPE.DATA, handle: 1, port: 4534, addr: 'abcd', payload: Buffer.alloc(0) });
  assert.throws(() => decode(buf.subarray(0, 8)), /truncated/);
  assert.throws(() => decode(buf.subarray(0, 3)), /too short/);
});

test('a frame from a future protocol version is rejected', () => {
  const buf = encode({ type: TYPE.DATA, handle: 1, port: 4534, addr: 'a', payload: Buffer.alloc(0) });
  buf[0] = 2;
  assert.throws(() => decode(buf), /version/);
});

test('an address longer than 255 bytes is refused at encode time', () => {
  assert.throws(() => encode({ type: TYPE.DATA, handle: 1, port: 4534, addr: 'x'.repeat(256) }), /too long/);
});
