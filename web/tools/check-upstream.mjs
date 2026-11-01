#!/usr/bin/env node
// Report how far this fork has drifted from upstream, sorted by what an
// upstream commit could cost this port.
//
// WHY NOT JUST "N NEW COMMITS". legacy_0.2.9 is a maintenance branch; a bare
// count is noise nobody reads. So every upstream commit lands in one of three
// lists, most important first:
//   security -- touches src/network/ or says security/cheat/crash/overflow/...
//               in its message. Listed WHEREVER the file is: the first version
//               of this tool only reported files the port had patched, and so
//               left out upstream's netobject owner check (nNetObject.cpp,
//               which the port never touched) while our dedicated wasm and the
//               bridge both run that code.
//   patched  -- touches a file this port has patched; a merge makes someone
//               read these.
//   other    -- everything else.
// Plus new upstream release tags and whether a merge into HEAD conflicts.
//
// Runs locally with no arguments. --json for the raw report, --markdown for
// the body of the upstream-merge PR (web/tools/upstream-pr.sh).

import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const UPSTREAM_URL = 'https://gitlab.com/armagetronad/armagetronad.git';
const BRANCH = 'legacy_0.2.9';
// Release tags of this line. They are cut on release_0.2.9, not on
// legacy_0.2.9, so a tag can be new here before its commits reach BRANCH.
const TAG_GLOB = 'v0.2.9.*';

// The PR body carries the upstream head it was written for, so the next run
// can tell "nothing new" from "upstream moved" without any other state.
export const HEAD_MARKER = '<!-- upstream-head: ';

// The port's own files live under src/emscripten/ and cannot conflict: upstream
// has never heard of them.
const isOurs = (f) => f.startsWith('src/emscripten/');

const SECURITY_FILES = (f) => f.startsWith('src/network/');
const SECURITY_WORDS = /\b(security|secure|exploit|cheat\w*|crash\w*|overflow|out[- ]of[- ]bounds|safety|vulnerab\w*|CVE-\d+|injection|sanitiz\w*)\b/i;

// commits: [{ sha, subject, body, files }]; shared: files the port patched.
// Each commit lands in exactly one list; patchedFiles names its hits on shared.
export function classify(commits, shared) {
    const out = { security: [], patched: [], other: [] };
    for (const c of commits) {
        const patchedFiles = c.files.filter((f) => shared.includes(f));
        const entry = { ...c, patchedFiles };
        if (c.files.some(SECURITY_FILES) || SECURITY_WORDS.test(`${c.subject}\n${c.body}`)) out.security.push(entry);
        else if (patchedFiles.length) out.patched.push(entry);
        else out.other.push(entry);
    }
    return out;
}

// `git merge-tree --write-tree --name-only` prints the tree, then (exit 1 only)
// the conflicted file names up to a blank line, then the messages.
export function conflictedFiles(stdout, status) {
    if (status !== 1) return [];
    const lines = stdout.split('\n');
    const end = lines.indexOf('', 1);
    return lines.slice(1, end < 0 ? undefined : end).filter(Boolean);
}

const short = (sha) => sha.slice(0, 12);
const commitUrl = (sha) => `${UPSTREAM_URL.replace(/\.git$/, '')}/-/commit/${sha}`;

export function renderMarkdown(r) {
    const L = [];
    const list = (items) => {
        for (const c of items) {
            L.push(`- [\`${short(c.sha)}\`](${commitUrl(c.sha)}) ${c.subject}`);
            for (const f of c.patchedFiles) L.push(`  - patched here: \`${f}\``);
        }
        L.push('');
    };

    L.push(`Upstream \`${r.branch}\` is **${r.commitsBehind} commit(s)** ahead of this port.`);
    L.push('');
    if (r.conflicts.length) {
        L.push('> [!WARNING]');
        L.push('> **This merge conflicts**, so this PR is a draft on the plain upstream branch. Merge it locally, resolve these, and push to this branch:');
        for (const f of r.conflicts) L.push(`> - \`${f}\``);
    } else {
        L.push('This branch is `main` with upstream merged in; the checks below build it.');
    }
    L.push('');
    if (r.tags.length) {
        L.push(`**New upstream release tag(s):** ${r.tags.map((t) => `\`${t}\``).join(', ')}`);
        L.push('');
    }
    if (r.security.length) {
        L.push(`### Security-relevant (${r.security.length})`);
        L.push('Touches `src/network/` or mentions security, cheating, crashes or overflows. Read these first, even in files the port never patched: the dedicated wasm and the bridge run this code.');
        L.push('');
        list(r.security);
    }
    if (r.patched.length) {
        L.push(`### In files this port has patched (${r.patched.length})`);
        L.push('');
        list(r.patched);
    }
    if (r.other.length) {
        L.push('<details>');
        L.push(`<summary>Everything else (${r.other.length})</summary>`);
        L.push('');
        list(r.other);
        L.push('</details>');
        L.push('');
    }
    L.push('### Before merging');
    L.push('- Any change under `src/` moves the dedicated server byte pin: the pin check fails on purpose until it is re-recorded.');
    L.push('- Run the browser gates one suite at a time (docs/development.md).');
    L.push('');
    L.push(`Base \`${short(r.base)}\` → upstream \`${short(r.upstreamHead)}\`. Same report locally: \`node web/tools/check-upstream.mjs\`.`);
    L.push('');
    L.push(`${HEAD_MARKER}${r.upstreamHead} -->`);
    return L.join('\n');
}

function renderText(r) {
    const L = [
        `upstream        ${r.upstream}`,
        `shared base     ${short(r.base)}`,
        `upstream head   ${short(r.upstreamHead)}`,
        `commits behind  ${r.commitsBehind}`,
        `files patched   ${r.patchedShared} shared with upstream, ${r.patchedOurs} ours alone`,
        `merge           ${r.conflicts.length ? `CONFLICTS in ${r.conflicts.join(', ')}` : 'clean'}`,
    ];
    if (r.tags.length) L.push(`new tags        ${r.tags.join(', ')}`);
    L.push('');
    if (!r.commitsBehind) { L.push('Up to date with upstream. Nothing to do.'); return L.join('\n'); }
    for (const [name, items] of [['security-relevant', r.security], ['in patched files', r.patched], ['other', r.other]]) {
        if (!items.length) continue;
        L.push(`${name} (${items.length}):`);
        for (const c of items) {
            L.push(`  ${short(c.sha)}  ${c.subject}`);
            for (const f of c.patchedFiles) L.push(`      ${f}`);
        }
        L.push('');
    }
    return L.join('\n');
}

function collect() {
    const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
    const gitLines = (...a) => git(...a).split('\n').filter(Boolean);

    if (!git('remote').split('\n').includes('upstream')) {
        execFileSync('git', ['remote', 'add', 'upstream', UPSTREAM_URL]);
    }
    execFileSync('git', ['fetch', '--quiet', 'upstream', BRANCH,
        `+refs/tags/${TAG_GLOB}:refs/tags/${TAG_GLOB}`]);

    const upstream = `upstream/${BRANCH}`;
    const base = git('merge-base', 'HEAD', upstream);
    const behind = gitLines('rev-list', `HEAD..${upstream}`);

    // Files this port has changed relative to the shared base. Recomputed every
    // run rather than hardcoded, because the port grows.
    const touchedByUs = gitLines('diff', '--name-only', base, 'HEAD', '--', 'src/', 'config/');
    const shared = touchedByUs.filter((f) => !isOurs(f));

    const commits = behind.map((sha) => ({
        sha,
        subject: git('log', '-1', '--format=%s', sha),
        body: git('log', '-1', '--format=%b', sha),
        files: gitLines('show', '--pretty=format:', '--name-only', sha),
    }));

    const tags = gitLines('tag', '--list', TAG_GLOB, '--no-merged', 'HEAD', '--sort=version:refname');

    const mt = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', 'HEAD', upstream], { encoding: 'utf8' });
    if (mt.status !== 0 && mt.status !== 1) throw new Error(`git merge-tree failed: ${mt.stderr}`);

    return {
        branch: BRANCH,
        upstream: `${UPSTREAM_URL}#${BRANCH}`,
        base,
        upstreamHead: git('rev-parse', upstream),
        commitsBehind: behind.length,
        patchedShared: shared.length,
        patchedOurs: touchedByUs.length - shared.length,
        ...classify(commits, shared),
        tags,
        conflicts: conflictedFiles(mt.stdout, mt.status),
    };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const r = collect();
    if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
    else if (process.argv.includes('--markdown')) console.log(renderMarkdown(r));
    else console.log(renderText(r));
}
