# JMeter Backend Listener (PoC)

This module is a JMeter 5.6.3 `BackendListenerClient`. It normalizes
`SampleResult` instances into event-contract-v1 JSON and posts batches to a
loopback collector.

Configure the listener implementation as:

`io.axtutorlog.jmeter.backend.EventCollectorBackendListener`

Properties:

| Property | Default | Meaning |
| --- | --- | --- |
| `collectorUrl` | `http://127.0.0.1:8765/events` | Required loopback HTTP(S) collector endpoint. |
| `batchSize` | `100` | Number of normalized samples per POST. |
| `flushIntervalMillis` | `1000` | Maximum interval before a POST. |
| `connectTimeoutMillis` | `1000` | Connect timeout for a collector request. |
| `requestTimeoutMillis` | `2000` | End-to-end timeout for a collector request. |

The request body is a JSON array. Every item has exactly these fields:
`timestamp`, `label`, `elapsed`, `success`, `responseCode`, `latency`,
`connect`, and `bytes`.

Delivery policy is **at-most-once**: a request is attempted once; non-2xx
responses, connection errors, and timeouts are logged and the batch is dropped.
This avoids duplicate samples until the collector defines idempotency keys.

Build with Java 21:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21 mvn test
```

## Local JMeter E2E fixture

The fixture uses JMeter's `DebugSampler`, so it makes no HTTP or external
network call other than the loopback collector POST. It temporarily adds the
built JAR with `user.classpath`; it does not modify JMeter's installed
`lib/ext` directory.

Run it with the installed Java 21 and JMeter 5.6.3 paths:

```sh
./fixtures/run-e2e.sh
```

Success requires the loopback collector to be running, plus listener
initialization, one successful batch delivery, and the `Local debug sample`.
The generated `.jtl` and `.log` files are ignored as execution evidence, not
source artifacts.
