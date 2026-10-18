# JMeter business-flow visualizer (PoC v1)

This repository is a loopback-only proof of concept that visualizes a real JMeter run as a business-flow replay.

```text
JMeter virtual users → collector (127.0.0.1:8765) → NetViz renderer (127.0.0.1:5174)
```

The included sample flow has seven stages: authentication, session/profile, product search, product detail, cart, payment approval, and order confirmation. A visual token makes a request from the JMeter load-generator card to an API, remains there for JMeter's measured duration, and returns as a response before its next request begins. The renderer supports replay, seek, and 0.125× through 2× playback.

## Scope and limits

This is a **single-machine, loopback PoC**. It is intended for safe local demonstrations and integration experiments; it is not a production telemetry system. It does not yet provide distributed JMeter aggregation, access control/TLS, durable retention management, retry/idempotency, or delivery guarantees. The collector's listener uses at-most-once delivery: a failed POST batch is logged and dropped to avoid duplicate samples.

The UI is based on a NetViz-derived React/Canvas implementation. See [netviz-visualizer/ATTRIBUTION.md](netviz-visualizer/ATTRIBUTION.md) before redistributing it; the upstream integration snapshot did not include a license declaration.

## Prerequisites

- Java 21 and Maven 3.9+
- Apache JMeter 5.6.x
- Python 3.10+
- Node.js 20+ and npm
- `curl`; the included mock-flow runner also uses `jq`

Confirm that `java`, `mvn`, `jmeter`, `python3`, `node`, `npm`, `curl`, and `jq` are reachable from your shell. This repository does not vendor those tools or their dependencies.

## Quick start: included seven-API demo

Use three terminals from the repository root.

**1. Build the JMeter listener and start the collector**

```sh
cd jmeter-backend-listener
mvn test package

cd ../live-traffic-poc
python3 server.py
```

The collector is now available only at `http://127.0.0.1:8765`.

**2. Start the visualizer**

```sh
cd netviz-visualizer
npm ci
npm run dev
```

Open `http://127.0.0.1:5174`.

**3. Run the flow fixture**

In another terminal, run the supplied local mock API and JMeter plan. Set `JAVA_HOME` only when JMeter cannot otherwise locate Java 21; set `JMETER_BIN` only when `jmeter` is not on `PATH`.

```sh
./mock-api-flow/run-jmeter-flow.sh
```

The runner starts the local mock API, resets the collector recording, publishes the load settings, and verifies expected counts. It resolves `jmeter` from `PATH`, with Homebrew paths as a macOS fallback. Read [mock-api-flow/README.md](mock-api-flow/README.md) for scaling examples and expected results.

After a run finishes, use **기록 다시 불러오기** in the browser, select a speed, use **처음부터 재생**, or drag the full-width timeline.

## Connecting a real JMeter plan

1. Start the collector and visualizer as above.
2. Build the listener JAR with `mvn package` under `jmeter-backend-listener`.
3. Add the JAR to the JMeter invocation or instance classpath. For a command-line run:

   ```sh
   jmeter -n -t /path/to/your-plan.jmx \
     -Juser.classpath=/absolute/path/to/jmeter-backend-listener/target/jmeter-backend-listener-0.1.0-SNAPSHOT.jar
   ```

4. Add a **Backend Listener** beneath the Test Plan and set its implementation class to:

   ```text
   io.axtutorlog.jmeter.backend.EventCollectorBackendListener
   ```

5. Configure these listener arguments:

   | Name | Value |
   | --- | --- |
   | `collectorUrl` | `http://127.0.0.1:8765/events` |
   | `batchSize` | `100` |
   | `flushIntervalMillis` | `1000` |

This gives endpoint completion counts, result status, and measured timings. To render the full per-user round trip (request → API residence → response → next request), instrument your plan with lifecycle fields including `correlationId`, `journeyId`, `stepId`, `stepOrder`, `previousStepId`, and `phase`. The reference JSR223 scripts and contract are [mock-api-flow/journey-start.groovy](mock-api-flow/journey-start.groovy), [mock-api-flow/journey-skip-order.groovy](mock-api-flow/journey-skip-order.groovy), and [mock-api-flow/CONTRACT.md](mock-api-flow/CONTRACT.md).

The collector only accepts loopback data by default. Do not expose it beyond the host without first adding authentication, TLS, input limits, persistence controls, and an appropriate delivery/idempotency design.

## Repository layout

- `jmeter-backend-listener/` — Java 21 JMeter Backend Listener and unit tests.
- `live-traffic-poc/` — Python standard-library collector and local replay API.
- `netviz-visualizer/` — React/Vite NetViz-derived renderer.
- `mock-api-flow/` — seven-stage mock API, JMeter plan, and lifecycle reference scripts.

Generated dependencies, build outputs, logs, JTL results, PID files, and collector recordings are deliberately ignored by Git. They are reproducible runtime evidence, not source artifacts.
