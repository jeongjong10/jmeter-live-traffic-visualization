#!/usr/bin/env python3
"""Deterministic, loopback-only seven-step commerce APIs for the JMeter PoC."""
from __future__ import annotations

import json
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HOST, PORT = "127.0.0.1", 18081


class MockApiHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        print("[mock-api] " + fmt % args)

    def send_json(self, status: int, body: dict) -> None:
        data = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def context(self, parsed) -> tuple[str, str, int]:
        query = parse_qs(parsed.query)
        flow_id = self.headers.get("X-Flow-ID") or query.get("flowId", ["untracked"])[0]
        scenario = self.headers.get("X-Scenario") or query.get("scenario", ["success"])[0]
        try:
            delay_ms = max(0, min(int(query.get("delayMs", ["0"])[0]), 5000))
        except ValueError:
            delay_ms = 0
        return str(flow_id), str(scenario), delay_ms

    def respond(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/health":
            self.send_json(HTTPStatus.OK, {"ok": True, "service": "mock-api-flow"})
            return
        flow_id, scenario, delay_ms = self.context(parsed)
        if delay_ms:
            time.sleep(delay_ms / 1000)
        # The deliberate outage is at product detail: downstream cart, payment
        # and confirmation must therefore not be requested by JMeter.
        if scenario == "failure" and parsed.path == "/catalog/products/sku-espresso":
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"flowId": flow_id, "scenario": scenario,
                                                            "error": "simulated_product_detail_outage"})
            return
        payload = {"flowId": flow_id, "scenario": scenario, "endpoint": parsed.path, "ok": True}
        if parsed.path == "/auth/login": payload["token"] = "mock-token-" + flow_id
        elif parsed.path == "/profile/session": payload["customerId"] = "customer-42"
        elif parsed.path == "/catalog/search": payload["results"] = [{"id": "sku-espresso"}]
        elif parsed.path == "/catalog/products/sku-espresso": payload["product"] = {"id": "sku-espresso", "price": 4500}
        elif parsed.path == "/cart/items": payload["cartId"] = "cart-" + flow_id
        elif parsed.path == "/payments/authorize": payload["paymentId"] = "pay-" + flow_id
        elif parsed.path == "/orders/confirm":
            payload["orderId"] = "ord-" + flow_id
            self.send_json(HTTPStatus.CREATED, payload)
            return
        else:
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "not_found", "path": parsed.path})
            return
        self.send_json(HTTPStatus.OK, payload)

    def do_GET(self) -> None: self.respond()

    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        if length: self.rfile.read(length)
        self.respond()


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), MockApiHandler)
    print(f"Mock API flow: http://{HOST}:{PORT} (loopback only)")
    server.serve_forever()
