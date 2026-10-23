# collector (`src/collector`)

Python 표준 라이브러리만 사용하는 loopback collector입니다. `docker/`의 collector 컨테이너로 실행합니다. 보관 개수 같은 런타임 설정은 `items/.env.*`, 호스트 포트는 `docker/.env.*`에서 바꿉니다.

```sh
cd docker && docker compose up -d --build   # 저장소 루트에서
```

계약 형식의 이벤트 하나 보내기:

```sh
curl -X POST http://127.0.0.1:8765/events -H 'content-type: application/json' \
  -d '{"timestamp":"2026-10-18T10:00:00Z","endpoint":"GET /catalog","durationMs":124,"success":true,"status":200}'
```

이벤트는 메모리에 유지되며 데이터 경로(컨테이너 `/app/data`, Docker 볼륨)의 현재 실행 기록 `runs/<id>/events.ndjson`에 추가 기록됩니다. 컨테이너 포트는 호스트의 `127.0.0.1`에만 노출되며, 서버는 외부 요청을 보내지 않습니다. `GET /stream`은 SSE, `GET /api/snapshot`은 최근 60초 구간, `GET /api/recording`은 화면 재생용 로컬 영구 기록을 제공합니다.

`snapshot.nodeStates`는 계획 없이 JSR223 수명주기 이벤트로 그리던 이전 화면용 집계입니다(현재 화면은 쓰지 않음). 각 노드는 `arrivals`, `inFlight`,
`completions`, `success`, `error`, `skipped`, `avgMs`, `p95Ms`,
`throughputPerSec`, 짧은 수명주기 `timeline`을 가집니다. SSE의 `journey`
이벤트는 `phase: started`로 가상 사용자 토큰을 노드에 배치하고,
`completed`/`aborted`/`skipped`로 토큰을 이동, 정지, 회색 처리합니다.

jmx 등록: `POST /api/plan`(본문은 `.jmx` XML)으로 단계 계획을 등록하고 `GET /api/plan`으로 조회하며, `DELETE /api/plan`으로 해제합니다. 계획이 등록되어 있으면 리스너의 일반 결과(`threadName`, `startTime` 포함)를 `flow_tracker.py`가 단계 이벤트(`completed`/`aborted`, 추정 `started`, `cancelled`, `halted`)로 변환합니다. 리스너는 테스트 시작 시 JMeter 실행 트리를 `POST /api/test-tree`로 자동 전송합니다(수동 `POST /api/plan`과 동일한 계획 생성, 매 실행마다 UI 미저장 변경 반영). 테스트 시작 표시를 받으면 새 실행 기록을 시작하고 최근 5개(`COLLECTOR_RUN_KEEP`)를 데이터 경로의 `runs/<id>/`(meta.json: 시각·당시 jmx 계획, events.ndjson: 이벤트)에 보관합니다. `GET /api/runs`는 기록 목록, `GET /api/runs/<id>`는 기록 하나를 반환합니다. 새 jmx를 등록하면 실시간 화면은 비워지고 다음 실행을 기다립니다. 단위 테스트(저장소 루트에서): `python3 -m unittest discover -s tests/collector`.

`POST /api/reset`은 메모리의 실시간 이벤트를 비우고 현재 실행 기록과의 연결을 끊습니다. 저장된 실행 기록 파일과 등록된 계획은 지우지 않으며, 다음 이벤트가 새 실행 기록을 엽니다.

화면 제공: API·SSE 외 경로는 이미지에 포함된 빌드 화면(`/app/web`)을 제공합니다. 화면이 호출하는 `/collector/...` 경로는 접두어를 떼고 같은 API로 처리합니다. 빌드가 없으면 `/`는 503을 반환합니다.

로그: 요청 로그와 기동 정보는 표준 출력(`docker compose logs collector`)과 `logs/collector/collector.log`(10MB 단위 5개 회전)에 남습니다.

컨테이너 경로 설정(`Dockerfile`·compose에서 지정, 코드 기본값과 같음): `COLLECTOR_HOST`, `COLLECTOR_PORT`, `COLLECTOR_DATA_DIR=/app/data`, `COLLECTOR_WEB_DIR=/app/web`, `COLLECTOR_LOG_DIR=/app/logs`.

한계: 프로세스 내 이벤트 목록은 실행 기간 내내 계속 늘어납니다. 보존 관리 기능을 갖춘 collector가 아니라 의도적으로 작게 만든 PoC입니다.
