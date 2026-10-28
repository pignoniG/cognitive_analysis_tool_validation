"""The local server: serves the page, appends and writes session files, refuses unsafe names.

    python -m unittest discover tests
"""

import base64
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server as server_module  # noqa: E402
from server import make_server  # noqa: E402


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
        self.server = make_server("127.0.0.1", 0, self.out)
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def post(self, endpoint, session, file, body):
        req = Request(f"{self.base}/api/{endpoint}?session={session}&file={file}", data=body.encode(), method="POST")
        with urlopen(req) as r:
            return json.load(r)

    def test_ping_and_static(self):
        with urlopen(self.base + "/api/ping") as r:
            self.assertTrue(json.load(r)["ok"])
        with urlopen(self.base + "/src/rng.js") as r:
            self.assertEqual(r.headers["Content-Type"], "text/javascript")
            r.read()

    def test_append_and_write(self):
        self.post("append", "P01_vr_2026-10-15_12-00-00", "nback_log.csv", "a\n")
        self.post("append", "P01_vr_2026-10-15_12-00-00", "nback_log.csv", "b\n")
        self.post("write", "P01_vr_2026-10-15_12-00-00", "session.json", "{}")
        folder = self.out / "P01_vr_2026-10-15_12-00-00"
        self.assertEqual((folder / "nback_log.csv").read_text(), "a\nb\n")
        self.assertEqual((folder / "session.json").read_text(), "{}")

    def test_refuses_unsafe_names(self):
        for session, file in [("..", "x.csv"), ("a", "../x.csv"), ("a/b", "x.csv"), ("a", "x.html"), ("", "x.csv")]:
            with self.assertRaises(HTTPError) as e:
                self.post("append", session, file, "x")
            self.assertEqual(e.exception.code, 400)
        self.assertEqual(list(self.out.iterdir()), [])

    def test_serves_only_the_pages_own_files(self):
        (self.out / "secret.csv").write_text("x")
        for path in ["/server.py", "/Dockerfile", "/tests/test_server.py", "/sessions/", "/.git/config", "/src/", "/assets/",
                     "/src/../server.py", "/%2e%2e/server.py", "/src/.hidden", "/tools/make_audio.py", "/api/nothing"]:
            with self.assertRaises(HTTPError, msg=path) as e:
                urlopen(self.base + path)
            self.assertEqual(e.exception.code, 404, path)
        for path in ["/", "/index.html", "/stimulus.html", "/src/rng.js", "/vendor/three-slim.module.js", "/docs/design.md",
                     "/assets/audio/en/manifest.json"]:
            with urlopen(self.base + path) as r:
                self.assertEqual(r.status, 200, path)
                r.read()

    def test_clock_endpoint_and_health(self):
        import time
        before = time.time() * 1000
        with urlopen(self.base + "/api/time") as r:
            body = json.load(r)
            self.assertEqual(r.headers["Cache-Control"], "no-store")
        self.assertTrue(body["ok"])
        self.assertTrue(before - 1 <= body["unix_ms"] <= time.time() * 1000 + 1)
        self.assertNotEqual(body["unix_ms"], int(body["unix_ms"]))       # sub-millisecond, not rounded
        with urlopen(self.base + "/healthz") as r:
            self.assertEqual(r.read(), b"ok\n")

    def test_caching_headers(self):
        with urlopen(self.base + "/src/rng.js") as r:
            self.assertEqual(r.headers["Cache-Control"], "no-cache")          # revalidated, not re-downloaded
            self.assertEqual(r.headers.get_all("Cache-Control"), ["no-cache"])
            tag = r.headers["Last-Modified"]
            r.read()
        req = Request(self.base + "/src/rng.js", headers={"If-Modified-Since": tag})
        with self.assertRaises(HTTPError) as e:
            urlopen(req)
        self.assertEqual(e.exception.code, 304)

    def test_file_size_cap(self):
        old = server_module.MAX_FILE
        server_module.MAX_FILE = 10
        try:
            self.post("append", "S1", "a.csv", "123456")
            with self.assertRaises(HTTPError) as e:
                self.post("append", "S1", "a.csv", "123456")
            self.assertEqual(e.exception.code, 413)
            self.assertEqual((self.out / "S1" / "a.csv").read_text(), "123456")
        finally:
            server_module.MAX_FILE = old


class PasswordTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
        self.server = make_server("127.0.0.1", 0, self.out, password="s3cret:é")
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    @staticmethod
    def basic(user, password):
        return {"Authorization": "Basic " + base64.b64encode(f"{user}:{password}".encode()).decode()}

    def test_everything_but_health_needs_the_password(self):
        for path in ["/", "/index.html", "/src/rng.js", "/api/ping", "/api/time"]:
            with self.assertRaises(HTTPError, msg=path) as e:
                urlopen(self.base + path)
            self.assertEqual(e.exception.code, 401, path)
            self.assertIn("Basic", e.exception.headers["WWW-Authenticate"])
        with self.assertRaises(HTTPError) as e:
            urlopen(Request(self.base + "/api/write?session=S&file=a.csv", data=b"x", method="POST"))
        self.assertEqual(e.exception.code, 401)
        self.assertEqual(list(self.out.iterdir()), [])                   # nothing written without the password
        with urlopen(self.base + "/healthz") as r:
            self.assertEqual(r.status, 200)

    def test_wrong_passwords_are_refused_and_the_right_one_works_with_any_user(self):
        for headers in [self.basic("lab", "wrong"), self.basic("lab", ""), {"Authorization": "Basic !!!"}, {"Authorization": "Bearer x"}]:
            with self.assertRaises(HTTPError) as e:
                urlopen(Request(self.base + "/api/ping", headers=headers))
            self.assertEqual(e.exception.code, 401)
        for user in ["lab", "", "anyone"]:
            with urlopen(Request(self.base + "/api/ping", headers=self.basic(user, "s3cret:é"))) as r:
                self.assertTrue(json.load(r)["ok"])
        req = Request(self.base + "/api/append?session=S&file=a.csv", data=b"row\n", method="POST", headers=self.basic("x", "s3cret:é"))
        with urlopen(req) as r:
            self.assertTrue(json.load(r)["ok"])
        self.assertEqual((self.out / "S" / "a.csv").read_text(), "row\n")


if __name__ == "__main__":
    unittest.main()
