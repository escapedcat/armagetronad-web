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
# ~+50%; the .js glue adds a further +25,151). That is the single largest known
# line item in PLAN.md's M5 size budget.
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
# ...plus one translation unit the dedicated build does not have:
# src/emscripten/eCompat.cpp, the compatibility shims for the symbols
# Emscripten's SDL and GL emulation leave undefined. It has to be named here
# because $(SRCS) above wildcards the six game source directories only, and
# src/emscripten/ is not one of them (it holds the hand-written config.h, not
# game source). No extra compile rule is needed for it: the
# $(CLIENT_OBJDIR)/%.o: src/%.cpp rule below already matches, with a stem of
# "emscripten/eCompat" -- pattern stems may contain slashes.
CLIENT_OBJS   := $(SRCS:src/%.cpp=$(CLIENT_OBJDIR)/%.o) \
                 $(CLIENT_OBJDIR)/emscripten/eCompat.o
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
# It is not free, and M5's size budget needs the number. Relinking the same 101
# objects with and without these two flags:
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
CLIENT_LDFLAGS := $(CLIENT_PORTS) -sLEGACY_GL_EMULATION=1 \
                  -sALLOW_MEMORY_GROWTH=1 -sERROR_ON_UNDEFINED_SYMBOLS=1 \
                  -sASYNCIFY=1 -sASYNCIFY_STACK_SIZE=131072 \
                  $(EXCEPTIONS)

web/dist-m1/armagetronad.js: $(CLIENT_OBJS) $(LIBXML2)/lib/libxml2.a
	@mkdir -p web/dist-m1
	$(EMXX) $(CLIENT_OBJS) $(LIBXML2)/lib/libxml2.a $(CLIENT_LDFLAGS) -o $@

$(CLIENT_OBJDIR)/%.o: src/%.cpp web/Makefile
	@mkdir -p $(dir $@)
	$(EMXX) $(CLIENT_CXXFLAGS) -c $< -o $@

-include $(CLIENT_OBJS:.o=.d)

.PHONY: client
client: data web/dist-m1/armagetronad.js

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
