# JMeter 비즈니스 흐름 시각화 도구 (PoC v1)

이 저장소는 실제 JMeter 실행 결과를 비즈니스 흐름 재생 화면으로 시각화하는, loopback 전용 개념 검증(PoC)입니다.

```text
JMeter 가상 사용자 → collector (127.0.0.1:8765) → NetViz 렌더러 (127.0.0.1:5174)
```

포함된 샘플 흐름은 인증, 세션/프로필, 상품 검색, 상품 상세, 장바구니, 결제 승인, 주문 확정의 7단계로 구성됩니다. 시각 토큰은 JMeter 부하 발생기 카드에서 API로 요청을 보내고, JMeter가 측정한 시간만큼 그 API에 머문 뒤, 다음 요청을 시작하기 전에 응답으로 돌아옵니다. 렌더러는 재생, 탐색(seek), 0.125×~2× 재생 속도를 지원합니다.

## 범위와 한계

이 프로젝트는 **단일 머신, loopback 전용 PoC**입니다. 안전한 로컬 시연과 통합 실험을 위한 것이며, 운영용 텔레메트리 시스템이 아닙니다. 분산 JMeter 집계, 접근 제어/TLS, 영구 보존 관리, 재시도/멱등성, 전달 보장은 아직 제공하지 않습니다. collector용 리스너는 at-most-once 전달 방식을 사용합니다. 즉, POST 배치가 실패하면 중복 샘플을 막기 위해 로그만 남기고 버립니다.

UI는 NetViz에서 파생된 React/Canvas 구현을 기반으로 합니다. 재배포하기 전에 [netviz-visualizer/ATTRIBUTION.md](netviz-visualizer/ATTRIBUTION.md)를 확인하세요. 통합 당시의 업스트림 스냅샷에는 라이선스 선언이 없었습니다.

## 사전 요구 사항

- Java 21 및 Maven 3.9+
- Apache JMeter 5.6.x
- Python 3.10+
- Node.js 20+ 및 npm
- `curl`(포함된 mock 흐름 실행 스크립트는 `jq`도 사용)

셸에서 `java`, `mvn`, `jmeter`, `python3`, `node`, `npm`, `curl`, `jq`를 실행할 수 있는지 확인하세요. 이 저장소는 해당 도구나 그 의존성을 함께 배포하지 않습니다.

## 빠른 시작: 포함된 7개 API 데모

저장소 루트에서 터미널 3개를 사용합니다.

**1. JMeter 리스너 빌드 및 collector 실행**

```sh
cd jmeter-backend-listener
mvn test package

cd ../live-traffic-poc
python3 server.py
```

이제 collector는 `http://127.0.0.1:8765`에서만 접근할 수 있습니다.

**2. 시각화 도구 실행**

```sh
cd netviz-visualizer
npm ci
npm run dev
```

`http://127.0.0.1:5174`를 엽니다.

**3. 흐름 fixture 실행**

다른 터미널에서 함께 제공되는 로컬 mock API와 JMeter 플랜을 실행합니다. `JAVA_HOME`은 JMeter가 Java 21을 찾지 못할 때만, `JMETER_BIN`은 `jmeter`가 `PATH`에 없을 때만 설정하세요.

```sh
./mock-api-flow/run-jmeter-flow.sh
```

실행 스크립트는 로컬 mock API를 시작하고, collector 기록을 초기화하고, load settings를 발행한 뒤, 예상 건수를 검증합니다. `jmeter`는 `PATH`에서 찾으며, macOS에서는 Homebrew 경로를 대체 경로로 사용합니다. 부하 배수 예시와 예상 결과는 [mock-api-flow/README.md](mock-api-flow/README.md)를 참고하세요.

실행이 끝나면 브라우저에서 **기록 다시 불러오기**를 누르고 속도를 고른 뒤 **처음부터 재생**을 누르거나, 전체 폭 타임라인을 드래그하세요.

## 실제 JMeter 플랜 연결

1. 위와 같이 collector와 시각화 도구를 실행합니다.
2. `jmeter-backend-listener`에서 `mvn package`로 리스너 JAR를 빌드합니다.
3. JAR를 JMeter 실행 시 또는 인스턴스의 classpath에 추가합니다. 명령줄 실행 예:

   ```sh
   jmeter -n -t /path/to/your-plan.jmx \
     -Juser.classpath=/absolute/path/to/jmeter-backend-listener/target/jmeter-backend-listener-0.1.0-SNAPSHOT.jar
   ```

4. Test Plan 아래에 **Backend Listener**를 추가하고 구현 클래스를 다음으로 지정합니다.

   ```text
   io.axtutorlog.jmeter.backend.EventCollectorBackendListener
   ```

5. 리스너 인자를 다음과 같이 설정합니다.

   | 이름 | 값 |
   | --- | --- |
   | `collectorUrl` | `http://127.0.0.1:8765/events` |
   | `batchSize` | `100` |
   | `flushIntervalMillis` | `1000` |

이 설정으로 엔드포인트별 완료 건수, 결과 상태, 측정 시간을 얻을 수 있습니다. 사용자별 전체 왕복(요청 → API 체류 → 응답 → 다음 요청)을 렌더링하려면 `correlationId`, `journeyId`, `stepId`, `stepOrder`, `previousStepId`, `phase` 등의 수명주기 필드를 플랜에 계측해야 합니다. 참고용 JSR223 스크립트와 계약은 [mock-api-flow/journey-start.groovy](mock-api-flow/journey-start.groovy), [mock-api-flow/journey-skip-order.groovy](mock-api-flow/journey-skip-order.groovy), [mock-api-flow/CONTRACT.md](mock-api-flow/CONTRACT.md)에 있습니다.

collector는 기본적으로 loopback 데이터만 받습니다. 인증, TLS, 입력 제한, 영속성 제어, 적절한 전달/멱등성 설계를 먼저 갖추기 전에는 호스트 밖으로 노출하지 마세요.

## 저장소 구성

- `jmeter-backend-listener/` — Java 21 JMeter Backend Listener 및 단위 테스트.
- `live-traffic-poc/` — Python 표준 라이브러리 기반 collector 및 로컬 재생 API.
- `netviz-visualizer/` — NetViz에서 파생된 React/Vite 렌더러.
- `mock-api-flow/` — 7단계 mock API, JMeter 플랜, 수명주기 참고 스크립트.

생성된 의존성, 빌드 결과물, 로그, JTL 결과, PID 파일, collector 기록은 의도적으로 Git에서 제외합니다. 이들은 재현 가능한 실행 증거이지 소스 산출물이 아닙니다.
