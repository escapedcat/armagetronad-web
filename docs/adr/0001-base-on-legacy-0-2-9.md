# Base the port on legacy_0.2.9, frozen until Phase 1 ships

The port is built on upstream's `legacy_0.2.9` branch — not `trunk` (0.4) and not `legacy_0.2.8.3`. `legacy_0.2.9` is the only line that is simultaneously light on dependencies (SDL 1.2, no Boost/protobuf — the facts the entire wasm feasibility case rests on) and still receiving upstream commits, which keeps a future upstream merge request plausible. `trunk` pulls in protobuf and heavier dependencies and has been unstable for years; `0.2.8.3` is the most battle-tested line but no longer where legacy fixes land.

## Consequences

`main` stays frozen at its current base commit until the Demo ships (M5): mid-port merges from upstream would land rebase noise on exactly the files being patched, for fixes the Demo doesn't need. Upstream tracking resumes after M5.
