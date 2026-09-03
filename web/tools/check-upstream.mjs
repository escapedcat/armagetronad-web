#!/usr/bin/env node
// Report how far this fork has drifted from upstream, and -- the part that
// matters -- which upstream commits touch files this port has patched.
//
// WHY NOT JUST "N NEW COMMITS". legacy_0.2.9 is a maintenance branch; a bare
// count is noise. What decides whether an upstream commit costs anything here
// is whether it lands on one of the ~18 shared files this port has modified.
// Everything else merges without anyone reading it.
//
// PLAN.md froze upstream tracking until the Demo shipped, precisely so that
// merges would not land rebase noise on the files being patched. The Demo has
// shipped, so this is the tool that resumes tracking.
//
// Runs locally with no arguments. CI passes --json.

import { execFileSync } from 'node:child_process';

const UPSTREAM_URL = 'https://gitlab.com/armagetronad/armagetronad.git';
const BRANCH = 'legacy_0.2.9';

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const gitLines = (...a) => git(...a).split('\n').filter(Boolean);

// The port's own files live under src/emscripten/ and cannot conflict: upstream
// has never heard of them. Excluded from the conflict surface, counted
// separately so the number is explainable rather than just smaller.
const isOurs = (f) => f.startsWith('src/emscripten/');

function main() {
    const json = process.argv.includes('--json');

    if (!git('remote').split('\n').includes('upstream')) {
        execFileSync('git', ['remote', 'add', 'upstream', UPSTREAM_URL]);
    }
    execFileSync('git', ['fetch', '--quiet', 'upstream', BRANCH]);

    const base = git('merge-base', 'HEAD', `upstream/${BRANCH}`);
    const behind = gitLines('rev-list', `HEAD..upstream/${BRANCH}`);

    // Files this port has changed relative to the shared base. Recomputed every
    // run rather than hardcoded, because the port grows: M5 added rViewport.cpp
    // and gMenus.cpp to this set, and a hardcoded list would have gone stale
    // silently and under-reported the conflict surface.
    const touchedByUs = gitLines('diff', '--name-only', base, 'HEAD', '--', 'src/', 'config/');
    const shared = touchedByUs.filter((f) => !isOurs(f));

    const interesting = [];
    for (const sha of behind) {
        const files = gitLines('show', '--pretty=format:', '--name-only', sha);
        const hits = files.filter((f) => shared.includes(f));
        if (hits.length) {
            interesting.push({ sha, subject: git('log', '-1', '--format=%s', sha), files: hits });
        }
    }

    const out = {
        upstream: `${UPSTREAM_URL}#${BRANCH}`,
        base,
        upstreamHead: git('rev-parse', `upstream/${BRANCH}`),
        commitsBehind: behind.length,
        patchedShared: shared.length,
        patchedOurs: touchedByUs.length - shared.length,
        conflicting: interesting,
    };

    if (json) { console.log(JSON.stringify(out, null, 2)); return out.conflicting.length ? 1 : 0; }

    console.log(`upstream        ${out.upstream}`);
    console.log(`shared base     ${base.slice(0, 12)}`);
    console.log(`upstream head   ${out.upstreamHead.slice(0, 12)}`);
    console.log(`commits behind  ${out.commitsBehind}`);
    console.log(`files patched   ${out.patchedShared} shared with upstream, ${out.patchedOurs} ours alone`);
    console.log('');

    if (!out.commitsBehind) { console.log('Up to date with upstream. Nothing to do.'); return 0; }
    if (!interesting.length) {
        console.log(`${out.commitsBehind} upstream commit(s), none touching a file this port has patched.`);
        console.log('A merge should be uneventful.');
        return 0;
    }

    console.log(`${interesting.length} of ${out.commitsBehind} upstream commit(s) touch files this port has patched:`);
    console.log('');
    for (const c of interesting) {
        console.log(`  ${c.sha.slice(0, 12)}  ${c.subject}`);
        for (const f of c.files) console.log(`      ${f}`);
    }
    return 1;
}

process.exit(main());
