"""Keeps the most recent JMeter runs on disk, one directory per run.

Each run directory holds ``meta.json`` (times and the .jmx plan that was
registered when the run started) and ``events.ndjson`` (collector events).
A new run starts on the listener's test-started marker; older runs beyond
``keep`` are deleted.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path


class RunStore:
    def __init__(self, root: Path, keep: int = 5) -> None:
        self.root = root
        self.keep = keep
        self.current: dict | None = None

    def _dir(self, run_id: str) -> Path:
        return self.root / run_id

    def _write_meta(self, meta: dict) -> None:
        (self._dir(meta["id"]) / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")

    def start(self, timestamp: int, plan: dict | None) -> dict:
        run_id = f"{timestamp:015d}"
        self._dir(run_id).mkdir(parents=True, exist_ok=True)
        (self._dir(run_id) / "events.ndjson").touch()
        self.current = {"id": run_id, "startedAt": timestamp, "endedAt": None,
                        "testPlan": (plan or {}).get("testPlan", ""), "plan": plan}
        self._write_meta(self.current)
        for old in self.ids()[self.keep:]:
            shutil.rmtree(self._dir(old), ignore_errors=True)
        return self.current

    def end(self, timestamp: int) -> None:
        if self.current:
            self.current["endedAt"] = timestamp
            self._write_meta(self.current)

    def append(self, event: dict, plan: dict | None) -> None:
        self.append_many([event], plan)

    def append_many(self, events: list[dict], plan: dict | None) -> None:
        if not events:
            return
        if self.current is None:
            # Events without a test-started marker (manual posts) open a run lazily.
            self.start(int(events[0].get("timestamp") or 0), plan)
        with (self._dir(self.current["id"]) / "events.ndjson").open("a", encoding="utf-8") as fp:
            fp.write("".join(json.dumps(event, separators=(",", ":")) + "\n" for event in events))

    def detach(self) -> None:
        """Stop appending to the current run without deleting it."""
        self.current = None

    def ids(self) -> list[str]:
        if not self.root.exists():
            return []
        return sorted((path.name for path in self.root.iterdir() if (path / "meta.json").exists()), reverse=True)

    def meta(self, run_id: str) -> dict:
        return json.loads((self._dir(run_id) / "meta.json").read_text(encoding="utf-8"))

    def events(self, run_id: str) -> list[dict]:
        events = []
        for line in (self._dir(run_id) / "events.ndjson").read_text(encoding="utf-8").splitlines():
            try:
                events.append(json.loads(line))
            except json.JSONDecodeError:
                pass
        return events

    def summaries(self) -> list[dict]:
        rows = []
        for run_id in self.ids():
            meta = self.meta(run_id)
            measured = [e for e in self.events(run_id) if e.get("phase") in ("completed", "aborted")]
            rows.append({key: meta.get(key) for key in ("id", "startedAt", "endedAt", "testPlan")}
                        | {"samples": len(measured), "errors": sum(1 for e in measured if e.get("phase") == "aborted"),
                           "live": self.current is not None and self.current["id"] == run_id})
        return rows

    def resume_latest(self) -> list[dict]:
        """On collector start, keep the newest run as the current recording."""
        ids = self.ids()
        if not ids:
            return []
        self.current = self.meta(ids[0])
        return self.events(ids[0])
