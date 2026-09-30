# Map downloads — the browser gate

**2026-09-30.** The browser client joins a server whose map it does not have,
and has to download that map through the relay's `/resource` route
(`bridge/resource.mjs`, `web/library_resource.js`,
`src/emscripten/eWebFetch.cpp`). Plan:
`docs/superpowers/plans/2026-09-30-map-downloads.md`, Task 4.

## What was run

```sh
docker build -t aa-dedicated -f bridge/test-server/Dockerfile .
python3 -m http.server 8008 --directory web/dist-m1 &
sh web/tools/run-resource-gate.sh docs/evidence/map-downloads/refused  refused
sh web/tools/run-resource-gate.sh docs/evidence/map-downloads/download download
sh web/tools/run-resource-gate.sh docs/evidence/map-downloads/bundled  bundled
```

All three arms ran on the final build of the branch, after the two fixes
described below ("The first run" and "The final review"). Each directory holds the arm's `verdict.txt` (the runner's
PASS/FAIL lines), the page's `console.log`, `relay.log`, `server.log`,
`repo.log` (the stand-in repository's access log) and `r1-end.png`.

## The arms

| arm | relay may fetch from | result |
|---|---|---|
| `refused` | nowhere (`BRIDGE_RESOURCE_HOSTS=none.invalid`) | 9/9 PASS |
| `download` | `127.0.0.1:8009` only, the stand-in repository | 10/10 PASS |
| `bundled` | nowhere — the server's map is in the client's bundle | 5/5 PASS |

**`refused`.** The client tried two addresses, in the engine's order: the
server's repository, then its own, which is always the official one. The relay
refused both locally, and the page read the refusal, not a status 0:

    [RESOURCE] 403 http://127.0.0.1:8009/gate/resource/sumo_gate-0.1.0.aamap.xml (host 127.0.0.1:8009 is not an allowed resource host)
    [RESOURCE] 403 http://resource.armagetronad.net/resource/gate/resource/sumo_gate-0.1.0.aamap.xml (host resource.armagetronad.net is not an allowed resource host)

`r1-end.png` is the game's failure screen. Its log now reads
"ERROR: Return value 403 != 200." twice, where players used to see
"Return value 0 != 200".

**`download`.** One fetch, 4,618 bytes, and the cached copy under
`/persist/resource/automatic/` is the whole file. The stand-in repository
answers after 3 s (`web/tools/slow-static-server.py`), and a sampler polled
the save path every 25 ms during the join: no empty file ever sat there
(`sawEmpty=false`). `r1-end.png` shows the round
being played on the downloaded map.

**`bundled`.** The server runs `tourney/sumobar/8player_sumo-1`, the one map
in `web/resource-bundle.txt`. The page logged no `[RESOURCE]` line at all,
the relay was never asked, and `r1-end.png` shows a round on the sumo map. An
early version of this check matched the harness's own "until … [RESOURCE]"
line in the same transcript; it now reads only the page's `[console.log]`
lines, and was shown to fail on the download arm's transcript.

## The first run, and why the gate has a size check

The first `download` run passed every check the runner had then, and
`first-run-empty-map/r1-end.png` shows "Map load failure — Document is
empty". Under Asyncify a suspending JS import is called twice: once to start
the work, and once more when the stack resumes. `aa_resource_fetch` zeroed its
output pointer and length **outside** the async part, so the second call wiped
the buffer the first had filled. The game got "200, 0 bytes", printed "OK" and
saved an empty file.

Two changes came out of it:

- `web/library_resource.js` does all its side effects inside the async part.
- `bridge/test/library-resource.test.mjs` now models Asyncify's two calls.
  It failed on the old code (`expected '<Map/>', actual null`) and passes on
  the fix.

The runner also compares the cached file's size with the original. On the old
build that check failed (`cachedBytes=0`; `first-run-empty-map/verdict.txt`),
and on the fixed build it passes.

## What this gate does not show

- **Nothing here touches `resource.armagetronad.net` or the Fly relay.** The
  refused arm's fallback address is refused by the relay before any request
  leaves the machine. The server gets the DTDs and default maps copied in
  from this repo, so it downloads nothing either; the runner checks that.
- **The published page is covered by the plan's Task 6**, a manual check after
  the merge.
- **The failure text is read from the screenshot, not checked automatically.**
  The game's own console never reaches the browser console, so no automated
  check can read "Map load failure". `r1-end.png` in each arm is the evidence
  for what the player sees.
- **The gate runs headless**, with a filter that drops headless Chrome's
  spurious `Unidentified` key events; see the header of
  `web/tools/resource-gate.steps`.

## The final review, and why the gate has a sampler

The whole-branch review found that the game created the map file **before**
downloading it (native `myHTTPFetch` opens the `std::ofstream` first). In the
browser that file lives on the IndexedDB mount, which persists every file the
moment it is created, and the download suspends for the whole round trip. So
an empty file was persisted during every download, and a reload mid-download
kept it for good: the next join found it "in the cache", never downloaded, and
failed to load that map in that browser until site data was cleared.

The sampler was added first, and on the unfixed build it saw the empty file
(`=> "sawEmpty=true"`, while every other check passed). The web client's
`myHTTPFetch` now downloads into memory and creates the file only once the
whole map is in hand; an empty body is an error. The relay also refuses an
empty upstream 200 (`502`), unit-tested. With the fix: `sawEmpty=false`.

The sampler check reads the eval's **result** line (`=> "sawEmpty=…"`): the
harness also logs each eval's source, and the sampler's source contains the
text `__sawEmpty=false`. The first version of the check matched that line and
passed on the broken build.
