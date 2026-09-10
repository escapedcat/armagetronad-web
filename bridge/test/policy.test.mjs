import test from 'node:test';
import assert from 'node:assert/strict';
import { checkDestination } from '../policy.mjs';

test('a public address on the game port range is allowed', () => {
  assert.equal(checkDestination('167.114.115.128', 4534), null);
  assert.equal(checkDestination('167.114.115.128', 4533), null);
  assert.equal(checkDestination('167.114.115.128', 4599), null);
});

test('ports outside 4533-4599 are refused', () => {
  assert.match(checkDestination('167.114.115.128', 22), /port/);
  assert.match(checkDestination('167.114.115.128', 4600), /port/);
  assert.match(checkDestination('167.114.115.128', 4532), /port/);
});

test('private, loopback, link-local and multicast ranges are refused by default', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.10', '172.16.0.1', '172.31.255.254', '169.254.1.1', '0.0.0.0', '224.0.0.1', '239.1.2.3']) {
    assert.match(checkDestination(ip, 4534), /not allowed/, ip + ' should be refused');
  }
});

test('172.32.0.1 is public and must not be caught by the 172.16/12 rule', () => {
  assert.equal(checkDestination('172.32.0.1', 4534), null);
});

test('allowPrivate lifts the address rule but never the port rule', () => {
  assert.equal(checkDestination('127.0.0.1', 4534, { allowPrivate: true }), null);
  assert.match(checkDestination('127.0.0.1', 22, { allowPrivate: true }), /port/);
});
