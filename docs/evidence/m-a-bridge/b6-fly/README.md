# B6 through the Fly relay — PASSED, 2026-09-29

The gate B6 failed three times from this machine in September (see `../b6/`):
150 datagrams to three community servers, zero back. The cause was this
machine's NymVPN mixnet tunnel, whose exits drop UDP to game ports. This run
moves the UDP leg off this machine: the relay runs on Fly.io in `fra`, and the
browser reaches it over `wss://` on 443, which the tunnel carries.

**Server:** bob's | DEFAULT SETTINGS [EU], `188.245.106.232:4537` — not owned
by this project. The Fly relay cannot reach the local test container (stopped,
and on another machine) and runs without `--allow-private`, so the peer can
only have been the community server; the page logged it as
`peer 188.245.106.232 -> 188.245.106.232 (literal)`.

**Verdict:** `B6 a-full-round-on-a-server-this-project-does-not-own` —
`"PASS":true`. Two rounds started, one scored (`ROUND_SCORE_TEAM -4 web_user`),
zero dropped datagrams, zero send failures, zero new relay errors. `B6-LEFT`
also passes: the page leaves the server and keeps running.

**Round trip, page to server and back (ack-paired, n=76):** min 64.2 ms,
p50 66.8 ms, p90 76 ms, p99 111.7 ms, max 111.7 ms. This includes the mixnet
on the browser-to-Fly leg, so it is an upper bound for an ordinary connection.
220 datagrams out, 256 in, zero parse failures. The GAPS figures in the log
(p99 927 ms) are inter-arrival gaps including between-round quiet, not stalls.

**Not a clean first attempt, and why:** the first run was refused by the
page's own bridge probe ("relay did not answer"). Connection setup to Fly
through the mixnet measured 570-1877 ms across four probes and occasionally
never completed; the menu probe budget is 1500 ms (`sg_menuProbeMs`), tuned
against a local relay. On an ordinary connection setup is tens of
milliseconds. Whether to raise the budget is an open question, not settled
here.

**Token:** the relay requires a shared secret in the URL path. Every log here
had it replaced with `<token>` before commit.

`relay-fly.log` is the relay's own log (`fly logs`), health-check lines
removed. Screenshots 01-20 are the gate's walk, 11 on the grid.
