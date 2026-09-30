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
      // An empty "map" would be cached by the page as a successful download
      // and then fail to parse on every join, for good; refuse it here.
      if (n === 0) return { status: 502, reason: 'upstream answered 200 with an empty body' };
      return { status: 200, body: Buffer.concat(chunks) };
    }
    return { status: 502, reason: 'too many redirects' };
  } catch (e) {
    if (signal.aborted) return { status: 504, reason: 'upstream did not answer within ' + timeoutMs + ' ms' };
    return { status: 502, reason: 'upstream unreachable: ' + (e.cause?.code || e.message) };
  }
}
