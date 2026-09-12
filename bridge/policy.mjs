// What this relay is willing to send UDP to. The relay resolves a hostname
// FIRST and checks the resolved IP here, so a public name pointing at a
// private address is refused like the address itself.
const MIN_PORT = 4533;
const MAX_PORT = 4599;

function octets(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  return nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? nums : null;
}

function isReserved(ip) {
  const o = octets(ip);
  if (!o) return true; // not a dotted quad we understand: refuse
  const [a, b] = o;
  if (a === 0 || a === 127) return true;                 // this-network, loopback
  if (a === 10) return true;                             // private
  if (a === 172 && b >= 16 && b <= 31) return true;      // private
  if (a === 192 && b === 168) return true;               // private
  if (a === 169 && b === 254) return true;               // link-local
  if (a === 100 && b >= 64 && b <= 127) return true;     // carrier-grade NAT
  if (a >= 224) return true;                             // multicast and above
  return false;
}

export function checkDestination(ip, port, { allowPrivate = false } = {}) {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    return 'port ' + port + ' is outside the allowed range ' + MIN_PORT + '-' + MAX_PORT;
  }
  if (!allowPrivate && isReserved(ip)) {
    return 'destination ' + ip + ' is not allowed (private, loopback, link-local or multicast)';
  }
  return null;
}
