# 7단계 동시 커머스 흐름

이 loopback 전용 fixture는 의도한 시각 모델을 보여줍니다. JMeter 가상 사용자들이 같은 비즈니스 프로세스에 함께 진입하고, API 응답이 돌아온 사용자만 다음 요청을 보낼 수 있습니다.

```text
사용자 → 인증 → 세션/프로필 → 상품 검색 → 상품 상세 → 장바구니 → 결제 승인 → 주문 확정
       ← 응답  ← 응답          ← 응답       ← 응답       ← 응답     ← 응답       ← 응답
```

7개 엔드포인트 정의와 렌더러용 JMeter 제어값은 [load-settings.json](load-settings.json)에 있습니다. 이 파일은 매 실행 전에 `/api/load-settings`로 POST되며, `/api/snapshot`에서 `loadSettings`로 반환됩니다.

| 부하 요소 | 값 | 의미 |
| --- | ---: | --- |
| 가상 사용자 | 12 | 동시 JMeter 스레드 수. |
| Ramp-up | 2초 | 사용자들이 시작되는 데 걸리는 시간. |
| 반복 | 2 | 사용자당 완료하는 여정 수. |
| 계획 여정 | 24 | `12 × 2`, 각각 correlation ID를 가짐. |
| 지연 cohort | 결정적 | 검색에 1200ms, 결제에 450ms 추가. |
| 실패 cohort | 결정적 | 상품 상세가 HTTP 503 반환. |

정상 사용자와 지연 사용자는 7개 API를 모두 완료합니다. 실패는 `product-detail`에서 시작되며, `cart`, `payment`, `order-confirmation`은 `skipped`로 발행되고 JMeter는 이 단계들에 HTTP 호출을 하지 않습니다.

## 실행 및 검증

먼저 collector를 실행한 뒤 다음을 실행합니다.

```sh
python3 live-traffic-poc/server.py
./mock-api-flow/run-jmeter-flow.sh
```

기본 스크립트는 정확히 156건의 실제 HTTP 샘플을 검증합니다: 상품 상세까지 각 24건, 장바구니/결제/주문 확정 각 20건, 그리고 상품 상세 HTTP 503 4건입니다. mock API는 `127.0.0.1:18081`에만 바인딩하며 실행이 끝나면 종료됩니다.

## 부하 배수 조정

스레드 수, ramp-up, 여정 반복 횟수는 안전한 JMeter 속성 오버라이드로 바꿀 수 있습니다. 각 실행은 JMeter 시작 전에 collector 기록을 초기화하고 그에 맞는 렌더러 설정을 발행합니다.

```sh
VIRTUAL_USERS=24 RAMP_UP_SECONDS=4 LOOPS=2 ./mock-api-flow/run-jmeter-flow.sh
VIRTUAL_USERS=48 RAMP_UP_SECONDS=8 LOOPS=2 ./mock-api-flow/run-jmeter-flow.sh
VIRTUAL_USERS=120 RAMP_UP_SECONDS=20 LOOPS=2 ./mock-api-flow/run-jmeter-flow.sh
```

2×, 4×, 10× 검증 결과는 [LOAD-SCALE-EVIDENCE.md](LOAD-SCALE-EVIDENCE.md)에 기록되어 있습니다.
