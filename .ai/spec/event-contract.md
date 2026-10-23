# Journey Event v4 — 7단계 동시 트래픽 계약

`correlationId`는 JMeter 가상 사용자 한 회차를 뜻합니다. 이벤트는 `timestamp`, 그다음 `stepOrder` 순으로 정렬합니다. 요청은 사용자 클러스터에서 API 노드로, 응답은 그 노드에서 사용자로 돌아오도록 애니메이션합니다. 응답이 돌아온 뒤에만 토큰이 다음 API를 요청할 수 있습니다.

`GET /api/snapshot`은 흐름 구성의 기준값으로 `loadSettings`를 반환합니다.

```json
{"virtualUsers":12,"rampUpSeconds":2,"loops":2,"plannedJourneys":24,
 "steps":[{"id":"auth","order":1,"label":"인증"},{"id":"session","order":2,"label":"세션/프로필"},{"id":"search","order":3,"label":"상품 검색"},{"id":"product-detail","order":4,"label":"상품 상세"},{"id":"cart","order":5,"label":"장바구니"},{"id":"payment","order":6,"label":"결제 승인"},{"id":"order-confirmation","order":7,"label":"주문 확정"}]}
```

수명주기 이벤트는 `eventType`, `correlationId`, `journeyId`, `stepId`, `stepOrder`, `previousStepId`, `phase`, `scenario`, `timestamp`, `startedAt`을 포함합니다. Backend Listener의 종료 이벤트는 `completed` 또는 `aborted`를 사용하며 실제 JMeter `durationMs`, `status`, `success`를 포함합니다. 실패가 발생하면 남은 각 단계에 대해 `skipped`를 발행하며, JMeter If Controller가 건너뛴 단계에서 HTTP/JTL 행이 생기지 않도록 보장합니다.

`nodeStates`는 계속 집계 입력으로 쓰입니다: arrivals, inFlight, completions, success, error, skipped, avgMs, p95Ms, throughputPerSec. 엣지 라벨은 `started`로 요청률을, 종료 이벤트의 duration으로 응답 시간을, `aborted`/`skipped`로 이탈을 계산할 수 있습니다.
