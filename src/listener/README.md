# JMeter Backend Listener (PoC)

이 모듈은 JMeter 5.6.3용 `BackendListenerClient`입니다. `SampleResult`
인스턴스를 JSON으로 정규화하고, 배치 단위로 loopback collector에 POST합니다.
테스트 시작 시 JMeter가 실행 중인 테스트 트리를 `/api/test-tree`로 보내고,
시작·종료 표시를 `/events`로 보냅니다. 형식은 [이벤트 계약](../../.ai/spec/event-contract.md)에 있습니다.

리스너 구현 클래스는 다음과 같이 설정합니다.

`io.axtutorlog.jmeter.backend.EventCollectorBackendListener`

속성:

| 속성 | 기본값 | 의미 |
| --- | --- | --- |
| `collectorUrl` | `http://127.0.0.1:8765/events` | 필수. loopback HTTP(S) collector 엔드포인트. |
| `batchSize` | `100` | POST 한 번에 담을 정규화된 샘플 수. |
| `flushIntervalMillis` | `1000` | POST 전까지의 최대 대기 간격. |
| `connectTimeoutMillis` | `1000` | collector 요청의 연결 타임아웃. |
| `requestTimeoutMillis` | `2000` | collector 요청의 전체(end-to-end) 타임아웃. |

요청 본문은 JSON 배열입니다. 샘플 항목의 필드는 `timestamp`, `label`, `elapsed`, `success`,
`responseCode`, `latency`, `connect`, `bytes`, `startTime`, `threadName`, `failureMessage`와
이전 수명주기 방식 호환용 `flowId`, `correlationId`, `journeyId`, `stepId`, `stepOrder`,
`previousStepId`, `phase`, `outcome`입니다. `failureMessage`는 실패한 샘플에만 Assertion 메시지(없으면
응답 메시지)를 앞 200자까지 담고, 응답 본문·헤더는 보내지 않습니다.

전달 정책은 **at-most-once**입니다. 요청은 한 번만 시도하며, 2xx가 아닌
응답, 연결 오류, 타임아웃은 로그로 남기고 해당 배치를 버립니다.
collector가 멱등성 키를 정의하기 전까지 중복 샘플을 피하기 위한 방식입니다.

Java 21로 빌드:

```sh
JAVA_HOME=<Java 21 경로> mvn test
```

## 로컬 JMeter E2E fixture

이 fixture는 JMeter의 `DebugSampler`를 사용하므로, loopback collector로의
POST 외에는 HTTP나 외부 네트워크 호출을 하지 않습니다. 빌드된 JAR는
`user.classpath`로 임시 추가하며, 설치된 JMeter의 `lib/ext` 디렉터리는
수정하지 않습니다.

fixture는 `tests/e2e/listener/`에 있습니다. 저장소 루트에서 Java 21 경로를 지정해 실행합니다(`jmeter`가 `PATH`에 없으면 `JMETER_BIN`도 지정).

```sh
JAVA_HOME=<Java 21 경로> ./tests/e2e/listener/run-e2e.sh
```

성공하려면 loopback collector가 실행 중이어야 하며, 리스너 초기화,
배치 1회 전달 성공, `Local debug sample`이 모두 확인되어야 합니다.
생성된 `.jtl`, `.log` 파일은 소스 산출물이 아닌 실행 증거이므로 Git에서
제외됩니다.
