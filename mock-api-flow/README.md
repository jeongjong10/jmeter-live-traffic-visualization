# Seven-step concurrent commerce flow

This loopback-only fixture demonstrates the intended visual model: JMeter virtual users enter the same business process together, and only users whose API response has returned can issue the next request.

```text
사용자 → 인증 → 세션/프로필 → 상품 검색 → 상품 상세 → 장바구니 → 결제 승인 → 주문 확정
       ← 응답  ← 응답          ← 응답       ← 응답       ← 응답     ← 응답       ← 응답
```

The seven endpoint definitions and renderer-facing JMeter controls are in [load-settings.json](load-settings.json). It is posted to `/api/load-settings` before each run and returned by `/api/snapshot` as `loadSettings`.

| Load factor | Value | Meaning |
| --- | ---: | --- |
| Virtual users | 12 | Concurrent JMeter threads. |
| Ramp-up | 2 sec | Time over which users begin. |
| Loops | 2 | Complete journeys per user. |
| Planned journeys | 24 | `12 × 2`, each with a correlation ID. |
| Slow cohort | deterministic | Search adds 1200 ms; payment adds 450 ms. |
| Failure cohort | deterministic | Product detail returns HTTP 503. |

Normal and slow users complete all seven APIs. A failure starts at `product-detail`; `cart`, `payment`, and `order-confirmation` are emitted as `skipped`, while JMeter makes no HTTP calls for them.

## Run and verify

Start the collector first, then execute:

```sh
python3 live-traffic-poc/server.py
./mock-api-flow/run-jmeter-flow.sh
```

The default script validates exactly 156 real HTTP samples: 24 each through product detail, 20 each for cart/payment/confirmation, and four product-detail HTTP 503 results. The mock API binds only to `127.0.0.1:18081` and exits after the run.

## Scale controls

The thread count, ramp-up, and journey loops are safe JMeter property overrides. Each run clears the collector record and publishes the matching renderer settings before JMeter starts.

```sh
VIRTUAL_USERS=24 RAMP_UP_SECONDS=4 LOOPS=2 ./mock-api-flow/run-jmeter-flow.sh
VIRTUAL_USERS=48 RAMP_UP_SECONDS=8 LOOPS=2 ./mock-api-flow/run-jmeter-flow.sh
VIRTUAL_USERS=120 RAMP_UP_SECONDS=20 LOOPS=2 ./mock-api-flow/run-jmeter-flow.sh
```

The 2×, 4×, and 10× evidence is recorded in [LOAD-SCALE-EVIDENCE.md](LOAD-SCALE-EVIDENCE.md).
