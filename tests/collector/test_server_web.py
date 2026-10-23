"""Unit tests for the single entry point: the collector serves the built web screen and API on one port."""
import http.client
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src" / "collector"))

import server  # noqa: E402


def get(port, path):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    conn.request("GET", path)
    response = conn.getresponse()
    body = response.read()
    conn.close()
    return response.status, response.getheader("Content-Type") or "", body


class WebServingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.web = root / "dist"
        (self.web / "assets").mkdir(parents=True)
        (self.web / "index.html").write_text("<!doctype html><title>JMeter Live Traffic</title>", encoding="utf-8")
        (self.web / "assets" / "app.js").write_text("console.log(1)", encoding="utf-8")
        (root / "secret.txt").write_text("outside", encoding="utf-8")
        self.saved_web = server.WEB_DIR
        server.WEB_DIR = self.web.resolve()
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.port = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        server.WEB_DIR = self.saved_web
        self.tmp.cleanup()

    def test_root_serves_built_index(self):
        status, content_type, body = get(self.port, "/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", content_type)
        self.assertIn(b"JMeter Live Traffic", body)

    def test_assets_are_served_with_their_type(self):
        status, content_type, _ = get(self.port, "/assets/app.js")
        self.assertEqual(status, 200)
        self.assertIn("javascript", content_type)

    def test_collector_prefix_reaches_the_same_api(self):
        prefixed = get(self.port, "/collector/api/runs")
        plain = get(self.port, "/api/runs")
        self.assertEqual(prefixed[0], 200)
        self.assertIn("application/json", prefixed[1])
        self.assertEqual(prefixed[2], plain[2])

    def test_bare_collector_prefix_is_the_root(self):
        self.assertEqual(get(self.port, "/collector")[0], 200)

    def test_paths_outside_the_web_dir_are_rejected(self):
        self.assertEqual(get(self.port, "/../secret.txt")[0], 404)
        self.assertEqual(get(self.port, "/assets/../../secret.txt")[0], 404)
        self.assertEqual(get(self.port, "/missing.js")[0], 404)

    def test_missing_build_returns_503(self):
        (self.web / "index.html").unlink()
        self.assertEqual(get(self.port, "/")[0], 503)


if __name__ == "__main__":
    unittest.main()
