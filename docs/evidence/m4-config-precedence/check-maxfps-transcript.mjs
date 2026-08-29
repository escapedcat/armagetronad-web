#!/usr/bin/env node
//
// M4 Task 3 gate, part 2 of 2: score a maxfps-precedence.steps transcript.
//
//   node docs/evidence/m4-config-precedence/check-maxfps-transcript.mjs \
//        docs/evidence/m4-config-precedence/chrome-console.log
//
// Part 1 -- the dedicated server is still byte-identical -- is
// check-dedicated-byte-identity.mjs in this directory. This script says
// nothing about bytes, only about whether the player's choice survives.
//
// WHAT IS BEING CLAIMED. That a value a player picks in the in-game menu is
// still there after a page reload. Before this task it was not: autoexec.cfg
// loads after user.cfg (st_LoadConfig in src/tools/tConfiguration.cpp), so its
// `MAX_FPS 60` overwrote the saved choice on every load, silently and with no
// error anywhere.
//
// WHICH TRANSCRIPT AM I SCORING. Two different pages run the identical steps
// file and produce transcripts that look alike at a glance:
//
//   armagetronad.html             the real client -- this task's fix in place.
//   armagetronad-oldautoexec.html the CONTROL -- same wasm, byte for byte, but
//                                 its preloaded autoexec.cfg still carries
//                                 `MAX_FPS 60` and `SOUND_BUFFER_SHIFT 1`.
//                                 That is this task's fix undone.
//
// Pointing this checker at the wrong one and reading "PASS" would be the
// easiest possible way to fool yourself, so the checker does NOT take the
// caller's word for which file it has. It reads the transcript's own record of
// what autoexec.cfg contained at runtime -- every [MAXFPS] probe carries
// autoexec_max_fps and autoexec_sound_buffer_shift -- and classifies the
// transcript from that. Then it prints the classification, and the evidence
// for it, BEFORE it prints a single check. --expect real|control makes the
// classification an assertion rather than an observation.
//
// PROVENANCE COMES FIRST, VERDICT LAST. M4 task 2 established this the hard
// way: a note about which build produced a transcript is worthless underneath
// a screenful of results, because by the time the verdict is on screen the
// note has scrolled away. Everything identifying the run is printed before any
// check runs.
//
// THE TRANSCRIPT IS CUMULATIVE ACROSS RELOADS, so it must be partitioned
// before it is counted. The steps file ends with a deliberate uncaught error
// behind the mark
//     positive-control-deliberate-uncaught-error-follows
// Everything before that mark is evidence; everything after it is the harness
// testing itself. The "no uncaught exceptions" check counts only the first
// part, and separately REQUIRES an exception in the second part -- a run where
// the deliberate error failed to register would mean the detector was blind,
// and a clean transcript would prove nothing.

import { readFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice( 2 );
let expect = null;
const files = [];
for ( let i = 0; i < args.length; i++ ) {
    if ( args[ i ] === '--expect' ) expect = args[ ++i ];
    else files.push( args[ i ] );
}
if ( files.length !== 1 || ( expect && ![ 'real', 'control' ].includes( expect ) ) ) {
    console.error( 'usage: check-maxfps-transcript.mjs [--expect real|control] <console.log>' );
    process.exit( 2 );
}
const path = files[ 0 ];

// The value the script drives the menu to. 30 is two LEFTs from the compiled
// default of 60 in sg_ScreenModeMenu's hand-picked list.
const CHOSEN = '30';
// The compiled default this task moved out of autoexec.cfg.
const DEFAULT_MAX_FPS = '60';
const DEFAULT_SHIFT = '1';
const MARK = 'positive-control-deliberate-uncaught-error-follows';

const raw = readFileSync( path, 'utf8' );
const lines = raw.split( '\n' );

// ------------------------------------------------------------ extraction

// Only real console output counts. `until:` directives echo their needle into
// the transcript, so a naive grep for "[PERSIST] populate ok" finds three
// genuine lines and six harness echoes of the same string.
const consoleLines = lines.filter( l => l.includes( '[console.log]' ) || l.includes( '[console.error]' ) );

const probes = [];
for ( const l of consoleLines ) {
    const m = l.match( /\[MAXFPS\] (\{.*\})\s*$/ );
    if ( m ) { try { probes.push( JSON.parse( m[ 1 ] ) ); } catch { /* malformed probe is a failure below */ } }
}
const byPhase = Object.fromEntries( probes.map( p => [ p.phase, p ] ) );

const populates = consoleLines.filter( l => /\[PERSIST\] populate ok/.test( l ) ).length;
const snd = [ ...raw.matchAll( /\[SND\] device opened: (\d+) Hz, .*?(\d+) frames\/callback \(([\d.]+) ms per callback, SOUND_BUFFER_SHIFT (-?\d+)\)/g ) ]
    .map( m => ( { hz: m[ 1 ], frames: m[ 2 ], ms: m[ 3 ], shift: m[ 4 ] } ) );

const markIndex = lines.findIndex( l => l.includes( MARK ) );
const before = markIndex >= 0 ? lines.slice( 0, markIndex ) : lines;
const after = markIndex >= 0 ? lines.slice( markIndex ) : [];
const exceptionsBefore = before.filter( l => l.includes( '[EXCEPTION]' ) );
const exceptionsAfter = after.filter( l => l.includes( '[EXCEPTION]' ) );

const navLine = lines.find( l => l.includes( 'navigating to' ) ) || '(no navigation line)';
const browserLine = lines.find( l => /\[harness\] (chrome|firefox):/.test( l ) ) || '(unknown browser)';

// ------------------------------------------------------- classification
//
// From the transcript, not from the filename and not from the caller.
//
// CLASSIFIED ON autoexec_max_fps ALONE, deliberately, even though the control
// page's autoexec.cfg sets both items. An earlier version keyed it on "either
// field is non-null", which made the SOUND_BUFFER_SHIFT check below
// unfalsifiable: that check asserts autoexec_sound_buffer_shift is null, and
// it only ran when the classifier had already established that both fields
// were null. It could not fail, so it was not evidence. Splitting the two
// makes the sound half an independent assertion that the prover can break.
const overrides = probes.some( p => p.autoexec_max_fps !== null );
const consistent = probes.every( p => ( p.autoexec_max_fps !== null ) === overrides );
const kind = overrides ? 'control' : 'real';

// ------------------------------------------------------------ provenance

console.log( '='.repeat( 78 ) );
console.log( 'M4 TASK 3 GATE, PART 2: DOES A PLAYER-CHOSEN MAX_FPS SURVIVE A RELOAD' );
console.log( '='.repeat( 78 ) );
console.log( `transcript     ${path}` );
try {
    const st = statSync( path );
    console.log( `               ${st.size} bytes, modified ${st.mtime.toISOString()}` );
} catch { /* size is a nicety */ }
console.log( `browser        ${browserLine.replace( /^.*\[harness\] /, '' )}` );
console.log( `page           ${navLine.replace( /^.*navigating to /, '' )}` );
try {
    console.log( `repo HEAD      ${execFileSync( 'git', [ 'rev-parse', 'HEAD' ], { encoding: 'utf8' } ).trim()}` );
} catch { /* not fatal */ }
console.log( `probes         ${probes.length} [MAXFPS] records, phases: ${probes.map( p => p.phase ).join( ', ' ) || '(none)'}` );
console.log( '' );
console.log( `THIS IS A ${kind.toUpperCase()} TRANSCRIPT, and here is why:` );
if ( overrides ) {
    const p = probes.find( x => x.autoexec_max_fps !== null || x.autoexec_sound_buffer_shift !== null );
    console.log( `  the game read an autoexec.cfg that SETS MAX_FPS ${p.autoexec_max_fps} and` );
    console.log( `  SOUND_BUFFER_SHIFT ${p.autoexec_sound_buffer_shift} (${p.autoexec_bytes} bytes). That is this task's fix` );
    console.log( '  UNDONE -- the armagetronad-oldautoexec.html control page. The player\'s' );
    console.log( '  choice is EXPECTED TO BE LOST here; a control that passed the real' );
    console.log( '  page\'s checks would mean the real page\'s checks measure nothing.' );
} else {
    console.log( `  the game read an autoexec.cfg (${probes[ 0 ]?.autoexec_bytes ?? '?'} bytes) that sets NEITHER` );
    console.log( '  MAX_FPS nor SOUND_BUFFER_SHIFT. Nothing loaded after user.cfg names' );
    console.log( '  either item, so the player\'s choice is expected to survive.' );
}
if ( expect ) {
    console.log( `  --expect ${expect} was passed; classification ${kind === expect ? 'agrees' : 'DISAGREES'}.` );
}
console.log( '' );
console.log( `partition      mark "${MARK}"` );
console.log( `               ${before.length} transcript lines before it (the evidence),` );
console.log( `               ${after.length} after (the harness testing itself).` );
console.log( '' );

// ---------------------------------------------------------------- checks

const results = [];
function check( name, ok, detail ) {
    results.push( { name, ok } );
    console.log( `  [${ok ? 'PASS' : 'FAIL'}] ${name}` );
    for ( const l of String( detail ).split( '\n' ) ) console.log( `         ${l}` );
}

console.log( '-'.repeat( 78 ) );
console.log( 'CHECKS' );
console.log( '-'.repeat( 78 ) );

check( 'the transcript is classified consistently throughout',
    consistent && probes.length === 7,
    `${probes.length}/7 probes; every probe agrees the page ${overrides ? 'DOES' : 'does not'} override MAX_FPS.\n` +
    'A transcript where some probes see an override and some do not would be two\nruns concatenated, and nothing below it could be trusted.' );

if ( expect ) {
    check( `transcript is the ${expect} page, as asserted with --expect`, kind === expect,
        `classified from the transcript as: ${kind}` );
}

check( 'all three boots populated /persist from IndexedDB', populates === 3,
    `saw ${populates}x "[PERSIST] populate ok" in console output (harness echoes excluded)` );

check( 'the run is clean up to the positive control', exceptionsBefore.length === 0,
    exceptionsBefore.length === 0
        ? 'no [EXCEPTION] lines before the mark'
        : exceptionsBefore.slice( 0, 5 ).join( '\n' ) );

check( 'the exception detector is not blind -- the deliberate error registered',
    exceptionsAfter.length > 0,
    exceptionsAfter.length > 0
        ? `${exceptionsAfter.length} [EXCEPTION] line(s) after the mark, as designed`
        : 'NONE. The clean run above therefore proves nothing.' );

// The audio half of the task. SOUND_BUFFER_SHIFT is not driven through the
// menu -- see the steps file for why -- so it is verified by the device the
// game actually opened.
check( 'the audio device opened at SOUND_BUFFER_SHIFT 1 on every boot',
    snd.length === 3 && snd.every( s => s.shift === DEFAULT_SHIFT && s.frames === '1024' ),
    snd.length ? snd.map( s => `${s.frames} frames/callback, ${s.ms} ms, SOUND_BUFFER_SHIFT ${s.shift}` ).join( '\n' )
        : 'no [SND] device opened lines at all' );

if ( !overrides ) {
    check( 'and on the real page nothing but the binary could have supplied that 1',
        probes.every( p => p.autoexec_sound_buffer_shift === null ),
        'autoexec.cfg names no SOUND_BUFFER_SHIFT in any probe, and config/ names none\n' +
        'either. The compiled default in eSound.cpp is the only remaining source.' );
}

const need = ( phase, key, want, why ) => {
    const p = byPhase[ phase ];
    check( `${phase}: ${key} is ${want} -- ${why}`, !!p && p[ key ] === want,
        p ? `${key}=${JSON.stringify( p[ key ] )}  (autoexec ${key}=${JSON.stringify( p[ 'autoexec_' + key ] )})`
          : `phase "${phase}" is missing from the transcript` );
};

need( 'boot1-nothing-chosen-yet', 'max_fps', DEFAULT_MAX_FPS,
    'the default applies before the player chooses anything' );
need( 'before-change', 'max_fps', DEFAULT_MAX_FPS,
    'still the default when the player arrives at the menu row' );
need( 'changed-menu-still-open', 'max_fps', DEFAULT_MAX_FPS,
    'the change is in memory only while the menu is open' );
need( 'after-menu-leave', 'max_fps', CHOSEN,
    'leaving the menu writes the choice (M4 task 2\'s mechanism)' );
need( 'boot3-before-play', 'max_fps', CHOSEN,
    'the choice survived the IndexedDB round trip' );

// THE HEADLINE. Everything above is true on the control page too -- the
// control's user.cfg also holds 30 immediately after populate. What separates
// the two builds is this one probe, taken AFTER the game has run
// st_LoadConfig, which is the moment autoexec.cfg used to win.
console.log( '' );
console.log( '  ---- the check the whole task exists for --------------------------------' );
if ( overrides ) {
    need( 'boot3-in-menu', 'max_fps', DEFAULT_MAX_FPS,
        'CONTROL: autoexec.cfg loads last, so the player\'s 30 is expected to be GONE' );
    console.log( '         The control reverted exactly as the pre-fix build did. Note the' );
    console.log( '         reversion happens BETWEEN boot3-before-play (30) and boot3-in-menu' );
    console.log( '         (60): the file was fine until the game loaded its config.' );
} else {
    need( 'boot3-in-menu', 'max_fps', CHOSEN,
        'the player\'s choice survives the game\'s own config load' );
}

// ---------------------------------------------------------------- verdict

console.log( '' );
const failed = results.filter( r => !r.ok );
console.log( '='.repeat( 78 ) );
console.log( `${results.length - failed.length}/${results.length} checks passed on the ${kind.toUpperCase()} transcript` );
for ( const r of failed ) console.log( `  FAILED: ${r.name}` );
if ( failed.length === 0 ) {
    console.log( overrides
        ? 'VERDICT: PASS -- the control behaved as the pre-fix build did: the player\'s'
        : 'VERDICT: PASS -- a player-chosen MAX_FPS survived two page reloads, and' );
    console.log( overrides
        ? '         MAX_FPS 30 was overwritten back to 60 by autoexec.cfg.'
        : '         SOUND_BUFFER_SHIFT 1 came from the binary rather than a config file.' );
} else {
    console.log( 'VERDICT: FAIL' );
}
console.log( '='.repeat( 78 ) );
process.exit( failed.length === 0 ? 0 : 1 );
