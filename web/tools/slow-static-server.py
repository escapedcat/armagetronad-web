#!/usr/bin/env python3
"""python3 web/tools/slow-static-server.py <port> <directory> <delay-seconds>

A static file server that waits <delay-seconds> before answering each request.
The map-download gate (web/tools/run-resource-gate.sh) uses it as its stand-in
repository so a download is reliably IN FLIGHT for a while: long enough for
the page-side sampler in web/tools/resource-gate.steps to see whether an empty
file sits at the map's save path during the wait -- the state that browser
storage persisted and a reload then kept for good.
"""
import functools
import http.server
import sys
import time

port, directory, delay = int(sys.argv[1]), sys.argv[2], float(sys.argv[3])


class Slow(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        time.sleep(delay)
        super().do_GET()


handler = functools.partial(Slow, directory=directory)
http.server.ThreadingHTTPServer(('127.0.0.1', port), handler).serve_forever()
