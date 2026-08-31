# Control: the shared drivers still work on their default path

M5 task 3 edited two tools every gate in this repo depends on —
`web/tools/drive-browser.mjs` (added a repeatable `--chrome-flag`) and
`web/tools/drive-firefox.mjs` (added `--accept-insecure-certs`). Both additions
are inert when the flag is absent: the Chrome one spreads an empty array into
the argv it already built, the Firefox one passes `capabilities: {}`, which is
what was there before.

That is an argument, so here is the measurement. M5 task 1's gate, re-run
through the patched Chrome driver with **neither** new flag:

    node web/tools/drive-browser.mjs --headed --out /tmp/regress-vp \
         --script-file web/tools/viewport-menu-gate.steps

    aborts 0 | numVertices 0 | [EXCEPTION] 0 | non-favicon 404s 0
    glGetError 0x0 | 20 of 20 screenshots distinct

which is that gate's stated pass condition. The four full task-3 runs over
`http:` (`mp-http`, `mp-http-ff`, and the two boot-1 passes inside them) also
went through the patched drivers with no new flag and exercised every step verb
the gates use — `until`, `wait`, `click`, `shot`, `key`, `eval`, `mark`.
