#!/usr/bin/env node
// A minimal local proxy, and it exists for ONE reason that has nothing to do
// with this port: on the machine M5 was verified on, Firefox cannot open a
// connection to *.github.io at all.
//
// WHAT WAS MEASURED, BEFORE REACHING FOR THIS.
//   Firefox 154.0.1, fresh profile, this repo's own driver:
//     https://example.com                                     -> loads, title read
//     https://escapedcat.github.io/armagetronad-web/...        -> NS_ERROR_FAILURE
//     https://pages.github.io/  (GITHUB'S OWN Pages demo site) -> NS_ERROR_FAILURE
//     http://escapedcat.github.io/armagetronad-web/  (no TLS)  -> NS_ERROR_FAILURE
//   Same host, same moment: curl and Chrome both fetch the deployed site fine,
//   and Chrome played three full rounds off it.
//
// So the failure is not the deployment, not TLS, and not this repository: a
// browser that cannot reach GitHub's own example site is a browser with a
// local outbound restriction. The first attempt hung for 26 s and every later
// one failed in ~15 ms, which is the shape of an interactive firewall (Little
// Snitch runs on this machine) prompting once, timing out unanswered, and
// caching the denial. Its rules cannot be read without root and this port has
// no business changing them.
//
// WHAT THIS DOES. Speaks just enough HTTP-proxy protocol for a browser:
// CONNECT is tunnelled byte-for-byte, plain http requests are forwarded. TLS
// stays end to end -- this process never sees plaintext and cannot, so Firefox
// still validates GitHub's real certificate and the page's origin is still
// https://escapedcat.github.io. The only thing that changes is which process
// opens the TCP connection.
//
// WHAT IT DOES NOT PROVE. It does not prove Firefox on an unrestricted machine
// reaches Pages -- nothing here could, and nothing needs to: curl and Chrome
// already did from this one. It proves Firefox renders and plays THE DEPLOYED
// BYTES, fetched live from the deployment, over https, from that origin.
//
// Usage:
//   node docs/evidence/m5-deploy/tunnel-proxy.mjs [--port 8890] &
//   node web/tools/drive-firefox.mjs --url https://escapedcat.github.io/... \
//        --pref network.proxy.type=1 \
//        --pref 'network.proxy.ssl="127.0.0.1"'  --pref network.proxy.ssl_port=8890 \
//        --pref 'network.proxy.http="127.0.0.1"' --pref network.proxy.http_port=8890
import http from 'node:http';
import net from 'node:net';

const argv = process.argv.slice(2);
const port = Number(argv[argv.indexOf('--port') + 1]) || 8890;

const server = http.createServer((req, res) => {
  let target;
  try {
    target = new URL(req.url);
  } catch {
    res.writeHead(400).end('proxy: absolute-form request URI required');
    return;
  }
  const up = http.request(
    {
      host: target.hostname,
      port: target.port || 80,
      path: target.pathname + target.search,
      method: req.method,
      headers: req.headers,
    },
    (ur) => {
      res.writeHead(ur.statusCode, ur.headers);
      ur.pipe(res);
    },
  );
  up.on('error', (e) => {
    console.error('proxy http error', target.href, e.message);
    res.writeHead(502).end('proxy: ' + e.message);
  });
  req.pipe(up);
});

// https: the browser asks for a tunnel and does its own TLS inside it.
server.on('connect', (req, clientSocket, head) => {
  const i = req.url.lastIndexOf(':');
  const host = req.url.slice(0, i);
  const dport = Number(req.url.slice(i + 1)) || 443;
  const upstream = net.connect(dport, host, () => {
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head && head.length) upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  const bail = (what) => (e) => {
    console.error('proxy connect error', what, req.url, e.message);
    upstream.destroy();
    clientSocket.destroy();
  };
  upstream.on('error', bail('upstream'));
  clientSocket.on('error', bail('client'));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`tunnel proxy on 127.0.0.1:${port}`);
});
