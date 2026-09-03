# Hand-written Emscripten build (see PLAN.md: autotools is NOT used for wasm).
# M0: dedicated server for Node. Usage, from the repo root:
#     source deps/emsdk/emsdk_env.sh
#     make -f web/Makefile dedicated -j8
#
# Without the line below, a bare `make -f web/Makefile` builds the first target
# in the file -- the link rule -- and stops there, silently skipping the runtime
# data (see "Runtime data" further down). That failure is deferred and hard to
# read: the binary links and boots, then prints raw message ids instead of
# English text and tries to fetch its map over the network. `dedicated` is the
# only correct default.
.DEFAULT_GOAL := dedicated

EMXX      := em++
LIBXML2   := deps/build/libxml2-install

# -I src/emscripten MUST come first: it serves the hand-written config.h.
# -iquote list mirrors the per-library dirs in src/Makefile.am; -iquote src
# is what native builds get implicitly from compiling inside src/.
INCLUDES  := -I src/emscripten \
             -I $(LIBXML2)/include/libxml2 \
             -iquote src \
             -iquote src/tools -iquote src/network -iquote src/render \
             -iquote src/ui -iquote src/engine -iquote src/tron \
             -iquote src/thirdparty/binreloc \
             -iquote src/thirdparty/particles

# -MMD -MP emits a .d file beside each .o listing the headers that .o consumed,
# so editing a header rebuilds exactly what depends on it. This matters more here
# than in a typical project: src/emscripten/config.h is the file this port churns
# most, and without dependency tracking a macro edit yields "Nothing to be done"
# — or worse, a half-rebuilt tree where some translation units saw the old macro
# set and some the new. That kind of ODR mismatch links cleanly and misbehaves at
# runtime. -MP adds phony targets for the headers, so deleting or renaming one
# does not wedge the build with "No rule to make target".
# -fexceptions is not optional for this codebase. Emscripten's default is to let
# `throw` compile but to DROP every catch block (-sDISABLE_EXCEPTION_CATCHING=1),
# which turns the first throw into `Aborted(Assertion failed: Exception thrown,
# but exception catching is not enabled)`. That is fatal here because exceptions
# are structural, not just error paths: gCycleDeath (src/tron/gWall.cpp:679) and
# eSensorFinished (src/tron/gSensor.cpp:42) are gameplay control flow, tCleanQuit
# and tException are how gArmagetron.cpp:909-942 shuts down, nKillHim/nIgnore are
# how nNetwork.cpp:621-624 rejects a bad packet without dropping the server, and
# tRunningInBuildDirectory (tDirectories.cpp:1496) is part of path discovery.
# There are 42 catch sites against 60 throws.
#
# It must be passed at compile AND link. We use -fexceptions (the JS-based
# implementation) rather than -fwasm-exceptions deliberately: emcc itself warns
# "ASYNCIFY=1 is not compatible with -fwasm-exceptions" (emcc.py:487), and a
# later milestone needs Asyncify for the main loop. Revisit only if that plan
# changes to JSPI, which does support wasm EH.
#
# It is not free, and the cost carries into every later build. Rebuilding all
# 100 translation units with EXCEPTIONS empty and nothing else changed produces
# a 1,661,113-byte wasm; with -fexceptions it is 2,488,298 (+827,185 bytes,
# ~+50%; the .js glue adds a further +25,151).
#
# THAT NUMBER IS THIS BUILD'S -- the DEDICATED one, which has no Asyncify -- and
# it must not be quoted at the client. Exceptions and Asyncify multiply, because
# ASYNCIFY=1 instruments the unwinder along with everything else. Measured at M5
# task 2 by recompiling all 102 CLIENT translation units with EXCEPTIONS empty
# and relinking (docs/evidence/m5-o2-assertions/measure-fexceptions-cost.sh):
#
#                          without -fexceptions   with        delta
#   dedicated (this)              1,661,113    2,488,298   + 827,185  (+49.8%)
#   client, pre-M5-task-2 link    6,477,276    8,879,522   +2,402,246 (+37.1%)
#   client, shipped -O2 link      3,100,006    4,331,138   +1,231,132 (+39.7%)
#
# PLAN.md quoted +827,185 in three places as if it were the client's; all three
# are now annotated there rather than replaced, because the figure is real, it
# is just the wrong build's.
EXCEPTIONS := -fexceptions

# Shared by every variant compiled from this file (M0 dedicated, M1 client, and
# whatever M2 adds): the C++ standard, optimisation level, and dependency-file
# flags must not drift between them, so they live here once. Each variant's
# CXXFLAGS then adds only what makes it different (macros, -sUSE_* ports, ...).
BASE_CXXFLAGS := -std=gnu++14 -O2 -MMD -MP $(EXCEPTIONS)

CXXFLAGS  := $(BASE_CXXFLAGS) $(INCLUDES)

# The wildcards below sweep whole directories, so they also pick up files that
# src/Makefile.am never compiles: extra main()s, stale demos/test harnesses,
# dead code, and one .cpp that is #included rather than compiled. Each is listed
# with its reason below.
#
# The list was cross-checked against the *_SOURCES lists in src/Makefile.am. The
# resulting 100 translation units are the same *.cpp set a native dedicated build
# compiles. The one difference is thirdparty/binreloc/prefix.c, which
# src/Makefile.am:63 puts in libtools_a_SOURCES unconditionally (so native
# compiles 101 units): it is inert without ENABLE_BINRELOC, which this config
# does not define, and the link confirms nothing references it.
EXCLUDES  := \
  src/network/master.cpp        \
  src/network/astat.cpp         \
  src/network/l2_demo.cpp       \
  src/network/l3_demo.cpp       \
  src/network/nettest_main.cpp  \
  src/tools/memtest.cpp         \
  src/tools/transfab.cpp        \
  src/engine/test.cpp           \
  src/render/testgl.cpp         \
  src/network/nettest.cpp       \
  src/tools/tSafePTRBase.cpp    \
  src/render/rConsoleCout.cpp
# master.cpp   — main(), the separate master-server binary.
# astat, l2_demo, l3_demo, nettest_main, memtest, transfab, test, testgl
#              — main(), standalone demos/benchmarks; several no longer compile
#                against today's headers (SDL 1.2 API, private nNetObject::owner).
# nettest.cpp  — the nettest_main harness's other half; includes a nNet.h that
#                no longer exists in the tree.
# tSafePTRBase — dead code: its body is commented out and what remains refers to
#                a List<> template that was renamed tList<> long ago.
# rConsoleCout.cpp — excluded from BOTH builds, for opposite reasons.
#   dedicated: rConsoleGraph.cpp:274 #includes it textually (the #else of
#              #ifndef DEDICATED), so compiling it too would duplicate it.
#   client:    that #else is dead, so the file contributes nothing — and
#              compiling it would collide with the graphical console
#              (DoCenterDisplay, DisplayAtNewline, sr_InputForScripts).
SRCS      := $(filter-out $(EXCLUDES), \
               $(wildcard src/tools/*.cpp) $(wildcard src/network/*.cpp) \
               $(wildcard src/engine/*.cpp) $(wildcard src/render/*.cpp) \
               $(wildcard src/ui/*.cpp)    $(wildcard src/tron/*.cpp))
OBJDIR    := web/build-m0
OBJS      := $(SRCS:src/%.cpp=$(OBJDIR)/%.o)

LDFLAGS   := -sENVIRONMENT=node -sNODERAWFS=1 -sEXIT_RUNTIME=1 \
             -sALLOW_MEMORY_GROWTH=1 $(EXCEPTIONS)

web/dist-m0/armagetronad-dedicated.js: $(OBJS) $(LIBXML2)/lib/libxml2.a
	@mkdir -p web/dist-m0
	$(EMXX) $(OBJS) $(LIBXML2)/lib/libxml2.a $(LDFLAGS) -o $@

# Objects also depend on this Makefile, so editing a flag (a -D, the include
# list, the optimisation level) actually triggers a rebuild instead of silently
# leaving stale objects behind. The link target needs no such rule: it depends on
# every object, and every object depends on this file.
$(OBJDIR)/%.o: src/%.cpp web/Makefile
	@mkdir -p $(dir $@)
	$(EMXX) $(CXXFLAGS) -c $< -o $@

# The generated header dependencies. Lowercase -include: on a clean tree the .d
# files do not exist yet and must not be an error. They live in $(OBJDIR), so
# `clean` already removes them.
-include $(OBJS:.o=.d)

# ---- M1: browser client -------------------------------------------------
# Same 100 source files as the dedicated build. Deliberately NOT adding
# src/thirdparty/particles: USE_PARTICLES is commented out at
# gParticles.h:32, so it is dead code, and linking its objects directly
# (native hides them in a .a) would add glCallList, glPushClientAttrib and
# glPopClientAttrib as undefined symbols for no benefit.
CLIENT_OBJDIR := web/build-m1
# ...plus two translation units the dedicated build does not have:
#
#   src/emscripten/eCompat.cpp     the compatibility shims for the symbols
#                                  Emscripten's SDL and GL emulation leave
#                                  undefined.
#   src/emscripten/eWebPersist.cpp M4 task 2: saves the config when the player
#                                  leaves a menu, and exports the one function
#                                  web/shell.html's unload backstop calls.
#   src/emscripten/eWebInput.cpp   phone feedback round 2: exports
#                                  aa_web_input_context(), the two bits
#                                  web/shell.html's touch overlay reads to
#                                  decide whether a tap means Enter or a turn.
#
# They have to be named here because $(SRCS) above wildcards the six game
# source directories only, and src/emscripten/ is not one of them (it holds
# the hand-written config.h, not game source). No extra compile rule is needed
# for any of them: the $(CLIENT_OBJDIR)/%.o: src/%.cpp rule below already
# matches, with a stem of "emscripten/eCompat" -- stems may contain slashes.
#
# Naming eWebPersist.cpp HERE rather than moving it into $(SRCS) is what keeps
# the dedicated build's wasm byte-identical: $(SRCS) feeds BOTH targets, so a
# file added there would compile into the server too. (The file also guards
# its whole body with `#if defined(__EMSCRIPTEN__) && !defined(DEDICATED)`, so
# even a future move could not change the server's behaviour -- but it would
# still change its size, because an empty translation unit is not a
# non-existent one.)
CLIENT_OBJS   := $(SRCS:src/%.cpp=$(CLIENT_OBJDIR)/%.o) \
                 $(CLIENT_OBJDIR)/emscripten/eCompat.o \
                 $(CLIENT_OBJDIR)/emscripten/eWebPersist.o \
                 $(CLIENT_OBJDIR)/emscripten/eWebInput.o
CLIENT_DEFS   := -DAA_WEB_CLIENT
# SDL and libpng are needed at COMPILE time for their headers, not just at link.
CLIENT_PORTS  := -sUSE_SDL=1 -sUSE_LIBPNG=1
# $(EXCEPTIONS) is required at COMPILE time as well as link — see the
# comment on its definition above; omitting it here silently discards catches.
# $(BASE_CXXFLAGS) keeps the standard/optimisation/dependency flags identical
# to the dedicated build's CXXFLAGS above — see its definition for why.
CLIENT_CXXFLAGS := $(BASE_CXXFLAGS) $(CLIENT_DEFS) $(CLIENT_PORTS) $(INCLUDES)

# -sASYNCIFY is what lets this program run in a browser at all, and it is a
# LINK-time transform: Binaryen rewrites the linked wasm so that a call stack
# can be unwound to the JS caller and rebuilt later. It is deliberately absent
# from CLIENT_CXXFLAGS -- passing it at compile time would do nothing.
#
# It is needed because the game has no frame callback. Every loop in it -- the
# main menu, the round loop, the connection and download waits -- is a plain
# while() that returns only when its work is done, and a browser tab that never
# yields to the event loop is a frozen tab. The single yield point that makes
# this pay off is emscripten_sleep(0) at the top of rSysDep::SwapGL()
# (src/render/rSysdep.cpp); Asyncify is the machinery that makes that call able
# to return.
#
# It is not free, and M5's size budget needs the number. Relinking the same
# objects with and without these two flags (101 of them when this was measured
# at M2 -- the client links 102 today, since M4 added eWebPersist.o; the delta
# below was re-measured at M5 recon as +5,893,427 / +197.4% and agrees):
#     without   2,982,495 bytes wasm      584,996 bytes js
#     with      8,871,099 bytes wasm      625,787 bytes js
#     delta    +5,888,604 bytes (+197%)   +40,791 bytes (+7%)
# The wasm very nearly triples. That makes Asyncify by a wide margin the single
# largest line item in the size budget -- seven times -fexceptions' +827,185
# (see the EXCEPTIONS comment above), and it displaces it as the figure to
# quote first. The reason is that ASYNCIFY=1 instruments every function that
# might be on the stack when an async call happens, and here that is reachable
# from essentially the whole program: SwapGL() is called from the bottom of the
# render tree, which is called from every game loop.
#
# The lever, if this has to come down, is ASYNCIFY_ONLY (or ASYNCIFY_REMOVE):
# hand Binaryen the list of functions that really can be on the stack across a
# yield, and it instruments only those. Do NOT hand-write that list -- getting
# it wrong produces an "unreachable" trap at runtime, not a build error.
# Generate it with -sASYNCIFY_ADVISE, which prints every function Binaryen
# instrumented together with the reason it was included; that output is the
# input to a defensible ASYNCIFY_ONLY. Worth doing only once the client runs,
# so the advice can be checked against real behaviour -- i.e. M5, not here.
#
# JSPI is the other exit and would cost far less. Its blocker is browser
# baseline. An earlier draft of this comment also asserted that JSPI conflicts
# with -fexceptions; that was NOT verified and this emsdk does not enforce it
# (src/settings.js has `var JSPI = 0`, and tools/link.py encodes no
# JSPI/exceptions or JSPI/longjmp error -- its only Asyncify incompatibility is
# WASM_ESM_INTEGRATION). Treat the interaction as needing verification against
# the emsdk in use rather than as a known blocker.
#
# ASYNCIFY_STACK_SIZE is the side buffer the unwound frames are copied into,
# and it is a fixed allocation, not a growing one -- overflowing it is a
# runtime abort ("Asyncify stack overflow"), not a reallocation. The default is
# 4096 bytes, which is not enough here: SwapGL() is called from the bottom of
# deeply nested render code, and the whole chain from main() down has to fit.
# 131072 (128KB) is 32x the default and costs 128KB of linear memory once. It
# has NOT been validated against a running client.
#
# Fuller notes, including the console-output cost of the yield:
# docs/porting/browser-runtime-notes.md sections 2 and 7.
#
# ---- M1 Task 6: preload the runtime data tree and generate the page -----
#
# --use-preload-plugins is NOT optional. Without it Emscripten's IMG_Load_RW
# warns once and then returns 0 for every single file, so no texture ever
# loads -- the plugin is what registers the preloaded bytes with SDL_image's
# virtual file layer. (Flagged by Task 3's reviewer as this task's job.)
#
# Each --preload-file maps a source-tree directory (path relative to the
# repo root, since that is where `make -f web/Makefile` runs) to a path
# inside the in-memory filesystem the game sees at runtime. The right-hand
# side of every mapping below must agree with the --datadir/--userconfigdir
# arguments web/shell.html passes to Module.arguments -- the game does not
# search for its data, it is told exactly where to look.
#   config, language, textures, models, sound, resource/included
#     -> /data/<same-name>, matching --datadir /data.
#   web/webdefaults
#     -> /data/webdefaults, matching --userconfigdir /data/webdefaults.
#     This ships web/webdefaults/autoexec.cfg into the bundle -- see that
#     file's own comment for the load-order mechanics that make it work
#     (tConfiguration.cpp loads autoexec.cfg unconditionally, last) and for
#     why /data/webdefaults REPLACES rather than merges with the shipped
#     config directory: anything else dropped in here (a settings.cfg, a
#     keys_*.cfg) would silently shadow the real one, not extend it.
#
# The --exclude-file patterns drop ~1 MB of the ~1.6 MB source tree (raw file
# bytes; du -sh reports higher due to block rounding) that no milestone reads
# at runtime: GIMP .xcf sources behind the shipped textures, five non-English
# language files plus the transliterated Polish variant (the Demo is
# English-only), the language file's build-time update.py, and the dedicated
# server's settings. None of this is reachable code, so cutting it is free --
# but the size drop does NOT verify itself; see the pattern-shape note below,
# which is the actual reason a first attempt at this quietly excluded nothing.
#
# tools/file_packager.py's should_ignore() matches each pattern with
# fnmatch.fnmatch(fullname, pattern), and fullname is the SOURCE-RELATIVE
# path (e.g. "language/deutsch.txt"), not the bare basename. A bare
# 'deutsch.txt' pattern therefore matches nothing -- fnmatch requires the
# whole string to match, and fnmatch's '*' happens to cross '/' so only a
# pattern with a leading wildcard (or an explicit directory component)
# matches a nested file. '*.xcf' below works by accident of that same rule
# (the '*' swallows the whole "textures/.../" prefix); every fixed filename
# needs the same '*/' prefix to match at all. Confirmed by grepping the built
# armagetronad.js for these paths post-link -- do that again if any of these
# lines are ever touched, because a silently-ignored --exclude-file fails
# nothing at build time, it just ships the file anyway.
#
# --shell-file replaces Emscripten's stock loader page with web/shell.html.
#
# ---- M4 Task 1: make /persist survive a reload --------------------------
#
# -lidbfs.js adds src/lib/libidbfs.js to the link. It is NOT part of the
# default JS library set (nothing in tools/link.py, tools/system_libs.py or
# emcc.py so much as mentions idbfs), and naming $IDBFS in
# EXPORTED_RUNTIME_METHODS is not enough on its own: exporting a symbol that
# no linked library defines is a link-time error, not an implicit include.
# Both flags are needed, and both belong here rather than in LDFLAGS -- the
# dedicated build runs under NODERAWFS, where the real filesystem already
# persists and IndexedDB does not exist.
#
# EXPORTED_RUNTIME_METHODS is EXTENDED, not repeated. It is a plain
# assignment, so a second -sEXPORTED_RUNTIME_METHODS= flag would REPLACE the
# list rather than add to it, silently dropping callMain -- which is the
# exact failure the long comment above describes (Play button, abort()).
# Four names now:
#   callMain   -- unchanged, see above.
#   FS, IDBFS  -- web/shell.html mounts /persist with them, and the evidence
#                 scripts in web/tools/ read the mount back through FS.
#   addRunDependency, removeRunDependency
#              -- how shell.html blocks main() until the IndexedDB->MEMFS
#                 populate has FINISHED. See the long comment on preRun in
#                 web/shell.html for why that is the whole point of the
#                 mount and why an un-awaited populate fails silently.
#                 (These two are also auto-exported by FORCE_FILESYSTEM's
#                 isExportedByForceFilesystem() list in
#                 src/runtime_debug.js, but that is a diagnostics helper,
#                 not a promise about the export table -- name them.)
#
# -sEXPORTED_RUNTIME_METHODS=callMain is not optional either, and for a
# reason that will not show up as a build error: Emscripten never
# auto-exports callMain (postamble.js says as much -- it is explicitly the
# embedder's job, settings.js documents it the same way), so without this
# flag it lands in the loader's unexportedSymbols list. The page still
# links, still loads, still reaches "Ready" -- it dies the instant
# web/shell.html's Play button calls Module.callMain(), because the
# unexported-symbol getter's body is an abort(). Fixing this now rather
# than at M5 matters because that abort's helpful message only exists while
# ASSERTIONS defaults on; the moment -O2 (or any release flag that turns
# ASSERTIONS off) reaches this link, the same bug degrades to a bare,
# unattributed TypeError. Verify this one by grep, the same way the
# --exclude-file bug above was actually caught: confirm "callMain" appears
# outside of unexportedSymbols in the built armagetronad.js, do not trust
# that adding the flag was enough.
# ---- M5 Task 2: -O2 at link, with ASSERTIONS held on -------------------
#
# -O2 here is a LINK-time flag and does something the -O2 already in
# BASE_CXXFLAGS cannot: it runs Binaryen's wasm-opt over the whole linked
# module (after the Asyncify transform, which is where nearly all of this
# binary's bulk comes from) and minifies the JS glue. Compile-time -O2 has
# been on since M0 and does not reach either of those. The wire total for the
# four served files drops from 4,097,666 to 1,707,754 bytes gzipped -- 3.91 MiB
# to 1.63 MiB, a 58% cut -- against PLAN.md's 15 MB budget.
#
# -sASSERTIONS=1 is NOT redundant and NOT optional. Emscripten's default for
# ASSERTIONS is 1 at -O0 and 0 from -O1 up (src/settings.js documents the
# default, tools/link.py flips it with the optimisation level), so adding -O2
# alone silently turns assertions OFF. That is the whole reason PLAN.md and
# docs/porting/browser-runtime-notes.md section 10 banned -O at link from M2
# through M4: section 10's defect class -- one glBegin/glEnd block gets one
# vertex format -- has two failure modes, an assert in glEnd (loud, fixable)
# and a slot count that happens to divide evenly (silent garbage geometry).
# Dropping ASSERTIONS converts every future instance of the first kind into the
# second kind.
#
# The ban was really a ban on losing ASSERTIONS, and the two are separable.
# That is not an argument, it is a measurement -- re-established on this build
# by FIRING the assert, not by reading flag defaults. With M5 task 1's
# RenderEnd() removed from rViewportConfiguration::DemonstrateViewport (the
# only known live section-10 site, hence the only one that can be fired):
#   -O2 -sASSERTIONS=1  ->  Aborted(Assertion failed: `numVertices` must be an
#                           integer.) from _emscripten_glEnd, same route and
#                           same message as the no-O build.
#   -O2 alone           ->  NO abort. The tab survives the same keystroke and
#                           draws the panel with its border wrong, which is
#                           exactly failure mode 2. The control that makes
#                           that attributable to the DEFECT rather than to
#                           -O2 or to ASSERTIONS=0 is the fourth cell: the
#                           FIXED objects linked with bare -O2 render
#                           correctly.
# Full transcripts, screenshots and the re-runnable script:
# docs/evidence/m5-o2-assertions/.
#
# Assertions cost 5.1% of the wire total over bare -O2. That is the price of
# keeping this port's largest defect class loud, and it is worth it.
#
# -O2 rather than -O3/-Os/-Oz: measured at M5 recon, the four differ by 10,728
# bytes on the wire (0.9%) and the raw-size ordering INVERTS under gzip. -O2 is
# emcc's own recommended default. Not worth revisiting without a new
# measurement.
#
# Deliberately NOT added to $(LDFLAGS): the dedicated build's wasm is a
# byte-identity invariant across the whole port (2,488,298 bytes, md5
# 9718a2a64978cb6e9b95ea2f0454cca5), and it is a Node diagnostic tool, not a
# shipped artefact, so it has nothing to gain and an invariant to lose.
CLIENT_LDFLAGS := -O2 -sASSERTIONS=1 \
                  $(CLIENT_PORTS) -sLEGACY_GL_EMULATION=1 \
                  -sALLOW_MEMORY_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=1 \
                  -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=131072 \
                  -sEXPORTED_RUNTIME_METHODS=callMain,FS,IDBFS,addRunDependency,removeRunDependency \
                  -lidbfs.js \
                  $(EXCEPTIONS) \
                  --use-preload-plugins \
                  --preload-file config@/data/config \
                  --preload-file language@/data/language \
                  --preload-file textures@/data/textures \
                  --preload-file models@/data/models \
                  --preload-file sound@/data/sound \
                  --preload-file resource/included@/data/resource/included \
                  --preload-file web/webdefaults@/data/webdefaults \
                  --exclude-file '*.xcf' --exclude-file '*/update.py' \
                  --exclude-file '*/settings_dedicated.cfg' \
                  --exclude-file '*/deutsch.txt' --exclude-file '*/polish.txt' \
                  --exclude-file '*/polish_transliterated.txt' \
                  --exclude-file '*/spanish.txt' --exclude-file '*/french.txt' \
                  --exclude-file '*/portugese.txt' \
                  --shell-file web/shell.html

# The primary output is the .html page (Task 6's actual deliverable); the
# .js loader, .wasm binary and .data archive are generated alongside it by
# the same emcc invocation.
#
# The prerequisite list below is NOT "every preloaded directory" -- it is
# five files: web/shell.html, web/webdefaults/autoexec.cfg, and the three
# generated data files, because those are the only preload inputs whose
# paths this Makefile can name without shelling out to `find`. Editing
# anything else under config/, language/, textures/, models/ or sound/
# (e.g. adding a texture) does NOT trigger a relink -- Make has no rule
# pointing at those files, so it will silently reuse a stale .data archive.
# Run `make -f web/Makefile clean && make ... client` (or just
# `rm -f web/dist-m1/armagetronad.*`) after touching any preloaded asset
# that isn't one of the five named below.
#
# resource/proto is the EXCEPTION, and an earlier version of this comment
# listed it wrongly among the uncovered directories. It IS covered, just
# indirectly: the resource/included/.mapversion rule further down lists
# $(shell find resource/proto -type f) among its prerequisites, so editing
# or adding a map re-runs sortresources, which restamps .mapversion, which
# is a prerequisite here -- and the relink follows. Verified with
# `touch resource/proto/<file> && make -f web/Makefile -n client`, which
# prints both the sortresources recipe and the em++ link. One real gap
# remains: that `find` runs when Make PARSES this file, so a map you DELETE
# is not noticed (nothing ends up newer than .mapversion). Deleting a map
# still needs the manual clean above.
#
# The three generated-data paths (spelled out here, not as $(DATA) -- that
# variable isn't assigned until the "Runtime data" section further down, and
# a prerequisite list is expanded when Make reads this line, not when it
# finally builds the target, so $(DATA) here would silently expand to
# nothing) are listed explicitly for a reason that did not matter for M0:
# --preload-file reads these directories off disk at LINK time and bundles
# whatever it finds right then, whereas M0's NODERAWFS reads them at RUN
# time. Without this dependency, `make -f web/Makefile client -j8` on a
# clean checkout can race -- Make is free to start the link the moment every
# .o exists, before config/aiplayers.cfg, language/languages.txt or
# resource/included/.mapversion (and the map files sortresources produces
# alongside it) have been generated, silently shipping a client missing its
# maps, AI roster or language table. It did not bite in practice while
# developing this task only because those files already existed from an
# earlier milestone's build; verify after touching this rule by running
# `clean-data` first.
web/dist-m1/armagetronad.html: $(CLIENT_OBJS) $(LIBXML2)/lib/libxml2.a \
                                web/shell.html web/webdefaults/autoexec.cfg \
                                language/languages.txt config/aiplayers.cfg \
                                resource/included/.mapversion
	@mkdir -p web/dist-m1
	$(EMXX) $(CLIENT_OBJS) $(LIBXML2)/lib/libxml2.a $(CLIENT_LDFLAGS) -o $@

$(CLIENT_OBJDIR)/%.o: src/%.cpp web/Makefile
	@mkdir -p $(dir $@)
	$(EMXX) $(CLIENT_CXXFLAGS) -c $< -o $@

-include $(CLIENT_OBJS:.o=.d)

.PHONY: client
client: data web/dist-m1/armagetronad.html

# ---- M4 Task 2: the CONTROL client ---------------------------------------
#
#   source deps/emsdk/emsdk_env.sh
#   make -f web/Makefile client client-control -j8
#
# A second, complete page -- armagetronad-nomenusave.html plus its own .js,
# .wasm and .data -- that differs from the real client in exactly one thing:
# src/emscripten/eWebPersist.cpp's uCallbackMenuLeave registration is compiled
# out. The game still runs, still saves on boot via rScreen.cpp, still has the
# JS backstop; what it does not have is a save caused by the player leaving a
# menu.
#
# WHY A WHOLE SECOND LINK RATHER THAN A PAGE EDIT. The three control pages in
# docs/evidence/m4-persist/make-control-pages.mjs are text edits to the
# GENERATED html, which is enough when the thing being controlled lives in
# web/shell.html. This task's primary mechanism lives in the wasm, and no edit
# to the page can reach it. Without this target the settings gate's central
# checks could only be falsified by mutating a transcript, which demonstrates
# that the CHECKER can fail, not that the claim can. It is cheap: one extra
# translation unit and one relink.
#
# It is deliberately NOT part of `client` and NOT part of any default goal --
# it doubles the link time and writes ~9.5 MB of control artefacts that only
# the evidence run wants.
CONTROL_OBJS := $(filter-out $(CLIENT_OBJDIR)/emscripten/eWebPersist.o,$(CLIENT_OBJS)) \
                $(CLIENT_OBJDIR)/emscripten/eWebPersist-nomenusave.o

# Its own object path, so it can never collide with the real one in the shared
# $(CLIENT_OBJDIR) -- two objects from the same source with different -D at the
# same path would silently alternate depending on which target ran last.
$(CLIENT_OBJDIR)/emscripten/eWebPersist-nomenusave.o: src/emscripten/eWebPersist.cpp web/Makefile
	@mkdir -p $(dir $@)
	$(EMXX) $(CLIENT_CXXFLAGS) -DAA_WEB_NO_MENU_SAVE -c $< -o $@

web/dist-m1/armagetronad-nomenusave.html: $(CONTROL_OBJS) $(LIBXML2)/lib/libxml2.a \
                                web/shell.html web/webdefaults/autoexec.cfg \
                                language/languages.txt config/aiplayers.cfg \
                                resource/included/.mapversion
	@mkdir -p web/dist-m1
	$(EMXX) $(CONTROL_OBJS) $(LIBXML2)/lib/libxml2.a $(CLIENT_LDFLAGS) -o $@

.PHONY: client-control
client-control: data web/dist-m1/armagetronad-nomenusave.html

# ---- M5 Task 5: the CONTROL client with the OLD yield placement ------------
#
#   source deps/emsdk/emsdk_env.sh
#   make -f web/Makefile client client-oldyield -j8
#
# Same shape and same reason as client-control and client-fullscreentoggle: a
# second complete page, armagetronad-oldyield.html, differing from the shipped
# client in exactly one preprocessor symbol.
#
# THIS TARGET IS THE INVERSE OF THE ONE M5 TASK 4C ADDED, and the rename is the
# point rather than tidying. 4c shipped rSysDep::SwapGL()'s emscripten_sleep(0)
# at the TOP of the function -- above rPerFrameTask::DoPerFrameTasks(), which
# draws the entire overlay -- and built `client-yieldprobe` with it moved below,
# to prove that placement was the HUD flicker. Task 5 made the moved placement
# the shipped one (after the swap block, so it is also after glFlush), so the
# control has to become the OLD placement or there is nothing to compare
# against. AA_WEB_YIELD_BEFORE_PERFRAME puts it back at the top.
#
# The claim it falsifies: on the shipped page a compositor-clock sampler must
# find the HUD-gone run count collapse, and on THIS page it must not. A run
# where both pages look the same means the sampler is not measuring what it
# thinks it is -- which is exactly what happened to the three swap-time probes
# kept in docs/evidence/m5-defect-b-hud-flicker/negative-swap-time-only/.
#
# NOT part of `client` and not a default goal: it doubles the link time and
# writes ~5 MB of artefacts that only the evidence run wants.
OLDYIELD_OBJS := $(filter-out $(CLIENT_OBJDIR)/render/rSysdep.o,$(CLIENT_OBJS)) \
                 $(CLIENT_OBJDIR)/render/rSysdep-oldyield.o

# Its own object path, for the reason spelled out above eWebPersist-nomenusave.o.
$(CLIENT_OBJDIR)/render/rSysdep-oldyield.o: src/render/rSysdep.cpp web/Makefile
	@mkdir -p $(dir $@)
	$(EMXX) $(CLIENT_CXXFLAGS) -DAA_WEB_YIELD_BEFORE_PERFRAME -c $< -o $@

web/dist-m1/armagetronad-oldyield.html: $(OLDYIELD_OBJS) $(LIBXML2)/lib/libxml2.a \
                                web/shell.html web/webdefaults/autoexec.cfg \
                                language/languages.txt config/aiplayers.cfg \
                                resource/included/.mapversion
	@mkdir -p web/dist-m1
	$(EMXX) $(OLDYIELD_OBJS) $(LIBXML2)/lib/libxml2.a $(CLIENT_LDFLAGS) -o $@

.PHONY: client-oldyield
client-oldyield: data web/dist-m1/armagetronad-oldyield.html

# ---- M5 Task 5: the CONTROL client that still has the fullscreen key -------
#
#   source deps/emsdk/emsdk_env.sh
#   make -f web/Makefile client client-fullscreentoggle -j8
#
# Same shape and same reason as client-control and client-yieldprobe above: a
# second complete page, armagetronad-fstoggle.html, differing from the shipped
# client in exactly one preprocessor symbol. AA_WEB_KEEP_FULLSCREEN_TOGGLE
# removes the early return M5 task 5 added to gMenus.cpp's
# toggle_fullscreen_func, so on this page the 'f' and 'n' keys still flip
# currentScreensetting.fullscreen and call sr_ReinitDisplay().
#
# IT IS THE POSITIVE CONTROL FOR A NEGATIVE CLAIM, which is the only reason it
# exists. The shipped claim is "pressing f during play does nothing and the
# canvas keeps the size the page gave it". Run against the shipped page alone
# that is indistinguishable from a key event that never reached the game --
# from a driver that types into the wrong element, from an SDL keysym that does
# not match the bind, from a canvas that never had focus. On this page the SAME
# keystroke through the SAME script must visibly re-init the display. If it
# does not, the shipped result means nothing and the run is void.
#
# NOT part of `client` and not a default goal: it doubles the link time and
# writes ~5 MB of artefacts that only the evidence run wants.
FSTOGGLE_OBJS := $(filter-out $(CLIENT_OBJDIR)/tron/gMenus.o,$(CLIENT_OBJS)) \
                 $(CLIENT_OBJDIR)/tron/gMenus-fstoggle.o

# Its own object path, for the reason spelled out above eWebPersist-nomenusave.o.
$(CLIENT_OBJDIR)/tron/gMenus-fstoggle.o: src/tron/gMenus.cpp web/Makefile
	@mkdir -p $(dir $@)
	$(EMXX) $(CLIENT_CXXFLAGS) -DAA_WEB_KEEP_FULLSCREEN_TOGGLE -c $< -o $@

web/dist-m1/armagetronad-fstoggle.html: $(FSTOGGLE_OBJS) $(LIBXML2)/lib/libxml2.a \
                                web/shell.html web/webdefaults/autoexec.cfg \
                                language/languages.txt config/aiplayers.cfg \
                                resource/included/.mapversion
	@mkdir -p web/dist-m1
	$(EMXX) $(FSTOGGLE_OBJS) $(LIBXML2)/lib/libxml2.a $(CLIENT_LDFLAGS) -o $@

.PHONY: client-fullscreentoggle
client-fullscreentoggle: data web/dist-m1/armagetronad-fstoggle.html

# ---- M4 Task 3: the CONTROL client that still overrides the player ---------
#
#   source deps/emsdk/emsdk_env.sh
#   make -f web/Makefile client client-oldautoexec -j8
#
# A second complete page -- armagetronad-oldautoexec.html plus its own .js,
# .wasm and .data -- identical to the real client except that its preloaded
# /data/webdefaults/autoexec.cfg has `MAX_FPS 60` and `SOUND_BUFFER_SHIFT 1`
# appended. That is precisely task 3's fix undone: autoexec.cfg loads after
# user.cfg, so with those two lines back the player's saved choice is
# overridden on every load exactly as it was before the task.
#
# WHY THIS IS THE RIGHT CONTROL, AND WHY IT DOES NOT NEED A DIFFERENT BINARY.
# The claim being tested is about PRECEDENCE, not about code: "a value named in
# autoexec.cfg beats user.cfg". The compiled default the task added is simply
# not consulted when a config file names the item, so re-adding the line
# reproduces the old behaviour bit for bit while holding the wasm constant.
# Holding the wasm constant is the point -- it means the two runs differ in
# exactly one input, the config file, and a difference in outcome cannot be
# blamed on anything else.
#
# THE CONTROL FILE IS DERIVED, NOT CHECKED IN. It is generated by appending to
# the shipped autoexec.cfg, so it cannot drift away from it: any future edit to
# the real file flows into the control automatically, and there is no second
# copy of that long comment to keep in sync. The `#` heading the recipe printf's
# ahead of the copied body is not decoration either -- a stray copy of this file
# must announce what it is.
#
# It is deliberately NOT part of `client` and NOT part of any default goal: it
# doubles link time and writes ~9.5 MB that only the evidence run wants.
OLDCFG_DIR := $(CLIENT_OBJDIR)/webdefaults-oldautoexec

$(OLDCFG_DIR)/autoexec.cfg: web/webdefaults/autoexec.cfg web/Makefile
	@mkdir -p $(dir $@)
	@cp $< $@
	@printf '\n# ------------------------------------------------------------------\n' >> $@
	@printf '# GENERATED CONTROL FILE -- NOT SHIPPED. web/Makefile appends the two\n' >> $@
	@printf '# lines below to build armagetronad-oldautoexec.html, the page that\n' >> $@
	@printf '# reproduces the pre-M4-task-3 bug on purpose. If you are reading this\n' >> $@
	@printf '# inside the real bundle, something has gone badly wrong.\n' >> $@
	@printf 'MAX_FPS 60\n' >> $@
	@printf 'SOUND_BUFFER_SHIFT 1\n' >> $@

web/dist-m1/armagetronad-oldautoexec.html: $(CLIENT_OBJS) $(LIBXML2)/lib/libxml2.a \
                                web/shell.html $(OLDCFG_DIR)/autoexec.cfg \
                                language/languages.txt config/aiplayers.cfg \
                                resource/included/.mapversion
	@mkdir -p web/dist-m1
	$(EMXX) $(CLIENT_OBJS) $(LIBXML2)/lib/libxml2.a \
	  $(subst --preload-file web/webdefaults@/data/webdefaults,--preload-file $(OLDCFG_DIR)@/data/webdefaults,$(CLIENT_LDFLAGS)) \
	  -o $@

.PHONY: client-oldautoexec
client-oldautoexec: data web/dist-m1/armagetronad-oldautoexec.html

# ---------------------------------------------------------------------------
# Runtime data.
#
# A checked-out tree is not a runnable tree: three of the files the server reads
# at startup are generated, and a native build gets them from `configure` and
# `make` long before the binary runs. This Makefile deliberately does not use
# autotools, so it has to do that work itself. All three outputs are already
# covered by .gitignore (lines 49, 52, 54), so nothing generated here is
# committable. Each rule below mirrors the autotools rule it replaces.
#
# Every rule also depends on this Makefile, for the same reason the object rules
# do (see the comment above $(OBJDIR)/%.o): the substitution text and the
# sortresources invocation live *here*, so editing them has to invalidate the
# data they produced, or a flag edit silently leaves stale data behind. Upstream
# agrees -- resource/Makefile.am:8 lists `Makefile` among the prerequisites of
# its `included:` rule.
DATA := language/languages.txt config/aiplayers.cfg resource/included/.mapversion

# configure.ac:1059 lists language/languages.txt in AC_OUTPUT. @progtitle@ is its
# only substitution, defaulted at configure.ac:447-448 to "Armagetron Advanced".
# Without the generated file there is no language at all: tLocale::FindStrict
# reports "Language British English not found" and every message afterwards
# prints as its raw id ("config_command_unknown" rather than English text).
language/languages.txt: language/languages.txt.in web/Makefile
	sed -e 's,@progtitle@,Armagetron Advanced,g' $< > $@

# Also AC_OUTPUT (configure.ac:1060). aiplayers.cfg.in contains no @substitution@
# at all, so configure only copies it. It carries the AI character table that
# gAICharacter reads.
config/aiplayers.cfg: config/aiplayers.cfg.in web/Makefile
	cp $< $@

# resource/Makefile.am's `included:` rule, which its `all:` target depends on.
# sortresources does NOT merely copy resource/proto. It parses each map's
# <Map name= author= category= version=> attributes and refiles it under the
# name the game actually asks for. That rename is the only reason the default
# map exists: proto/Anonymous/original/original.map.xml is republished as
# Anonymous/polygon/regular/square-1.0.1.aamap.xml, which is verbatim
# DEFAULT_MAP in src/tron/gGame.cpp:121. Skip this step and no local resource
# path matches, so tResourceManager falls through to downloading the map from
# resource.armagetronad.net -- which under Node's socket emulation fails with
# "Unknown IO error" and takes the map load down with it.
# .mapversion is sortresources' own final output, so it stamps a complete run.
#
# The `test -f $@` is not belt-and-braces. sortresources:11 opens with
# `test -d $source || exit 0`, so a missing or renamed resource/proto makes it
# report success having produced nothing at all -- after which the server finds
# no local map and silently falls back to downloading from the network, which is
# the exact failure this rule exists to prevent. Upstream guards the same recipe
# with `|| { rm -rf $@; false; }` (resource/Makefile.am:9); this checks the
# stamp too, because an exit status of 0 is not evidence here. On failure the
# whole output directory goes, so a half-built tree can never look complete.
resource/included/.mapversion: batch/make/sortresources batch/make/sortresources.py web/Makefile $(shell find resource/proto -type f 2>/dev/null)
	@sh batch/make/sortresources resource/proto resource/included batch/make/sortresources.py && test -f $@ \
	  || { rm -rf resource/included; \
	       echo "web/Makefile: sortresources produced no resources - is resource/proto present?" >&2; \
	       false; }

.PHONY: dedicated data clean
data: $(DATA)
dedicated: web/dist-m0/armagetronad-dedicated.js data
clean:
	rm -rf $(OBJDIR) web/dist-m0 $(CLIENT_OBJDIR) web/dist-m1
# `clean` deliberately leaves $(DATA) alone: it is generated *source-tree* data,
# not build output, and regenerating it is slow-ish and never the thing at fault.
.PHONY: clean-data
clean-data:
	rm -rf resource/included language/languages.txt config/aiplayers.cfg
