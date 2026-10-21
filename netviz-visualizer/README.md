# JMeter NetViz 렌더러

JMeter 시각화 PoC의 화면 렌더러입니다. NetViz의 React + Canvas 토폴로지 UI를 사용하며, NetViz의 mock/공개 트래픽 생성기가 아닌 **실제 로컬 collector 이벤트**를 받습니다.

## 표시 내용

- **동시 비즈니스 트래픽 우선**: 왼쪽에 `JMeter 부하 발생기` 노드 하나가 있습니다. 장식용 사용자 점 대신 실제 트래픽 요소(`VU`, ramp-up 초, 반복 횟수, 계획 여정, 관측된 요청)를 보여줍니다.
- API 단계는 오른쪽 세로 레인에 배치됩니다. 렌더러는 `GET /api/snapshot.loadSettings.steps`를 읽으므로, 설정된 7단계 여정(`auth/session/search/product-detail/cart/payment/order-confirmation`)이 실행 전과 실행 중 모두 표시됩니다. 흐름이 길면 캔버스 세로 공간이 늘어나고 스크롤 컨테이너가 생기며, 노드가 다른 노드 뒤에 겹치지 않습니다.
- 화면의 모든 점은 이벤트에 근거한 샘플링된 JMeter 요청입니다(`correlationId`가 있으면 그것을, 없으면 요청 ID를 사용). 생성되거나 장식용인 사용자는 없습니다.
- 각 단계는 눈에 보이는 왕복입니다. 위쪽 실선 곡선은 `사용자 → API` 요청, API 체류는 JMeter 측정 시간, 아래쪽 점선 곡선은 `API → 사용자` 응답입니다. 다음 단계는 이전 응답이 같은 사용자/실행 ID로 돌아온 뒤에만 요청을 보낼 수 있습니다.
- 모든 엣지에는 처리 중 요청 수와 초당 완료 요청 수, 그리고 응답 평균 지연과 오류율이 표시됩니다. 모든 API 노드에는 표시 시점 기준 유입 건수, 처리 중 사용자, 평균 지연, p95 지연, 누적 **오류 건수**(잘못 표기된 `/s` 값이 아님)가 표시됩니다.
- 대량 트래픽에서는 실제 이벤트 토큰을 최대 80개까지만 그리며, 이를 UI에 표시합니다. 지표는 여전히 수집된 모든 이벤트를 사용합니다.
- 원시 요청 로그, 인스펙터, 타이밍 워터폴은 테스트 결과를 가리지 않도록 **개발자 상세** 아래에 접혀 있습니다.
- 재생 속도는 **0.125×, 0.25×, 0.5×, 0.75×, 1×, 2×** 중에서 고를 수 있습니다. 선택한 속도는 화면 시간축과 영구 기록 재로드 모두에 적용됩니다.
- 기본 **처음부터 재생** 컨트롤은 타임라인을 0으로 되돌리고 선택한 속도로 즉시 재생합니다. 재생/일시정지 토글 및 **기록 다시 불러오기**(collector의 영구 데이터를 새로 고침)와는 별개입니다.
- 전체 폭 기록 스크러버는 경과/전체 시간, 재생/일시정지, 클릭/드래그 탐색을 제공합니다. 탐색하면 해당 시점의 API 지표와 요청/응답 토큰을 즉시 다시 계산합니다.
- 통신은 loopback으로만 이루어집니다: 브라우저 → Vite 프록시 → `127.0.0.1:8765` collector.

### 첫 화면 읽는 법

1. 왼쪽 `JMeter 부하 발생기`에서 시작합니다. 실선 `→ 요청`이 설정된 테스트 부하에서 출발하고, 점은 JMeter가 측정한 시간만큼 API에 머물며, 점선 `← 응답`이 돌아온 뒤에야 같은 여정이 다음 API를 요청합니다.
2. 엣지 라벨은 방향과 근거를 구분합니다. 요청 쪽은 처리 중 건수/처리량을, 응답 쪽은 평균 지연과 오류율을 보여줍니다. 빨간 응답 점은 해당 사용자의 흐름을 종료합니다.
3. 점이 몰려 있고 주황색 테두리가 있으며 다음 요청 곡선이 듬성한 API가 병목입니다. 화면은 수집된 타임스탬프를 계속 훑으며, 재생은 기록된 도착을 반복합니다.

짧은 요청/응답 이동 구간은 고정된 **170ms 시각적 이동 오버레이**입니다. 로컬에서는 거의 즉시 끝나는 왕복을 눈으로 볼 수 있게 해 줄 뿐, JMeter가 측정한 API 체류 시간, 평균, p95를 대체하거나 바꾸지 않습니다. 움직이는 색 점은 여전히 correlation에 근거한 실제 이벤트이며, 왼쪽 부하 발생기 카드에는 의도적으로 사용자별 점을 두지 않습니다.

## 여정 상관관계

collector가 제공하면 렌더러는 `correlationId`/`flowId`, `journeyId`, `stepId`, `stepOrder`, `previousStepId`, `phase`, `outcome`을 사용합니다. 실행 정의는 `GET /api/snapshot.loadSettings`에서 읽습니다: `{ journeyId, journeyName, virtualUsers, rampUpSeconds, loops, durationSeconds, plannedJourneys, failureRule, slowRule, steps }`. mock 실행은 JMeter 시작 전에 `POST /api/load-settings`로 같은 계약을 기록합니다. ID가 없는 이전 기록은 시나리오와 10초 시간 구간으로 묶습니다. 이 대체 방식은 이 PoC에서만 허용되며, 동시 실행을 잘못 합칠 수 있습니다. Backend Listener의 완료 이벤트만으로는 진행 중인 요청을 알 수 없습니다. v2 fixture는 실시간 활성 단계 렌더링을 위해 수명주기 신호를 발행하며, 운영 환경 계측에서는 애플리케이션 경계에서 같은 필드를 발행해야 합니다.

## 실행

먼저 기존 collector를 실행합니다(포트 8765 사용).

```sh
cd live-traffic-poc
python3 server.py
```

그다음 NetViz 렌더러를 실행합니다.

```sh
cd netviz-visualizer
npm install
npm run dev
```

[http://127.0.0.1:5174](http://127.0.0.1:5174)를 엽니다. 다른 터미널에서 기존 실제 JMeter fixture를 실행합니다.

```sh
cd jmeter-backend-listener/fixtures
./run-e2e.sh
```

들어오는 fixture 샘플이 실시간으로 표시됩니다. 실행이 끝나면 속도를 고르고 **기록 다시 불러오기**를 누르거나, **전체 기록 타임라인**을 드래그해 원하는 시점을 살펴보세요. 데이터는 `GET /api/recording`을 통해 collector의 `data/events.ndjson`에서 읽으며, 어떤 데이터도 머신 밖으로 나가지 않습니다.

## 데이터 어댑터

`src/services/realTraffic.ts`는 collector 계약(`timestamp`, `endpoint`, `durationMs`, `success`, `status`, 선택적 `bytes`/타이밍)을 NetViz의 `NetworkRequest`로 매핑합니다. 업스트림의 브라우저 가로채기와 공개 API 데모 생성기를 의도적으로 대체합니다.

## 업스트림 출처 표기

[ATTRIBUTION.md](ATTRIBUTION.md)를 참고하세요. 통합 커밋 시점에 업스트림 저장소는 라이선스 파일을 공개하지 않았으므로, 이 PoC는 출처 표기를 유지하며 업스트림 오픈소스 라이선스가 선언된 것처럼 재배포해서는 안 됩니다.
