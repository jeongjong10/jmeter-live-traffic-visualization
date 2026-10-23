# JMeter Backend Listener (PoC)

이 모듈은 JMeter 5.6.3용 `BackendListenerClient`입니다. `SampleResult`
인스턴스를 event-contract-v1 JSON으로 정규화하고, 배치 단위로 loopback
collector에 POST합니다.

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

요청 본문은 JSON 배열입니다. 각 항목은 정확히 다음 필드만 가집니다:
`timestamp`, `label`, `elapsed`, `success`, `responseCode`, `latency`,
`connect`, `bytes`.

전달 정책은 **at-most-once**입니다. 요청은 한 번만 시도하며, 2xx가 아닌
응답, 연결 오류, 타임아웃은 로그로 남기고 해당 배치를 버립니다.
collector가 멱등성 키를 정의하기 전까지 중복 샘플을 피하기 위한 방식입니다.

Java 21로 빌드:

```sh
JAVA_HOME=/opt/homebrew/opt/openjdk@21 mvn test
```

## 로컬 JMeter E2E fixture

이 fixture는 JMeter의 `DebugSampler`를 사용하므로, loopback collector로의
POST 외에는 HTTP나 외부 네트워크 호출을 하지 않습니다. 빌드된 JAR는
`user.classpath`로 임시 추가하며, 설치된 JMeter의 `lib/ext` 디렉터리는
수정하지 않습니다.

설치된 Java 21 및 JMeter 5.6.3 경로로 실행합니다.

```sh
./fixtures/run-e2e.sh
```

성공하려면 loopback collector가 실행 중이어야 하며, 리스너 초기화,
배치 1회 전달 성공, `Local debug sample`이 모두 확인되어야 합니다.
생성된 `.jtl`, `.log` 파일은 소스 산출물이 아닌 실행 증거이므로 Git에서
제외됩니다.
