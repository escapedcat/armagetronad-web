#!/usr/bin/env python3
"""Show that check-2x2.py can FAIL -- one targeted mutation per check.

    python3 docs/evidence/m5-o2-assertions/prove-2x2-can-fail.py

A checker that has only ever been run against passing evidence has not been
tested; it has been exercised. This builds a throwaway copy of the evidence
tree (plus four stub .js loaders, so the static E-checks stay meaningful), and
for each mutation asserts that the set of checks that flip is EXACTLY the set
the mutation declares -- not merely "something failed". Exits 0 if every
mutation lands where it says, 1 otherwise.

Mutation 0 is the unmutated control and must flip NOTHING; without it a
checker that failed everything unconditionally would score a perfect result
here.
"""
import os, re, shutil, subprocess, sys, tempfile, glob

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
SHOT = '08-VIEWPORTS-HIGHLIGHTED-THIS-IS-THE-CRASH-POINT.png'
MSG  = '`numVertices` must be an integer'
CELLS = ['cell-fix-assert-SHIPPED', 'cell-bug-assert', 'cell-bug-noassert', 'cell-fix-noassert']
PAGES = {'armagetronad': True, 'armagetronad-bug-assert': True,
         'armagetronad-bug-noassert': False, 'armagetronad-fix-noassert': False}

def build(tmp):
    ev = os.path.join(tmp, 'docs', 'evidence', 'm5-o2-assertions')
    os.makedirs(ev)
    shutil.copy(os.path.join(HERE, 'check-2x2.py'), ev)
    for c in CELLS:
        shutil.copytree(os.path.join(HERE, c), os.path.join(ev, c))
    d = os.path.join(tmp, 'web', 'dist-m1'); os.makedirs(d)
    for page, on in PAGES.items():
        # A stub, not a copy: these files are 300-360 KB each and the only
        # thing check-2x2.py reads out of them is whether the assert message
        # is there. Stubbing keeps this prover fast and makes the mutation
        # below ("put the message in a build that must not have it") obvious.
        open(os.path.join(d, page + '.js'), 'w').write(
            f'// stub loader for prove-2x2-can-fail.py\n'
            + (f'assert(numVertices%1==0,"{MSG}.");\n' if on else 'var numVertices=0;\n'))
    return ev

def rw(p, f):
    s = open(p, encoding='utf8', errors='replace').read()
    open(p, 'w', encoding='utf8').write(f(s))

def log(ev, cell): return os.path.join(ev, cell, 'console.log')
def shot(ev, cell): return os.path.join(ev, cell, SHOT)

MUTATIONS = [
    ('control -- nothing changed', set(), lambda ev: None),
    ('drop the assert message from the aborting transcript', {'A1'},
     lambda ev: rw(log(ev, 'cell-bug-assert'), lambda s: s.replace(MSG, 'something else entirely'))),
    ('drop "Aborted(" from the aborting transcript', {'A2'},
     lambda ev: rw(log(ev, 'cell-bug-assert'), lambda s: s.replace('Aborted(', 'Finished('))),
    ('drop the flush frame, so the stack no longer implicates glEnd', {'A3'},
     lambda ev: rw(log(ev, 'cell-bug-assert'),
                   lambda s: '\n'.join(l for l in s.splitlines() if not re.search(r'\bflush @ ', l)))),
    ('make the post-crash shots all different (tab NOT dead)', {'A4'},
     lambda ev: [shutil.copy(p, os.path.join(ev, 'cell-bug-assert', os.path.basename(p)))
                 for p in sorted(glob.glob(os.path.join(ev, 'cell-fix-assert-SHIPPED', '*.png')))[7:]]),
    ('inject an abort into the silent run', {'B1'},
     lambda ev: rw(log(ev, 'cell-bug-noassert'), lambda s: s + '\n[  1ms] [console.error] Aborted(x)\n')),
    ('inject the assert message into the silent run', {'B2'},
     lambda ev: rw(log(ev, 'cell-bug-noassert'), lambda s: s + f'\n[  1ms] [console.error] {MSG}\n')),
    ('inject an uncaught exception into the silent run', {'B3'},
     lambda ev: rw(log(ev, 'cell-bug-noassert'), lambda s: s + '\n[  1ms] [EXCEPTION] boom\n')),
    ('duplicate a shot so the silent run stops being 20 distinct', {'B4'},
     lambda ev: shutil.copy(sorted(glob.glob(os.path.join(ev, 'cell-bug-noassert', '*.png')))[0],
                            sorted(glob.glob(os.path.join(ev, 'cell-bug-noassert', '*.png')))[1])),
    ('give the SHIPPED build the borderless frame', {'B5', 'C1'},
     lambda ev: shutil.copy(shot(ev, 'cell-bug-noassert'), shot(ev, 'cell-fix-assert-SHIPPED'))),
    ('give the buggy bare--O2 run a correct frame', {'B6'},
     lambda ev: shutil.copy(shot(ev, 'cell-fix-assert-SHIPPED'), shot(ev, 'cell-bug-noassert'))),
    ('make the fix-at-bare--O2 control render wrong too', {'C1'},
     lambda ev: shutil.copy(shot(ev, 'cell-bug-noassert'), shot(ev, 'cell-fix-noassert'))),
    ('abort the fix-at-bare--O2 control', {'C2'},
     lambda ev: rw(log(ev, 'cell-fix-noassert'), lambda s: s + '\n[  1ms] [console.error] Aborted(x)\n')),
    ('delete a shot from the shipped run', {'D1'},
     lambda ev: os.remove(sorted(glob.glob(os.path.join(ev, 'cell-fix-assert-SHIPPED', '*.png')))[3])),
    ('abort the shipped run', {'D2'},
     lambda ev: rw(log(ev, 'cell-fix-assert-SHIPPED'), lambda s: s + '\n[  1ms] [console.error] Aborted(x)\n')),
    ('lose the glGetError probe', {'D3'},
     lambda ev: rw(log(ev, 'cell-fix-assert-SHIPPED'), lambda s: s.replace('alive, gl err=0x0', 'alive, gl err=0x502'))),
    ('lose the end-of-route liveness probe', {'D4'},
     lambda ev: rw(log(ev, 'cell-fix-assert-SHIPPED'), lambda s: s.replace('still alive, canvas 1024x768', 'gone'))),
    ('a real 404', {'D5'},
     lambda ev: rw(log(ev, 'cell-fix-assert-SHIPPED'), lambda s: s + '\n[  1ms] [404] /data/textures/missing.png\n')),
    ('leave the assert message in a build that must not have it', {'E-armagetronad-bug-noa'},
     lambda ev: open(os.path.join(ev, '..', '..', '..', 'web', 'dist-m1',
                                  'armagetronad-bug-noassert.js'), 'w').write(f'assert("{MSG}.")')),
    ('remove a loader so a static check silently skips', {'Z2'},
     lambda ev: os.remove(os.path.join(ev, '..', '..', '..', 'web', 'dist-m1', 'armagetronad-fix-noassert.js'))),
]

def failures(ev):
    r = subprocess.run([sys.executable, os.path.join(ev, 'check-2x2.py')],
                       capture_output=True, text=True)
    return {m.group(1) for m in re.finditer(r'^  FAIL (\S+)', r.stdout, re.M)}

bad = 0
for i, (name, expect, apply) in enumerate(MUTATIONS):
    tmp = tempfile.mkdtemp(prefix='aa-2x2-')
    try:
        ev = build(tmp)
        apply(ev)
        got = failures(ev)
        ok = got == expect
        bad += not ok
        print(('  PASS ' if ok else '  FAIL ') + f'{i:>2}. {name}')
        if not ok:
            print(f'        expected exactly {sorted(expect)}, got {sorted(got)}')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

print(f'\n{len(MUTATIONS)-bad}/{len(MUTATIONS)} mutations flipped exactly the checks they declare')
sys.exit(1 if bad else 0)
