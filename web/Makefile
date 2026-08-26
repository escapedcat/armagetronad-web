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

CXXFLAGS  := -std=gnu++14 -O2 $(INCLUDES)

# The wildcards below sweep whole directories, so they also pick up files that
# src/Makefile.am never compiles: extra main()s, stale demos/test harnesses and
# one alternative implementation. Each is listed with the reason; the list was
# cross-checked against the *_SOURCES lists in src/Makefile.am, and the set of
# compiled files now matches a native dedicated build exactly.
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

$(OBJDIR)/%.o: src/%.cpp
	@mkdir -p $(dir $@)
	$(EMXX) $(CXXFLAGS) -c $< -o $@

.PHONY: dedicated clean
dedicated: web/dist-m0/armagetronad-dedicated.js
clean:
	rm -rf $(OBJDIR) web/dist-m0
