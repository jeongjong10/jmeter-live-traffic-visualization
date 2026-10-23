# NetViz 출처 표기

이 디렉토리는 [hoodini/netviz](https://github.com/hoodini/netviz)의 커밋 `9b084414a06303a4837536ffb60cde5621107cfb`(2026-10-18 가져옴)를 기반으로 한 파생 저작물입니다. 원저작자는 Yuval Avidani(https://github.com/hoodini)입니다.

## 라이선스

- 업스트림 README의 `License` 절은 MIT를 선언합니다. 가져온 시점에 업스트림 저장소에는 `LICENSE` 파일이 없었습니다.
- 이 프로젝트는 README의 선언을 근거로 업스트림 저작물을 MIT로 사용하고, MIT 전문과 원저작자 저작권 표시를 [LICENSE](LICENSE)에 둡니다. 재배포할 때는 이 파일과 `LICENSE`를 함께 유지합니다.
- 런타임 의존성(`react`, `react-dom`과 그 하위 `scheduler`, `loose-envify`, `js-tokens`)은 모두 MIT입니다. 빌드 결과(`dist/`)에는 React의 `@license` 주석이 그대로 남습니다.

## 유지한 것과 바꾼 것

- 유지: React + TypeScript + Vite + Tailwind 구성, Canvas 토폴로지 그리기 방식(`src/components/TopologyCanvas.tsx`).
- 바꾼 것: 업스트림의 브라우저 요청 가로채기와 공개 데모 트래픽을 loopback 전용 collector 이벤트(SSE)와 실행 기록 재생으로 대체했습니다. 요청 목록·인스펙터·워터폴·통계 UI는 제거하고, JMeter 테스트 계획 기반 대시보드(`src/components/PlanFlowView.tsx`, `src/components/plan/`)와 계산 모듈(`src/services/`)을 새로 작성했습니다.
