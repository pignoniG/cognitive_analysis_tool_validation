#!/usr/bin/env python3
"""Serve the validation presenter and save its sessions to disk.

    python server.py [--port 8000] [--out sessions] [--host 127.0.0.1]

Open http://localhost:8000 (WebXR also needs localhost or HTTPS). The page finds the server through
``GET /api/ping`` and then sends each row as it happens, so a crash loses nothing that was shown:

- ``POST /api/append?session=<folder>&file=<name>``: append the request body to OUT/<folder>/<name>;
- ``POST /api/write?session=<folder>&file=<name>``: replace the file with the body;
- ``GET /api/time``: the server's clock in Unix milliseconds, which the page uses to measure the offset between the
  server's clock and the computer's (``clock_offset.csv`` and ``session.json`` of each session);
- ``GET /healthz``: ``ok``, for container health checks.

Folder and file names are checked (letters, digits, ``_ . -``; files end in .csv, .json or .txt), so nothing is
written outside OUT. Only the page's own files are served (index.html, stimulus.html, src/, assets/, vendor/, docs/):
never the data folder, the server's code or any hidden file, and no directory listings. Only the Python standard
library is used.

For a server (see docs/deploying.md) the settings come from the environment, so the same image runs anywhere:

- ``DATA_DIR`` the folder for the session folders (default ``sessions``; ``/data`` in the container);
- ``HOST`` and ``PORT`` the address to listen on (default 127.0.0.1:8000; the container listens on 0.0.0.0);
- ``VALIDATION_PASSWORD`` if set, every request needs it (HTTP Basic: any user name, this password).
"""

from __future__ import annotations

import argparse
import base64
import hmac
import json
import os
import re
import sys
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
SESSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$")
FILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}\.(csv|json|txt)$")
MAX_BODY = 20 * 1024 * 1024
MAX_FILE = 200 * 1024 * 1024          # one session file never grows past this (a runaway client cannot fill the disk)
# the only parts of the folder that are served
PUBLIC_FILES = {"index.html", "stimulus.html"}
PUBLIC_DIRS = {"src", "assets", "vendor", "docs"}


class Handler(SimpleHTTPRequestHandler):
    out: Path = ROOT / "sessions"
    password: str | None = None

    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript",
                      ".md": "text/plain; charset=utf-8"}

    _cache_sent = False

    def end_headers(self):
        # revalidate every time (the files are small and a 304 is cheap), so an update is never served stale
        if not self._cache_sent:
            self.send_header("Cache-Control", "no-cache")
        self._cache_sent = False
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt, *args):
        if not self.path.startswith("/api/"):   # keep the console for the saves
            return
        super().log_message(fmt, *args)

    def _json(self, status: int, body: dict) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self._cache_sent = True
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _authorised(self) -> bool:
        """True without a password set; else the request's Basic password must match (any user name)."""
        if not self.password:
            return True
        header = self.headers.get("Authorization", "")
        if header.startswith("Basic "):
            try:
                given = base64.b64decode(header[6:], validate=True).decode("utf-8").partition(":")[2]
            except (ValueError, UnicodeDecodeError):
                given = ""
            if hmac.compare_digest(given.encode(), self.password.encode()):
                return True
        body = b"A password is needed.\n"
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Validation task", charset="UTF-8"')
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)
        return False

    def _public(self, path: str) -> bool:
        """Whether `path` is one of the page's own files."""
        parts = [p for p in unquote(path).split("/") if p]
        if any(p.startswith(".") for p in parts):
            return False
        if not parts:
            return True                                    # "/" is index.html
        return (len(parts) == 1 and parts[0] in PUBLIC_FILES) or parts[0] in PUBLIC_DIRS

    def list_directory(self, path):                        # no listings
        self.send_error(404, "Not found")
        return None

    def do_HEAD(self):
        if not self._authorised():
            return
        if not self._public(urlparse(self.path).path):
            return self.send_error(404, "Not found")
        return super().do_HEAD()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/healthz":                             # no password: a health check has none
            body = b"ok\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/plain")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if not self._authorised():
            return
        if path == "/api/ping":
            return self._json(200, {"ok": True})
        if path == "/api/time":
            return self._json(200, {"ok": True, "unix_ms": time.time() * 1000})
        if path.startswith("/api/") or not self._public(path):
            return self.send_error(404, "Not found")
        return super().do_GET()

    def do_POST(self):
        if not self._authorised():
            return
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
        target = folder / name
        append = url.path == "/api/append"
        if append and target.exists() and target.stat().st_size + length > MAX_FILE:
            return self._json(413, {"ok": False, "error": "file too large"})
        folder.mkdir(parents=True, exist_ok=True)
        with open(target, "ab" if append else "wb") as f:
            f.write(body)
        return self._json(200, {"ok": True, "bytes": len(body)})


def make_server(host: str, port: int, out: Path, password: str | None = None) -> ThreadingHTTPServer:
    handler = type("BoundHandler", (Handler,), {"out": out.resolve(), "password": password or None})
    return ThreadingHTTPServer((host, port), partial(handler, directory=str(ROOT)))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"),
                    help="127.0.0.1 (default) keeps it on this computer; 0.0.0.0 in a container")
    ap.add_argument("--out", type=Path, default=Path(os.environ.get("DATA_DIR") or ROOT / "sessions"),
                    help="folder for the session folders (env DATA_DIR)")
    args = ap.parse_args()
    password = os.environ.get("VALIDATION_PASSWORD") or None
    args.out.mkdir(parents=True, exist_ok=True)
    server = make_server(args.host, args.port, args.out, password)
    print(f"Serving http://{args.host}:{args.port}  (sessions saved in {args.out.resolve()}; "
          f"{'password required' if password else 'no password'})  Ctrl+C to stop", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
