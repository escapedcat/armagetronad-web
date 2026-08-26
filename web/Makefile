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

# src/network/master.cpp has its own main() (master-server binary) — exclude.
EXCLUDES  := src/network/master.cpp
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
