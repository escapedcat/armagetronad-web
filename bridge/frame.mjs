// The wire format between the browser client and this relay. Both ends
// implement it; web/library_bridge.js is the other one. Keep them in step.
export const VERSION = 1;
export const TYPE = { BIND: 1, BOUND: 2, DATA: 3, CLOSE: 4, ERROR: 5 };

export function encode({ type, handle, port, addr, payload }) {
  const a = Buffer.from(addr ?? '', 'ascii');
  if (a.length > 255) throw new RangeError('address too long: ' + a.length + ' bytes');
  const p = payload ?? Buffer.alloc(0);
  const buf = Buffer.allocUnsafe(7 + a.length + p.length);
  buf[0] = VERSION;
  buf[1] = type;
  buf.writeUInt16BE(handle & 0xffff, 2);
  buf.writeUInt16BE(port & 0xffff, 4);
  buf[6] = a.length;
  a.copy(buf, 7);
  Buffer.from(p).copy(buf, 7 + a.length);
  return buf;
}

export function decode(buf) {
  if (buf.length < 7) throw new RangeError('frame too short: ' + buf.length + ' bytes');
  if (buf[0] !== VERSION) throw new RangeError('unsupported frame version ' + buf[0]);
  const addrLen = buf[6];
  if (buf.length < 7 + addrLen) throw new RangeError('frame truncated: address needs ' + addrLen + ' bytes');
  return {
    type: buf[1],
    handle: buf.readUInt16BE(2),
    port: buf.readUInt16BE(4),
    addr: buf.toString('ascii', 7, 7 + addrLen),
    payload: buf.subarray(7 + addrLen),
  };
}
