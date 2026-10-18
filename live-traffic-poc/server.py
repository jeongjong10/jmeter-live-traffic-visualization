#!/usr/bin/env python3
"""Loopback-only collector and dashboard for the JMeter visualization PoC."""
from __future__ import annotations

import json
import queue
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
LOG = DATA / "events.ndjson"
LOAD_SETTINGS_FILE = DATA / "load-settings.json"
EVENTS: list[dict] = []
LOAD_SETTINGS: dict = {}
SUBSCRIBERS: list[queue.Queue] = []
LOCK = threading.Lock()


def now_ms() -> int:
    return int(time.time() * 1000)


def event_time(value) -> int:
    if isinstance(value, (int, float)):
        return int(value * 1000) if value < 10_000_000_000 else int(value)
    if isinstance(value, str):
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            pass
    return now_ms()


def normalize(raw: dict) -> dict:
    """Accept contract-v1 fields plus common JMeter naming variants."""
    labels = raw.get("labels") if isinstance(raw.get("labels"), dict) else {}
    endpoint = raw.get("endpoint") or labels.get("endpoint") or raw.get("samplerName") or raw.get("label") or "unknown"
    duration = raw.get("durationMs", raw.get("elapsedMs", raw.get("responseTimeMs", raw.get("elapsed", 0))))
    status = raw.get("status", raw.get("responseCode", ""))
    if "success" in raw:
        ok = raw["success"]
    elif "ok" in raw:
        ok = raw["ok"]
    else:
        try:
            ok = int(status or 200) < 400
        except (TypeError, ValueError):
            ok = True
    phase = str(raw.get("phase") or ("completed" if "success" in raw else ""))
    success = bool(ok)
    outcome = str(raw.get("outcome") or ("success" if success else "failure"))
    timestamp = event_time(raw.get("timestamp", raw.get("timeStamp")))
    duration_ms = max(0, float(duration or 0))
    terminal = phase in ("completed", "aborted", "skipped")
    return {
        "timestamp": timestamp,
        "endpoint": str(endpoint),
        "durationMs": duration_ms,
        "success": success,
        "status": status,
        "requestId": raw.get("requestId", raw.get("id", "")),
        "flowId": raw.get("flowId", ""),
        # Journey Event v2: retained verbatim in SSE and recordings so a
        # visualizer can animate a single business transaction in order.
        "eventType": raw.get("eventType") or ("journey" if raw.get("stepId") else "sample"),
        "correlationId": raw.get("correlationId", raw.get("flowId", "")),
        "journeyId": raw.get("journeyId", ""),
        "stepId": raw.get("stepId", ""),
        "stepOrder": int(raw.get("stepOrder", 0) or 0),
        "previousStepId": raw.get("previousStepId", ""),
        "phase": phase,
        "outcome": outcome,
        # Backend-listener terminal samples do not carry start time, but JMeter
        # does carry elapsed time. Deriving it preserves the token dwell span.
        "startedAt": event_time(raw.get("startedAt", timestamp - duration_ms if terminal else timestamp)),
        "completedAt": event_time(raw.get("completedAt", timestamp)) if terminal else None,
        "scenario": str(raw.get("scenario", labels.get("scenario", ""))),
        "jmeterThread": raw.get("jmeterThread", ""),
    }


def publish(event: dict) -> None:
    DATA.mkdir(exist_ok=True)
    with LOCK:
        EVENTS.append(event)
        with LOG.open("a", encoding="utf-8") as fp:
            fp.write(json.dumps(event, separators=(",", ":")) + "\n")
        for subscriber in SUBSCRIBERS[:]:
            try:
                subscriber.put_nowait(event)
            except queue.Full:
                pass


def percentile(values: list[float], point: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int((len(ordered) - 1) * point)))
    return round(ordered[index], 1)


def node_states(events: list[dict], now: int) -> list[dict]:
    """Traffic-simulation input: one aggregate per business node."""
    journey = [event for event in events if event.get("eventType") == "journey" and event.get("stepId")]
    by_step: dict[str, list[dict]] = {}
    active_keys: set[tuple[str, str]] = set()
    for event in journey:
        key = (str(event.get("correlationId", "")), str(event.get("stepId", "")))
        if event.get("phase") == "started":
            active_keys.add(key)
        elif event.get("phase") in ("completed", "aborted", "skipped"):
            active_keys.discard(key)
        by_step.setdefault(str(event["stepId"]), []).append(event)
    states = []
    for step, values in sorted(by_step.items(), key=lambda pair: min(x.get("stepOrder", 99) for x in pair[1])):
        arrivals = [event for event in values if event.get("phase") == "started"]
        terminals = [event for event in values if event.get("phase") in ("completed", "aborted", "skipped")]
        samples = [event for event in terminals if event.get("phase") != "skipped"]
        durations = [float(event.get("durationMs", 0)) for event in samples]
        active = sum(1 for correlation, active_step in active_keys if active_step == step and correlation)
        completed_last_second = sum(1 for event in terminals if event["timestamp"] >= now - 1000)
        states.append({
            "stepId": step, "stepOrder": min(event.get("stepOrder", 99) for event in values),
            "arrivals": len(arrivals), "inFlight": active, "completions": len(terminals),
            "success": sum(1 for event in samples if event.get("phase") == "completed"),
            "error": sum(1 for event in samples if event.get("phase") == "aborted"),
            "skipped": sum(1 for event in terminals if event.get("phase") == "skipped"),
            "avgMs": round(sum(durations) / len(durations), 1) if durations else 0.0,
            "p95Ms": percentile(durations, 0.95),
            "throughputPerSec": completed_last_second,
            "timeline": [{"timestamp": event["timestamp"], "phase": event["phase"],
                          "correlationId": event.get("correlationId", ""),
                          "durationMs": event.get("durationMs", 0),
                          "success": event.get("success", True)}
                         for event in values[-80:]],
        })
    return states


def snapshot() -> dict:
    cutoff = now_ms() - 60_000
    with LOCK:
        recent = [e for e in EVENTS if e["timestamp"] >= cutoff]
    groups: dict[str, list[dict]] = {}
    for e in recent:
        groups.setdefault(e["endpoint"], []).append(e)
    endpoints = []
    for endpoint, values in sorted(groups.items()):
        count = len(values)
        endpoints.append({"endpoint": endpoint, "rps": round(count / 60, 2),
                          "avgMs": round(sum(x["durationMs"] for x in values) / count, 1),
                          "errorRate": round(100 * sum(not x["success"] for x in values) / count, 1), "count": count})
    now = now_ms()
    with LOCK:
        all_events = EVENTS[:]
    return {"type": "snapshot", "generatedAt": now, "windowSeconds": 60,
            "events": recent[-240:], "eventTimeline": all_events[-500:],
            "nodeStates": node_states(all_events, now), "endpoints": endpoints,
            "recordedCount": len(all_events), "loadSettings": LOAD_SETTINGS}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print("[collector] " + fmt % args)

    def send_json(self, value, status=200):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/load-settings":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                value = json.loads(self.rfile.read(length))
                if not isinstance(value, dict): raise ValueError("Expected a JSON object.")
                required = ("virtualUsers", "rampUpSeconds", "loops", "journeyId", "steps")
                if any(key not in value for key in required): raise ValueError("Incomplete load settings.")
                global LOAD_SETTINGS
                with LOCK:
                    LOAD_SETTINGS = value
                    DATA.mkdir(exist_ok=True)
                    LOAD_SETTINGS_FILE.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
                self.send_json({"accepted": True, "loadSettings": value}, HTTPStatus.ACCEPTED)
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/reset":
            with LOCK:
                EVENTS.clear()
                DATA.mkdir(exist_ok=True)
                LOG.write_text("", encoding="utf-8")
            self.send_json({"reset": True}, HTTPStatus.OK)
            return
        if path != "/events":
            self.send_error(404); return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
            raw_events = body if isinstance(body, list) else body.get("events", [body])
            if not isinstance(raw_events, list) or not all(isinstance(x, dict) for x in raw_events):
                raise ValueError("Expected an event object or {events: [...]}.")
            accepted = [normalize(x) for x in raw_events]
            for event in accepted: publish(event)
            self.send_json({"accepted": len(accepted), "events": accepted}, HTTPStatus.ACCEPTED)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/snapshot":
            self.send_json(snapshot()); return
        if path == "/api/recording":
            with LOCK: recorded = EVENTS[:]
            self.send_json({"events": recorded, "count": len(recorded)}); return
        if path == "/stream":
            self.stream(); return
        if path in ("/", "/index.html"):
            self.static("index.html", "text/html; charset=utf-8"); return
        if path == "/app.js":
            self.static("app.js", "application/javascript; charset=utf-8"); return
        if path == "/style.css":
            self.static("style.css", "text/css; charset=utf-8"); return
        self.send_error(404)

    def static(self, name, content_type):
        data = (ROOT / name).read_bytes()
        self.send_response(200); self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def stream(self):
        q: queue.Queue = queue.Queue(maxsize=256)
        with LOCK: SUBSCRIBERS.append(q)
        try:
            self.send_response(200); self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache"); self.send_header("Connection", "keep-alive"); self.end_headers()
            self.wfile.write(("data: " + json.dumps(snapshot()) + "\n\n").encode()); self.wfile.flush()
            while True:
                try: event = q.get(timeout=12)
                except queue.Empty: self.wfile.write(b": keepalive\n\n"); self.wfile.flush(); continue
                self.wfile.write(("event: traffic\ndata: " + json.dumps(event) + "\n\n").encode()); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with LOCK:
                if q in SUBSCRIBERS: SUBSCRIBERS.remove(q)


if __name__ == "__main__":
    DATA.mkdir(exist_ok=True)
    if LOG.exists():
        for line in LOG.read_text(encoding="utf-8").splitlines():
            try: EVENTS.append(json.loads(line))
            except json.JSONDecodeError: pass
    if LOAD_SETTINGS_FILE.exists():
        try: LOAD_SETTINGS.update(json.loads(LOAD_SETTINGS_FILE.read_text(encoding="utf-8")))
        except json.JSONDecodeError: pass
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("Dashboard: http://127.0.0.1:8765  (loopback only)")
    server.serve_forever()
