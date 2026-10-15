"""The local server: serves the page, appends and writes session files, refuses unsafe names.

    python -m unittest discover tests
"""

import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
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


if __name__ == "__main__":
    unittest.main()
