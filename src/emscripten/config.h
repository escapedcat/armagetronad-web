/* Hand-written config for Emscripten builds — dedicated-server (M0) variant.
   Precedent: src/win32/config.h, src/config_ide.h. Native builds never see
   this file; it must be first on the include path (-I src/emscripten).
   Rules (PLAN.md): no threads, no SDL (yet), no curl/krawall, no
   TOP_SOURCE_DIR, no platform macros. */
#ifndef CONFIG_H_INCLUDED
#define CONFIG_H_INCLUDED

#ifndef __EMSCRIPTEN__
#error "src/emscripten/config.h is only for Emscripten builds"
#endif

#define DEDICATED 1

#define PACKAGE "armagetronad"
#define VERSION "0.2.9-wasm"

#define HAVE_LIBXML2 1

/* The tMemManager custom allocator predates modern toolchains; bypass it. */
#define DONTUSEMEMMANAGER 1

/* Install locations tools/tDirectories.cpp probes first. Natively these come
   from the generated src/tUniversalVariables.h, which tDirectories.cpp only
   includes under TOP_SOURCE_DIR — deliberately undefined here — yet uses
   unconditionally in FindDataPath()/FindConfigurationPath(). Values mirror the
   file's own PREFIX default, so wasm behaves like an unconfigured native build.

   Expect a "Relocation error" line on stderr at startup. It is unavoidable and
   harmless; do NOT try to make it go away by changing these values. Why it
   happens: st_RelocatePath() (:1416) calls GetPrefix() before it tests anything,
   so GeneratePrefix() always runs. That compares where the binary actually sits
   against BINDIR's "/bin" suffix; the wasm artifact sits in web/dist-m0, which
   has no "/bin" suffix and no Makefile to trigger the tRunningInBuildDirectory
   escape hatch, so it reaches the tERR_ERROR at :1380. tERR_ERROR resolves to
   st_PresentError(), whose non-WIN32 body prints to stderr and returns — its
   exit(-1) sits behind a `static bool error = false` — so startup continues and
   the path search does fall back to "." / "./config", which NODERAWFS resolves
   against the process working directory. --datadir cannot suppress the message
   either: tCommandLine.cpp:125 runs every analyzer's Initialize(), which reaches
   FindDataPath(), before the option loop at :141 that parses --datadir. No value
   of these two macros avoids it. */
#define AA_DATADIR "/usr/local/share/armagetronad"
#define AA_SYSCONFDIR "/usr/local/etc/armagetronad"

/* Float math: musl provides all of these. Without them, the fallbacks in
   src/defs.h collide with musl's own declarations. */
#define HAVE_ATAN2F 1
#define HAVE_COSF 1
#define HAVE_EXPF 1
#define HAVE_FABSF 1
#define HAVE_FLOORF 1
#define HAVE_LOGF 1
#define HAVE_SINF 1
#define HAVE_SQRTF 1
#define HAVE_TANF 1

/* Provided by Emscripten's musl/headers. */
#define HAVE_ISBLANK 1
#define HAVE_SELECT 1
#define HAVE_SOCKLEN_T 1
#define HAVE_WMEMSET 1
#define HAVE_UNISTD_H 1
#define HAVE_STDINT_H 1
#define HAVE_INTTYPES_H 1
#define HAVE_STDLIB_H 1
#define HAVE_STRING_H 1
#define HAVE_STRINGS_H 1
#define HAVE_SYS_STAT_H 1
#define HAVE_SYS_TYPES_H 1
#define HAVE_MEMORY_H 1

#endif /* CONFIG_H_INCLUDED */
