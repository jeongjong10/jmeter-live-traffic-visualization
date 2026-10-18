# Live Traffic PoC

Python standard-library-only loopback collector and browser dashboard.

```sh
cd live-traffic-poc
python3 server.py
# Open http://127.0.0.1:8765
```

Send one contract-shaped event:

```sh
curl -X POST http://127.0.0.1:8765/events -H 'content-type: application/json' \
  -d '{"timestamp":"2026-10-18T10:00:00Z","endpoint":"GET /catalog","durationMs":124,"success":true,"status":200}'
```

Events remain in memory and append to `data/events.ndjson`. The server binds only to `127.0.0.1`; it makes no external requests. `GET /stream` is SSE, `GET /api/snapshot` is the current 60-second window, and `GET /api/recording` exposes the durable local recording for dashboard replay.

For a flow renderer, consume `snapshot.nodeStates` rather than trying to infer
node queues from endpoint totals. Each node has `arrivals`, `inFlight`,
`completions`, `success`, `error`, `skipped`, `avgMs`, `p95Ms`,
`throughputPerSec`, and a short lifecycle `timeline`. A `journey` event on SSE
uses `phase: started` to place a virtual-user token at a node, then
`completed`/`aborted`/`skipped` to move, stop, or gray it out.

For a fresh demonstration recording, `POST /api/reset` clears only this local
PoC collector's in-memory and NDJSON events.

Limit: the in-process event list grows for the duration of a run; this is intentionally a small PoC rather than a retention-managed collector.
