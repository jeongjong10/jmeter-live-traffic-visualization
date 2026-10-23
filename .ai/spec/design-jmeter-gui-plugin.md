# 설계서: JMeter 내장(GUI) 플러그인

노션 작업 큐 TASK-20. 구현은 사용자가 별도로 진행한다.

## 1. 목표

JMeter GUI 안에서 바로 흐름 관제 화면을 연다. 테스트를 구성하는 같은 창에서 실행 결과를 업무 흐름으로 보게 하는 것이 목표다. 구성하면서 짧게 돌려 보는 스모크·디버그 실행이 주된 쓰임새다.

## 2. 전제와 경계

JMeter 공식 문서는 부하 테스트를 GUI가 아닌 non-GUI(`-n`) 모드로 실행하라고 안내한다. GUI 리스너도 부하 발생기의 CPU·메모리를 함께 쓴다. 따라서 이 플러그인은 **GUI 모드 실행(구성·스모크·소규모 실행)을 위한 보조 화면**으로 둔다. 본 부하 테스트의 관제는 계속 웹 화면(collector)이 맡는다.

포함:
- JMeter 메뉴에서 관제 화면 열기
- GUI 모드 실행 중 샘플 결과를 같은 JVM 안에서 받아 업무 흐름·KPI 표시

제외:
- non-GUI 실행 관제 (웹 화면 담당)
- 웹 화면의 모든 기능 복제 (시간축 재생·실행 기록 보관은 웹 화면 담당)

## 3. 참조 소스와 기존 패턴

| 참조 | 내용 | 이 설계에서의 사용 |
| --- | --- | --- |
| `src/listener` (`EventCollectorBackendListener`, `SampleEventNormalizer`) | `SampleResult` 정규화, 실패 사유(Assertion 메시지) 추출 | 같은 정규화 코드를 플러그인에서 재사용 (같은 JAR 또는 공용 모듈) |
| `src/listener` `TestTreeCapture` | 실행 중인 엔진의 테스트 트리 직렬화 | GUI에서는 `GuiPackage`의 트리 모델로 같은 정보를 얻는다 |
| `src/collector/jmx_plan.py`, `flow_tracker.py` | 단계 목록 구성, 스레드·라벨·시작 시각 기반 사용자 위치 복원 | 플러그인 안에서 같은 규칙으로 계산해야 한다 (6절의 방안별 차이) |
| `src/web/src/components/plan/FlowPipeline.tsx` | 단계 흐름 보기(파이프라인)·평소 대비 색·응답 칸 | Swing 화면의 표시 규칙 기준 |
| `.ai/spec/event-contract.md` | 이벤트 계약 | 플러그인과 collector가 같은 계약을 쓰도록 유지 |

## 4. JMeter 확장 지점

| 확장 지점 | 클래스 | 용도 |
| --- | --- | --- |
| 리스너(Visualizer) | `org.apache.jmeter.visualizers.gui.AbstractVisualizer` 상속, `add(SampleResult)`·`clearData()` 구현 | 테스트 트리에 추가하는 리스너 요소. GUI 실행 중 샘플을 JVM 안에서 직접 받는다 |
| 메뉴 | `org.apache.jmeter.gui.plugin.MenuCreator` 구현 | 상단 메뉴에 "JMeter Live Traffic 열기" 항목 추가 |
| 테스트 트리 | `org.apache.jmeter.gui.GuiPackage#getTreeModel()` | 현재 GUI의 테스트 계획(저장하지 않은 변경 포함)을 읽어 단계 목록 구성 |

JMeter는 `lib/ext`의 JAR에서 이 클래스들을 찾아 메뉴와 리스너 목록에 올린다. 리스너 JAR과 마찬가지로 JAR 하나를 넣으면 설치가 끝난다.

## 5. 구성 방안 비교

| 방안 | 내용 | 장점 | 단점 |
| --- | --- | --- | --- |
| A. 브라우저 열기 | 메뉴 항목이 collector 주소를 기본 브라우저로 연다(`java.awt.Desktop#browse`). 결과는 기존 Backend Listener 경로로 수집 | 구현이 가장 작다. 웹 화면 기능을 그대로 쓴다 | JMeter 창 안이 아니다. collector가 떠 있어야 한다 |
| B. 웹 화면 내장 | Swing 안에 브라우저 엔진(JCEF 또는 JavaFX WebView)을 넣어 collector 화면을 표시 | 웹 화면 재사용, JMeter 창 안에서 보인다 | Java 21에는 JavaFX가 포함되지 않고, JCEF는 플랫폼별 네이티브 바이너리를 함께 배포해야 한다. collector도 필요하다 |
| C. Swing 재구현 | `AbstractVisualizer`로 샘플을 직접 받아 Swing/Java2D로 KPI·업무 흐름을 그린다 | collector 없이 JMeter만으로 동작한다. 진짜 내장이다 | 흐름 복원 로직(`flow_tracker.py`)과 화면을 Java로 다시 만들어야 한다. 웹과 로직이 두 벌이 된다 |

## 6. 권장 단계

1. **1단계: 방안 A.** 메뉴 항목과 상태 표시(collector 연결 여부, 현재 실행 샘플 수)만 둔다. collector가 꺼져 있으면 `docker compose up -d` 실행 안내를 띄운다. 작은 비용으로 "JMeter에서 바로 진입"을 먼저 얻는다.
2. **2단계: 방안 C의 최소 범위.** `AbstractVisualizer` 기반 리스너로 단계 목록, 단계별 처리 중·완료·오류 수, KPI 4종(활성 사용자·처리량·p95·오류율)만 그린다. 시간축 재생과 기록 보관은 넣지 않는다.
   - 흐름 복원 로직은 Java로 옮기되 collector와 같은 테스트 케이스(`tests/collector/test_flow.py`의 입력·기대값)를 JUnit으로 옮겨 두 구현이 같은 결과를 내는지 검증한다.
3. 방안 B는 배포 부담(네이티브 바이너리, 플랫폼별 패키징) 때문에 권장하지 않는다. 필요하면 1단계 사용 경험을 보고 다시 판단한다.

## 7. 모듈 구성 (2단계 기준)

```
src/listener/                     (기존 Maven 모듈 확장 또는 src/gui-plugin/ 신설)
  └ io.axtutorlog.jmeter.backend
      ├ EventCollectorBackendListener   기존: 결과 → collector 전송
      ├ SampleEventNormalizer           기존: 정규화 (공용)
      └ gui/
          ├ LiveTrafficMenuCreator      메뉴 항목
          ├ LiveTrafficVisualizer       AbstractVisualizer, add(SampleResult) → FlowModel
          ├ FlowModel                   단계 목록·사용자 위치 복원 (flow_tracker 이식)
          └ FlowPanel                   Swing/Java2D 렌더링
```

`add(SampleResult)`는 샘플링 스레드에서 호출되므로 FlowModel 갱신만 하고, 그리기는 Swing 타이머(예: 초당 4회)로 EDT에서 수행한다. 웹 화면의 "무거운 계산 초당 4회" 원칙과 같다.

## 8. 위험과 대응

| 위험 | 대응 |
| --- | --- |
| GUI 리스너가 부하 발생기 자원을 써서 측정값을 흔든다 | 화면에 "GUI 모드 보조 화면" 표시. 대규모 실행에서는 웹 화면 사용을 안내 |
| 흐름 복원 로직이 Python과 Java 두 벌이 된다 | 공용 테스트 케이스로 두 구현을 같은 입력에 대해 검증. 규칙 변경은 계약 문서에 먼저 기록 |
| JMeter 버전 간 GUI API 변경 | 대상은 리스너와 같은 JMeter 5.6.x로 고정하고 `ApacheJMeter_core` 버전을 맞춘다 |
| 대량 샘플에서 Swing 그리기 지연 | 집계와 그리기를 분리하고, 토큰 표본 수를 웹 화면처럼 제한 |

## 9. 검증 계획

- 단위: FlowModel이 `tests/collector/test_flow.py`와 같은 입력에서 같은 결과를 내는지 (JUnit).
- 수동 E2E: JMeter GUI에서 `tests/e2e/btoc-like/btoc-like.jmx`를 열어 리스너를 추가하고 실행한다. 단계별 완료·오류 수가 웹 화면 및 JTL과 일치하는지 확인한다.
