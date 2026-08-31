#!/usr/bin/env node
// A TLS static file server, for the one thing no gate in this project has ever
// exercised: the page served over https:.
//
// WHY IT EXISTS. GitHub Pages is HTTPS-only, and the browser's mixed-content
// rules key off the DOCUMENT's scheme, not off anything the page or the wasm
// module can see. `python3 -m http.server`, which every gate from M1 to M5
// used, therefore cannot reach the behaviour a real visitor gets. This is the
// smallest thing that can: Node's own https.createServer over the same
// directory, with the same MIME types.
//
// USAGE
//   node web/tools/make-rig-cert.mjs /tmp/rig      # once, writes key+cert
//   node web/tools/serve-https.mjs --dir web/dist-m1 --port 8443 \
//        --cert /tmp/rig/cert.pem --key /tmp/rig/key.pem
//
// THE CERTIFICATE IS SELF-SIGNED AND THAT MATTERS FOR EXACTLY ONE THING.
// A self-signed cert changes whether the browser will *establish* the
// connection; it does not change the mixed-content rules applied once the
// document is loaded, because those are keyed on the document origin's scheme
// (https:) via "potentially trustworthy origin", not on certificate validity.
// The right way to keep that difference from contaminating a measurement is
// NOT --ignore-certificate-errors, which puts the tab into a
// certificate-error security state; it is
// --ignore-certificate-errors-spki-list=<sha256(spki) base64>, which makes
// Chrome accept this one key as valid and leaves the page a normal secure
// page. make-rig-cert.mjs prints that value.
//
// MIME TYPES ARE NOT DECORATION. Emscripten's loader uses
// WebAssembly.instantiateStreaming, which REJECTS a response whose
// Content-Type is not application/wasm and then falls back -- a fallback that
// logs a warning and would show up in the transcript as a difference between
// the http and https runs that has nothing to do with the thing being
// measured. Keeping the table identical to what Pages serves keeps the two
// runs comparable.

import { createServer } from 'node:https';
import { readFileSync, statSync, createReadStream } from 'node:fs';
import { join, normalize, extname } from 'node:path';

const argv = process.argv.slice(2);
const opt = { dir: 'web/dist-m1', port: 8443, cert: null, key: null };
for (let i = 0; i < argv.length; i++) {
  const next = () => argv[++i];
  if (argv[i] === '--dir') opt.dir = next();
  else if (argv[i] === '--port') opt.port = Number(next());
  else if (argv[i] === '--cert') opt.cert = next();
  else if (argv[i] === '--key') opt.key = next();
  else throw new Error(`unknown option: ${argv[i]}`);
}
if (!opt.cert || !opt.key) throw new Error('--cert and --key are required');

// Matches what GitHub Pages sends for these extensions. .data has no
// registered type and Pages answers application/octet-stream for it.
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.png':  'image/png',
  '.json': 'application/json',
  '.css':  'text/css; charset=utf-8',
};

const root = normalize(opt.dir);

const server = createServer(
  { cert: readFileSync(opt.cert), key: readFileSync(opt.key) },
  (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'https://x').pathname);
    // normalize() collapses ".." before the join, so a request cannot climb
    // out of the served directory.
    const file = join(root, normalize(path).replace(/^(\.\.[/\\])+/, ''));
    let st;
    try { st = statSync(file); } catch { res.writeHead(404).end('not found'); return; }
    if (st.isDirectory()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
      'Content-Length': st.size,
    });
    createReadStream(file).pipe(res);
  }
);
server.listen(opt.port, '127.0.0.1', () => {
  console.log(`serving ${root} at https://localhost:${opt.port}/`);
});
