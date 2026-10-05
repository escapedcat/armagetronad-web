# Map Downloads in the Browser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Joining a server whose map is not bundled stops failing with "Map load failure … ERROR: Return value 0 != 200": the browser client fetches the map through the relay, keeps it in IndexedDB, and ships a small bundle of popular maps so the common case needs no download at all.

**Architecture:** Three layers, all fitting the engine's existing lookup chain in `tResourceManager::locateResource` (`src/tools/tResourceManager.cpp`), which searches the resource read paths and only downloads on a miss:

| Layer | Where it lives in the page | Covers |
|---|---|---|
| Bundle | `/data/resource/<path>` (preloaded, read-only) | popular server maps, zero network |
| Cache | `/persist/resource/automatic/<path>` (IDBFS — already the write path, because the page passes `--userdatadir /persist`) | every map downloaded once, per browser |
| Proxy | `FetchURI` → `eWebFetch` → `aa_resource_fetch` (JS) → relay `GET /resource?url=…` → upstream | everything else |

The relay route exists because a page cannot do what nanoHTTP does (open a TCP socket to port 80 — Emscripten turns that into a `ws://` dial the resource server does not speak and an https page may not make) and cannot `fetch()` the resource server directly (no `Access-Control-Allow-Origin` on its responses, measured 2026-09-30).

**Tech Stack:** Node 22 (`node:http`, global `fetch`, `node --test`) for the relay; Emscripten 6.0.8 with `-sASYNCIFY=1` and a JS library (`__async: true`) for the client; the existing `web/tools/drive-browser.mjs` + `aa-dedicated` container for the browser gate.

**Spec:** none separate — the design was agreed in conversation on 2026-09-30 and is recorded in the Architecture paragraph above and the "Why" notes in each task. Read `bridge/README.md` and the M-A block of `PLAN.md` for the relay's existing admission rules, which Task 1 reuses.

**Review applied 2026-09-30:** gate arms made hermetic against the client's repository fallback (Review Focus 5), `<Resource>` element named correctly, the `/resource` handler can no longer crash the relay and escapes what it logs, native compile check moved into Docker, refused-host harvesting, the relay's refusal reason reaches the console, scheme check and redistribution note for the bundle.

**Branch:** `map-downloads`, off `main`. One PR per task group is fine: Tasks 1–4 (the fix) and Task 5 (the bundle).

## Global Constraints

- **Guard every C++ change with `#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)`.** Never bare `__EMSCRIPTEN__` — the dedicated server is an Emscripten build too (`PLAN.md`, M-A final review, correction (b)).
- **The dedicated wasm must stay byte-identical.** CI's `dedicated-pin` job enforces it (Mac pin 2,488,298 bytes / md5 `9718a2a64978cb6e9b95ea2f0454cca5`; Linux pin in `.github/workflows/checks.yml`). `src/tools/tResourceManager.cpp` compiles into the dedicated build. It contains no `tERR_*`/`tVERIFY`/`__LINE__` today (checked 2026-09-30), so inserted lines cannot move a baked-in line constant — re-check with `grep -n "tERR_\|tVERIFY\|tASSERT\|__LINE__" src/tools/tResourceManager.cpp` before editing, and if anything appears, use the header-macro technique from `src/network/nSocket.h` (`AA_GETHOSTBYNAME`) instead.
- **New C++ files go in `src/emscripten/` and are named in `CLIENT_OBJS`** in `web/Makefile`, never added to `$(SRCS)` (an empty translation unit still changes the server's size).
- **Native builds untouched.** Every C++ edit is inside the guard above.
- **Network code (`src/network/`) is not touched at all.**
- **No open proxy.** The relay's `/resource` route fetches only from an explicit host allowlist (default: `resource.armagetronad.net` only), only `http:`/`https:`, only paths ending `.xml`, at most 1,000,000 bytes, with a timeout, per-IP rate limit and a global concurrency cap — and follows a redirect only if the target passes the same checks.
- **Unadmitted HTTP requests keep getting a bare 404**, exactly like today (`bridge/test/public.test.mjs`: "any other plain HTTP request gets 404, and never reveals whether a path is the token").
- **The relay Dockerfile copies files by name** (`COPY frame.mjs policy.mjs limits.mjs relay.mjs ./`). A new `.mjs` must be added there or the deployed relay crashes at import.
- **No body line in `web/shell.html` may start with `#`** (not expected to be touched, listed because it breaks the link silently).
- **Tests that bind UDP 4534 cannot run while `aa-server` is up** — `docker stop aa-server` before `npm test` in `bridge/`.
- **Commits:** author `escapedcat <github@htmlcss.de>`; end the message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Messages with backticks go through `git commit -F <file>`. Stage named paths only — never `git add -A` / `git add .`.
- **Do not connect to any third-party game server** in automated gates; the only third-party host any test touches is `resource.armagetronad.net`, and only in Task 5's fetch script.

## Review Focus

1. **Error responses without CORS headers.** A 403/404/502 from `/resource` that omits `Access-Control-Allow-Origin` reaches the page as a network error (status 0), so every refusal would read "Return value 0" again and the player learns nothing. Every response from an *admitted* request carries the header — pinned in Task 1 ("a refused upstream host is 403 and still readable cross-origin").
2. **A relay that predates the route.** Until Task 1 is deployed, the published page's `/resource` request gets a bare 404 with no CORS header → status 0 → the same failure as today, not a crash or hang. Pinned in Task 2 ("a network failure resolves to 0, not a throw").
3. **Status 0 treated as success.** Upstream's nanoHTTP branch returns `static_cast<Result>(rc)` for rc 0, which `myFetch` reads as success and then hands the map loader a deleted file. The new branch must return `ERROR_Unknown` for 0 so `myFetch` tries the next repository URI. Pinned in Task 4's refused arm (the log must show the fetch error, not a parse error on a missing file).
4. **A hung upstream.** A resource server that accepts and never answers must not freeze the page forever: relay aborts at 10 s (Task 1 test "an upstream that never answers is 504 within the timeout"), client aborts at 15 s (Task 2 test "a fetch that exceeds the client timeout resolves to 0").
5. **The client tries up to three URIs per missing map, and the last one is the official repository.** `tResourceManager::locateResource` (`tResourceManager.cpp:293-300`) builds the list: a URI embedded in the map reference (`file(http://…)`), then `RESOURCE_REPOSITORY_SERVER` + file (sent by the server — an `nSettingItem`, `gStuff.cpp:48`), then `RESOURCE_REPOSITORY_CLIENT` + file (default `http://resource.armagetronad.net/resource/`) unless equal to the server's. So a refused first URI falls through to `resource.armagetronad.net` — which the default relay allowlist admits. Any gate arm that must not leave the machine therefore starts the relay with `BRIDGE_RESOURCE_HOSTS=none.invalid` (Task 4), and servers running their own repository are refused unless their host is listed — harvest refused hosts from the relay log (Task 1 Step 10) before widening the allowlist.
6. **The bundle shadowing a newer map.** Resource paths carry the version in the file name (`…-1.aamap.xml`), so a bundled file can never be stale for its own path; a server moving to `-2` simply misses the bundle and downloads. The fetch script refuses any list entry without a version suffix (Task 5 step "reject unversioned paths").

---

### Task 1: The relay's `/resource` route

**Files:**
- Create: `bridge/resource.mjs`
- Create: `bridge/test/resource.test.mjs`
- Modify: `bridge/relay.mjs` (HTTP handler, `startRelay` options, CLI env)
- Modify: `bridge/limits.mjs` (`DEFAULT_LIMITS`)
- Modify: `bridge/Dockerfile` (the `COPY` line)
- Modify: `bridge/README.md` (new section "Map downloads")

**Interfaces:**
- Produces (HTTP): `GET /resource?url=<encodeURIComponent(absolute URL)>` on a loopback relay with no rules or from an allowlisted Origin; `GET /<token>/resource?url=…` on a token relay. Answers `200` + `content-type: text/xml` + body, or `403` (URL refused by policy), `404` (upstream 404), `429` (rate limited), `502` (upstream error / too large / too many redirects), `503` (too many fetches in flight), `504` (upstream timeout) — each with a `text/plain` reason and, for admitted requests, `Access-Control-Allow-Origin: <request Origin>` + `Vary: Origin`. Unadmitted: bare `404`, no CORS.
- Produces (JS): `checkResourceUrl(text, hosts) -> string|null`, `fetchResource(url, opts) -> Promise<{status, body?, reason?}>`, `DEFAULT_RESOURCE_HOSTS`.
- Produces (env): `BRIDGE_RESOURCE_HOSTS` — comma-separated `URL.host` values (`host` or `host:port`); **replaces** the default when set.
- Produces (log line, consumed by Task 5's harvesting): `resource <status> <bytes> <url> (<client ip>)`.

- [ ] **Step 1: Write the failing unit tests for the URL policy and the fetcher**

`bridge/test/resource.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkResourceUrl, fetchResource, DEFAULT_RESOURCE_HOSTS } from '../resource.mjs';

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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `docker stop aa-server 2>/dev/null; cd bridge && node --test test/resource.test.mjs`
Expected: FAIL — `Cannot find module '../resource.mjs'`.

- [ ] **Step 3: Write `bridge/resource.mjs`**

```js
// Map downloads for the browser client.
//
// WHY THIS EXISTS. When a server runs a map the client does not have, the
// engine downloads it (tResourceManager::FetchURI). Natively that is a plain
// TCP connection to resource.armagetronad.net:80. A page can do neither of the
// two things that would replace it: it cannot open TCP at all (Emscripten turns
// connect() into a ws:// dial the resource server does not speak, and an https
// page may not dial ws:// anyway), and it cannot fetch() the resource server
// directly, because that server sends no Access-Control-Allow-Origin. So the
// page asks the relay, which already faces the internet on the page's behalf.
//
// WHAT KEEPS THIS FROM BEING AN OPEN PROXY. Only the listed hosts, only http
// and https, only paths ending in .xml, only so many bytes, only so long -- and
// a redirect is followed only if its target passes the same checks. The
// admission, rate and concurrency limits are relay.mjs's, beside the route.
export const DEFAULT_RESOURCE_HOSTS = Object.freeze(['resource.armagetronad.net']);
export const RESOURCE_MAX_BYTES = 1_000_000;
export const RESOURCE_TIMEOUT_MS = 10_000;
export const RESOURCE_MAX_REDIRECTS = 3;

// null when the URL may be fetched, otherwise the reason it may not.
// Hosts are compared as URL.host, so 'example.org' does not admit
// 'example.org:8080' -- a test upstream is listed with its port.
export function checkResourceUrl(text, hosts) {
  let u;
  try { u = new URL(text); } catch { return 'not a URL'; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'scheme ' + u.protocol + ' is not allowed';
  if (u.username || u.password) return 'credentials in the URL are not allowed';
  if (!hosts.includes(u.host)) return 'host ' + u.host + ' is not an allowed resource host';
  if (!u.pathname.endsWith('.xml')) return 'only .xml resources are served';
  return null;
}

// Never throws. {status: 200, body} or {status, reason} where status is what
// the relay should answer the page with.
export async function fetchResource(url, {
  hosts = DEFAULT_RESOURCE_HOSTS, maxBytes = RESOURCE_MAX_BYTES,
  timeoutMs = RESOURCE_TIMEOUT_MS, maxRedirects = RESOURCE_MAX_REDIRECTS,
} = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const refusal = checkResourceUrl(current, hosts);
      if (refusal) return { status: 403, reason: refusal };
      const res = await fetch(current, { redirect: 'manual', signal });
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel();
        current = new URL(location, current).href;
        continue;
      }
      if (res.status !== 200) {
        await res.body?.cancel();
        return { status: res.status === 404 ? 404 : 502, reason: 'upstream answered ' + res.status };
      }
      const tooBig = { status: 502, reason: 'larger than ' + maxBytes + ' bytes' };
      if (Number(res.headers.get('content-length')) > maxBytes) { await res.body?.cancel(); return tooBig; }
      const chunks = [];
      let n = 0;
      for await (const c of res.body) {
        n += c.length;
        if (n > maxBytes) return tooBig; // leaving the loop cancels the stream
        chunks.push(c);
      }
      return { status: 200, body: Buffer.concat(chunks) };
    }
    return { status: 502, reason: 'too many redirects' };
  } catch (e) {
    if (signal.aborted) return { status: 504, reason: 'upstream did not answer within ' + timeoutMs + ' ms' };
    return { status: 502, reason: 'upstream unreachable: ' + (e.cause?.code || e.message) };
  }
}
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `cd bridge && node --test test/resource.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing route tests** (append to `bridge/test/resource.test.mjs`)

```js
import { startRelay } from '../relay.mjs';

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
```

- [ ] **Step 6: Run them to verify they fail**

Run: `cd bridge && node --test test/resource.test.mjs`
Expected: the 8 unit tests PASS; the 8 route tests FAIL (404 where 200/403/429/400 expected).

- [ ] **Step 7: Add the limits** — in `bridge/limits.mjs`, inside `DEFAULT_LIMITS` after `destinationsPerMinute`:

```js
  // Map downloads (resource.mjs) one client IP may ask for. Joining a server
  // costs at most one or two; a burst of 10 covers hopping between servers.
  resourcesPerMinute: 30,
  resourceBurst: 10,
  // Upstream fetches in flight at once, across all clients, so a crowd cannot
  // turn the relay into a download mirror.
  resourceConcurrent: 8,
```

- [ ] **Step 8: Wire the route into `bridge/relay.mjs`**

1. Import: `import { DEFAULT_RESOURCE_HOSTS, fetchResource } from './resource.mjs';`
2. Add to the `startRelay` options, after `clientIpHeader`:

```js
  // Hosts the /resource route may fetch from (resource.mjs). Replaces the
  // default when given; tests list their local upstream as 'host:port'.
  resourceHosts = DEFAULT_RESOURCE_HOSTS,
```

3. Replace the `http.createServer(...)` block (keep its comment, extend it) with:

```js
  // Plain HTTP answers /health (for the platform's checks) and the /resource
  // map-download route (resource.mjs), and 404s everything else -- including a
  // plain GET on the token path, and any /resource request that is not
  // admitted, so probing cannot tell a right guess from a wrong one.
  const resourceBuckets = new Map(); // client ip -> bucket
  let resourcesInFlight = 0;
  // The same admission as an upgrade, for /resource and /<token>/resource.
  const resourceAdmitted = (req, path) => {
    if (expected === null && !allowlist) return path === '/resource';
    if (path.endsWith('/resource') && path !== '/resource' && tokenMatches(path.slice(0, -'/resource'.length))) return true;
    return path === '/resource' && !!allowlist && originAllowed(req.headers.origin, allowlist);
  };
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    const path = String(req.url || '').split('?')[0];
    if (req.method !== 'GET' || !resourceAdmitted(req, path)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const ip = clientIp(req);
    // Every admitted answer carries CORS, refusals included: without it the
    // page sees a network error (status 0) instead of the reason.
    const cors = typeof req.headers.origin === 'string' ? { 'access-control-allow-origin': req.headers.origin, vary: 'Origin' } : {};
    // The URL is logged, and it arrives decoded from ?url=, so anything outside
    // printable ASCII (a newline would forge a log line) is re-escaped first.
    const printable = (u) => String(u).replace(/[^\x21-\x7e]/g, (c) => encodeURIComponent(c));
    const answer = (status, body, url) => {
      const text = typeof body === 'string';
      res.writeHead(status, { ...cors, 'content-type': text ? 'text/plain' : 'text/xml',
                              ...(status === 200 ? { 'cache-control': 'public, max-age=86400' } : {}) });
      res.end(body);
      log('resource ' + status + ' ' + (text ? 0 : body.length) + ' ' + printable(url) + ' (' + ip + ')');
    };
    // AN ASYNC HANDLER MUST NOT THROW: in Node 22 an unhandled rejection ends
    // the process, and this is the only relay. Anything unexpected is a 500.
    try {
      const url = new URL(req.url, 'http://relay').searchParams.get('url');
      if (!url) return answer(400, 'missing ?url=', '-');
      if (resourceBuckets.size > 10_000) resourceBuckets.clear(); // bounded memory; a reset only forgives
      if (!resourceBuckets.has(ip)) resourceBuckets.set(ip, bucket(L.resourcesPerMinute / 60, L.resourceBurst));
      if (!resourceBuckets.get(ip).take(1)) return answer(429, 'too many map downloads, try again in a minute', url);
      if (resourcesInFlight >= L.resourceConcurrent) return answer(503, 'the relay is busy, try again', url);
      ++resourcesInFlight;
      try {
        const r = await fetchResource(url, { hosts: resourceHosts });
        answer(r.status, r.status === 200 ? r.body : r.reason, url);
      } finally {
        --resourcesInFlight;
      }
    } catch (e) {
      log('resource handler error: ' + e.message);
      if (!res.headersSent) { res.writeHead(500, cors); res.end(); } else res.destroy();
    }
  });
```

(`clientIp` and `tokenMatches` are already defined above this point; `clientIp` must stay defined before `server` — it is today.)

4. In the CLI block, pass `resourceHosts` and report it in the listening line:

```js
      resourceHosts: parseOrigins(process.env.BRIDGE_RESOURCE_HOSTS).length
        ? parseOrigins(process.env.BRIDGE_RESOURCE_HOSTS) : undefined,
```

and append to the `listening on` message:

```js
                (process.env.BRIDGE_RESOURCE_HOSTS ? ' (map downloads from ' + process.env.BRIDGE_RESOURCE_HOSTS + ')' : '') +
```

(`parseOrigins` is a plain comma splitter; reusing it is deliberate — note that in a one-line comment.)

- [ ] **Step 9: Run the whole relay suite**

Run: `docker stop aa-server 2>/dev/null; cd bridge && npm test`
Expected: PASS, every existing test plus the 16 new ones — in particular `public.test.mjs` "any other plain HTTP request gets 404" still passes.

- [ ] **Step 10: Dockerfile and README**

`bridge/Dockerfile`: `COPY frame.mjs policy.mjs limits.mjs relay.mjs resource.mjs ./`

Then verify the image actually starts (catches a missing COPY):

```sh
docker build -t aa-bridge-check bridge/ && \
docker run --rm -e BRIDGE_TOKEN=0123456789abcdef0123 aa-bridge-check node -e "import('./relay.mjs').then(()=>console.log('imports ok'))"
```
Expected: `imports ok`.

`bridge/README.md`: add a section **"Map downloads (`/resource`)"** stating: why it exists (two sentences from the `resource.mjs` header), the request shape, the admission rule (same as upgrades; unadmitted → bare 404), the policy (hosts, schemes, `.xml`, 1 MB, 10 s, 3 redirects), the limits (30/min, burst 10, 8 in flight), `BRIDGE_RESOURCE_HOSTS` (replaces the default; `host:port` form for local testing), and the log line format with the commands to harvest bundle candidates — `fly logs -a armagetronad-bridge | grep -o 'resource 200 [0-9]* [^ ]*' | sort | uniq -c | sort -rn` — and refused repository hosts, the evidence for widening `BRIDGE_RESOURCE_HOSTS` — `fly logs -a armagetronad-bridge | grep -o 'resource 403 0 [a-z]*://[^/ ]*' | sort | uniq -c | sort -rn`.

- [ ] **Step 11: Commit**

```bash
git add bridge/resource.mjs bridge/test/resource.test.mjs bridge/relay.mjs bridge/limits.mjs bridge/Dockerfile bridge/README.md
git commit -F /tmp/msg-task1.txt   # "bridge: serve map downloads to the page at /resource" + why + attribution
```

---

### Task 2: The page end — `aa_resource_fetch`

**Files:**
- Create: `web/library_resource.js`
- Create: `bridge/test/library-resource.test.mjs` (lives beside `library-bridge.test.mjs` so CI's `bridge-tests` job runs it)

**Interfaces:**
- Consumes: `AABridge.getUrl()` from `web/library_bridge.js` — the relay URL the page dials (`wss://armagetronad-bridge.fly.dev/` on the published page, `?bridge=` elsewhere, `null` when offline); Task 1's HTTP contract.
- Produces (C ABI, for Task 3): `extern "C" int aa_resource_fetch( const char * uri, void ** outBuf, int * outLen );` — returns the HTTP status, `0` when nothing answered (offline page, network error, timeout). On `200`, `*outBuf` is a `malloc`'d buffer of `*outLen` bytes the caller must `free`; otherwise `*outBuf` is `NULL` and `*outLen` is `0`. Suspends under Asyncify.
- Produces (JS): `AAResource.endpoint(bridgeUrl) -> string|null`.
- Produces (console, for Task 4's gate): `[RESOURCE] <status> <uri>` once per call, followed by ` (<relay's reason>)` when the relay answered with a non-200 body.

- [ ] **Step 1: Write the failing tests**

`bridge/test/library-resource.test.mjs` — load both libraries the way `library-bridge.test.mjs` loads one (read its header comment first; the loader below follows it):

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, '..', '..', 'web', f), 'utf8');
const bridgeSource = src('library_bridge.js');
const resourceSource = src('library_resource.js');

function load({ search = '?bridge=ws://127.0.0.1:8010', hostname = '127.0.0.1', fetchImpl } = {}) {
  const heap = new Uint8Array(4096);
  let next = 1024;
  const freed = [];
  const logged = [];
  const sandbox = {
    mergeInto: (target, obj) => Object.assign(target, obj),
    LibraryManager: { library: {} },
    console: { log: (...a) => logged.push(a.join(' ')) },
    location: { search, hostname },
    URLSearchParams, URL, AbortController, setTimeout, clearTimeout,
    fetch: fetchImpl,
    HEAPU8: heap,
    HEAP32: new Int32Array(heap.buffer),
    UTF8ToString: (p) => sandbox._strings[p],
    _malloc: (n) => { const p = next; next += n; return p; },
    Asyncify: { handleAsync: (f) => f() },
    _strings: {},
  };
  const names = Object.keys(sandbox);
  // Emscripten turns each $-dep into a top-level var the entry points close
  // over, so the vars are declared in the SAME scope that evaluates the
  // library sources -- the pattern library-bridge.test.mjs documents.
  const built = new Function(...names, bridgeSource + resourceSource + `
    var AABridge = LibraryManager.library.$AABridge;
    var AAResource = LibraryManager.library.$AAResource;
    return {
      lib: LibraryManager.library,
      call: (name, args) => LibraryManager.library[name].apply(null, args),
    };
  `)(...names.map((n) => sandbox[n]));
  const lib = built.lib;
  return {
    lib, heap, logged, freed,
    fetch: async (uri) => {
      sandbox._strings[1] = uri;
      const status = await built.call('aa_resource_fetch', [1, 0, 4]);
      const i32 = new Int32Array(heap.buffer);
      const ptr = i32[0], len = i32[1];
      return { status, text: ptr ? Buffer.from(heap.subarray(ptr, ptr + len)).toString() : null, ptr, len };
    },
  };
}
```

Tests:

```js
test('the route is derived from the bridge URL: scheme, token path and all', () => {
  const { lib } = load();
  const ep = lib.$AAResource.endpoint;
  assert.equal(ep('wss://armagetronad-bridge.fly.dev/'), 'https://armagetronad-bridge.fly.dev/resource');
  assert.equal(ep('ws://127.0.0.1:8010'), 'http://127.0.0.1:8010/resource');
  assert.equal(ep('wss://relay.test/sometoken'), 'https://relay.test/sometoken/resource');
  assert.equal(ep(null), null);
  assert.equal(ep('junk'), null);
});

test('a 200 lands in a malloc\'d buffer with its length', async () => {
  let asked;
  const b = load({ fetchImpl: async (u) => { asked = u; return new Response('<Map/>', { status: 200 }); } });
  const r = await b.fetch('http://resource.armagetronad.net/resource/a/b/c-1.aamap.xml');
  assert.equal(r.status, 200);
  assert.equal(r.text, '<Map/>');
  assert.equal(asked, 'http://127.0.0.1:8010/resource?url=' +
    encodeURIComponent('http://resource.armagetronad.net/resource/a/b/c-1.aamap.xml'));
  assert.ok(b.logged.some((l) => l === '[RESOURCE] 200 http://resource.armagetronad.net/resource/a/b/c-1.aamap.xml'));
});

test('a refusal passes its status through and hands back no buffer', async () => {
  const b = load({ fetchImpl: async () => new Response('host not allowed', { status: 403 }) });
  const r = await b.fetch('http://evil.test/x.xml');
  assert.equal(r.status, 403);
  assert.equal(r.ptr, 0);
  assert.equal(r.len, 0);
  assert.ok(b.logged.includes('[RESOURCE] 403 http://evil.test/x.xml (host not allowed)'), b.logged.join('\n'));
});

test('a network failure resolves to 0, not a throw', async () => {
  const b = load({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal((await b.fetch('http://resource.armagetronad.net/resource/x-1.aamap.xml')).status, 0);
});

test('a fetch that exceeds the client timeout resolves to 0', async () => {
  const b = load({ fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))) });
  b.lib.$AAResource.TIMEOUT_MS = 50;
  assert.equal((await b.fetch('http://resource.armagetronad.net/resource/x-1.aamap.xml')).status, 0);
});

test('an offline page does not fetch at all', async () => {
  let called = false;
  const b = load({ search: '', hostname: 'localhost', fetchImpl: async () => { called = true; } });
  assert.equal((await b.fetch('http://resource.armagetronad.net/resource/x-1.aamap.xml')).status, 0);
  assert.equal(called, false);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd bridge && node --test test/library-resource.test.mjs`
Expected: FAIL — `ENOENT … web/library_resource.js`.

- [ ] **Step 3: Write `web/library_resource.js`**

```js
// Map downloads for the browser client: the page end of the relay's /resource
// route (bridge/resource.mjs says why the relay has to do the fetching).
//
// C++ calls aa_resource_fetch from tResourceManager::FetchURI, via
// src/emscripten/eWebFetch.cpp, and it SUSPENDS under Asyncify until the
// answer is in -- the same blocking shape as the nanoHTTP call it replaces,
// with the page staying responsive while it waits. It never calls C++ back.
mergeInto(LibraryManager.library, {
  $AAResource: {
    TIMEOUT_MS: 15000,   // longer than the relay's own 10 s upstream timeout
    // The relay serves /resource beside its WebSocket, so the route is the
    // bridge URL with an http scheme and /resource on the end of its path --
    // which keeps a token relay's /<token> prefix.
    endpoint: function (bridgeUrl) {
      if (!bridgeUrl) return null;
      var u;
      try { u = new URL(bridgeUrl); } catch (e) { return null; }
      if (u.protocol !== 'ws:' && u.protocol !== 'wss:') return null;
      u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
      u.pathname = u.pathname.replace(/\/$/, '') + '/resource';
      u.search = '';
      u.hash = '';
      return u.href;
    },
  },

  // Returns the HTTP status, 0 when nothing answered. On 200, *outBuf is a
  // malloc'd copy of the body the caller frees; otherwise it is NULL.
  aa_resource_fetch__deps: ['$AABridge', '$AAResource', 'malloc'],
  aa_resource_fetch__async: true,
  aa_resource_fetch: function (uriPtr, outBufPtr, outLenPtr) {
    var uri = UTF8ToString(uriPtr);
    HEAP32[outBufPtr >> 2] = 0;
    HEAP32[outLenPtr >> 2] = 0;
    return Asyncify.handleAsync(async function () {
      var status = 0;
      var reason = '';
      var ep = AAResource.endpoint(AABridge.getUrl());
      if (ep) {
        var ctl = new AbortController();
        var timer = setTimeout(function () { ctl.abort(); }, AAResource.TIMEOUT_MS);
        try {
          var r = await fetch(ep + '?url=' + encodeURIComponent(uri), { signal: ctl.signal });
          status = r.status;
          if (status !== 200) {
            // The relay says WHY in a short text/plain body; the game can only
            // print the number, so the reason goes to the console.
            try { reason = (await r.text()).slice(0, 200); } catch (e) { reason = ''; }
          } else {
            var bytes = new Uint8Array(await r.arrayBuffer());
            var p = _malloc(bytes.length || 1);
            HEAPU8.set(bytes, p);           // HEAPU8 read AFTER malloc: it may grow memory
            HEAP32[outBufPtr >> 2] = p;
            HEAP32[outLenPtr >> 2] = bytes.length;
          }
        } catch (e) {
          status = 0;
        } finally {
          clearTimeout(timer);
        }
      }
      console.log('[RESOURCE] ' + status + ' ' + uri + (reason ? ' (' + reason + ')' : ''));
      return status;
    });
  },
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd bridge && node --test test/library-resource.test.mjs && npm test`
Expected: PASS, 6 new tests, and the whole suite still green.

- [ ] **Step 5: Commit**

```bash
git add web/library_resource.js bridge/test/library-resource.test.mjs
git commit -F /tmp/msg-task2.txt   # "web: fetch maps through the relay from the page"
```

---

### Task 3: The C++ hook and the link

**Files:**
- Create: `src/emscripten/eWebFetch.h`
- Create: `src/emscripten/eWebFetch.cpp`
- Modify: `src/tools/tResourceManager.cpp` (include block; head of `tResourceManager::FetchURI`)
- Modify: `web/Makefile` (`CLIENT_OBJS`, its comment list, `CLIENT_LDFLAGS`, the prerequisites of `web/dist-m1/armagetronad.html`)

**Interfaces:**
- Consumes: `aa_resource_fetch` (Task 2).
- Produces: `int eWebFetch( char const * uri, std::ostream & o );` — writes the body to `o` on 200, returns the HTTP status (0 = nothing answered).

There is no C++ unit harness in this repo; this task's test is the build plus the dedicated pin, and Task 4's gate is the behavioural test.

- [ ] **Step 1: Write `src/emscripten/eWebFetch.h`**

```cpp
#ifndef ArmageTron_eWebFetch_H
#define ArmageTron_eWebFetch_H

#include <ostream>

// Fetches uri through the relay's /resource route (web/library_resource.js,
// bridge/resource.mjs) and writes the body to o. Returns the HTTP status;
// 0 when nothing answered. Blocks (suspends under Asyncify) until done.
int eWebFetch( char const * uri, std::ostream & o );

#endif
```

- [ ] **Step 2: Write `src/emscripten/eWebFetch.cpp`**

```cpp
/*
Armagetron Advanced -- map downloads in the browser client.

WHY THIS EXISTS. tResourceManager::FetchURI downloads a map the client lacks
with libxml2's nanoHTTP, which opens a TCP socket to the repository. A page
has no TCP: Emscripten's socket emulation turns that connect() into a ws://
dial the resource server does not speak (and an https page may not make), so
no status line ever arrives and the player sees "Return value 0 != 200". This
file hands the request to web/library_resource.js, which asks the relay.

Named in CLIENT_OBJS in web/Makefile, never in $(SRCS): the dedicated wasm is
byte-pinned. The guard below is belt and braces on top of that.
*/
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)

#include "eWebFetch.h"

#include <stdlib.h>

extern "C" int aa_resource_fetch( const char * uri, void ** outBuf, int * outLen );

int eWebFetch( char const * uri, std::ostream & o )
{
    void * buf = NULL;
    int len = 0;
    int status = aa_resource_fetch( uri, &buf, &len );
    if ( status == 200 && buf )
        o.write( static_cast< char const * >( buf ), len );
    free( buf );
    return status;
}

#endif
```

- [ ] **Step 3: Hook `FetchURI`**

Re-run the pin-safety grep from Global Constraints first. Then in `src/tools/tResourceManager.cpp`, after `#include "tString.h"`:

```cpp
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
#include "eWebFetch.h"
#endif
```

and as the first thing inside `tResourceManager::FetchURI`'s body, before `#ifdef LIBCURL_PROTOCOL_HTTP`:

```cpp
#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)
    // A page cannot open the TCP socket nanoHTTP needs; the relay fetches for
    // us -- see src/emscripten/eWebFetch.cpp. Status 0 (nothing answered) is
    // ERROR_Unknown, NOT static_cast<Result>(0): myFetch reads 0 as success
    // and would hand the map loader a file it has just deleted.
    {
        int rc = eWebFetch( URI, o );
        if ( rc != 200 )
        {
            con << tOutput( rc == 404 ? "$resource_fetcherror_404" : "$resource_fetcherror", rc );
            return rc == 0 ? ERROR_Unknown : static_cast< tResourceManager::Result >( rc );
        }
        con << "OK\n";
        return RESULT_Ok;
    }
#endif
```

(`con` and `tOutput` are already in scope — the nanoHTTP branch uses both. If the compiler reports unreachable-code warnings for the native branches below, that is expected and harmless under `CODELEVEL` defaults; do not restructure the native code.)

- [ ] **Step 4: Link it**

In `web/Makefile`:
1. Append `$(CLIENT_OBJDIR)/emscripten/eWebFetch.o` to `CLIENT_OBJS` (after `eWebWallCut.o`), and add a line to the comment list above it: `#   src/emscripten/eWebFetch.cpp   map downloads through the relay's /resource route, for the same byte-pin reason as eWebNet.cpp.`
2. In `CLIENT_LDFLAGS`, after `--js-library web/library_bridge.js \`, add `--js-library web/library_resource.js \`.
3. Add `web/library_resource.js` next to `web/library_bridge.js` in the prerequisites of **every** rule that lists `web/library_bridge.js` (find them with `grep -n "library_bridge.js" web/Makefile`), so editing it relinks.

- [ ] **Step 5: Build both targets and check the pin**

```sh
source deps/emsdk/emsdk_env.sh
make -f web/Makefile client -j8
make -f web/Makefile dedicated -j8
ls -l web/dist-m0/armagetronad-dedicated.wasm && md5 web/dist-m0/armagetronad-dedicated.wasm
grep -c aa_resource_fetch web/dist-m1/armagetronad.js
```
Expected: both builds succeed with `-sERROR_ON_UNDEFINED_SYMBOLS=1`; dedicated wasm is **2,488,298 bytes, md5 `9718a2a64978cb6e9b95ea2f0454cca5`** (Mac); the client JS mentions `aa_resource_fetch` (≥1). If the pin moved, stop — do not "fix" it by rebaselining; find the unguarded change.

- [ ] **Step 6: Native build still compiles the file unchanged**

Not in the working tree — `./configure` there would scatter generated Makefiles and a root `config.h` through it. The gate's server image already runs the native autotools build from a copy of the tree, and Task 4 needs it rebuilt anyway:

```sh
docker build -t aa-dedicated -f bridge/test-server/Dockerfile . > /tmp/aa-dedicated-build.log 2>&1; echo "exit $?"; tail -3 /tmp/aa-dedicated-build.log
```
Expected: `exit 0` — `tResourceManager.cpp` compiled natively (the guarded block is preprocessed away). `git diff --stat` shows only the files listed in this task.

- [ ] **Step 7: Commit**

```bash
git add src/emscripten/eWebFetch.h src/emscripten/eWebFetch.cpp src/tools/tResourceManager.cpp web/Makefile
git commit -F /tmp/msg-task3.txt   # "client: download missing maps through the relay"
```

---

### Task 4: The browser gate — a real join onto an unbundled map

**Files:**
- Create: `bridge/test-server/resource-repo/gate/resource/sumo_gate-0.1.0.aamap.xml`
- Create: `bridge/test-server/resource-var/autoexec.cfg`
- Create: `web/tools/resource-gate.steps`
- Create: `web/tools/run-resource-gate.sh`
- Create: `docs/evidence/map-downloads/README.md` (+ the run outputs)

**Interfaces:**
- Consumes: Tasks 1–3; `aa-dedicated` image (`bridge/test-server/README.md`); `web/tools/drive-browser.mjs`; the bookmark walk in `web/tools/bridge-gate-b6.steps` / `bridge-gate.steps`.
- Produces: `sh web/tools/run-resource-gate.sh <out-dir> <download|refused>`, extended by Task 5 with `bundled`.

The gate is hermetic: the "resource repository" is `python3 -m http.server 8009` on this machine, the server is the local container, and the relay is told (via `BRIDGE_RESOURCE_HOSTS`) exactly which hosts it may fetch from — `127.0.0.1:8009` in the `download` arm, `none.invalid` (nothing) in the others. The client's last-resort URI is always the official repository (Review Focus 5), so no arm runs with the default host list. Nothing leaves the machine.

- [ ] **Step 1: Make the gate map**

```sh
mkdir -p bridge/test-server/resource-repo/gate/resource
cp resource/included/Z-Man/fortress/sumo_8x2-0.1.0.aamap.xml \
   bridge/test-server/resource-repo/gate/resource/sumo_gate-0.1.0.aamap.xml
```

Edit the copy's `<Resource type="aamap" …>` element (line 3 of the source; the identity lives there, not on `<Map>`) so `author="gate" category="resource" name="sumo_gate" version="0.1.0"` — the engine checks these against the path. Check the DTD reference at the top still resolves (the included maps' DTDs ship in `/data/resource/included`; keep the reference identical to the original's).

- [ ] **Step 2: Server config**

`bridge/test-server/resource-var/autoexec.cfg`:

```
# Map-download gate (web/tools/run-resource-gate.sh). The map is NOT in the
# client bundle, so joining forces a download -- from 127.0.0.1:8009, the
# gate's stand-in for resource.armagetronad.net, via the relay.
MAP_FILE gate/resource/sumo_gate-0.1.0.aamap.xml
RESOURCE_REPOSITORY_SERVER http://127.0.0.1:8009/
```

The server itself finds the map locally because the runner mounts `resource-repo` at the server's `--userdatadir /data` → `/data/resource/automatic`.

- [ ] **Step 3: Write `web/tools/resource-gate.steps`**

Start from `web/tools/bridge-gate-b6.steps`: copy its header conventions, its boot/reload dance, its taps, and its menu walk to the bookmarked server **verbatim** up to (not including) the steps that wait for the round. Then replace everything after with:

```
mark:R1 join started
until:1:30000:[RESOURCE]
shot:r1-after-fetch
until:1:30000:Map load failure
shot:r1-end
eval:(()=>{try{return 'cached='+Module.FS.analyzePath('/persist/resource/automatic/gate/resource/sumo_gate-0.1.0.aamap.xml').exists}catch(e){return 'cached=ERR '+e}})()
```

The second `until:` is expected to **time out** in the `download` arm (no failure screen) and to **hit** in the `refused` arm; `until:` never throws, so the runner — not this file — decides PASS/FAIL. Write a header comment saying exactly that, in the style of `bridge-gate.steps` ("WHY `until:` DOES NOT DECIDE ANYTHING HERE").

Also check whether the game's `con` output reaches the page console (grep an earlier evidence transcript under `docs/evidence/` for "not found in cache" or "Downloading"). If it does, add `until:1:30000:Downloading` before the `[RESOURCE]` wait; if not, record that in the README and rely on `[RESOURCE]` and the screenshots.

- [ ] **Step 4: Write `web/tools/run-resource-gate.sh`**

Model it on `web/tools/run-bridge-b6.sh` (read it whole first: container by name, no `--rm`, log collection, refusing to run from the wrong directory). Arms:

| Arm | Relay started with | PASS requires |
|---|---|---|
| `download` | `BRIDGE_RESOURCE_HOSTS=127.0.0.1:8009 node bridge/relay.mjs --port 8010 --allow-private` | console has `[RESOURCE] 200 http://127.0.0.1:8009/gate/resource/sumo_gate-0.1.0.aamap.xml`; console has **no** `Map load failure`; eval printed `cached=true`; relay log has `resource 200`; server log shows the client joined (same check `run-bridge-b6.sh` uses) |
| `refused` | `BRIDGE_RESOURCE_HOSTS=none.invalid node bridge/relay.mjs --port 8010 --allow-private` (**every** host refused — with the default list the client's fallback URI, `http://resource.armagetronad.net/resource/gate/…`, would be fetched from the real repository; Review Focus 5) | console has `[RESOURCE] 403 http://127.0.0.1:8009/gate/resource/sumo_gate-0.1.0.aamap.xml` **and** `[RESOURCE] 403 http://resource.armagetronad.net/resource/gate/resource/sumo_gate-0.1.0.aamap.xml` (the fallback, refused locally), and no `[RESOURCE]` line with any other status; screenshot `r1-end` shows the failure screen; relay log has `resource 403` and no `resource 200`/`404`; console does **not** show `Return value 0` (Review Focus 1 and 3) |

Container start, for both arms:

```sh
docker rm -f aa-server >/dev/null 2>&1 || true
docker run -d --name aa-server -p 4534:4534/udp \
  -v "$ROOT/bridge/test-server/resource-var:/gatevar:ro" \
  -v "$ROOT/bridge/test-server/resource-repo:/data/resource/automatic:ro" \
  aa-dedicated /opt/aa/bin/armagetronad-dedicated --userdatadir /data --vardir /gatevar
```

Plus `python3 -m http.server 8009 --directory bridge/test-server/resource-repo` in the background, killed on exit (`trap`). Require the static page server on 8008 as `run-bridge-b6.sh` does, and the page URL `http://localhost:8008/armagetronad.html?bridge=ws://127.0.0.1:8010` (numeric relay address — see `bridge-gate.steps` on `localhost` vs `127.0.0.1`).

**Fresh profile per arm** — the `download` arm caches the map in IndexedDB, which would make a later arm pass or fail for the wrong reason. `drive-browser.mjs` starts a fresh profile per run; confirm that in its source and say so in the script's header. Print `PASS`/`FAIL` per check and exit non-zero on any FAIL; run `shellcheck` clean (CI runs it on `web/tools/*.sh`).

- [ ] **Step 5: Run it — the refused arm first, so the gate is shown able to fail**

```sh
docker stop aa-server 2>/dev/null; (cd bridge && npm test) # suite green before the gate
python3 -m http.server 8008 --directory web/dist-m1 &
sh web/tools/run-resource-gate.sh docs/evidence/map-downloads/refused refused
sh web/tools/run-resource-gate.sh docs/evidence/map-downloads/download download
```
Expected: both print PASS on every check. Look at `r1-end.png` in each directory yourself — the refused one must show "Map load failure" with a 403 line; the download one must show the arena.

- [ ] **Step 6: Evidence README**

`docs/evidence/map-downloads/README.md`: what was run (the exact commands above), the date, the per-check PASS lines, the two screenshots, and one paragraph on what the gate does **not** show (it never touches `resource.armagetronad.net` or the Fly relay; the published page is covered by Task 6's manual check).

- [ ] **Step 7: Commit**

```bash
git add bridge/test-server/resource-repo bridge/test-server/resource-var web/tools/resource-gate.steps web/tools/run-resource-gate.sh docs/evidence/map-downloads
git commit -F /tmp/msg-task4.txt   # "gate: join a server whose map is not bundled"
```

---

### Task 5: The bundle of popular maps

**Files:**
- Create: `web/resource-bundle.txt`
- Create: `web/tools/fetch-resource-bundle.sh`
- Create: `web/resource-bundle/…` (fetched files, committed)
- Modify: `web/Makefile` (`CLIENT_LDFLAGS` preload; link-rule prerequisites)
- Modify: `web/tools/run-resource-gate.sh` (new `bundled` arm)
- Modify: `docs/development.md` (section "Bundled maps")

**Interfaces:**
- Consumes: the engine's resource read path `/data/resource` (third entry in `tPathResource::Paths`, `src/tools/tDirectories.cpp`) — searched before any download.
- Produces: `sh web/tools/fetch-resource-bundle.sh` — idempotent; rewrites `web/resource-bundle/` from `web/resource-bundle.txt`.

**Why `/data/resource` and not `/data/resource/automatic`:** the page passes `--userdatadir /persist`, so the first read path is `/persist/resource/automatic` and `/data/resource/automatic` is never searched. `/data/resource` is. `resource/included` is already preloaded to `/data/resource/included`; the bundle's paths never start with `included/`, so the two trees do not overlap (the script refuses such an entry).

- [ ] **Step 1: Seed the list**

`web/resource-bundle.txt`:

```
# Maps preloaded into the browser build so joining these servers needs no
# download. One repository path per line, relative to
# http://resource.armagetronad.net/resource/ -- always a VERSIONED file name,
# so a bundled copy can never be stale for its own path.
#
# How to find candidates: the relay logs every map it serves
# (bridge/README.md, "Map downloads"). Anything requested often belongs here.
# Refresh the files with: sh web/tools/fetch-resource-bundle.sh
tourney/sumobar/8player_sumo-1.aamap.xml
```

Add further entries only with evidence (relay logs, or a native client's `var/resource/automatic` after visiting the busiest servers in the in-game browser) — list the source for each addition in the commit message. **Redistribution:** committing a map and serving it from GitHub Pages redistributes it. Before adding an entry, read the map's header comment/author note for license terms; if it forbids redistribution or says nothing and the author is reachable, leave it out (it still downloads on demand). Record what each map's header says in the commit message.

- [ ] **Step 2: Check the repository's scheme, then write `web/tools/fetch-resource-bundle.sh`**

First: `curl -sS -o /dev/null -w '%{http_code}\n' --max-time 20 https://resource.armagetronad.net/resource/tourney/sumobar/8player_sumo-1.aamap.xml`. If that is not `200`, repeat with `http://`; use whichever scheme answered `200` for `REPO` below (and say which in the script's header). `xmllint` validates the content either way.

```sh
#!/bin/sh
# sh web/tools/fetch-resource-bundle.sh
#
# Rewrites web/resource-bundle/ from web/resource-bundle.txt. Run from the
# repository root. The fetched files are COMMITTED: the build stays offline
# and reproducible, like every other preloaded file.
set -eu
REPO=https://resource.armagetronad.net/resource
LIST=web/resource-bundle.txt
OUT=web/resource-bundle
[ -f "$LIST" ] || { echo "run me from the repository root" >&2; exit 2; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
grep -v '^[[:space:]]*#' "$LIST" | grep -v '^[[:space:]]*$' | while read -r path; do
  case $path in
    /*|*..*|included/*) echo "REFUSING $path: absolute, '..' or under included/" >&2; exit 1;;
  esac
  # reject unversioned paths: <name>-<version>.<ext>.xml
  echo "$path" | grep -Eq -- '-[0-9][0-9A-Za-z._]*\.[a-z]+\.xml$' \
    || { echo "REFUSING $path: no version in the file name" >&2; exit 1; }
  mkdir -p "$TMP/$(dirname "$path")"
  curl -fsS --max-time 30 -o "$TMP/$path" "$REPO/$path"
  xmllint --noout "$TMP/$path"
  echo "ok  $(wc -c < "$TMP/$path") $path"
done
rm -rf "$OUT"
mv "$TMP" "$OUT"
trap - EXIT
```

(The `while` loop runs in a subshell, so its `exit 1` fails the pipeline; `set -e` then stops before `rm -rf "$OUT"`. Verify this by adding a bad line temporarily in Step 3.)

- [ ] **Step 3: Run it, including a refusal**

```sh
printf 'bad/unversioned.aamap.xml\n' >> web/resource-bundle.txt
sh web/tools/fetch-resource-bundle.sh; echo "exit $?"
git checkout web/resource-bundle.txt
sh web/tools/fetch-resource-bundle.sh
```
Expected: first run prints `REFUSING bad/unversioned…`, exits non-zero, and `web/resource-bundle/` does not exist yet. Second run prints `ok  <bytes> tourney/sumobar/8player_sumo-1.aamap.xml` and creates the file. `shellcheck web/tools/fetch-resource-bundle.sh` is clean.

- [ ] **Step 4: Preload it**

In `web/Makefile`:
1. `CLIENT_LDFLAGS`, after `--preload-file resource/included@/data/resource/included \`: `--preload-file web/resource-bundle@/data/resource \`
2. Define near the top-level variables: `RESOURCE_BUNDLE := $(shell find web/resource-bundle -type f)` and add `$(RESOURCE_BUNDLE) web/resource-bundle.txt` to the prerequisites of every link rule that lists `resource/included/.mapversion` (`grep -n "mapversion" web/Makefile`).
3. Comment beside the preload: why `/data/resource` (the paragraph under this task's Interfaces).

- [ ] **Step 5: Build and confirm the file is in the page's filesystem**

```sh
make -f web/Makefile client -j8
python3 -m http.server 8008 --directory web/dist-m1 &
node web/tools/drive-browser.mjs --out /tmp/bundle-check --script-file /dev/stdin <<'EOF'
wait:15000
eval:Module.FS.analyzePath('/data/resource/tourney/sumobar/8player_sumo-1.aamap.xml').exists
eval:Module.FS.analyzePath('/data/resource/included').exists
EOF
make -f web/Makefile dedicated -j8 && md5 web/dist-m0/armagetronad-dedicated.wasm
```
Expected: `true`, `true`; dedicated md5 unchanged (`9718a2a6…`). If `drive-browser.mjs` does not accept `/dev/stdin`, write the steps to a temp file.

- [ ] **Step 6: Add the `bundled` gate arm**

In `web/tools/run-resource-gate.sh`, add arm `bundled`:
- server config: a second var dir `bridge/test-server/resource-var-bundled/autoexec.cfg` with `MAP_FILE tourney/sumobar/8player_sumo-1.aamap.xml` (and no repository line); mount `web/resource-bundle` at `/data/resource/automatic:ro` so the **server** has the map;
- relay: `BRIDGE_RESOURCE_HOSTS=none.invalid` (so any download attempt is refused locally — the default list would let a fallback reach the real repository);
- PASS requires: **no** `[RESOURCE]` line in the console at all, no `Map load failure`, server log shows the join.

Run it: `sh web/tools/run-resource-gate.sh docs/evidence/map-downloads/bundled bundled` → PASS. Add the arm to the evidence README.

- [ ] **Step 7: Docs**

`docs/development.md`, section **"Bundled maps"**: what the bundle is, where it lands and why (`/data/resource`), how to add a map (edit the list, run the script, commit both), how to find candidates (relay log command from `bridge/README.md`), and that a missing map is only a download, never a failure.

In `PLAN.md`, the libxml2 row of the build-strategy table says "runtime HTTP fails gracefully → bundled maps": append a dated correction in the document's existing style — **corrected 2026-09-30:** runtime HTTP did not fail gracefully (status 0, "Return value 0 != 200"); map downloads now go through the relay's `/resource` route, with a preloaded bundle in front; see this plan.

- [ ] **Step 8: Commit**

```bash
git add web/resource-bundle.txt web/tools/fetch-resource-bundle.sh web/resource-bundle web/Makefile web/tools/run-resource-gate.sh bridge/test-server/resource-var-bundled docs/development.md PLAN.md docs/evidence/map-downloads
git commit -F /tmp/msg-task5.txt   # "web: bundle popular server maps"
```

---

### Task 6: After merge — the published page (maintainer, manual)

Merging deploys the relay to Fly (`.github/workflows/deploy-relay.yml`) and the page to GitHub Pages. This task needs the maintainer's go, because it touches the live relay and a third-party server.

- [ ] **Step 1:** Confirm the deployed relay has the route: `curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://escapedcat.github.io' 'https://armagetronad-bridge.fly.dev/resource?url=http%3A%2F%2Fresource.armagetronad.net%2Fresource%2Ftourney%2Fsumobar%2F8player_sumo-1.aamap.xml'` → `200`; the same without the Origin header → `404`.
- [ ] **Step 2:** On `https://escapedcat.github.io/…`, in a fresh private window, join a server running a map that is in neither `resource/included` nor the bundle. Expected: a short "Downloading…" then the arena; the browser console shows `[RESOURCE] 200 …`. Reload and rejoin: no `[RESOURCE]` line (cached in IndexedDB).
- [ ] **Step 3:** Join the sumobar server from the original report: no `[RESOURCE]` line at all (bundled).
- [ ] **Step 4:** Record the three results in `docs/evidence/map-downloads/README.md` under "Published page" and commit.
