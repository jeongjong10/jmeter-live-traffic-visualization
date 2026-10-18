# JMeter NetViz renderer

This is the visible renderer for the JMeter visualization PoC. It uses the NetViz React + Canvas topology UI and receives **real local collector events**, not NetViz's mock/public traffic generator.

## What it shows

- **concurrent business traffic first**: one `JMeter 부하 발생기` node sits on the left. It shows the actual traffic factors (`VU`, ramp-up seconds, loops, planned journeys, observed requests) rather than decorative user dots;
- API stages are a vertical lane on the right. The renderer reads `GET /api/snapshot.loadSettings.steps`, so the configured seven-stage journey (`auth/session/search/product-detail/cart/payment/order-confirmation`) is displayed before and during a run. Longer flows receive more vertical canvas space and a scroll container; nodes never stack behind another node;
- every visible dot is a sampled, event-backed JMeter request (`correlationId` when supplied; request ID fallback otherwise), never a generated/decorative user;
- each stage is a visible round trip: the solid upper curve is `사용자 → API` request, API residency uses the measured JMeter duration, and the dashed lower curve is `API → 사용자` response. The next stage can only send after its prior response returns to the same user/run ID;
- every edge shows request in-flight and completed requests/sec, then response mean delay and error rate. Every API node shows inbound count, processing users, mean latency, p95 latency, and cumulative **error count** (never an incorrectly-labelled `/s` value) for the displayed time;
- at high volume the renderer caps drawing to 80 real event tokens and says so in the UI. Metrics still use all captured events.
- the raw request log, inspector, and timing waterfall are folded under **개발자 상세** so they do not obscure the test result;
- speed choices of **0.125×, 0.25×, 0.5×, 0.75×, 1×, and 2×**. The selected speed applies to both the screen time axis and a durable-recording reload;
- a primary **처음부터 재생** control that resets the timeline to zero and immediately plays at the selected speed. It is separate from the play/pause toggle and **기록 다시 불러오기** (which refreshes durable collector data);
- a full-width recording scrubber with elapsed/total time, play/pause, and click/drag seek. Seeking immediately recalculates the API metrics and request/response tokens for that instant;
- only loopback communication: browser → Vite proxy → `127.0.0.1:8765` collector.

### Reading the first screen

1. Start at the left `JMeter 부하 발생기`: solid `→ 요청` leaves the configured test load, the dot stays in an API for JMeter's measured duration, and dashed `← 응답` returns before the same journey asks the next API.
2. Edge labels separate direction and evidence: request-side shows in-flight/throughput; response-side shows average latency and error rate. Red response dots terminate that user's flow.
3. A crowded, orange-outlined API with a sparse next request curve is the bottleneck. The screen continually sweeps captured timestamps; Replay repeats the recorded arrivals.

The short request/response flight interval is a fixed **170 ms visual transit overlay**. It makes an otherwise instantaneous local wire round trip legible; it does not replace or alter the JMeter-measured API residence time, average, or p95. The colored moving dots remain real correlation-backed events; the left load-generator card intentionally contains no per-user dots.

## Journey correlation

The renderer consumes `correlationId`/`flowId`, `journeyId`, `stepId`, `stepOrder`, `previousStepId`, `phase`, and `outcome` when the collector provides them. It also reads the run definition at `GET /api/snapshot.loadSettings`: `{ journeyId, journeyName, virtualUsers, rampUpSeconds, loops, durationSeconds, plannedJourneys, failureRule, slowRule, steps }`. The mock run writes the same contract through `POST /api/load-settings` before JMeter begins. Old recordings without an ID are grouped by scenario plus a 10-second time window; that fallback is only acceptable for this PoC and can join concurrent executions incorrectly. Backend Listener completion events alone cannot reveal an in-progress request; the v2 fixture emits lifecycle signals for live active-step rendering, while production instrumentation should emit the same fields from the application boundary.

## Run

Start the existing collector first (it owns port 8765):

```sh
cd live-traffic-poc
python3 server.py
```

Then start the NetViz renderer:

```sh
cd netviz-visualizer
npm install
npm run dev
```

Open [http://127.0.0.1:5174](http://127.0.0.1:5174). Run the existing real-JMeter fixture in another terminal:

```sh
cd jmeter-backend-listener/fixtures
./run-e2e.sh
```

The incoming fixture samples appear live. Once the run is over, choose a speed, use **기록 다시 불러오기**, or drag the **전체 기록 타임라인** to inspect any instant. The data is read from the collector's `data/events.ndjson` through `GET /api/recording`; nothing leaves the machine.

## Data adapter

`src/services/realTraffic.ts` maps the collector contract (`timestamp`, `endpoint`, `durationMs`, `success`, `status`, optional `bytes`/timings) into NetViz's `NetworkRequest`. This deliberately replaces the upstream browser interception and public API demo generator.

## Upstream attribution

See [ATTRIBUTION.md](ATTRIBUTION.md). The upstream repository did not publish a license file at the integration commit, so this PoC preserves attribution and must not be redistributed as if it carried a declared upstream open-source license.
