# Hand-written Emscripten build (see PLAN.md: autotools is NOT used for wasm).
# M0: dedicated server for Node. Usage, from the repo root:
#     source deps/emsdk/emsdk_env.sh
#     make -f web/Makefile dedicated -j8
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
CXXFLAGS  := -std=gnu++14 -O2 -MMD -MP $(INCLUDES)

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
# rConsoleCout — not a standalone TU: render/rConsoleGraph.cpp ends with a
#                literal `#include "rConsoleCout.cpp"` for DEDICATED builds,
#                which is why it is EXTRA_DIST in src/Makefile.am. Its code IS
#                in the build; compiling it a second time only duplicates it.
SRCS      := $(filter-out $(EXCLUDES), \
               $(wildcard src/tools/*.cpp) $(wildcard src/network/*.cpp) \
               $(wildcard src/engine/*.cpp) $(wildcard src/render/*.cpp) \
               $(wildcard src/ui/*.cpp)    $(wildcard src/tron/*.cpp))
OBJDIR    := web/build-m0
OBJS      := $(SRCS:src/%.cpp=$(OBJDIR)/%.o)

LDFLAGS   := -sENVIRONMENT=node -sNODERAWFS=1 -sEXIT_RUNTIME=1 \
             -sALLOW_MEMORY_GROWTH=1

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

.PHONY: dedicated clean
dedicated: web/dist-m0/armagetronad-dedicated.js
clean:
	rm -rf $(OBJDIR) web/dist-m0
