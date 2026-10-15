#!/usr/bin/env python3
"""Serve the validation presenter and save its sessions to disk.

    python server.py [--port 8000] [--out sessions] [--host 127.0.0.1]

Open http://localhost:8000 (WebXR also needs localhost or HTTPS). The page finds the server through
``GET /api/ping`` and then sends each row as it happens, so a crash loses nothing that was shown:

- ``POST /api/append?session=<folder>&file=<name>``: append the request body to OUT/<folder>/<name>;
- ``POST /api/write?session=<folder>&file=<name>``: replace the file with the body.

Folder and file names are checked (letters, digits, ``_ . -``; files end in .csv, .json or .txt), so nothing is
written outside OUT. Only the Python standard library is used.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
SESSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$")
FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}\.(csv|json|txt)$")
MAX_BODY = 20 * 1024 * 1024


class Handler(SimpleHTTPRequestHandler):
    out: Path = ROOT / "sessions"

    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript"}

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/"):   # keep the console for the saves
            return
        super().log_message(fmt, *args)

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if urlparse(self.path).path == "/api/ping":
            return self._json(200, {"ok": True, "out": str(self.out)})
        return super().do_GET()

    def do_POST(self):
        url = urlparse(self.path)
        if url.path not in ("/api/append", "/api/write"):
            return self._json(404, {"ok": False, "error": "unknown endpoint"})
        q = parse_qs(url.query)
        session, name = q.get("session", [""])[0], q.get("file", [""])[0]
        if not SESSION_RE.match(session) or ".." in session or not FILE_RE.match(name):
            return self._json(400, {"ok": False, "error": "bad session or file name"})
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            return self._json(413, {"ok": False, "error": "body too large"})
        body = self.rfile.read(length)
        folder = self.out / session
        folder.mkdir(parents=True, exist_ok=True)
        with open(folder / name, "ab" if url.path == "/api/append" else "wb") as f:
            f.write(body)
        return self._json(200, {"ok": True, "bytes": len(body)})


def make_server(host: str, port: int, out: Path) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {"out": out.resolve()})
    return ThreadingHTTPServer((host, port), partial(handler, directory=str(ROOT)))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1", help="127.0.0.1 (default) keeps it on this computer")
    ap.add_argument("--out", type=Path, default=ROOT / "sessions", help="folder for the session folders")
    args = ap.parse_args()
    server = make_server(args.host, args.port, args.out)
    print(f"Serving http://localhost:{args.port}  (sessions saved in {args.out.resolve()})  Ctrl+C to stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
