// The limit primitives on their own, with a clock the test moves by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bucket, destinationWindow, ipCounter, originAllowed, parseOrigins } from '../limits.mjs';

const clock = () => { let t = 0; const now = () => t; now.advance = (ms) => { t += ms; }; return now; };

test('a bucket allows its burst at once, then only its rate', () => {
  const now = clock();
  const b = bucket(10, 5, now);
  for (let i = 0; i < 5; i++) assert.equal(b.take(), true, 'take ' + i + ' is inside the burst');
  assert.equal(b.take(), false, 'the burst is spent');
  now.advance(100); // 10/s for 0.1 s = one token
  assert.equal(b.take(), true);
  assert.equal(b.take(), false);
  now.advance(60_000);
  for (let i = 0; i < 5; i++) assert.equal(b.take(), true);
  assert.equal(b.take(), false, 'an idle bucket refills only up to its burst');
});

test('a bucket takes sizes, not just counts', () => {
  const now = clock();
  const b = bucket(1000, 1500, now);
  assert.equal(b.take(1400), true);
  assert.equal(b.take(200), false);
  assert.equal(b.take(100), true);
});

test('the destination window caps NEW destinations, never ones already in use', () => {
  const now = clock();
  const w = destinationWindow(3, now);
  assert.equal(w.allow('a:1'), true);
  assert.equal(w.allow('b:1'), true);
  assert.equal(w.allow('c:1'), true);
  assert.equal(w.allow('d:1'), false, 'a fourth new destination is over the cap');
  assert.equal(w.allow('a:1'), true, 'a destination already in use keeps working');
  assert.equal(w.allow('a:2'), false, 'the same host on another port is a new destination');
});

test('the destination window forgets a destination a minute after its last use', () => {
  const now = clock();
  const w = destinationWindow(2, now);
  w.allow('a:1');
  now.advance(30_000);
  w.allow('b:1');
  now.advance(30_000); // a:1 last used 60 s ago
  assert.equal(w.allow('c:1'), true, 'a:1 has aged out, so there is room');
  assert.equal(w.allow('d:1'), false, 'b:1 (30 s old) and c:1 still fill the window');
});

test('the IP counter caps each address separately and gives slots back', () => {
  const c = ipCounter(2);
  assert.equal(c.tryOpen('1.1.1.1'), true);
  assert.equal(c.tryOpen('1.1.1.1'), true);
  assert.equal(c.tryOpen('1.1.1.1'), false);
  assert.equal(c.tryOpen('2.2.2.2'), true, 'another address has its own allowance');
  c.close('1.1.1.1');
  assert.equal(c.tryOpen('1.1.1.1'), true);
  c.close('2.2.2.2');
  assert.equal(c.count('2.2.2.2'), 0);
});

test('origins match exactly, or on any port with the :* form', () => {
  const list = ['https://escapedcat.github.io', 'http://localhost:*'];
  assert.equal(originAllowed('https://escapedcat.github.io', list), true);
  assert.equal(originAllowed('http://localhost:8008', list), true);
  assert.equal(originAllowed('http://localhost', list), true);
  for (const bad of [
    'http://escapedcat.github.io',            // wrong scheme
    'https://escapedcat.github.io.evil.test', // suffix trick
    'https://evil.test',
    'http://localhost.evil.test',
    'http://localhost:80x',
    'https://localhost:8008',
    '',
    undefined,
    'null',                                   // what a sandboxed page sends
  ]) {
    assert.equal(originAllowed(bad, list), false, JSON.stringify(bad) + ' must be refused');
  }
});

test('an origin list is read from comma-separated text', () => {
  assert.deepEqual(parseOrigins(' https://a.test , http://localhost:*,,'), ['https://a.test', 'http://localhost:*']);
  assert.deepEqual(parseOrigins(undefined), []);
});
