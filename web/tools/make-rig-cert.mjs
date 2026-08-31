#!/usr/bin/env node
// Make a throwaway self-signed certificate for the local https rig, and print
// the SPKI hash Chrome needs to accept it WITHOUT entering a
// certificate-error state.
//
//   node web/tools/make-rig-cert.mjs /tmp/rig                  # CN=localhost
//   node web/tools/make-rig-cert.mjs /tmp/rig-demo demo.example
//
// The second argument exists for one control: `localhost` is a potentially
// trustworthy origin on its own, so a measurement taken only at
// https://localhost cannot by itself rule out that the hostname, rather than
// the scheme, produced the result. Pair a cert for an ordinary-looking name
// with Chrome's --host-resolver-rules=MAP <name> 127.0.0.1 and the rig serves
// an https origin that is trustworthy for no reason except its scheme.
//
// Writes key.pem, cert.pem and spki.txt into that directory and prints the
// base64 SHA-256 of the public key. Pass it to Chrome as
//
//   --ignore-certificate-errors-spki-list=<that value>
//
// WHY NOT --ignore-certificate-errors. That flag suppresses the error but
// leaves the tab in a "certificate error" security state, which is a DIFFERENT
// state from a normal https page and is not what a visitor to a Pages URL
// gets. The SPKI list makes Chrome treat this specific key as valid, so the
// page is an ordinary secure page and the only remaining difference from Pages
// is the hostname and the absence of a CDN.
//
// NOTHING HERE IS COMMITTED. The key and cert go to a scratch directory on
// purpose: a committed private key is a committed private key even when it is
// only good for localhost.
//
// openssl is used rather than a JS X.509 library so this file has no
// dependencies. macOS ships LibreSSL, which supports -addext.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const host = process.argv[3] || 'localhost';
if (!dir) throw new Error('usage: make-rig-cert.mjs <output-dir> [hostname]');
mkdirSync(dir, { recursive: true });

const key = join(dir, 'key.pem');
const cert = join(dir, 'cert.pem');

execFileSync('openssl', [
  'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', key, '-out', cert, '-days', '30',
  '-subj', `/CN=${host}`,
  '-addext', `subjectAltName=DNS:${host},IP:127.0.0.1`,
], { stdio: 'inherit' });

// sha256(DER of SubjectPublicKeyInfo), base64 -- the exact form Chrome's
// --ignore-certificate-errors-spki-list expects.
const spki = execFileSync('/bin/sh', ['-c',
  `openssl x509 -in '${cert}' -pubkey -noout ` +
  `| openssl pkey -pubin -outform der ` +
  `| openssl dgst -sha256 -binary | openssl base64`,
]).toString().trim();

writeFileSync(join(dir, 'spki.txt'), spki + '\n');
console.log(spki);
