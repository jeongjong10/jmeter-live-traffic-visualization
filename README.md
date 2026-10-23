# JMeter 비즈니스 흐름 시각화 도구 (PoC v1)

이 저장소는 실제 JMeter 실행 결과를 비즈니스 흐름 재생 화면으로 시각화하는, loopback 전용 개념 검증(PoC)입니다.

```text
JMeter + Backend Listener JAR → collector (127.0.0.1:8765) → 브라우저 화면 (같은 주소)
```

기존 jmx에 Backend Listener 하나만 추가하면, 테스트가 시작될 때 실행 중인 테스트 계획이 자동으로 전송되고 화면이 그 계획의 업무 단계(Thread Group별 Sampler 순서)로 구성됩니다. 실행 중에는 가상 사용자의 단계 위치와 단계별 응답시간·오류를 실시간으로 보여 주고, 끝난 실행은 0.05×~2×(기본 0.25×) 속도로 재생·탐색합니다. 테스트 계획이 아직 없으면 화면은 연결 방법 안내를 보여 줍니다.

## 범위와 한계

이 프로젝트는 **단일 머신, loopback 전용 PoC**입니다. 안전한 로컬 시연과 통합 실험을 위한 것이며, 운영용 텔레메트리 시스템이 아닙니다. 분산 JMeter 집계, 접근 제어/TLS, 영구 보존 관리, 재시도/멱등성, 전달 보장은 아직 제공하지 않습니다. collector용 리스너는 at-most-once 전달 방식을 사용합니다. 즉, POST 배치가 실패하면 중복 샘플을 막기 위해 로그만 남기고 버립니다.

UI는 NetViz(MIT, Yuval Avidani)에서 파생된 React/Canvas 구현을 기반으로 합니다. 출처와 라이선스 근거는 [src/web/ATTRIBUTION.md](src/web/ATTRIBUTION.md), 전문은 [src/web/LICENSE](src/web/LICENSE)에 있습니다.

## 사전 요구 사항

- Docker, Docker Compose v2 (시스템 실행)
- Java 21 및 Maven 3.9+ (리스너 JAR 빌드)
- Apache JMeter 5.6.x
- Python 3.10+, `curl`, `jq` (E2E 모의 API·실행 스크립트)
- Node.js 20+ 및 npm (화면 개발 모드에서만)

OS 환경변수 `COMPOSE_ENV_FILES`에 사용할 환경 파일명(예: `.env.dev`)을 등록해 두어야 합니다. 이 저장소는 해당 도구나 그 의존성을 함께 배포하지 않습니다.

## 빠른 시작: 포함된 7개 API 데모

저장소 루트에서 실행합니다.

**1. JMeter 리스너 빌드** (최초 1회, JMeter에 넣을 JAR)

```sh
(cd src/listener && mvn test package)
```

**2. 시스템 실행** (컨테이너)

```sh
cp items/.env.example items/.env.dev   # 최초 1회 (런타임 환경변수)
cd docker
docker compose up -d --build
```

`http://127.0.0.1:8765`를 엽니다. collector 컨테이너가 화면·API·실시간 스트림을 이 주소 하나로 제공합니다. 화면은 이미지 빌드 단계에서 만들어지고, collector 소스는 마운트되므로 수정 후 `docker compose restart`로 반영됩니다. 환경변수는 컨테이너 기동용(`docker/.env.*`: 포트·프로젝트명)과 런타임용(`items/.env.*`)으로 나뉘며 `COMPOSE_ENV_FILES`로 선택합니다.

로그는 저장소 루트 `logs/`에 남습니다(`logs/collector/collector.log`, E2E 실행 로그·JTL은 `logs/e2e/<시나리오>/`). 실행 기록은 Docker 볼륨(`jmeter-live-traffic_collector-data`)에 보관됩니다.

화면을 수정하며 개발할 때는 컨테이너를 띄운 상태에서 `cd src/web && npm run dev`를 실행하고 `http://127.0.0.1:5174`(Vite HMR, API는 8765로 프록시)를 엽니다.

**3. 데모 실행** (선택)

함께 제공되는 로컬 mock API와 JMeter 플랜으로 동작을 확인합니다. `JAVA_HOME`은 JMeter가 Java 21을 찾지 못할 때만, `JMETER_BIN`은 `jmeter`가 `PATH`에 없을 때만 설정하세요.

```sh
./tests/e2e/checkout-flow/run-jmeter-flow.sh
```

실행 스크립트는 로컬 mock API를 시작하고, collector 기록을 초기화하고, load settings를 발행한 뒤, 예상 건수를 검증합니다. `jmeter`는 `PATH`에서 찾습니다. 부하 배수 예시와 예상 결과는 [tests/e2e/checkout-flow/README.md](tests/e2e/checkout-flow/README.md)를 참고하세요.

데모 jmx에도 Backend Listener가 들어 있어, 실행하면 화면이 데모 계획(7단계)의 대시보드로 바뀝니다. 실행이 끝나면 재생 조작부의 **⏮ 처음부터**를 누르거나 재생 바를 드래그해 다시 봅니다.

## 실제 JMeter 플랜 연결

1. 위와 같이 `docker compose up -d`로 시스템을 실행합니다.
2. `src/listener`에서 `mvn package`로 리스너 JAR를 빌드합니다.
3. JAR를 JMeter 실행 시 또는 인스턴스의 classpath에 추가합니다. 명령줄 실행 예:

   ```sh
   jmeter -n -t /path/to/your-plan.jmx \
     -Juser.classpath=/absolute/path/to/src/listener/target/jmeter-backend-listener-0.1.0-SNAPSHOT.jar
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

6. 테스트를 실행하면 리스너가 **JMeter가 실제 실행 중인 테스트 트리**를 collector로 자동 전송합니다(`POST /api/test-tree`). JMeter UI에서 저장하지 않은 변경(비활성화, 스레드 수 변경)도 매 실행마다 자동 반영되므로 별도 등록이 필요 없습니다. 리스너 없이 기록만 재생할 때는 **jmx 선택** 버튼이나 아래 명령으로 직접 등록할 수 있습니다.

   ```sh
   curl -X POST -H 'Content-Type: application/xml' --data-binary @/path/to/your-plan.jmx http://127.0.0.1:8765/api/plan
   ```

등록된 테스트 계획은 활성 Thread Group별 단계(Sampler 트리 순서)로 표시됩니다. Sampler 이름 규칙이나 JSR223 스크립트 같은 추가 계측은 필요 없습니다.

- collector가 각 결과의 스레드 이름·라벨·시작 시각으로 사용자 위치를 복원합니다. 같은 라벨이 여러 번 나오면 트리 위치로 구분하고, 루프 안 Sampler는 반복 단계(↻)로 표시합니다.
- 한 결과가 도착하면 같은 사용자의 다음 단계를 **처리 중(추정, 점선 원)**으로 표시하고, 그 결과가 오면 실측으로 확정합니다.
- 실시간 모드는 리스너 전송 간격을 감안해 1.5초 늦게 그립니다. 오류 시 동작은 Thread Group의 `on_sample_error` 설정(continue/stoptest 등)을 따릅니다.
- JMeter 테스트가 시작될 때마다 새 실행 기록을 만들고 **최근 5개**를 보관합니다(Docker 볼륨의 `runs/`, 개수는 `items/.env.*`의 `COLLECTOR_RUN_KEEP`). 화면 상단 **실행 기록**에서 골라 재생합니다. 각 기록은 당시 등록된 jmx 기준으로 그려집니다.
- 화면 이름은 **JMeter Live Traffic**이고, 주요 정보(KPI·재생 조작부·전체 단계 요약)는 상단에 틀 고정되어 스크롤해도 사라지지 않습니다.
- 테마는 다크/라이트/시스템 따라가기를 지원합니다(화면 오른쪽 위에 떠 있는 선택). 그래프와 캔버스 색도 테마에 맞게 바뀝니다.
- 업무 흐름은 두 보기로 전환합니다: **단계 흐름**(사용자가 업무 단계를 따라 이동)과 **요청·응답 왕복**(JMeter와 각 API 사이의 요청·응답). 두 보기는 같은 시각 규칙을 씁니다: 노드 색 = 평소 대비(그 API의 지금 응답시간 ÷ 이번 실행에서의 평소 = 끝난 요청 중앙값, ×1.2 이하 파랑 → ×1.6 주황 → ×2 이상 빨강, 요청이 없거나 끝난 요청 5건 미만이면 색 없음). 다른 API와 비교하지 않으며, 사용자가 몰리기만 하고 응답이 평소대로인 단계(예: 반복 단계)는 파랑이고, 동시 사용자 수는 숫자로만 표시합니다. 평균·p95 응답시간은 1회 호출 기준 수치 칸으로 표시하고, 처리 중·지연 사용자 토큰은 크기가 맥동합니다(지연은 더 빠르고 크게). 보기 위의 **보는 법**(접기 가능)이 모든 색·수치를 견본으로 설명합니다.
- 대량 실행(30 VU 이상)에 대비해: collector는 이벤트를 묶어(SSE `batch`) 전송하고 밀린 화면에는 `resync`로 전체 재로딩을 지시합니다(이벤트 폐기 없음). 화면은 이벤트를 증분 반영하고 무거운 계산은 초당 4회, 사용자 타임라인은 캔버스로 그립니다.
- 재생 중 타임라인을 조작하면 그 시점부터 계속 재생되고, 정지 중에 조작하면 재생 버튼을 눌러야 진행됩니다. 실시간 모드는 테스트 종료 시점에서 멈춥니다.
- 화면은 대시보드형입니다. 위에서부터 KPI(활성 사용자·처리량·p95·오류율), 시간축 그래프(선택형, 클릭하면 그 시점으로 이동, 단계를 선택하면 응답시간 계열은 그 단계만), 오류 요약(단계·응답 코드·실패 사유별), **업무 흐름**(단계가 순서대로 이어지고 사용자 토큰이 단계 사이를 이동), 표 탭 순서입니다.
- 위쪽 고정 영역은 위에서부터 제목·실행 기록·Thread Group·jmx 선택 줄, KPI 줄, **재생 조작부**(실시간, 처음부터, 재생/일시정지, 재생 바, 속도), **전체 단계 요약** 줄(제목·읽는 법과 선택한 요청 표시)입니다. 테마 선택은 화면 오른쪽 위에 떠 있습니다.
- 테스트가 끝나고 재생 위치가 기록 끝이면 **실행 완료** 상태로, 단계 노드·요청·응답 왕복·요약 줄이 마지막 순간 값 대신 각 단계의 최대치(최대 동시 사용자, 최대 처리량 1초 구간, 평소 대비 최대, 최종 평균·p95·오류)를 표시하고 사용자 토큰은 그리지 않습니다. 재생 위치를 앞으로 옮기면 그 시점 값으로 돌아갑니다.
- 화면의 모든 HTML 요소는 `jlt-`로 시작하는 고유 id를 가집니다(예: `jlt-node-<단계 id>-p95-value`). 요소를 지칭할 때 이 id를 쓰면 됩니다.
- 그래프는 **그래프 선택** 줄에서 체크한 것만 표시합니다(선택은 브라우저에 기억). 기본으로 켜진 것은 활성 사용자·처리량·응답시간·오류이고, 사용자 수 대비 처리량·p95(포화점), 응답시간 구성(연결·서버 대기·수신), 응답 코드별 건수, 응답시간 백분위(p50/p90/p95/p99), 오류율(%)을 더 켤 수 있습니다. 여러 계열 그래프는 계열 이름과 현재 값을 같은 색으로 위아래에 맞춰 보여 줍니다.
- 색은 절제해서 씁니다. 모든 API는 한 가지 색이고, 색은 상태와 부하에만 쓰입니다(평소 대비=파랑→주황→빨강, 오류=빨간 글자·점, 선택=흰 테두리).
- 단계 수치는 **1회 호출 기준**입니다. 같은 사용자가 ↻ 반복 단계를 여러 번 호출해도 평균·p95는 호출 1회의 응답시간으로 계산하고, 반복 횟수는 전체 호출 수와 사용자 1명당 평균 호출 수로 따로 보여 줍니다.
- 비교 배지(평균 최대, p95 최대, 오류 건수·비율)는 테스트가 끝난 뒤 **최종 결과 기준**으로만 표시합니다. 실행 중에는 오류 건수만 노드에 글자로 보입니다.
- 위쪽 고정 영역의 **전체 단계 요약 줄**에 모든 단계가 한 칸씩 보입니다(숫자 = 처리량 req/s, 칸 색 = 평소 대비, 빨간 점 = 오류, 완료 상태에서는 최대 처리량·평소 대비 최대). 칸을 누르면 그 단계를 선택하고 화면을 그 단계로 옮깁니다.
- 실패한 샘플은 Assertion 실패 메시지(없으면 응답 메시지)를 앞 200자까지 수집해 보여 줍니다. 성공 샘플과 응답 본문·헤더는 수집하지 않습니다.
- 화면 상단 **쓰레드 속성** 표에 Thread Group 설정(사용자 수, Ramp-up, 루프, 동일 사용자, 생성 지연, 생명주기, 지속 시간, 시작 지연, 오류 시 동작)과 그 의미, 이번 실행의 실측값을 함께 보여 줍니다.
- 재생 속도는 0.05×~2×(기본 0.25×)이고, ←/→ 키로 요청 하나씩 넘겨 볼 수 있습니다. 실시간 모드는 실제 시간으로 흐르며 속도 설정은 재생에만 적용됩니다.
- 단계 노드·점에 마우스를 올리면 상세가 보이고, 클릭하면 단계 선택·사용자 여정 강조가 됩니다. 아래 탭에서 **집계 보고서**(JMeter Aggregate Report와 같은 항목), **결과 트리**(샘플 목록·상세, 행 클릭 시 그 시점으로 이동), **사용자 타임라인**, **단계×시간 히트맵**(행 = 단계, 열 = 시간 구간, 동시 사용자·처리량·1회 평균 응답시간·오류 중 선택, 칸 클릭 시 그 시점·단계로 이동)을 볼 수 있습니다. 요청·응답 본문과 헤더는 개인정보가 포함될 수 있어 수집하지 않습니다.
- 지원 요소: HTTP Sampler, Loop/If Controller, Flow Control Action. 그 외 요소는 화면에 경고로 표시합니다.

btoc 구조(중복 라벨, CSV 반복 루프, 다중 Thread Group, stoptest)를 재현한 검증용 예제는 [tests/e2e/btoc-like/run.sh](tests/e2e/btoc-like/run.sh)입니다(`./run.sh continue` 또는 `./run.sh stoptest`).

리스너·collector·화면 사이의 요청 형식과 이벤트는 [.ai/spec/event-contract.md](.ai/spec/event-contract.md)에 정리되어 있습니다. 테스트 계획 없이 JSR223 수명주기 이벤트(`correlationId`, `stepId`, `phase` 등)만으로 그리던 이전 화면은 연결 안내 화면으로 대체되었고, 그 수명주기 계약과 참고 스크립트([journey-start.groovy](tests/e2e/checkout-flow/journey-start.groovy), [journey-skip-order.groovy](tests/e2e/checkout-flow/journey-skip-order.groovy))는 데모 검증용으로만 남아 있습니다.

collector는 기본적으로 loopback 데이터만 받습니다. 인증, TLS, 입력 제한, 영속성 제어, 적절한 전달/멱등성 설계를 먼저 갖추기 전에는 호스트 밖으로 노출하지 마세요.

## 저장소 구성

- `.ai/` — AI 협업 파일(`notion-sync.md`)과 명세 문서(`spec/`: 정의서, 이벤트 계약, 부하 확장 검증 결과, 설계서).
- `docker/` — Compose 진입점(`docker-compose.yml`), 서비스 정의(`docker-compose-collector.yml`), 이미지(`collector/Dockerfile`), 컨테이너 기동용 환경변수(`.env.*`).
- `items/` — 런타임 환경변수. `.env.example`을 `.env.dev` 등으로 복사해 사용합니다(Git 제외).
- `src/listener/` — Java 21 JMeter Backend Listener 및 단위 테스트(Maven).
- `src/collector/` — Python 표준 라이브러리 기반 collector, jmx 해석(`jmx_plan.py`), 흐름 복원(`flow_tracker.py`), 실행 기록(`run_store.py`).
- `src/web/` — NetViz에서 파생된 React/Vite 화면.
- `tests/collector/` — collector 단위 테스트(`python3 -m unittest discover -s tests/collector`).
- `tests/web/` — 화면 계산 로직(평소 대비·완료 상태 최대치) 테스트(`src/web`에서 `npm test`).
- `tests/e2e/` — 7단계 mock API 흐름(`checkout-flow/`), btoc 구조 검증 예제(`btoc-like/`), 리스너 단독 검증(`listener/`).
- `logs/` — collector 로그, E2E 실행 로그·JTL(Git 제외).

생성된 의존성, 빌드 결과물, 로그, JTL 결과, PID 파일, collector 기록은 의도적으로 Git에서 제외합니다. 이들은 재현 가능한 실행 증거이지 소스 산출물이 아닙니다.
