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
