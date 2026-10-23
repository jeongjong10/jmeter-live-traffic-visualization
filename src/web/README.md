# JMeter Live Traffic 화면 (`src/web`)

collector가 보내는 이벤트로 JMeter 실행을 실시간으로 보여 주고, 끝난 실행을 재생하는 화면입니다. NetViz(MIT)에서 파생된 React + TypeScript + Vite + Canvas 구현입니다(출처·라이선스는 [ATTRIBUTION.md](ATTRIBUTION.md), [LICENSE](LICENSE)). 화면의 구성과 색·수치 규칙은 저장소 루트 [README.md](../../README.md)에 정리되어 있습니다.

## 실행

- **운영**: 저장소 루트의 `docker/`에서 `docker compose up -d --build`. 이미지 빌드 단계에서 이 디렉토리를 빌드(`npm run build`)하고, collector가 결과(`dist/`)를 `http://127.0.0.1:8765`에서 API와 함께 제공합니다.
- **개발**: 컨테이너를 띄운 상태에서 `npm install && npm run dev` 후 `http://127.0.0.1:5174`. Vite HMR을 쓰며 `/collector/...` 요청은 `127.0.0.1:8765`로 프록시됩니다(`vite.config.ts`).
- **검사**: `npm test`(저장소 `tests/web/`의 계산 로직 테스트, vitest), `npm run build`(타입 검사 포함).

두 경우 모두 화면은 API를 `/collector/...` 경로로 호출하고, collector는 이 접두어를 떼고 처리합니다.

## 구성

| 파일 | 역할 |
| --- | --- |
| `src/App.tsx` | 테스트 계획이 있으면 대시보드(`PlanFlowView`), 없으면 JMeter 연결 안내 화면 |
| `src/hooks/usePlanFlow.ts` | 계획·실행 기록 조회, SSE(`/stream`)의 `batch`·`resync` 수신, 실행 기록 선택 |
| `src/services/flowStore.ts` | 단계 이벤트(`started`·`completed`·`aborted`·`cancelled`·`halted`)를 사용자별 방문(visit)으로 누적 |
| `src/services/flowModel.ts` | 화면 계산: 단계 상태·평소 대비·완료 상태 최대치(`stepPeaks`)·최종 배지·집계 보고서·시간 구간 계열·히트맵 격자 |
| `src/components/PlanFlowView.tsx` | 대시보드: 고정 영역(제목·KPI·재생 조작부·전체 단계 요약), 그래프, 오류 요약, 업무 흐름, 아래 표 탭 |
| `src/components/plan/FlowPipeline.tsx` | 단계 흐름 보기(노드·간선·사용자 토큰)와 **보는 법** 범례 |
| `src/components/TopologyCanvas.tsx` | 요청·응답 왕복 보기(Canvas) |
| `src/components/plan/StepSummaryStrip.tsx` | 전체 단계 요약 줄 |
| `src/components/plan/TimeSeriesCharts.tsx` | 시간축 그래프(선택형) |
| `src/components/plan/StepHeatmap.tsx` | 단계×시간 히트맵 탭 |
| `src/components/plan/AggregateReport.tsx`, `ResultsTree.tsx`, `UserTimeline.tsx`, `ErrorSummary.tsx`, `ThreadSettings.tsx` | 집계 보고서, 결과 트리, 사용자 타임라인, 오류 요약, 쓰레드 속성 |
| `src/components/FlowParts.tsx` | 공용 부품: 재생 시계, 재생 바, KPI 카드, 테마, 부하·지연 색(`loadColor`) |

## 규칙

- 화면의 모든 HTML 요소는 `jlt-`로 시작하는 고유 id를 가집니다(규칙은 루트 `AGENTS.md`의 "화면 요소 id 규칙").
- 수치는 JMeter가 측정한 샘플에서만 계산합니다. 처리 중(추정) 표시와 토큰 이동 효과는 시각 표현이며 측정값을 바꾸지 않습니다.
- 응답·요청 본문과 헤더는 수집하지 않습니다.
