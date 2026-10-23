# 설계서: 웹에서 JMeter 실행

노션 작업 큐 TASK-19. 구현은 사용자가 별도로 진행한다.

## 1. 목표

사용자가 웹 화면(`http://127.0.0.1:8765`)에서 jmx를 올리고 **실행 버튼**을 누르면 collector가 JMeter를 non-GUI(`-n`) 모드로 띄운다. 테스트 구성 → 실행 → 관제 → 재생을 주소 하나에서 끝내는 것이 목표다.

현재 형태(웹 1개 + 리스너 JAR)에서는 JMeter를 사용자가 직접 실행하고, 화면은 관제와 재생만 맡는다. 이 설계는 그 위에 실행 제어를 더한다.

## 2. 범위

**컨테이너 전제**: collector는 컨테이너에서 실행된다. 따라서 JMeter를 collector 컨테이너 안에서 실행하려면 이미지에 Java 21과 JMeter를 넣어야 하고(이미지 크기 증가), 호스트 JMeter를 쓰려면 호스트 쪽에 실행 대리자가 필요하다. 구현 시 둘 중 하나를 먼저 결정한다. 컨테이너 안 실행이 구성 단순성 면에서 유리하다.


포함:
- jmx 업로드·목록·삭제 (CSV 등 jmx가 참조하는 데이터 파일 포함)
- 실행 시작(JMeter 속성 덮어쓰기 포함), 정상 종료 요청, 강제 중지
- 실행 상태와 JMeter 로그 끝부분의 실시간 표시
- 리스너가 없는 jmx에 Backend Listener 자동 주입

제외:
- 동시에 여러 실행 (한 번에 하나만)
- 원격·분산 JMeter, JMeter 설치·버전 관리
- jmx 편집기 (구성은 계속 JMeter GUI에서 한다)

## 3. 참조 소스와 기존 패턴

| 참조 | 내용 | 이 설계에서의 사용 |
| --- | --- | --- |
| `src/collector/server.py` `POST /api/plan` | jmx XML 본문을 받아 `parse_jmx`로 계획 등록 | 업로드한 jmx를 실행 전에 같은 방식으로 해석·검증 |
| `src/collector/jmx_plan.py` | jmx의 Thread Group·Sampler 트리 해석 | 지원하지 않는 요소 경고를 실행 전에 표시, 리스너 존재 여부 확인 |
| `src/collector/run_store.py` | 실행 기록(`runs/<id>/`) 생성·보관 | 실행 기록은 지금처럼 리스너의 테스트 시작 신호로 만든다(변경 없음) |
| `tests/e2e/btoc-like/run.sh` | jmx 복사본 수정 후 `jmeter -n -t … -Juser.classpath=<JAR> -l … -j …` 실행 | 실행 명령 형태와 JAR 주입 방식(`user.classpath`)을 그대로 따른다 |
| `docker/docker-compose-collector.yml`, `items/.env.example` | collector 컨테이너, 런타임 설정을 환경변수로 받음 | JMeter 경로·리스너 JAR 경로를 같은 방식으로 받는다 |

## 4. 구성

```
브라우저 ──▶ collector (127.0.0.1:8765)
              ├ 기존: 수신·흐름 복원·기록·SSE·화면 제공
              └ 신규 runner 모듈 (src/collector/runner.py)
                   ├ jmx 저장소: <데이터 경로>/plans/<planId>/ (Docker 볼륨) (plan.jmx + 데이터 파일)
                   ├ 리스너 주입: 실행용 복사본에 BackendListener 추가
                   └ 프로세스 관리: subprocess.Popen(jmeter -n …)
                                    └▶ 리스너가 기존 경로로 POST /events, /api/test-tree
```

runner는 JMeter를 실행만 한다. 결과 수집 경로는 지금과 같다. JMeter 안의 리스너가 collector에 결과를 보내므로, 화면 관제·실행 기록·재생은 수정하지 않는다.

### 4.1 런타임 설정 (`items/.env.example`에 추가)

| 키 | 의미 |
| --- | --- |
| `JMETER_BIN` | jmeter 실행 파일 경로. 비우면 `PATH`에서 찾는다 |
| `LISTENER_JAR` | 리스너 JAR 경로. 비우면 `src/listener/target/jmeter-backend-listener-*.jar` |
| `RUNNER_PLAN_KEEP` | 보관할 업로드 jmx 수 |

### 4.2 리스너 자동 주입

업로드한 jmx에 `EventCollectorBackendListener`가 없으면, 실행용 복사본의 Test Plan 바로 아래 `hashTree`에 BackendListener 요소를 추가한다. 인자는 `collectorUrl=http://{COLLECTOR_HOST}:{COLLECTOR_PORT}/events`로 채운다. 원본 jmx는 바꾸지 않는다. 이미 리스너가 있으면 `collectorUrl`만 현재 collector 주소와 같은지 확인하고, 다르면 경고한다.

## 5. API

| 메서드·경로 | 요청 | 응답·동작 |
| --- | --- | --- |
| `POST /api/plans` | multipart: `jmx`(필수), `files[]`(CSV 등) | `{planId, name, warnings[]}`. jmx 해석 결과의 지원하지 않는 요소를 경고로 반환 |
| `GET /api/plans` | — | 업로드 목록 `{plans:[{planId,name,uploadedAt,files[]}]}` |
| `DELETE /api/plans/<planId>` | — | 실행 중인 계획이면 409 |
| `POST /api/executions` | `{planId, properties:{key:value}}` | 상태가 idle일 때만 시작(그 외 409). `{executionId}` |
| `GET /api/executions/current` | — | `{executionId, planId, state, startedAt, exitCode, logTail[]}` |
| `POST /api/executions/current/stop` | `{mode:"graceful"|"now"|"kill"}` | 아래 6.2 절의 종료 방식 |

실행 상태 변화와 로그 줄은 기존 SSE(`/stream`)에 `event: execution`으로 함께 보낸다. 화면이 별도 연결을 열지 않아도 된다.

## 6. 실행 상태 관리

### 6.1 상태 전이

```
idle ──start──▶ starting ──(JMeter 기동·test-tree 수신)──▶ running
running ──stop(graceful|now)──▶ stopping ──(프로세스 종료)──▶ finished
starting/running ──(프로세스 비정상 종료)──▶ failed
finished/failed ──(다음 start)──▶ starting
```

- `starting → running`은 리스너가 `POST /api/test-tree`를 보낸 시점으로 판단한다. 기동 후 일정 시간(예: 30초) 안에 오지 않으면 로그와 함께 `failed`로 표시한다. 리스너 JAR을 못 찾는 경우가 여기에 해당한다.
- collector가 재시작되면 실행 중이던 프로세스와의 연결이 끊긴다. PID 파일(데이터 경로의 `runner.pid`)로 남은 프로세스를 감지해 `orphaned`로 표시하고, 사용자가 kill할 수 있게 한다.

### 6.2 종료 방식

JMeter non-GUI 모드는 UDP 포트(`jmeterengine.nongui.port`, 기본 4445부터 `maxport` 4455까지)로 종료 명령을 받는다. JMeter 배포본의 `stoptest.sh`·`shutdown.sh`가 이 방식을 쓴다.

| mode | 동작 | 대응 스크립트 |
| --- | --- | --- |
| `graceful` | UDP로 `Shutdown` 전송. 진행 중인 샘플이 끝난 뒤 종료 | `shutdown.sh` |
| `now` | UDP로 `StopTestNow` 전송. 즉시 중지 | `stoptest.sh` |
| `kill` | 프로세스 종료 신호. 위 두 방식이 응답하지 않을 때만 사용 | — |

실행할 때 `-Jjmeterengine.nongui.port=<빈 포트>`를 지정하면 runner가 쓸 포트를 확정할 수 있다.

## 7. 화면

- 상단 도구 줄의 `jmx 선택` 옆에 **실행** 영역을 추가한다. 업로드한 계획 선택, 속성 덮어쓰기(접이식 키·값 표), 실행·정상 종료·즉시 중지 버튼, 상태 배지를 둔다.
- 실행을 시작하면 화면은 지금처럼 실시간 모드로 들어간다. 실행 기록은 리스너의 테스트 시작 신호로 자동으로 생긴다.
- 로그 끝부분(예: 최근 200줄)은 접이식 패널로 보여 준다. 오류 줄은 강조한다.

## 8. 위험과 대응

| 위험 | 대응 |
| --- | --- |
| jmx는 JSR223·OS Process Sampler로 임의 코드를 실행할 수 있다 | collector는 loopback에만 바인딩한다(현행 유지). 원격 노출 전에는 인증을 먼저 설계한다 |
| jmx가 참조하는 CSV 등 데이터 파일의 상대 경로가 깨진다 | 계획별 디렉토리에 함께 저장하고, JMeter 작업 디렉토리를 그 디렉토리로 지정한다. 절대 경로 참조는 업로드할 때 경고한다 |
| 속성 덮어쓰기는 jmx가 `${__P(name,기본값)}`을 쓸 때만 효과가 있다 | 해석 단계에서 `__P` 사용 키 목록을 뽑아 화면에 덮어쓰기 후보로 보여 준다 |
| runner가 띄우는 JMeter가 사용자가 테스트를 구성한 JMeter와 다를 수 있다 (설치 위치·플러그인·JVM 옵션) | `JMETER_BIN`으로 collector와 같은 환경의 JMeter를 지정한다. 플러그인·JVM 옵션 차이는 실행 전 점검 항목으로 안내한다 |
| 부하 발생기(JMeter)와 collector·브라우저가 같은 머신 자원을 나눠 쓴다 | 실행 정보에 머신 CPU 사용률을 함께 기록해 테스트 간섭 여부를 판단할 근거를 남긴다 |

## 9. 검증 계획

- 단위: 리스너 주입(없음·있음·URL 불일치), 상태 전이, 종료 명령 전송, 업로드 경로 탈출 차단.
- E2E: `tests/e2e/btoc-like`의 jmx와 CSV를 업로드하고 화면 API로 실행한다. 기존 `run.sh`의 JTL 대조(미매칭 0) 기준을 그대로 적용한다.
- 종료: 실행 중 `graceful`·`now`·`kill` 각각에서 프로세스가 끝나고 상태가 `finished`가 되는지 확인한다.

## 10. 작업 분해 (제안)

1. runner 모듈: 계획 저장소·업로드 API (+ 단위 테스트)
2. 리스너 주입·실행 명령 구성 (+ 단위 테스트)
3. 프로세스 관리·상태 전이·종료 방식·SSE 연동
4. 화면 실행 영역
5. btoc-like 업로드 실행 E2E
