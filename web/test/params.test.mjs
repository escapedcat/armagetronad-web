// web/page/params.js: the page's URL parameters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPageModule } from './load-page-module.mjs';

const P = loadPageModule('web/page/params.js', 'AAParams', { URLSearchParams });

test('number: absent, in range, out of range (ignored under the feature\'s tag, never clamped)', () => {
  assert.deepEqual({ ...P.number('', '[DISPLAY]', 'dpr', 0.05, 8) }, { value: null, ignored: null });
  assert.deepEqual({ ...P.number('?dpr=1.5', '[DISPLAY]', 'dpr', 0.05, 8) }, { value: 1.5, ignored: null });
  assert.deepEqual({ ...P.number('?dpr=9', '[DISPLAY]', 'dpr', 0.05, 8) },
    { value: null, ignored: '[DISPLAY] ?dpr=9 ignored (want 0.05..8)' });
  assert.equal(P.number('?sparks=2', '[SPARKS]', 'sparks', 0, 1).ignored, '[SPARKS] ?sparks=2 ignored (want 0..1)');
  assert.equal(P.number('?cam=abc', '[CAMERA]', 'cam', 0.15, 4).value, null);
});
