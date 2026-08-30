#!/usr/bin/env node
//
// M4 Task 3 gate, part 1 of 2: the dedicated server is still byte-identical.
//
//   source deps/emsdk/emsdk_env.sh
//   node docs/evidence/m4-config-precedence/check-dedicated-byte-identity.mjs
//
// Run it from the repo root. Part 2 -- that a player-chosen MAX_FPS survives a
// reload -- is check-maxfps-transcript.mjs in this directory; this script says
// nothing about behaviour, only about bytes.
//
// WHY THIS SCRIPT EXISTS AT ALL. Task 3 is the only part of M4 that edits game
// source. Tasks 1 and 2 could not break the dedicated server structurally:
// task 1 touched only web/, and task 2's mechanism lives in src/emscripten/,
// which web/Makefile's $(SRCS) does not wildcard. This task edits
// src/render/rSysdep.cpp and src/engine/eSound.cpp, and BOTH of those are in
// the six directories $(SRCS) does wildcard, so both compile into the M0
// dedicated server. Its wasm has been 2,488,298 bytes since M0 and every
// milestone since has had to keep it there.
//
// Worse, both edits are to declarations that sit OUTSIDE their file's
// `#ifndef DEDICATED` region -- `sr_maxFPS` is defined just above the one in
// rSysdep.cpp, and `buffer_shift` just below the end of the one in eSound.cpp
// -- so neither is protected by the file's existing structure. The guard
//     #if !defined( DEDICATED ) && defined( __EMSCRIPTEN__ )
// is the whole protection, and CONTROL 1 below shows what happens without its
// first half.
//
// -------------------------------------------------------------------------
// EXACTLY WHAT MOVES AN OBJECT'S MD5 HERE. This script's whole design rests on
// it, and this task's brief got it half right, so it is measured rather than
// assumed. The brief warned:
//
//     "compile it at the same path with the same flags to a scratch location
//      ... A different path changes the md5 on its own, so a mismatch there
//      means nothing"
//
// Measured, this toolchain, these flags (-O2, no -g), same source content
// compiled four ways:
//
//   src/render/rSysdep.cpp                  1022f9ec62b81304f47cca4366a13581
//   <scratch>/a/rSysdep.cpp                 1022f9ec62b81304f47cca4366a13581
//   <scratch>/deep/deeper/rSysdep.cpp       1022f9ec62b81304f47cca4366a13581
//   <scratch>/a/rSysdeq.cpp                 950e1256067f89b53efc3548833a0a1d
//   <scratch>/a/zzzzzzz.cpp                 1542354c8b889e094a330b884babe3be
//
// All four are 20567 bytes; only the digest moves. So:
//
//   * the DIRECTORY of the source does NOT affect the object;
//   * the -o path does NOT affect the object (measured separately, same way);
//   * the source file's BASENAME DOES -- rSysdeq.cpp, one letter different and
//     the same length, produces different bytes at the same size.
//
// The brief's warning is therefore real but mislocated: what has to match is
// the FILENAME, not the path. That distinction is the difference between a
// control that means something and one that does not, and getting it wrong is
// silent -- an earlier draft of this script named its scratch copies
// `unguarded-sr_maxFPS.cpp`, which made CONTROL 1 differ from base for two
// reasons at once and made CONTROL 1b's byte delta meaningless.
//
// Consequence for this script: every scratch copy is written as
// <scratch>/<variant>/<ORIGINAL BASENAME>, so filename is held constant and
// only the edit under test varies. That in turn means no control ever has to
// mutate a file in src/ -- a crashed run cannot leave the tree modified.
// CONTROL 2 re-measures the "directory does not matter" half on every run; if
// it ever starts failing, this reasoning has expired and the script needs
// rewriting rather than the tree needing fixing.
// -------------------------------------------------------------------------
//
// WHAT COUNTS AS "BASE". Not a hardcoded object md5 -- those are properties of
// whichever emsdk is in deps/, and pinning them would turn a toolchain upgrade
// into a mystery failure. Base is derived, every run, by pulling the pre-task
// source out of git (BASE_REF below) and compiling it with the same flags. The
// two wasm constants ARE hardcoded, because those are the project-wide
// invariant this task must not move and they are quoted in PLAN.md and in
// every milestone report.
//
// THE COMPILE FLAGS ARE NOT HARDCODED EITHER. They are extracted from
// web/Makefile with `make -n -B <object>`, so "the same flags" is guaranteed
// by construction rather than asserted by a comment that can drift.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';

// The commit this task branched from: the tree before autoexec.cfg lost its
// two settings and before either .cpp grew a guard. `git show BASE_REF:<path>`
// is what makes a fresh, toolchain-correct base object every run.
//
// IF THIS REF NO LONGER RESOLVES, this gate stops running -- a squash or a
// rebase before merge will do that, and M4 task 5's exit step is a clean
// rebuild PLUS this gate, so it is the likely moment to discover it. The fix is
// not to delete the check. Repoint BASE_REF at any commit whose tree predates
// this task's two .cpp guards and the autoexec.cfg deletions; `git log --
// src/render/rSysdep.cpp` finds the boundary. The base object md5s are
// properties of that tree, not of this hash, so they do not change when the
// hash does. What must NOT happen is repointing it at a commit that already
// contains the guards -- the control would then compare the change against
// itself and pass while proving nothing.
const BASE_REF = '56df579d';

// The invariant. Same two numbers as M0, M1, M2, M3 and M4 tasks 1-2.
const REQUIRED_WASM_BYTES = 2488298;
const REQUIRED_WASM_MD5 = '9718a2a64978cb6e9b95ea2f0454cca5';

// The two translation units this task edits, and the settings each carries.
const UNITS = [
    { src: 'src/render/rSysdep.cpp', obj: 'web/build-m0/render/rSysdep.o',
      symbol: 'sr_maxFPS', setting: 'MAX_FPS',
      // What the DEDICATED preprocessor must still produce -- upstream's value,
      // unchanged by this task -- and what the CLIENT must now produce, which
      // is the value that used to live in autoexec.cfg.
      preproc: /^int sr_maxFPS = (\d+);/m, dedicatedValue: '360', clientValue: '60' },
    { src: 'src/engine/eSound.cpp', obj: 'web/build-m0/engine/eSound.o',
      symbol: 'buffer_shift', setting: 'SOUND_BUFFER_SHIFT',
      preproc: /^static int buffer_shift=(-?\d+);/m, dedicatedValue: '0', clientValue: '1' },
];

const WASM = 'web/dist-m0/armagetronad-dedicated.wasm';
const AUTOEXEC = 'web/webdefaults/autoexec.cfg';

// ---------------------------------------------------------------- machinery

const results = [];
function record( kind, name, ok, detail ) {
    results.push( { kind, name, ok, detail } );
    const tag = ok ? 'PASS' : 'FAIL';
    console.log( `  [${tag}] ${name}` );
    for ( const line of detail.split( '\n' ) ) console.log( `         ${line}` );
}

function md5( path ) {
    return createHash( 'md5' ).update( readFileSync( path ) ).digest( 'hex' );
}

// maxBuffer is NOT a detail to leave defaulted. `em++ -E` on rSysdep.cpp emits
// well over a megabyte of preprocessed text, and node's 1 MB default kills the
// child and reports `exit null` -- which reads exactly like a compiler crash
// and sent the first version of this script looking for one.
function run( cmd, args, opts = {} ) {
    const r = spawnSync( cmd, args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, ...opts } );
    if ( r.error ) throw new Error( `${cmd} ${args.join( ' ' )}\n${r.error.message}` );
    if ( r.status !== 0 ) {
        throw new Error( `${cmd} ${args.join( ' ' )}\nexit ${r.status} signal ${r.signal}\n${r.stderr || ''}` );
    }
    return r.stdout;
}

// ------------------------------------------------------------- provenance
//
// PRINTED BEFORE ANY CHECK RUNS, not after. M4 task 2 learned this the hard
// way: a provenance note under a screen of output is a note nobody reads,
// because by the time the verdict is on screen the header has scrolled off.
// Whoever is looking at this output needs to know which tree and which
// toolchain produced it before they know whether it passed.

console.log( '='.repeat( 78 ) );
console.log( 'M4 TASK 3 GATE, PART 1: DEDICATED SERVER BYTE-IDENTITY' );
console.log( '='.repeat( 78 ) );

let head = '(not a git worktree)';
let dirty = '(unknown)';
try {
    head = run( 'git', [ 'rev-parse', 'HEAD' ] ).trim();
    const status = run( 'git', [ 'status', '--porcelain' ] ).trim();
    dirty = status ? `${status.split( '\n' ).length} modified/untracked path(s)` : 'clean';
} catch { /* leave the placeholders */ }

// em++ -v prints its banner on STDERR, not stdout. Reading only stdout gives
// an empty string and a provenance header that silently says nothing about the
// toolchain -- worse than useless, since it looks like it reported something.
let emcc = '(em++ NOT ON PATH)';
{
    const r = spawnSync( 'em++', [ '-v' ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 } );
    const banner = `${r.stderr || ''}${r.stdout || ''}`.trim().split( '\n' )
        .find( l => /emcc|clang version/i.test( l ) );
    if ( !r.error && banner ) emcc = banner.trim();
}

const scratch = join( tmpdir(), `aa-m4t3-${process.pid}` );
mkdirSync( scratch, { recursive: true } );

console.log( `cwd            ${process.cwd()}` );
console.log( `HEAD           ${head}` );
console.log( `worktree       ${dirty}` );
console.log( `base ref       ${BASE_REF}  (pre-task source is pulled from here)` );
console.log( `toolchain      ${emcc}` );
console.log( `scratch        ${scratch}` );
console.log( `node           ${process.version}` );
console.log( `run at         ${new Date().toISOString()}` );
console.log( '' );
console.log( 'Nothing below writes to src/ or to git. Control builds are compiled from' );
console.log( 'mutated COPIES under the scratch directory above; CONTROL 2 is what earns' );
console.log( 'the right to do that. The only tree paths this script writes are the ones' );
console.log( '`make -f web/Makefile dedicated` writes anyway.' );
console.log( '' );

if ( emcc.includes( 'NOT ON PATH' ) ) {
    console.log( 'em++ is not on PATH. Run `source deps/emsdk/emsdk_env.sh` first.' );
    process.exit( 2 );
}
if ( !existsSync( 'web/Makefile' ) ) {
    console.log( 'web/Makefile not found -- run this from the repo root.' );
    process.exit( 2 );
}

// Extract the real compile command for each unit from the Makefile itself, so
// "the same flags" is a fact rather than a claim. `-n -B` prints the recipe
// without running it and without caring whether the object is up to date.
function compileCommandFor( unit ) {
    const out = run( 'make', [ '-f', 'web/Makefile', '-n', '-B', unit.obj ] );
    const line = out.split( '\n' ).find( l => l.trim().startsWith( 'em++' ) );
    if ( !line ) throw new Error( `no em++ recipe for ${unit.obj} in make -n output:\n${out}` );
    return line.trim().split( /\s+/ );
}

// Write `text` to <scratch>/<variant>/<original basename> and compile it with
// the Makefile's own command, output to a scratch object. The basename is
// preserved deliberately -- see the measurement in the header comment; a
// renamed copy compiles to different bytes for a reason that has nothing to do
// with the edit under test.
function compileVariant( unit, argv, variant, text ) {
    const dir = join( scratch, variant );
    mkdirSync( dir, { recursive: true } );
    const srcPath = join( dir, basename( unit.src ) );
    writeFileSync( srcPath, text );
    const objPath = join( dir, basename( unit.obj ) );
    const a = argv.slice();
    a[ a.indexOf( '-c' ) + 1 ] = srcPath;
    a[ a.indexOf( '-o' ) + 1 ] = objPath;
    run( a[ 0 ], a.slice( 1 ) );
    return { md5: md5( objPath ), objPath };
}

// ------------------------------------------------------------------ build

console.log( '-'.repeat( 78 ) );
console.log( 'BUILDING THE DEDICATED SERVER FROM THE CURRENT TREE' );
console.log( '-'.repeat( 78 ) );
try {
    run( 'make', [ '-f', 'web/Makefile', 'dedicated' ] );
    console.log( '  make -f web/Makefile dedicated: ok' );
} catch ( e ) {
    console.log( `  make failed:\n${e.message}` );
    process.exit( 2 );
}
console.log( '' );

// ----------------------------------------------------------------- checks

console.log( '-'.repeat( 78 ) );
console.log( 'CHECKS' );
console.log( '-'.repeat( 78 ) );

// CHECK 1 -- the two settings really are gone from the file that used to
// override the player. Anchored to the start of a line so a mention inside a
// comment (there are several, deliberately) does not satisfy it.
{
    const text = readFileSync( AUTOEXEC, 'utf8' );
    const offenders = text.split( '\n' )
        .map( ( l, i ) => [ i + 1, l ] )
        .filter( ( [ , l ] ) => /^\s*(MAX_FPS|SOUND_BUFFER_SHIFT)\b/.test( l ) );
    const settings = text.split( '\n' )
        .filter( l => l.trim() && !l.trim().startsWith( '#' ) )
        .map( l => l.trim() );
    record( 'check', 'autoexec.cfg no longer sets MAX_FPS or SOUND_BUFFER_SHIFT',
        offenders.length === 0,
        offenders.length === 0
            ? `settings still in the file: ${settings.join( ' | ' )}`
            : `still present: ${offenders.map( ( [ n, l ] ) => `line ${n}: ${l.trim()}` ).join( ', ' )}` );

    // The two that MUST stay. They are correctness overrides, not preferences:
    // a saved user.cfg must not be able to turn display lists back on.
    const keeps = [ 'INFINITY_PLANE 0', 'USE_DISPLAYLISTS 0' ];
    const missing = keeps.filter( k => !settings.includes( k ) );
    record( 'check', 'autoexec.cfg still hard-overrides INFINITY_PLANE and USE_DISPLAYLISTS',
        missing.length === 0,
        missing.length === 0 ? 'both present' : `missing: ${missing.join( ', ' )}` );
}

// CHECK 2/3 -- what the preprocessor actually yields for each build variant.
// This is the check that says the guard has the shape it is supposed to have,
// independently of any md5: dedicated must still see upstream's values, and
// the client must see the values that left autoexec.cfg.
for ( const unit of UNITS ) {
    const argv = compileCommandFor( unit );
    const inc = argv.slice( 1 ).filter( a => a !== '-c' && a !== '-o' && a !== unit.src && a !== unit.obj
        && a !== '-MMD' && a !== '-MP' && a !== '-O2' );
    const preprocess = ( extra ) =>
        run( 'em++', [ ...inc, ...extra, '-E', unit.src ] );

    const ded = preprocess( [] ).match( unit.preproc );
    record( 'check', `dedicated build still sees upstream's ${unit.symbol} (${unit.setting})`,
        !!ded && ded[ 1 ] === unit.dedicatedValue,
        `em++ -E ${unit.src} (no -DAA_WEB_CLIENT) => ${ded ? ded[ 0 ] : '(no match!)'}` +
        `\nexpected value ${unit.dedicatedValue}` );

    const cli = preprocess( [ '-DAA_WEB_CLIENT', '-sUSE_SDL=1', '-sUSE_LIBPNG=1' ] ).match( unit.preproc );
    record( 'check', `client build compiles ${unit.setting} in as a default (${unit.symbol})`,
        !!cli && cli[ 1 ] === unit.clientValue,
        `em++ -E -DAA_WEB_CLIENT ${unit.src} => ${cli ? cli[ 0 ] : '(no match!)'}` +
        `\nexpected value ${unit.clientValue} -- the value that used to be in autoexec.cfg` );
}

// CHECK 4 -- the object bytes. Base is compiled fresh from BASE_REF's source
// with the identical command, so this compares like with like on whatever
// emsdk is installed today.
const baseObjMd5 = {};
for ( const unit of UNITS ) {
    const argv = compileCommandFor( unit );
    const base = compileVariant( unit, argv, `base-${unit.symbol}`,
        run( 'git', [ 'show', `${BASE_REF}:${unit.src}` ] ) ).md5;
    baseObjMd5[ unit.src ] = base;
    const now = md5( unit.obj );
    record( 'check', `${unit.obj} is byte-identical to ${BASE_REF}`,
        base === now,
        `base (${BASE_REF} source, same flags) = ${base}\nnow  (this tree, ${unit.obj}) = ${now}` );
}

// CHECK 5 -- the invariant itself.
{
    const bytes = readFileSync( WASM ).length;
    const digest = md5( WASM );
    record( 'check', `${WASM} is ${REQUIRED_WASM_BYTES} bytes`,
        bytes === REQUIRED_WASM_BYTES,
        `actual ${bytes}${bytes === REQUIRED_WASM_BYTES ? '' : ` (delta ${bytes - REQUIRED_WASM_BYTES})`}` );
    record( 'check', `${WASM} md5 is ${REQUIRED_WASM_MD5}`,
        digest === REQUIRED_WASM_MD5, `actual ${digest}` );
}

console.log( '' );

// --------------------------------------------------------------- controls

console.log( '-'.repeat( 78 ) );
console.log( 'CONTROLS -- every check above has to be shown able to come out the other way' );
console.log( '-'.repeat( 78 ) );
console.log( 'A checker that has never failed is a checker nobody has tested. Each control' );
console.log( 'below states what it is and which outcome counts as the control SUCCEEDING.' );
console.log( '' );

// CONTROL 1 -- expected to DIFFER. Weakens the guard to __EMSCRIPTEN__ alone,
// which is the mistake a hurried version of this task would actually make,
// since __EMSCRIPTEN__ reads like "the web build". em++ defines it for both
// wasm builds, so the dedicated server picks up the new value too.
console.log( 'CONTROL 1 -- "the guard is what protects the server, not luck".' );
console.log( '  Rebuilds both objects from copies whose guard has been weakened from' );
console.log( '  `#if !defined( DEDICATED ) && defined( __EMSCRIPTEN__ )` to' );
console.log( '  `#if defined( __EMSCRIPTEN__ )`, and relinks the server with them.' );
console.log( '  THE CONTROL SUCCEEDS IF THESE DIFFER FROM BASE. If they matched, CHECK 4' );
console.log( '  and CHECK 5 would be measuring nothing.' );
const unguardedObjs = [];
for ( const unit of UNITS ) {
    const argv = compileCommandFor( unit );
    const src = readFileSync( unit.src, 'utf8' );
    const mutated = src.replaceAll(
        '#if !defined( DEDICATED ) && defined( __EMSCRIPTEN__ )',
        '#if defined( __EMSCRIPTEN__ )' );
    if ( mutated === src ) {
        record( 'control', `CONTROL 1: could not weaken the guard in ${unit.src}`,
            false, 'the exact guard text was not found -- the guard was reworded without updating this control' );
        continue;
    }
    const built = compileVariant( unit, argv, `unguarded-${unit.symbol}`, mutated );
    unguardedObjs.push( { unit, o: built.objPath } );
    record( 'control', `CONTROL 1: unguarded ${unit.obj} differs from base`,
        built.md5 !== baseObjMd5[ unit.src ],
        `base       = ${baseObjMd5[ unit.src ] }\nunguarded  = ${built.md5}` );
}

// CONTROL 1b -- the same mistake carried through to the artifact the invariant
// is actually stated about. One extra link; worth it, because "the object
// changed" and "the shipped wasm changed" are different claims.
//
// IT SUBSTITUTES THE OBJECTS IN PLACE ON THE REAL LINK LINE AND DOES NOT
// APPEND THEM. Object order changes the output: measured on the client link,
// appending two rebuilt objects instead of substituting them moved the wasm by
// 700 bytes with no source change at all. Appending here would fold a link-
// order artifact into the number this control reports, which is precisely the
// number a reader would quote as "what the guard is worth".
if ( unguardedObjs.length === UNITS.length ) {
    // Re-derive the link command the same way as the compile command: ask make.
    // It prints nothing when the target is up to date, so force it with -B.
    // (An earlier revision ran the un-forced `make -n` first and then discarded
    // its output with `void linkOut;`. Removed in review -- it was one more
    // make invocation whose result was never read.)
    const forced = run( 'make', [ '-f', 'web/Makefile', '-n', '-B',
        'web/dist-m0/armagetronad-dedicated.js' ] );
    const linkLine = forced.split( '\n' ).filter( l => l.trim().startsWith( 'em++' ) ).pop();
    const args = linkLine.trim().split( /\s+/ ).slice( 1 );
    const swapped = args.map( a => {
        const hit = unguardedObjs.find( u => u.unit.obj === a );
        return hit ? hit.o : a;
    } );
    const outIdx = swapped.indexOf( '-o' );
    const ctlJs = join( scratch, 'control-dedicated.js' );
    swapped[ outIdx + 1 ] = ctlJs;
    run( 'em++', swapped );
    const ctlWasm = ctlJs.replace( /\.js$/, '.wasm' );
    const bytes = readFileSync( ctlWasm ).length;
    const digest = md5( ctlWasm );
    const sizeWouldCatch = bytes !== REQUIRED_WASM_BYTES;
    record( 'control', 'CONTROL 1b: an unguarded server links to a DIFFERENT wasm',
        bytes !== REQUIRED_WASM_BYTES || digest !== REQUIRED_WASM_MD5,
        `required  ${REQUIRED_WASM_BYTES} bytes  ${REQUIRED_WASM_MD5}` +
        `\nunguarded ${bytes} bytes  ${digest}` +
        `\nsize delta ${bytes - REQUIRED_WASM_BYTES} bytes` +
        ( sizeWouldCatch
            ? '\nthe SIZE check alone would have caught this.'
            : '\nTHE SIZE CHECK ALONE WOULD NOT HAVE CAUGHT THIS. Both values changed only\n' +
              'in content, not in length: sr_maxFPS 360 -> 60 and buffer_shift 0 -> 1 are\n' +
              'edits to the initialisers of two i32s that already exist in the data\n' +
              'segment, so the segment is the same length and so is the module. This is\n' +
              'why the invariant has to be quoted as "2,488,298 bytes AND md5 9718a2a6..."\n' +
              'and why a size-only check would have passed a broken dedicated server.' ) );
}

console.log( '' );

// CONTROL 2 -- expected to MATCH, and it is a control precisely because it is
// expected to match. It is also the measurement that licenses every scratch
// path used above.
console.log( 'CONTROL 2 -- A CONTROL THAT IS SUPPOSED TO PASS. Not filler: it is the only' );
console.log( '  thing standing between CONTROL 1 and the excuse "well, of course it' );
console.log( '  differs, it was compiled somewhere else". It compiles the CURRENT,' );
console.log( '  UNMODIFIED source from a scratch DIRECTORY, under the same filename, to a' );
console.log( '  scratch -o, and expects the canonical md5 anyway. THE CONTROL SUCCEEDS IF' );
console.log( '  THESE MATCH -- which means directory and -o are not variables here, so' );
console.log( '  CONTROL 1\'s difference is the guard and nothing else.' );
for ( const unit of UNITS ) {
    const argv = compileCommandFor( unit );
    const digest = compileVariant( unit, argv, `verbatim-${unit.symbol}`,
        readFileSync( unit.src, 'utf8' ) ).md5;
    record( 'control', `CONTROL 2: ${unit.src} compiled from a scratch directory is unchanged`,
        digest === md5( unit.obj ),
        `canonical dir/-o = ${md5( unit.obj )}\nscratch   dir/-o = ${digest}` +
        '\n(same basename, different directory, different -o: bytes must be identical)' );
}

console.log( '' );
console.log( 'CONTROL 2b -- the other half of the same measurement, and the reason CONTROL 2' );
console.log( '  is worded as "directory" and not "path". Same content again, but written' );
console.log( '  under a DIFFERENT FILENAME. THE CONTROL SUCCEEDS IF IT DIFFERS: the source' );
console.log( '  basename is embedded in the object, so any control that renames its input' );
console.log( '  is measuring the rename as well as the edit. This is the trap the header' );
console.log( '  comment records; it is re-run here so it cannot quietly stop being true.' );
for ( const unit of UNITS ) {
    const argv = compileCommandFor( unit );
    const dir = join( scratch, `renamed-${unit.symbol}` );
    mkdirSync( dir, { recursive: true } );
    // Same length as the original stem, so file SIZE is held constant too and
    // the only thing that can move is the digest.
    const stem = basename( unit.src, '.cpp' );
    const renamed = join( dir, `${'z'.repeat( stem.length )}.cpp` );
    writeFileSync( renamed, readFileSync( unit.src ) );
    const objPath = join( dir, basename( unit.obj ) );
    const a = argv.slice();
    a[ a.indexOf( '-c' ) + 1 ] = renamed;
    a[ a.indexOf( '-o' ) + 1 ] = objPath;
    run( a[ 0 ], a.slice( 1 ) );
    const digest = md5( objPath );
    const sizes = `${readFileSync( unit.obj ).length} vs ${readFileSync( objPath ).length} bytes`;
    record( 'control', `CONTROL 2b: renaming ${basename( unit.src )} does change the object`,
        digest !== md5( unit.obj ),
        `as ${basename( unit.src )} = ${md5( unit.obj )}\nas ${basename( renamed )} = ${digest}` +
        `\nsizes ${sizes} -- same size, different bytes` );
}

console.log( '' );

// CONTROL 3 -- expected to DIFFER. CHECK 1 greps a file; a grep that cannot be
// made to fire is not evidence that the file is clean.
console.log( 'CONTROL 3 -- "the autoexec.cfg grep can fire". Re-runs CHECK 1\'s test against' );
console.log( '  a copy of the file with `MAX_FPS 60` appended. THE CONTROL SUCCEEDS IF IT' );
console.log( '  REPORTS THE LINE. Nothing is written to the real file.' );
{
    const mutated = readFileSync( AUTOEXEC, 'utf8' ) + '\nMAX_FPS 60\n';
    const offenders = mutated.split( '\n' ).filter( l => /^\s*(MAX_FPS|SOUND_BUFFER_SHIFT)\b/.test( l ) );
    record( 'control', 'CONTROL 3: the grep detects a re-added MAX_FPS',
        offenders.length === 1 && offenders[ 0 ].trim() === 'MAX_FPS 60',
        `found: ${JSON.stringify( offenders )}` );
}

console.log( '' );

// --------------------------------------------------------------- verdict

const checks = results.filter( r => r.kind === 'check' );
const controls = results.filter( r => r.kind === 'control' );
const failedChecks = checks.filter( r => !r.ok );
const failedControls = controls.filter( r => !r.ok );

console.log( '='.repeat( 78 ) );
console.log( `CHECKS   ${checks.length - failedChecks.length}/${checks.length} passed` );
console.log( `CONTROLS ${controls.length - failedControls.length}/${controls.length} behaved as designed` );
for ( const r of [ ...failedChecks, ...failedControls ] ) console.log( `  FAILED: ${r.name}` );
const ok = failedChecks.length === 0 && failedControls.length === 0;
console.log( ok
    ? 'VERDICT: PASS -- the dedicated server is unchanged, and the checks that say so'
    : 'VERDICT: FAIL' );
if ( ok ) console.log( '         have each been shown able to fail.' );
console.log( '='.repeat( 78 ) );

try { rmSync( scratch, { recursive: true, force: true } ); } catch { /* scratch is disposable */ }
process.exit( ok ? 0 : 1 );
