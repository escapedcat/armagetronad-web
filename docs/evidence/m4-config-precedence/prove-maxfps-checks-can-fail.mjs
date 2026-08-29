#!/usr/bin/env node
//
// Proves that every check in check-maxfps-transcript.mjs can come out FAIL.
//
//   node docs/evidence/m4-config-precedence/prove-maxfps-checks-can-fail.mjs \
//        docs/evidence/m4-config-precedence/chrome-console.log
//
// WHY THIS EXISTS. check-maxfps-transcript.mjs printed 13 PASSes on the real
// transcript. On its own that is compatible with two very different worlds:
// one where the fix works, and one where the checker is a program that prints
// PASS. This script rules out the second. It takes the real transcript,
// damages it in one specific way per check, and requires the checker to notice
// that specific check -- not merely to fail, which a syntax error would also
// achieve, but to name the right one in its FAILED list.
//
// WHAT IT IS NOT. It is not evidence that the fix works, and it cannot be:
// every input it feeds the checker is fabricated. The evidence that the fix
// works is the pair of real transcripts (armagetronad.html and the
// armagetronad-oldautoexec.html control) and the screenshots beside them. This
// script only establishes that the instrument has a needle that moves.
//
// THE FIRST CASE IS A CONTROL THAT PASSES, and it is not padding. If the
// unmutated transcript did not pass, every "mutation caused this failure"
// claim below would be unfounded -- the failures could have been there all
// along. It announces itself as a control in its own output.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CHECKER = join( dirname( fileURLToPath( import.meta.url ) ), 'check-maxfps-transcript.mjs' );
const src = process.argv[ 2 ];
if ( !src ) {
    console.error( 'usage: prove-maxfps-checks-can-fail.mjs <real console.log>' );
    process.exit( 2 );
}
const original = readFileSync( src, 'utf8' );

// --------------------------------------------------------------- helpers

// Rewrite one field inside one [MAXFPS] probe, leaving every other line alone.
// Operating on the JSON rather than on the raw text means a mutation cannot
// accidentally corrupt the line into something the checker rejects for the
// wrong reason.
function editProbe( text, phase, mutate ) {
    let hits = 0;
    const out = text.split( '\n' ).map( l => {
        const m = l.match( /^(.*\[MAXFPS\] )(\{.*\})\s*$/ );
        if ( !m ) return l;
        const obj = JSON.parse( m[ 2 ] );
        if ( obj.phase !== phase ) return l;
        hits++;
        mutate( obj );
        return m[ 1 ] + JSON.stringify( obj );
    } ).join( '\n' );
    if ( hits !== 1 ) throw new Error( `expected exactly one "${phase}" probe, found ${hits}` );
    return out;
}

function editAllProbes( text, mutate ) {
    let hits = 0;
    const out = text.split( '\n' ).map( l => {
        const m = l.match( /^(.*\[MAXFPS\] )(\{.*\})\s*$/ );
        if ( !m ) return l;
        const obj = JSON.parse( m[ 2 ] );
        hits++;
        mutate( obj );
        return m[ 1 ] + JSON.stringify( obj );
    } ).join( '\n' );
    if ( hits !== 7 ) throw new Error( `expected 7 probes, found ${hits}` );
    return out;
}

function dropFirst( text, pattern ) {
    const lines = text.split( '\n' );
    const i = lines.findIndex( l => pattern.test( l ) );
    if ( i < 0 ) throw new Error( `nothing matched ${pattern}` );
    lines.splice( i, 1 );
    return lines.join( '\n' );
}

// --------------------------------------------------------------- cases
//
// `expect` is a substring of the check name that MUST appear in the checker's
// FAILED list. Matching on the name and not merely on the exit code is what
// stops a mutation that breaks the checker outright from counting as proof.

const cases = [
    {
        name: 'CONTROL (expected to PASS): the transcript exactly as recorded',
        control: true,
        mutate: t => t,
    },
    {
        name: 'a probe line goes missing',
        expect: 'classified consistently',
        mutate: t => dropFirst( t, /\[MAXFPS\] .*"phase":"before-change"/ ),
    },
    {
        name: 'the page is actually the control page (autoexec sets MAX_FPS)',
        expect: 'as asserted with --expect',
        mutate: t => editAllProbes( t, o => { o.autoexec_max_fps = '60'; } ),
    },
    {
        name: 'one of the three boots did not populate /persist',
        expect: 'all three boots populated',
        mutate: t => dropFirst( t, /\[console\.log\] \[PERSIST\] populate ok/ ),
    },
    {
        name: 'something threw during the run, before the positive control',
        expect: 'the run is clean up to the positive control',
        mutate: t => t.replace( /(\n.*\[console\.log\] \[MAXFPS\] .*"phase":"before-change".*)/,
            '\n[  00000ms] [EXCEPTION] SyntheticError: injected by the prover$1' ),
    },
    {
        name: 'the deliberate uncaught error did not register (blind detector)',
        expect: 'the exception detector is not blind',
        mutate: t => {
            const i = t.indexOf( 'positive-control-deliberate-uncaught-error-follows' );
            return t.slice( 0, i ) + t.slice( i ).split( '\n' )
                .filter( l => !l.includes( '[EXCEPTION]' ) ).join( '\n' );
        },
    },
    {
        name: 'the audio device opened at a different buffer shift',
        expect: 'the audio device opened at SOUND_BUFFER_SHIFT 1',
        mutate: t => t.replace( '1024 frames/callback (46.4 ms per callback, SOUND_BUFFER_SHIFT 1)',
            '512 frames/callback (23.2 ms per callback, SOUND_BUFFER_SHIFT 0)' ),
    },
    {
        name: 'autoexec.cfg turns out to set SOUND_BUFFER_SHIFT after all',
        expect: 'nothing but the binary could have supplied that 1',
        mutate: t => editAllProbes( t, o => { o.autoexec_sound_buffer_shift = '1'; } ),
    },
    {
        name: 'the compiled default did not apply on a fresh profile',
        expect: 'boot1-nothing-chosen-yet',
        mutate: t => editProbe( t, 'boot1-nothing-chosen-yet', o => { o.max_fps = '360'; } ),
    },
    {
        name: 'the value was already the chosen one before the player chose it',
        expect: 'before-change',
        mutate: t => editProbe( t, 'before-change', o => { o.max_fps = '30'; } ),
    },
    {
        name: 'the file was written while the menu was still open',
        expect: 'changed-menu-still-open',
        mutate: t => editProbe( t, 'changed-menu-still-open', o => { o.max_fps = '30'; } ),
    },
    {
        name: 'leaving the menu did not write the choice',
        expect: 'after-menu-leave',
        mutate: t => editProbe( t, 'after-menu-leave', o => { o.max_fps = '60'; } ),
    },
    {
        name: 'the choice did not survive the IndexedDB round trip',
        expect: 'boot3-before-play',
        mutate: t => editProbe( t, 'boot3-before-play', o => { o.max_fps = '60'; } ),
    },
    {
        // The one the whole task is about: the file survives but the game's own
        // config load puts the old value back. This is precisely the failure
        // the real control page exhibits, reproduced here as a mutation so the
        // checker is known to catch it even without rebuilding anything.
        name: 'THE HEADLINE: the choice survived the reload but the game overrode it',
        expect: 'boot3-in-menu',
        mutate: t => editProbe( t, 'boot3-in-menu', o => { o.max_fps = '60'; } ),
    },
];

// --------------------------------------------------------------- provenance

console.log( '='.repeat( 78 ) );
console.log( 'PROVING check-maxfps-transcript.mjs CAN FAIL' );
console.log( '='.repeat( 78 ) );
console.log( `checker    ${CHECKER}` );
console.log( `input      ${src} (${original.length} bytes)` );
console.log( `cases      ${cases.length} (1 control that must pass, ${cases.length - 1} mutations that must fail)` );
console.log( `run at     ${new Date().toISOString()}` );
console.log( '' );
console.log( 'Every input below is FABRICATED. Nothing here is evidence that the fix' );
console.log( 'works -- that is the two real transcripts and the screenshots. This only' );
console.log( 'shows the instrument responds.' );
console.log( '' );

const dir = mkdtempSync( join( tmpdir(), 'aa-m4t3-prove-' ) );
let bad = 0;

for ( const c of cases ) {
    const text = c.mutate( original );
    const p = join( dir, 'mutated.log' );
    writeFileSync( p, text );
    const r = spawnSync( process.execPath, [ CHECKER, '--expect', 'real', p ],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 } );
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const failedNames = out.split( '\n' ).filter( l => l.trim().startsWith( 'FAILED:' ) );

    let ok, detail;
    if ( c.control ) {
        ok = r.status === 0 && failedNames.length === 0;
        detail = ok
            ? 'checker exits 0 with no FAILED lines, so every failure below is caused by\nits mutation and was not already present.'
            : `checker exited ${r.status} on the UNMUTATED transcript:\n${failedNames.join( '\n' )}`;
    } else {
        const named = failedNames.some( l => l.includes( c.expect ) );
        ok = r.status !== 0 && named;
        detail = `checker exit ${r.status}; FAILED lines:\n` +
            ( failedNames.length ? failedNames.map( l => `  ${l.trim()}` ).join( '\n' ) : '  (none)' ) +
            `\nlooked for a failure naming: "${c.expect}"`;
    }
    if ( !ok ) bad++;
    console.log( `  [${ok ? 'OK' : 'BROKEN'}] ${c.name}` );
    for ( const l of detail.split( '\n' ) ) console.log( `          ${l}` );
    console.log( '' );
}

rmSync( dir, { recursive: true, force: true } );

console.log( '='.repeat( 78 ) );
console.log( bad === 0
    ? `All ${cases.length} cases behaved as designed: the control passes and each of the\n${cases.length - 1} mutations is caught by the check it was aimed at.`
    : `${bad} case(s) did NOT behave as designed -- see BROKEN above.` );
console.log( '='.repeat( 78 ) );
process.exit( bad === 0 ? 0 : 1 );
