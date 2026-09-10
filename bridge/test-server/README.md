# `aa-dedicated` — the local opponent the bridge gates play against

A stock Armagetron Advanced dedicated server, built from **this** source tree
inside Debian bookworm. It exists so `web/tools/bridge-gate.steps` can assert
a join and a finished round from the *server's* side, which is the only
evidence that a datagram actually made the trip; the browser client saying
"connected" is a statement about the browser.

## Build and run

From the **repository root** (the build context is the whole tree — the
Dockerfile lives here but cannot be built from here):

```bash
docker build -f bridge/test-server/Dockerfile -t aa-dedicated .
docker rm -f aa-server           # remove the previous one BY NAME
docker run -d --name aa-server -p 4534:4534/udp aa-dedicated
docker logs aa-server            # expect "Bound socket to *.*.*.*:4534."
```

### No `--rm`, and that is the point

`--rm` deletes the container the moment it exits — and with it the log, exactly
when the log is the only thing that would say why it exited. Task 3 lost a
crashed server's log to it once: every reading in the page was correct, the
connect simply got no answer, and `docker ps -a` said "No such container".
Remove the previous container **by name** before starting a new one instead;
then the last run's corpse is always still there to read.
`web/tools/run-steer-arm.sh` and `web/tools/run-bridge-loss-arm.sh` both do
exactly that.

### `bridge/test/relay.test.mjs` cannot run while this container is up

The unit test "a datagram reaches the server and the reply comes back with the
address echoed" binds a UDP echo server on `127.0.0.1:4534`, which is the port
this container publishes. With `aa-server` running that bind fails with
EADDRINUSE, and because the failure happens inside a test's setup, `node --test`
reports it as **nine cancelled tests** with `Promise resolution is still pending
but the event loop has already resolved` — a message that points nowhere near
the cause. Stop the container before running the suite:

```bash
docker stop aa-server && ( cd bridge && npm test ) && docker start aa-server
```

The image is ~5 minutes to build cold and seconds when Docker's layer cache
is warm. What invalidates the cache is `COPY . /src`, i.e. **any** change
anywhere in the tree, `docs/evidence/` included — so committing evidence
forces a full rebuild of the autotools tree next time. Build before you write
evidence, not after.

## What it is configured to do, and what it is not

`config/settings_dedicated.cfg` ships with `TALK_TO_MASTER 0` (line 117), so
this server does **not** announce itself to the public master servers. That
is checked, not assumed: a full `docker logs` of an idle run contains no
master traffic at all. Nothing about this container reaches the internet, and
nothing needs to — the client dials `127.0.0.1:4534`.

`SERVER_PORT 4534` (same file, line 89) is why the published port is 4534 and
why `CLIENT_PORT 4534` in `web/webdefaults/autoexec.cfg` matches it.

## python3 is a build dependency

`./configure` never probes for python and succeeds without it; the build then
fails much later, in `resource/`, with

```
python is
../batch/make/sortresources: 32: ../batch/make/sortresources.py: Permission denied
make[2]: *** [Makefile:514: included] Error 1
```

because `batch/make/sortresources` line 30 does
`PYTHON=$(which python3 python python2 ...)` and then runs `${PYTHON} ...py`
— with no python that is the empty string, so the shell tries to exec the
non-executable `.py` itself. The failure lands *after* `src/` has compiled and
linked cleanly, which makes it read like a packaging bug. `python3` is in the
`apt-get` line for this reason and must stay there.

## Docker Desktop's UDP proxy, and why it did not break this

Armagetron identifies a client by the source `ip:port` of its datagrams
(`nAddress::Compare`, and `nSocket`'s per-peer bookkeeping). Publishing UDP
with `-p 4534:4534/udp` on macOS puts Docker Desktop's userland proxy between
the relay's socket and the server, and a proxy is free to rewrite the source
endpoint — either so replies never find their way home, or so successive
datagrams from one client arrive with *different* source ports and the server
treats them as several clients.

Measured on this machine (Docker Desktop 29.4.0, Apple Silicon), it does
neither: the mapping is stable for the lifetime of the relay's socket, one
client stays one client, and the round completes. See
`docs/evidence/m-a-bridge/b1/` and `b2/` for the server-side logs.

**This is a property of the host, not of the port, so re-measure it rather
than assume it.** The symptom to watch for is a server log that shows a join
but a client that never gets a reply, or a server log that shows the same
player connecting repeatedly from ascending ports. The fallback if a machine
ever does that is a native dedicated build on the host with no Docker in the
path — a decision for the maintainer, not a workaround to bolt on here.
