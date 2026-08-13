"""Local server for the Bonding Analysis Explorer.

Same as `python -m http.server`, but sends no-cache headers so the browser
always picks up the latest version of the app after edits.

Usage: python serve.py [port]   (default: $PORT env var, else 8123)
"""
import os
import sys
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', 8123))


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',  # ES modules need a JS MIME type
    }

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()


if __name__ == '__main__':
    server = ThreadingHTTPServer(('', PORT), NoCacheHandler)
    print(f'Bonding Analysis Explorer running at http://localhost:{PORT}')
    print('Press Ctrl+C (or close this window) to stop.')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
