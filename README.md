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

6. 테스트를 실행하면 리스너가 **JMeter가 실제 실행 중인 테스트 트리**를 collector로 자동 전송합니다(`POST /api/test-tree`). JMeter UI에서 저장하지 않은 변경(비활성화, 스레드 수 변경)도 매 실행마다 자동 반영되므로 별도 등록이 필요 없습니다. 리스너 없이 기록만 재생할 때는 **jmx 등록** 버튼이나 아래 명령으로 직접 등록할 수 있습니다.

   ```sh
   curl -X POST -H 'Content-Type: application/xml' --data-binary @/path/to/your-plan.jmx http://127.0.0.1:8765/api/plan
   ```

등록된 테스트 계획은 활성 Thread Group별 단계(Sampler 트리 순서)로 표시됩니다. Sampler 이름 규칙이나 JSR223 스크립트 같은 추가 계측은 필요 없습니다.

- collector가 각 결과의 스레드 이름·라벨·시작 시각으로 사용자 위치를 복원합니다. 같은 라벨이 여러 번 나오면 트리 위치로 구분하고, 루프 안 Sampler는 반복 단계(↻)로 표시합니다.
- 한 결과가 도착하면 같은 사용자의 다음 단계를 **처리 중(추정, 점선 원)**으로 표시하고, 그 결과가 오면 실측으로 확정합니다.
- 실시간 모드는 리스너 전송 간격을 감안해 1.5초 늦게 그립니다. 오류 시 동작은 Thread Group의 `on_sample_error` 설정(continue/stoptest 등)을 따릅니다.
- JMeter 테스트가 시작될 때마다 새 실행 기록을 만들고 **최근 5개**를 보관합니다(`live-traffic-poc/data/runs/`). 화면 상단 **실행 기록**에서 골라 재생합니다. 각 기록은 당시 등록된 jmx 기준으로 그려집니다.
- 화면 이름은 **JMeter Live Traffic**이고, 주요 정보(상태 카드·타임라인·요청 단위 이동)는 상단에 틀 고정되어 스크롤해도 사라지지 않습니다.
- 테마는 다크/라이트/시스템 따라가기를 지원합니다(상단 선택). 그래프와 캔버스 색도 테마에 맞게 바뀝니다.
- 업무 흐름은 두 탭으로 볼 수 있습니다: **단계 연결**(파이프라인)과 **API 왕복**(이전 화면). 사용자 표시는 칩/사람 아이콘으로 전환 가능하고 상태 설명표가 함께 표시됩니다.
- 대량 실행(30 VU 이상)에 대비해: collector는 이벤트를 묶어(SSE `batch`) 전송하고 밀린 화면에는 `resync`로 전체 재로딩을 지시합니다(이벤트 폐기 없음). 화면은 이벤트를 증분 반영하고 무거운 계산은 초당 4회, 사용자 타임라인은 캔버스로 그립니다.
- 재생 중 타임라인을 조작하면 그 시점부터 계속 재생되고, 정지 중에 조작하면 재생 버튼을 눌러야 진행됩니다. 실시간 모드는 테스트 종료 시점에서 멈춥니다.
- 화면은 대시보드형입니다. 위에서부터 KPI(활성 사용자·처리량·p95·오류율), 시간축 그래프 4종(활성 사용자·처리량·응답시간 p50/p95·오류, 클릭하면 그 시점으로 이동, 단계를 선택하면 응답시간은 그 단계만), 오류 요약(단계·응답 코드·실패 사유별), **업무 흐름**(단계가 순서대로 이어지고 사용자 토큰이 단계 사이를 이동), 표 탭 순서입니다.
- 색은 절제해서 씁니다. 모든 API는 한 가지 색이고, 색은 상태(오류=빨강, 지연=주황, 선택=흰 테두리)에만 쓰입니다.
- **체류와 부하는 다릅니다.** 노드의 체류 바(회색)는 전체 시간 중 그 단계가 차지한 비중(같은 사용자의 반복 호출 포함)이고, 부하 바(파랑)는 최근 1초 완료 요청과 동시 사용자 수입니다. 같은 사용자가 ↻ 반복 단계를 도는 경우 체류는 커도 부하는 낮게 나옵니다.
- 실패한 샘플은 Assertion 실패 메시지(없으면 응답 메시지)를 앞 200자까지 수집해 보여 줍니다. 성공 샘플과 응답 본문·헤더는 수집하지 않습니다.
- 화면 상단 **쓰레드 속성** 표에 Thread Group 설정(사용자 수, Ramp-up, 루프, 동일 사용자, 생성 지연, 생명주기, 지속 시간, 시작 지연, 오류 시 동작)과 그 의미, 이번 실행의 실측값을 함께 보여 줍니다.
- 재생 속도는 0.05×~4×이고, **◀ 이전 요청 / 다음 요청 ▶** 버튼이나 ←/→ 키로 요청 하나씩 넘겨 볼 수 있습니다. 실시간 모드는 실제 시간으로 흐르며 속도 설정은 재생에만 적용됩니다.
- 단계 노드·점에 마우스를 올리면 상세가 보이고, 클릭하면 단계 선택·사용자 여정 강조가 됩니다. 아래 탭에서 **집계 보고서**(JMeter Aggregate Report와 같은 항목), **결과 트리**(샘플 목록·상세, 행 클릭 시 그 시점으로 이동), **사용자 타임라인**을 볼 수 있습니다. 요청·응답 본문과 헤더는 개인정보가 포함될 수 있어 수집하지 않습니다.
- 지원 요소: HTTP Sampler, Loop/If Controller, Flow Control Action. 그 외 요소는 화면에 경고로 표시합니다.

btoc 구조(중복 라벨, CSV 반복 루프, 다중 Thread Group, stoptest)를 재현한 검증용 예제는 [mock-api-flow/btoc-like/run.sh](mock-api-flow/btoc-like/run.sh)입니다(`./run.sh continue` 또는 `./run.sh stoptest`).

jmx를 등록하지 않으면 기존 방식으로 동작합니다. 이 경우 사용자별 왕복을 렌더링하려면 `correlationId`, `journeyId`, `stepId`, `stepOrder`, `previousStepId`, `phase` 등의 수명주기 필드를 플랜에 계측해야 합니다. 참고용 JSR223 스크립트와 계약은 [mock-api-flow/journey-start.groovy](mock-api-flow/journey-start.groovy), [mock-api-flow/journey-skip-order.groovy](mock-api-flow/journey-skip-order.groovy), [mock-api-flow/CONTRACT.md](mock-api-flow/CONTRACT.md)에 있습니다.

collector는 기본적으로 loopback 데이터만 받습니다. 인증, TLS, 입력 제한, 영속성 제어, 적절한 전달/멱등성 설계를 먼저 갖추기 전에는 호스트 밖으로 노출하지 마세요.

## 저장소 구성

- `jmeter-backend-listener/` — Java 21 JMeter Backend Listener 및 단위 테스트.
- `live-traffic-poc/` — Python 표준 라이브러리 기반 collector, jmx 해석(`jmx_plan.py`), 흐름 복원(`flow_tracker.py`), 단위 테스트(`tests/`).
- `netviz-visualizer/` — NetViz에서 파생된 React/Vite 렌더러.
- `mock-api-flow/` — 7단계 mock API, JMeter 플랜, 수명주기 참고 스크립트, btoc 구조 검증 예제(`btoc-like/`).

생성된 의존성, 빌드 결과물, 로그, JTL 결과, PID 파일, collector 기록은 의도적으로 Git에서 제외합니다. 이들은 재현 가능한 실행 증거이지 소스 산출물이 아닙니다.
