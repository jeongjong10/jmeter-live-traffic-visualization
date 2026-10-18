# Journey Event v4 — seven-stage concurrent traffic contract

`correlationId` is one JMeter virtual-user round. Order events by `timestamp`, then `stepOrder`; animate request from the user cluster to the API node and response from that node back to the user. Only after that response may the token request the next API.

`GET /api/snapshot` returns `loadSettings` as the authoritative flow configuration:

```json
{"virtualUsers":12,"rampUpSeconds":2,"loops":2,"plannedJourneys":24,
 "steps":[{"id":"auth","order":1,"label":"인증"},{"id":"session","order":2,"label":"세션/프로필"},{"id":"search","order":3,"label":"상품 검색"},{"id":"product-detail","order":4,"label":"상품 상세"},{"id":"cart","order":5,"label":"장바구니"},{"id":"payment","order":6,"label":"결제 승인"},{"id":"order-confirmation","order":7,"label":"주문 확정"}]}
```

Lifecycle events include `eventType`, `correlationId`, `journeyId`, `stepId`, `stepOrder`, `previousStepId`, `phase`, `scenario`, `timestamp`, and `startedAt`. Backend listener terminal events use `completed` or `aborted` and include real JMeter `durationMs`, `status`, and `success`. A failure emits `skipped` for each remaining stage; the JMeter If Controllers ensure skipped stages do not create an HTTP/JTL row.

`nodeStates` remains the aggregate input: arrivals, inFlight, completions, success, error, skipped, avgMs, p95Ms, and throughputPerSec. Edge labels can derive request rate from `started`, response time from terminal durations, and drop-off from `aborted`/`skipped`.
