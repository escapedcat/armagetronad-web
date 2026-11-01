// web/tools/check-upstream.mjs: the upstream PR body puts what matters first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, conflictedFiles, renderMarkdown, HEAD_MARKER } from '../tools/check-upstream.mjs';

const c = (sha, subject, files, body = '') => ({ sha: sha.padEnd(40, '0'), subject, body, files });

test('a network fix in a file we never patched is still reported, first', () => {
  // The miss that started this: upstream's netobject owner check landed in
  // src/network/nNetObject.cpp, which the port has not touched, so the old
  // report (patched files only) left it out.
  const { security, patched, other } = classify([
    c('444c418b', 'Check object owner when destroying netobject', ['src/network/nNetObject.cpp']),
    c('672050f3', 'Lower default MAX_FPS in debug mode', ['src/render/rSysdep.cpp']),
    c('be988e83', 'Integrate conan deeper into builds', ['conanfile.py']),
  ], ['src/render/rSysdep.cpp']);
  assert.deepEqual(security.map((x) => x.subject), ['Check object owner when destroying netobject']);
  assert.deepEqual(patched.map((x) => x.subject), ['Lower default MAX_FPS in debug mode']);
  assert.deepEqual(other.map((x) => x.subject), ['Integrate conan deeper into builds']);
});

test('security words in the subject or body count, wherever the file is', () => {
  const { security } = classify([
    c('a', 'manual cherry pick of safety from sty', ['src/tools/tResourceManager.cpp']),
    c('b', 'Tidy', ['src/ui/uMenu.cpp'], 'Fixes a buffer overflow in the menu'),
    c('c', 'Reordering', ['configure.ac']),
  ], []);
  assert.deepEqual(security.map((x) => x.sha[0]), ['a', 'b']);
});

test('every commit lands in exactly one list, and a patched hit names its files', () => {
  const commits = [
    c('a', 'Fix crash on exit', ['src/render/rSysdep.cpp', 'NEWS']),
    c('b', 'Update doc', ['NEWS']),
  ];
  const r = classify(commits, ['src/render/rSysdep.cpp']);
  assert.equal(r.security.length + r.patched.length + r.other.length, commits.length);
  assert.deepEqual(r.security[0].patchedFiles, ['src/render/rSysdep.cpp']);
});

test('merge-tree output: conflicted file names, nothing for a clean merge', () => {
  const out = 'abc123tree\nsrc/render/rSysdep.cpp\n\nAuto-merging src/render/rSysdep.cpp\nCONFLICT (content): ...\n';
  assert.deepEqual(conflictedFiles(out, 1), ['src/render/rSysdep.cpp']);
  assert.deepEqual(conflictedFiles('abc123tree\n', 0), []);
});

const report = (over = {}) => ({
  branch: 'legacy_0.2.9',
  upstream: 'https://gitlab.com/armagetronad/armagetronad.git#legacy_0.2.9',
  base: 'b'.repeat(40), upstreamHead: 'f'.repeat(40), commitsBehind: 3,
  security: [{ ...c('444c418b', 'Check object owner', ['src/network/nNetObject.cpp']), patchedFiles: [] }],
  patched: [{ ...c('672050f3', 'Lower MAX_FPS', ['src/render/rSysdep.cpp']), patchedFiles: ['src/render/rSysdep.cpp'] }],
  other: [{ ...c('be988e83', 'conan', ['conanfile.py']), patchedFiles: [] }],
  tags: ['v0.2.9.3.1'], conflicts: [],
  ...over,
});

test('the PR body leads with security, then patched files, and carries the upstream head', () => {
  const md = renderMarkdown(report());
  const at = (s) => { const i = md.indexOf(s); assert.ok(i >= 0, `missing: ${s}`); return i; };
  assert.ok(at('Check object owner') < at('Lower MAX_FPS'));
  assert.ok(at('Lower MAX_FPS') < at('conan'));
  at('v0.2.9.3.1');
  at(`${HEAD_MARKER}${'f'.repeat(40)}`);
});

test('a conflicted merge says so and names the files', () => {
  const md = renderMarkdown(report({ conflicts: ['src/render/rSysdep.cpp'] }));
  assert.match(md, /conflict/i);
  assert.match(md, /src\/render\/rSysdep\.cpp/);
});

test('empty sections are left out rather than shown as "none"', () => {
  const md = renderMarkdown(report({ security: [], tags: [] }));
  assert.doesNotMatch(md, /Security/);
  assert.doesNotMatch(md, /release tag/i);
});
