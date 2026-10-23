#!/usr/bin/env python3
"""Loopback-only collector for the JMeter visualization PoC."""
from __future__ import annotations

import json
import logging
import logging.handlers
import mimetypes
import os
import queue
import threading
import time
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from flow_tracker import FlowTracker
from jmx_plan import parse_jmx, parse_test_tree
from run_store import RunStore

# Settings come from the environment; defaults are the container paths (docker/collector/Dockerfile).
HOST = os.environ.get("COLLECTOR_HOST", "127.0.0.1")
PORT = int(os.environ.get("COLLECTOR_PORT", "8765"))
DATA = Path(os.environ.get("COLLECTOR_DATA_DIR") or "/app/data")
# Built web screen (src/web: npm run build), served on the same port as the API.
WEB_DIR = Path(os.environ.get("COLLECTOR_WEB_DIR") or "/app/web").resolve()
LOG_DIR = Path(os.environ.get("COLLECTOR_LOG_DIR") or "/app/logs")
LOG = logging.getLogger("collector")
LOAD_SETTINGS_FILE = DATA / "load-settings.json"
PLAN_FILE = DATA / "plan.json"
EVENTS: list[dict] = []
LOAD_SETTINGS: dict = {}
SUBSCRIBERS: list[Subscriber] = []
LOCK = threading.Lock()
# Serializes sample matching so one thread's samples are resolved in arrival order.
TRACKER_LOCK = threading.Lock()
TRACKER = FlowTracker()
RUNS = RunStore(DATA / "runs", keep=int(os.environ.get("COLLECTOR_RUN_KEEP", "5")))


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
    terminal = phase in ("completed", "aborted", "skipped", "cancelled", "halted")
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
        "jmeterThread": raw.get("jmeterThread", raw.get("threadName", "")),
        # Plan-mode fields: a started step inferred from the previous sample is
        # an estimate until JMeter reports the real result for it.
        "estimated": bool(raw.get("estimated", False)),
        "journeyName": raw.get("journeyName", ""),
        "unmatched": bool(raw.get("unmatched", False)),
        # JMeter timings and sizes shown in the per-sample detail view.
        "latency": raw.get("latency", 0),
        "connect": raw.get("connect", 0),
        "bytes": raw.get("bytes", 0),
        # Failed samples only, capped by the listener; never response bodies.
        "failureMessage": str(raw.get("failureMessage", ""))[:240],
    }


# Batches queued per live viewer before it is told to reload the recording instead.
SUBSCRIBER_BACKLOG = 2000


class Subscriber:
    def __init__(self) -> None:
        self.queue: queue.Queue = queue.Queue(maxsize=SUBSCRIBER_BACKLOG)
        self.lagging = threading.Event()


def publish(events: list[dict]) -> None:
    """Record a batch and hand it to every live viewer as one SSE message."""
    if not events:
        return
    DATA.mkdir(parents=True, exist_ok=True)
    with LOCK:
        EVENTS.extend(events)
        RUNS.append_many(events, TRACKER.plan)
        for subscriber in SUBSCRIBERS[:]:
            try:
                subscriber.queue.put_nowait(events)
            except queue.Full:
                # Never drop events silently: a viewer that fell behind reloads the recording.
                SUBSCRIBERS.remove(subscriber)
                subscriber.lagging.set()


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
        elif event.get("phase") in ("completed", "aborted", "skipped", "cancelled"):
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
            "recordedCount": len(all_events), "loadSettings": LOAD_SETTINGS, "plan": TRACKER.plan}


def reset_recording() -> None:
    """Empty the live view; stored runs are kept and the next event opens a new run."""
    with LOCK:
        EVENTS.clear()
        RUNS.detach()


def ingest(raw: dict) -> list[dict]:
    """Route one received object: test markers, plan-matched samples, or legacy events."""
    if raw.get("eventType") == "test":
        timestamp = int(raw.get("timestamp") or now_ms())
        if raw.get("phase") == "started":
            # A new JMeter run becomes the live recording; earlier runs stay stored.
            TRACKER.reset()
            with LOCK:
                EVENTS.clear()
                RUNS.start(timestamp, TRACKER.plan)
            produced = []
        else:
            produced = TRACKER.end_test(timestamp)
            with LOCK:
                RUNS.end(timestamp)
        return produced + [raw]
    if TRACKER.handles(raw):
        return TRACKER.sample(raw)
    return [raw]


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        LOG.info(fmt % args)

    def route(self) -> str:
        """Request path; the web screen calls the API under /collector (same as the Vite dev proxy)."""
        path = urlparse(self.path).path
        return path[len("/collector"):] or "/" if path == "/collector" or path.startswith("/collector/") else path

    def send_json(self, value, status=200):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = self.route()
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
                    DATA.mkdir(parents=True, exist_ok=True)
                    LOAD_SETTINGS_FILE.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")
                self.send_json({"accepted": True, "loadSettings": value}, HTTPStatus.ACCEPTED)
            except (ValueError, json.JSONDecodeError) as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/reset":
            with TRACKER_LOCK:
                TRACKER.reset()
                reset_recording()
            self.send_json({"reset": True}, HTTPStatus.OK)
            return
        if path == "/api/test-tree":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                plan = parse_test_tree(self.rfile.read(length))
                with TRACKER_LOCK:
                    TRACKER.set_plan(plan)
                    DATA.mkdir(parents=True, exist_ok=True)
                    PLAN_FILE.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    reset_recording()
                self.send_json({"accepted": True, "threadGroups": len(plan["threadGroups"])}, HTTPStatus.ACCEPTED)
            except (ValueError, SyntaxError, json.JSONDecodeError) as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if path == "/api/plan":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                plan = parse_jmx(self.rfile.read(length))
                with TRACKER_LOCK:
                    TRACKER.set_plan(plan)
                    DATA.mkdir(parents=True, exist_ok=True)
                    PLAN_FILE.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
                    # The live view belongs to the new plan; earlier runs keep their own plan.
                    reset_recording()
                self.send_json({"accepted": True, "plan": plan}, HTTPStatus.ACCEPTED)
            except (ValueError, SyntaxError) as exc:
                self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
            return
        if path != "/events":
            self.send_error(404); return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
            raw_events = body if isinstance(body, list) else body.get("events", [body])
            if not isinstance(raw_events, list) or not all(isinstance(x, dict) for x in raw_events):
                raise ValueError("Expected an event object or {events: [...]}.")
            with TRACKER_LOCK:
                accepted = [normalize(x) for raw in raw_events for x in ingest(raw)]
                publish(accepted)
            self.send_json({"accepted": len(accepted)}, HTTPStatus.ACCEPTED)
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)

    def do_DELETE(self):
        if self.route() != "/api/plan":
            self.send_error(404); return
        with TRACKER_LOCK:
            TRACKER.set_plan(None)
            PLAN_FILE.unlink(missing_ok=True)
        self.send_json({"plan": None})

    def do_GET(self):
        path = self.route()
        if path == "/api/snapshot":
            self.send_json(snapshot()); return
        if path == "/api/plan":
            self.send_json({"plan": TRACKER.plan}); return
        if path == "/api/recording":
            with LOCK: recorded = EVENTS[:]
            self.send_json({"events": recorded, "count": len(recorded), "run": RUNS.current}); return
        if path == "/api/runs":
            with LOCK: runs = RUNS.summaries()
            self.send_json({"runs": runs}); return
        if path.startswith("/api/runs/"):
            run_id = path.rsplit("/", 1)[1]
            with LOCK:
                if run_id not in RUNS.ids():
                    self.send_error(404); return
                body = {"run": RUNS.meta(run_id), "events": RUNS.events(run_id)}
            self.send_json(body); return
        if path == "/stream":
            self.stream(); return
        self.web(path)

    def web(self, path):
        if not (WEB_DIR / "index.html").exists():
            self.send_error(503, "Web screen not built: run 'npm run build' in src/web"); return
        target = (WEB_DIR / path.lstrip("/")).resolve() if path != "/" else WEB_DIR / "index.html"
        if not target.is_relative_to(WEB_DIR) or not target.is_file():
            self.send_error(404); return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mimetypes.guess_type(target.name)[0] or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def stream(self):
        subscriber = Subscriber(); q = subscriber.queue
        with LOCK: SUBSCRIBERS.append(subscriber)
        try:
            self.send_response(200); self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache"); self.send_header("Connection", "keep-alive"); self.end_headers()
            self.wfile.write(("data: " + json.dumps(snapshot()) + "\n\n").encode()); self.wfile.flush()
            while True:
                if subscriber.lagging.is_set():
                    self.wfile.write(b"event: resync\ndata: {}\n\n"); self.wfile.flush(); return
                try: item = q.get(timeout=12)
                except queue.Empty: self.wfile.write(b": keepalive\n\n"); self.wfile.flush(); continue
                # Coalesce whatever else is already queued into the same message.
                batch = list(item)
                while True:
                    try: batch.extend(q.get_nowait())
                    except queue.Empty: break
                self.wfile.write(("event: batch\ndata: " + json.dumps(batch, separators=(",", ":")) + "\n\n").encode()); self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass
        finally:
            with LOCK:
                if subscriber in SUBSCRIBERS: SUBSCRIBERS.remove(subscriber)


def setup_logging() -> None:
    """Log to stdout (docker logs) and to a rotating file under LOG_DIR (logs/collector on the host)."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    file_handler = logging.handlers.RotatingFileHandler(LOG_DIR / "collector.log", maxBytes=10_000_000, backupCount=5, encoding="utf-8")
    for handler in (logging.StreamHandler(), file_handler):
        handler.setFormatter(formatter); LOG.addHandler(handler)
    LOG.setLevel(logging.INFO)


if __name__ == "__main__":
    setup_logging()
    DATA.mkdir(parents=True, exist_ok=True)
    EVENTS.extend(RUNS.resume_latest())
    if LOAD_SETTINGS_FILE.exists():
        try: LOAD_SETTINGS.update(json.loads(LOAD_SETTINGS_FILE.read_text(encoding="utf-8")))
        except json.JSONDecodeError: pass
    if PLAN_FILE.exists():
        try: TRACKER.set_plan(json.loads(PLAN_FILE.read_text(encoding="utf-8")))
        except json.JSONDecodeError: pass
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    LOG.info("Collector: http://%s:%s  (data: %s, web: %s)", HOST, PORT, DATA, WEB_DIR)
    server.serve_forever()
