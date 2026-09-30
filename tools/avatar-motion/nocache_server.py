"""Dev static server for the repo root that disables browser caching (so edited ES modules
always reload). Usage: python tools/avatar-motion/nocache_server.py [port]"""
import http.server
import sys


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer(("", port), NoCache).serve_forever()
