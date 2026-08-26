#ifndef AT_GL_H
#define AT_GL_H

#ifndef DEDICATED

#ifdef WIN32
#include <windows.h>
#endif


#define NO_SDL_GLEXT
#include <SDL_opengl.h>

/*
// include OpenGL header
#ifdef HAVE_SDL_OPENGL_H
#include <SDL_opengl.h>
#else
#ifdef HAVE_SDL_SDL_OPENGL_H
#include <SDL/SDL_opengl.h>
#else
#ifdef HAVE_OPENGL_GL_H
#include <OpenGL/gl.h>
#include <OpenGL/glu.h>
#else
#ifdef HAVE_GL_GL_H
#include <GL/gl.h>
#include <GL/glu.h>
#else
#error No suitable OpenGL header found by configure!
#endif
#endif
#endif
#endif
*/

#ifdef __EMSCRIPTEN__
// SDL_opengl.h pulls in GL but not GLU, and the <GL/glu.h> this file would
// otherwise have picked up sits in the commented-out block above. So nothing
// declares gluLookAt (eCamera.cpp) or gluBuild2DMipmaps (rTexture.cpp).
// Emscripten ships the header, so include it rather than hand-declaring
// those functions: the declarations then cannot drift from the
// implementations Emscripten provides in libglemu.js.
#include <GL/glu.h>
#endif

#else

typedef float GLfloat;
typedef unsigned char GLubyte;
typedef unsigned int GLuint;
typedef unsigned int GLenum;
#endif


#ifdef DEBUG
#ifndef DEDICATED
#define AA_GL_ERROR_CHECKING
#endif
#endif

#ifdef AA_GL_ERROR_CHECKING
//! for debugging purposes: checks for OpenGL errors and prints them to the console.
void sr_CheckGLError();
#else
inline void sr_CheckGLError(){}
#endif

#endif
