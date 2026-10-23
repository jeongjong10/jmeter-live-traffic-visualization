# 이벤트 계약

리스너(`src/listener`) → collector(`src/collector`) → 화면(`src/web`) 사이의 요청 형식과 이벤트다. 1절이 현재 주 경로(기존 jmx에 Backend Listener만 추가)이고, 2절은 테스트 계획 없이 JSR223 수명주기 이벤트로 그리던 이전 방식의 계약으로 데모(`tests/e2e/checkout-flow`) 검증에만 쓰인다.

## 1. 리스너 기반 연동 (현재)

### 1.1 리스너 → collector

| 시점 | 요청 | 본문 |
| --- | --- | --- |
| 테스트 시작 | `POST /api/test-tree` | JMeter가 실행 중인 테스트 트리. `[요소, 자식 배열, 요소, 자식 배열, …]` 형태의 JSON 배열이며 요소는 `{"tag","name","enabled","props"}`. collector가 `.jmx`와 같은 계획으로 해석한다 |
| 테스트 시작 직후 | `POST /events` | `[{"eventType":"test","phase":"started","timestamp":<ms>}]` — 새 실행 기록을 연다 |
| 실행 중 | `POST /events` | 샘플 배열(배치 `batchSize` 또는 `flushIntervalMillis`마다). 필드: `timestamp`, `label`, `elapsed`, `success`, `responseCode`, `latency`, `connect`, `bytes`, `startTime`, `threadName`, `failureMessage`(실패 샘플만, 앞 200자) 및 2절 호환 필드(`flowId`, `correlationId`, `journeyId`, `stepId`, `stepOrder`, `previousStepId`, `phase`, `outcome`) |
| 테스트 종료 | `POST /events` | 남은 배치를 보낸 뒤 `[{"eventType":"test","phase":"ended","timestamp":<ms>}]` |

전송은 at-most-once다. 실패한 배치는 리스너 로그에 남기고 버린다.

### 1.2 collector가 만드는 단계 이벤트

계획이 있으면 collector(`flow_tracker.py`)가 각 샘플을 `threadName`·`label`·`startTime`으로 계획의 단계에 맞춰 아래 이벤트로 바꾼다. 공통 필드: `eventType:"journey"`, `journeyId`(Thread Group id), `journeyName`, `stepId`, `stepOrder`, `endpoint`(단계 이름), `correlationId`(사용자·회차), `requestId`(방문 id), `jmeterThread`, `phase`, `outcome`, `timestamp`, `startedAt`, `durationMs`, `estimated`.

| `phase` | 뜻 |
| --- | --- |
| `completed` / `aborted` | 측정된 요청(성공/실패). `status`, `latency`, `connect`, `bytes`, `failureMessage` 포함 |
| `started` | 직전 요청이 끝나 다음 단계를 시작했을 것으로 추정(`estimated:true`). 측정 결과가 오면 같은 `requestId`로 확정된다 |
| `cancelled` | 추정이 맞지 않았거나 테스트가 끝나 추정을 취소 |
| `halted` | 실패 뒤 Thread Group의 오류 시 동작(`outcome`에 정책)으로 그 사용자가 멈춘 지점 |

테스트 시작·종료 표시(`eventType:"test"`)도 그대로 전달된다.

### 1.3 collector → 화면

| 요청 | 응답 |
| --- | --- |
| `GET /stream` (SSE) | 연결 직후 `snapshot` 한 번, 이후 `event: batch`(이벤트 배열, 묶어서 전송), 화면이 밀리면 `event: resync`(전체 재로딩 지시, 이벤트는 버리지 않음) |
| `GET /api/recording` | 현재 실행 기록의 이벤트 전체 |
| `GET /api/plan`, `POST /api/plan`(본문 `.jmx`), `DELETE /api/plan` | 등록된 계획 조회·등록·해제 |
| `GET /api/runs`, `GET /api/runs/<id>` | 최근 실행 기록 목록(시각·건수·오류), 기록 하나(당시 계획 + 이벤트) |
| `POST /api/reset` | 실시간 이벤트를 비우고 현재 기록과의 연결을 끊음(파일·계획 유지) |

화면은 같은 API를 `/collector/...` 접두어로 호출하며 collector는 접두어를 떼고 처리한다.

## 2. 이전 계약: Journey Event v4 (데모 검증용)

`correlationId`는 JMeter 가상 사용자 한 회차를 뜻합니다. 이벤트는 `timestamp`, 그다음 `stepOrder` 순으로 정렬합니다. 요청은 사용자 클러스터에서 API 노드로, 응답은 그 노드에서 사용자로 돌아오도록 애니메이션합니다. 응답이 돌아온 뒤에만 토큰이 다음 API를 요청할 수 있습니다.

`GET /api/snapshot`은 흐름 구성의 기준값으로 `loadSettings`를 반환합니다.

```json
{"virtualUsers":12,"rampUpSeconds":2,"loops":2,"plannedJourneys":24,
 "steps":[{"id":"auth","order":1,"label":"인증"},{"id":"session","order":2,"label":"세션/프로필"},{"id":"search","order":3,"label":"상품 검색"},{"id":"product-detail","order":4,"label":"상품 상세"},{"id":"cart","order":5,"label":"장바구니"},{"id":"payment","order":6,"label":"결제 승인"},{"id":"order-confirmation","order":7,"label":"주문 확정"}]}
```

수명주기 이벤트는 `eventType`, `correlationId`, `journeyId`, `stepId`, `stepOrder`, `previousStepId`, `phase`, `scenario`, `timestamp`, `startedAt`을 포함합니다. Backend Listener의 종료 이벤트는 `completed` 또는 `aborted`를 사용하며 실제 JMeter `durationMs`, `status`, `success`를 포함합니다. 실패가 발생하면 남은 각 단계에 대해 `skipped`를 발행하며, JMeter If Controller가 건너뛴 단계에서 HTTP/JTL 행이 생기지 않도록 보장합니다.

`nodeStates`는 계속 집계 입력으로 쓰입니다: arrivals, inFlight, completions, success, error, skipped, avgMs, p95Ms, throughputPerSec. 엣지 라벨은 `started`로 요청률을, 종료 이벤트의 duration으로 응답 시간을, `aborted`/`skipped`로 이탈을 계산할 수 있습니다.
