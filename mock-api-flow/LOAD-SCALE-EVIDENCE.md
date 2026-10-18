# 7단계 checkout 부하 배수 검증

검증일: 2026-10-18 (KST)
범위: loopback 전용 `127.0.0.1` mock API, JMeter 5.6.3, collector `:8765`

기준은 12 VU × 2회 반복(24 여정)이다. 요청한 배수는 VU만 2배·4배·10배로 올렸고,
각 실행 전 collector의 기록을 초기화하고 해당 실행의 load settings를 다시 발행했다.
Ramp-up은 초당 약 6 VU로 일정하게 유지했다.

| 배수 | JMeter 설정 | 여정 | HTTP 표본 | product-detail 503 | collector 이벤트 | JMeter 요약 |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| 2× | 24 VU, 4초 ramp-up, 2회 | 48 | 318 | 6 | 654 | 57.2/s, 평균 73ms, 최대 1,207ms, 오류 6 (1.89%) |
| 4× | 48 VU, 8초 ramp-up, 2회 | 96 | 630 | 14 | 1,302 | 65.9/s, 평균 74ms, 최대 1,207ms, 오류 14 (2.22%) |
| 10× | 120 VU, 20초 ramp-up, 2회 | 240 | 1,578 | 34 | 3,258 | 73.2/s, 평균 74ms, 최대 1,207ms, 오류 34 (2.15%) |

`product-detail`의 503은 계획된 failure cohort이다. 다른 HTTP 오류는 없었다.

## 10× 마지막 실행의 단계별 결과

| 단계 | 유입 | 성공 | 오류 | skipped | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 인증 | 240 | 240 | 0 | 0 | 2ms |
| 세션/프로필 | 240 | 240 | 0 | 0 | 1ms |
| 상품 검색 | 240 | 240 | 0 | 0 | 1,206ms |
| 상품 상세 | 240 | 206 | 34 | 0 | 1ms |
| 장바구니 | 206 | 206 | 0 | 34 | 1ms |
| 결제 승인 | 206 | 206 | 0 | 34 | 456ms |
| 주문 확정 | 206 | 206 | 0 | 34 | 1ms |

수명주기 완결성은 `1,578 HTTP terminal × 2(start + terminal) + 34 실패 × 3 downstream skipped = 3,258` 이벤트로 확인했다.
`cart`, `payment`, `order-confirmation`의 실제 HTTP 호출은 모두 206건이어서,
상품 상세 실패 34건이 후속 세 단계로 이동하지 않았음도 확인했다.

마지막 10× 기록은 collector에 유지한다. `http://127.0.0.1:8765/api/snapshot` 및 시각화 화면
`http://127.0.0.1:5174/`은 검증 시 HTTP 200이었다.

## 재현

collector를 실행한 뒤 아래 중 하나를 실행한다. 스크립트가 실행 전 기록을 초기화하고,
load settings를 해당 설정으로 발행한다.

```sh
VIRTUAL_USERS=24 RAMP_UP_SECONDS=4 LOOPS=2 ./mock-api-flow/run-jmeter-flow.sh
VIRTUAL_USERS=48 RAMP_UP_SECONDS=8 LOOPS=2 ./mock-api-flow/run-jmeter-flow.sh
VIRTUAL_USERS=120 RAMP_UP_SECONDS=20 LOOPS=2 ./mock-api-flow/run-jmeter-flow.sh
```
