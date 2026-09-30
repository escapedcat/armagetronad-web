import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkResourceUrl, fetchResource, DEFAULT_RESOURCE_HOSTS } from '../resource.mjs';
import { startRelay } from '../relay.mjs';

// A stand-in for resource.armagetronad.net: `routes` maps a path to a handler.
async function upstream(routes) {
  const server = http.createServer((req, res) => {
    const h = routes[req.url];
    if (h) return h(req, res);
    res.writeHead(404); res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, host: '127.0.0.1:' + server.address().port };
}
const MAP = '<?xml version="1.0"?><Resource/>';
const opts = (hosts, extra = {}) => ({ hosts, maxBytes: 1000, timeoutMs: 300, maxRedirects: 3, ...extra });

test('the default allows the official repository and nothing else', () => {
  assert.deepEqual([...DEFAULT_RESOURCE_HOSTS], ['resource.armagetronad.net']);
  assert.equal(checkResourceUrl('http://resource.armagetronad.net/resource/a/b/c-1.aamap.xml', DEFAULT_RESOURCE_HOSTS), null);
  assert.equal(checkResourceUrl('https://resource.armagetronad.net/resource/a/b/c-1.aamap.xml', DEFAULT_RESOURCE_HOSTS), null);
});

test('other hosts, schemes, credentials, ports and non-xml paths are refused', () => {
  const H = DEFAULT_RESOURCE_HOSTS;
  assert.match(checkResourceUrl('http://evil.test/x.xml', H), /host/);
  assert.match(checkResourceUrl('http://resource.armagetronad.net:8080/x.xml', H), /host/);
  assert.match(checkResourceUrl('ftp://resource.armagetronad.net/x.xml', H), /scheme/);
  assert.match(checkResourceUrl('http://u:p@resource.armagetronad.net/x.xml', H), /credentials/);
  assert.match(checkResourceUrl('http://resource.armagetronad.net/resource/', H), /\.xml/);
  assert.match(checkResourceUrl('not a url', H), /not a URL/);
});

test('a 200 upstream comes back as the body', async (t) => {
  const u = await upstream({ '/m-1.aamap.xml': (q, s) => { s.writeHead(200); s.end(MAP); } });
  t.after(() => u.server.close());
  const r = await fetchResource('http://' + u.host + '/m-1.aamap.xml', opts([u.host]));
  assert.equal(r.status, 200);
  assert.equal(r.body.toString(), MAP);
});

test('an upstream 404 stays a 404, so the game can say "not found"', async (t) => {
  const u = await upstream({});
  t.after(() => u.server.close());
  const r = await fetchResource('http://' + u.host + '/gone-1.aamap.xml', opts([u.host]));
  assert.equal(r.status, 404);
});

test('a body over the cap is refused, whether or not it declared its length', async (t) => {
  const big = 'x'.repeat(2000);
  const u = await upstream({
    '/declared.xml': (q, s) => { s.writeHead(200, { 'content-length': big.length }); s.end(big); },
    '/chunked.xml': (q, s) => { s.writeHead(200); s.write(big.slice(0, 900)); s.end(big.slice(900)); },
  });
  t.after(() => u.server.close());
  for (const p of ['/declared.xml', '/chunked.xml']) {
    const r = await fetchResource('http://' + u.host + p, opts([u.host]));
    assert.equal(r.status, 502, p);
    assert.match(r.reason, /larger than 1000/, p);
  }
});

test('a redirect is followed only to a URL that passes the same policy', async (t) => {
  const u = await upstream({
    '/a.xml': (q, s) => { s.writeHead(302, { location: '/b.xml' }); s.end(); },
    '/b.xml': (q, s) => { s.writeHead(200); s.end(MAP); },
    '/out.xml': (q, s) => { s.writeHead(302, { location: 'http://evil.test/x.xml' }); s.end(); },
    '/loop.xml': (q, s) => { s.writeHead(302, { location: '/loop.xml' }); s.end(); },
  });
  t.after(() => u.server.close());
  assert.equal((await fetchResource('http://' + u.host + '/a.xml', opts([u.host]))).status, 200);
  const out = await fetchResource('http://' + u.host + '/out.xml', opts([u.host]));
  assert.equal(out.status, 403);
  assert.match(out.reason, /evil\.test/);
  const loop = await fetchResource('http://' + u.host + '/loop.xml', opts([u.host]));
  assert.equal(loop.status, 502);
  assert.match(loop.reason, /redirects/);
});

test('an empty 200 is refused as 502, so the page never caches an empty map', async (t) => {
  const u = await upstream({ '/empty-1.aamap.xml': (q, s) => { s.writeHead(200); s.end(); } });
  t.after(() => u.server.close());
  const r = await fetchResource('http://' + u.host + '/empty-1.aamap.xml', opts([u.host]));
  assert.equal(r.status, 502);
  assert.match(r.reason, /empty/);
});

test('an upstream that never answers is 504 within the timeout', async (t) => {
  const u = await upstream({ '/hang.xml': () => {} });
  t.after(() => { u.server.closeAllConnections(); u.server.close(); });
  const started = Date.now();
  const r = await fetchResource('http://' + u.host + '/hang.xml', opts([u.host]));
  assert.equal(r.status, 504);
  assert.ok(Date.now() - started < 2000, 'must not wait past the timeout');
});

test('an upstream that refuses the connection is 502, not a throw', async () => {
  const r = await fetchResource('http://127.0.0.1:1/x.xml', opts(['127.0.0.1:1']));
  assert.equal(r.status, 502);
});


async function relayWith(t, options) {
  const relay = startRelay({ port: 0, ...options });
  t.after(() => relay.close());
  await relay.ready;
  return relay;
}
const get = (relay, path, headers = {}) =>
  fetch('http://127.0.0.1:' + relay.port + path, { headers });
const q = (url) => '/resource?url=' + encodeURIComponent(url);

test('a loopback relay with no rules serves a map, readable cross-origin', async (t) => {
  const u = await upstream({ '/m-1.aamap.xml': (x, s) => { s.writeHead(200); s.end(MAP); } });
  t.after(() => u.server.close());
  const relay = await relayWith(t, { resourceHosts: [u.host] });
  const r = await get(relay, q('http://' + u.host + '/m-1.aamap.xml'), { origin: 'http://localhost:8008' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8008');
  assert.equal(await r.text(), MAP);
});

test('a refused upstream host is 403 and still readable cross-origin', async (t) => {
  const relay = await relayWith(t, {});
  const r = await get(relay, q('http://evil.test/x.xml'), { origin: 'http://localhost:8008' });
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('access-control-allow-origin'), 'http://localhost:8008',
    'without it the page sees status 0 and the player sees "Return value 0" again');
});

test('with an allowlist, a listed page is served and any other page gets a bare 404', async (t) => {
  const u = await upstream({ '/m-1.aamap.xml': (x, s) => { s.writeHead(200); s.end(MAP); } });
  t.after(() => u.server.close());
  const relay = await relayWith(t, { origins: ['https://page.test'], resourceHosts: [u.host] }); // the allowlist applies on loopback too
  const ok = await get(relay, q('http://' + u.host + '/m-1.aamap.xml'), { origin: 'https://page.test' });
  assert.equal(ok.status, 200);
  const other = await get(relay, q('http://' + u.host + '/m-1.aamap.xml'), { origin: 'https://other.test' });
  assert.equal(other.status, 404);
  assert.equal(other.headers.get('access-control-allow-origin'), null);
  const none = await get(relay, q('http://' + u.host + '/m-1.aamap.xml'));
  assert.equal(none.status, 404);
});

test('with a token, /<token>/resource is served and a wrong token is a bare 404', async (t) => {
  const u = await upstream({ '/m-1.aamap.xml': (x, s) => { s.writeHead(200); s.end(MAP); } });
  t.after(() => u.server.close());
  const token = 'a-long-enough-secret-token';
  const relay = await relayWith(t, { token, resourceHosts: [u.host] });
  const url = encodeURIComponent('http://' + u.host + '/m-1.aamap.xml');
  assert.equal((await get(relay, '/' + token + '/resource?url=' + url)).status, 200);
  assert.equal((await get(relay, '/wrong-token-of-some-length/resource?url=' + url)).status, 404);
  assert.equal((await get(relay, '/resource?url=' + url)).status, 404);
});

test('past the per-IP burst, requests are refused with 429', async (t) => {
  const relay = await relayWith(t, { limits: { resourceBurst: 2, resourcesPerMinute: 1 } });
  const url = q('http://evil.test/x.xml'); // refused at once: no upstream needed
  assert.equal((await get(relay, url)).status, 403);
  assert.equal((await get(relay, url)).status, 403);
  assert.equal((await get(relay, url)).status, 429);
});

test('a request without ?url= is 400, and POST is a bare 404', async (t) => {
  const relay = await relayWith(t, {});
  assert.equal((await get(relay, '/resource')).status, 400);
  const post = await fetch('http://127.0.0.1:' + relay.port + q('http://x/y.xml'), { method: 'POST' });
  assert.equal(post.status, 404);
});

test('each served request is logged with status, size and URL', async (t) => {
  const lines = [];
  const relay = await relayWith(t, { log: (m) => lines.push(m) });
  await get(relay, q('http://evil.test/x.xml'));
  assert.ok(lines.some((l) => /^resource 403 0 http:\/\/evil\.test\/x\.xml \(/.test(l)), lines.join('\n'));
});

test('a URL cannot forge a log line: whitespace and control characters are escaped', async (t) => {
  const lines = [];
  const relay = await relayWith(t, { log: (m) => lines.push(m) });
  await get(relay, q('http://evil.test/x.xml\nresource 200 99 http://fake'));
  const hit = lines.filter((l) => l.startsWith('resource '));
  assert.equal(hit.length, 1);
  assert.ok(!hit[0].includes('\n'), hit[0]);
  assert.match(hit[0], /%0A/);
});
