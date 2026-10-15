#!/usr/bin/env node
// web/tools/serve-switchable.mjs --dir D --next D2 --port P --control C
//
// The offline gate's web server: a static server for D on 127.0.0.1:P that
// the page itself can switch off and on, through a second, always-on server
// on C. A real outage is a refused connection, so /down closes the listener
// AND destroys every open socket; /up?next=1 brings it back serving D2 (the
// "newer build"). /hits counts requests per path, so a gate can tell a file
// that came from the network from one that came from the offline copy.
// Every response is Cache-Control: no-store, so the browser's HTTP cache can
// never stand in for either.
//
//   GET C/down          -> "down"
//   GET C/up[?next=1]   -> "up <dir>"
//   GET C/hits          -> {"armagetronad.wasm": 3, ...}
//
// Prints "listening <P> control <C>" once both are up.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';

const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };
const port = Number(arg('port'));
const controlPort = Number(arg('control'));
let dir = arg('dir');
const next = arg('next');
if (!dir || !port || !controlPort) {
  console.error('usage: serve-switchable.mjs --dir D [--next D2] --port P --control C');
  process.exit(2);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.wasm': 'application/wasm',
                '.data': 'application/octet-stream', '.json': 'application/json', '.png': 'image/png' };
const hits = {};
const sockets = new Set();

const site = http.createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
  if (path.split('/').includes('..')) { res.writeHead(400).end(); return; }
  hits[path] = (hits[path] || 0) + 1;
  try {
    const body = await readFile(join(dir, path || 'index.html'));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
                         'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Cache-Control': 'no-store' }).end();
  }
});
site.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
const up = () => new Promise((r) => site.listen(port, '127.0.0.1', r));
const down = () => new Promise((r) => { site.close(() => r()); for (const s of sockets) s.destroy(); });

const control = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let body;
  if (u.pathname === '/down') { await down(); body = 'down'; }
  else if (u.pathname === '/up') { if (u.searchParams.get('next') === '1' && next) dir = next; await up(); body = 'up ' + dir; }
  else if (u.pathname === '/hits') body = JSON.stringify(hits);
  else { res.writeHead(404).end(); return; }
  console.log('control ' + u.pathname + ' -> ' + body.slice(0, 80));
  res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
  res.end(body);
});

await up();
await new Promise((r) => control.listen(controlPort, '127.0.0.1', r));
console.log('listening ' + port + ' control ' + controlPort);
