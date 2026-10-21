#!/usr/bin/env python3
"""Loopback-only mock for btoc-like.jmx: every path answers, with per-path delays.

The ``FAIL_RESULTS_CALL`` environment variable (default 2) makes that numbered
call to ``.../results`` return HTTP 500, so error handling can be observed.
"""
from __future__ import annotations

import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOST, PORT = "127.0.0.1", 18082
FAIL_RESULTS_CALL = int(os.environ.get("FAIL_RESULTS_CALL", "2"))
DELAYS_MS = (("/results", 900), ("/report/", 350), ("/questions", 120), ("/status/", 200), ("/load/", 80))
results_calls = 0
lock = threading.Lock()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        print("[btoc-like-mock] " + fmt % args)

    def respond(self) -> None:
        global results_calls
        length = int(self.headers.get("Content-Length", "0"))
        if length:
            self.rfile.read(length)
        path = urlparse(self.path).path
        status = 200
        if path == "/health":
            body = {"ok": True}
        else:
            time.sleep(next((ms for part, ms in DELAYS_MS if part in path), 40) / 1000)
            if path.endswith("/results"):
                with lock:
                    results_calls += 1
                    status = 500 if results_calls == FAIL_RESULTS_CALL else 200
            body = {"ok": status == 200, "path": path}
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    do_GET = do_POST = do_PATCH = respond


if __name__ == "__main__":
    print(f"btoc-like mock API: http://{HOST}:{PORT} (loopback only)")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
