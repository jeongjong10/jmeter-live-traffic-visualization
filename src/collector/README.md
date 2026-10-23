# Live Traffic PoC

Python 표준 라이브러리만 사용하는 loopback collector 및 브라우저 대시보드입니다.

```sh
cd live-traffic-poc
python3 server.py
# http://127.0.0.1:8765 열기
```

계약 형식의 이벤트 하나 보내기:

```sh
curl -X POST http://127.0.0.1:8765/events -H 'content-type: application/json' \
  -d '{"timestamp":"2026-10-18T10:00:00Z","endpoint":"GET /catalog","durationMs":124,"success":true,"status":200}'
```

이벤트는 메모리에 유지되며 `data/events.ndjson`에 추가 기록됩니다. 서버는 `127.0.0.1`에만 바인딩하고 외부 요청을 보내지 않습니다. `GET /stream`은 SSE, `GET /api/snapshot`은 최근 60초 구간, `GET /api/recording`은 대시보드 재생용 로컬 영구 기록을 제공합니다.

흐름 렌더러는 엔드포인트 합계로 노드 대기열을 추론하려 하지 말고
`snapshot.nodeStates`를 사용하세요. 각 노드는 `arrivals`, `inFlight`,
`completions`, `success`, `error`, `skipped`, `avgMs`, `p95Ms`,
`throughputPerSec`, 짧은 수명주기 `timeline`을 가집니다. SSE의 `journey`
이벤트는 `phase: started`로 가상 사용자 토큰을 노드에 배치하고,
`completed`/`aborted`/`skipped`로 토큰을 이동, 정지, 회색 처리합니다.

jmx 등록: `POST /api/plan`(본문은 `.jmx` XML)으로 단계 계획을 등록하고 `GET /api/plan`으로 조회하며, `DELETE /api/plan`으로 해제합니다. 계획이 등록되어 있으면 리스너의 일반 결과(`threadName`, `startTime` 포함)를 `flow_tracker.py`가 단계 이벤트(`completed`/`aborted`, 추정 `started`, `cancelled`, `halted`)로 변환합니다. 리스너는 테스트 시작 시 JMeter 실행 트리를 `POST /api/test-tree`로 자동 전송합니다(수동 `POST /api/plan`과 동일한 계획 생성, 매 실행마다 UI 미저장 변경 반영). 테스트 시작 표시를 받으면 새 실행 기록을 시작하고 최근 5개를 `data/runs/<id>/`(meta.json: 시각·당시 jmx 계획, events.ndjson: 이벤트)에 보관합니다. `GET /api/runs`는 기록 목록, `GET /api/runs/<id>`는 기록 하나를 반환합니다. 새 jmx를 등록하면 실시간 화면은 비워지고 다음 실행을 기다립니다. 단위 테스트: `python3 -m unittest discover -s tests`.

새 시연 기록이 필요하면 `POST /api/reset`으로 이 로컬 PoC collector의
메모리 및 NDJSON 이벤트만 초기화합니다.

한계: 프로세스 내 이벤트 목록은 실행 기간 내내 계속 늘어납니다. 보존 관리 기능을 갖춘 collector가 아니라 의도적으로 작게 만든 PoC입니다.
