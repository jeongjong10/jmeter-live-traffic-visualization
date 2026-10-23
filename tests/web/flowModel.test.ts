import { slowdownAt, slowdownLevel, stepPeaks, stepStates, type Visit } from '../../src/web/src/services/flowModel';
import type { StageDefinition } from '../../src/web/src/components/TopologyCanvas';

let seq = 0;
/** A measured request of `durationMs` that started at `start`; `end: null` keeps it open. */
function visit(stepId: string, start: number, durationMs: number, extra: Partial<Visit> = {}): Visit {
  seq += 1;
  return { id: `v${seq}`, stepId, correlationId: extra.correlationId ?? `u${seq}`, thread: 'tg 1-1', iteration: 1, start, end: start + durationMs, estimated: false, success: true, status: '200', durationMs, latency: 0, connect: 0, bytes: 0, failureMessage: '', ...extra };
}
/** `count` back-to-back requests of one user, each `durationMs` long. */
const series = (stepId: string, from: number, count: number, durationMs: number, user = 'u-repeat') =>
  Array.from({ length: count }, (_, index) => visit(stepId, from + index * durationMs, durationMs, { correlationId: user }));

const STAGES: StageDefinition[] = [{ id: 'login', name: '로그인', endpoint: 'POST /login' }, { id: 'answer', name: '응답 입력', endpoint: 'POST /answer', repeat: true }];

describe('slowdownAt (평소 대비)', () => {
  it('반복 호출이 많아도 응답 시간이 그대로면 ×1.0', () => {
    const finished = series('answer', 0, 40, 100);
    expect(slowdownAt(finished, 4000)).toBe(1);
  });

  it('최근 2초 응답이 평소의 3배면 ×3.0', () => {
    const usual = series('login', 0, 21, 100);
    const slow = [visit('login', 9000, 300), visit('login', 9100, 300), visit('login', 9200, 300)];
    expect(slowdownAt([...usual, ...slow], 9600)).toBe(3);
  });

  it('완료가 5건 미만이면 값이 없다', () => {
    expect(slowdownAt(series('login', 0, 4, 100), 400)).toBeNull();
  });

  it('최근 2초에 완료도 없고 열린 요청도 없으면(유휴) 값이 없다', () => {
    expect(slowdownAt(series('login', 0, 10, 100), 5000)).toBeNull();
  });

  it('응답이 멈춘 요청은 경과 시간으로 반영된다', () => {
    const finished = series('login', 0, 5, 100);
    const stalled = visit('login', 600, 0, { end: null });
    expect(slowdownAt(finished, 2600, [stalled])).toBe(20); // 최근 완료 없이 경과 2000ms ÷ 평소 100ms
  });

  it('추정(estimated) 상태의 열린 요청은 계산에서 뺀다', () => {
    const finished = series('login', 0, 5, 100);
    expect(slowdownAt(finished, 5000, [visit('login', 600, 0, { end: null, estimated: true })])).toBeNull();
  });

  it('평소 시간은 최소 20ms로 본다(2ms → 5ms를 느려짐으로 읽지 않음)', () => {
    const fast = series('login', 0, 10, 2);
    const recent = [visit('login', 5000, 5), visit('login', 5005, 5), visit('login', 5010, 5)];
    expect(slowdownAt([...fast, ...recent], 5020)).toBe(5 / 20); // 평소 2ms가 아니라 20ms로 나눈다
  });
});

describe('slowdownLevel (색 위치)', () => {
  it('×1.2 이하 파랑(0), ×1.6 주황(0.5), ×2 이상 빨강(1)', () => {
    expect(slowdownLevel(1)).toBe(0);
    expect(slowdownLevel(1.2)).toBe(0);
    expect(slowdownLevel(1.6)).toBeCloseTo(.5);
    expect(slowdownLevel(2)).toBe(1);
    expect(slowdownLevel(5)).toBe(1);
  });
});

describe('stepStates', () => {
  it('응답 시간은 호출 1건 기준이라 같은 사용자의 반복 호출이 평균을 키우지 않는다', () => {
    const state = stepStates(series('answer', 0, 30, 100), STAGES, 10_000).steps[1];
    expect(state.calls).toBe(30);
    expect(state.reached).toBe(1);
    expect(state.averageMs).toBe(100);
  });
});

describe('stepPeaks (완료 상태 최대치)', () => {
  it('재생 중 어느 시점의 평소 대비 값도 완료 상태 최대치를 넘지 않는다', () => {
    const visits = [...series('login', 0, 20, 100), ...series('login', 5000, 4, 250, 'u-slow'), visit('login', 6000, 900), ...series('login', 8000, 10, 100), ...series('answer', 0, 40, 100)];
    const peaks = stepPeaks(visits, STAGES);
    let shown = 0;
    for (let cursor = 0; cursor <= 12_000; cursor += 10) shown = Math.max(shown, stepStates(visits, STAGES, cursor).steps[0].slowdown ?? 0);
    expect(shown).toBeGreaterThan(1);
    expect(peaks[0].slowdown).toBeGreaterThanOrEqual(shown);
    expect(peaks[1].slowdown).toBe(1);
  });

  it('한 사용자의 연속 요청은 동시 사용자로 겹쳐 세지 않고, 최대 처리량은 1초 안 완료 수', () => {
    const peaks = stepPeaks(series('answer', 0, 30, 100), STAGES);
    expect(peaks[1].users).toBe(1);
    expect(peaks[1].throughput).toBe(10);
  });

  it('끝나지 않은 요청은 최대치에서 뺀다', () => {
    const peaks = stepPeaks([visit('login', 0, 100), visit('login', 0, 0, { end: null }), visit('login', 0, 0, { end: null })], STAGES);
    expect(peaks[0].users).toBe(1);
    expect(peaks[0].done).toBe(1);
    expect(peaks[0].slowdown).toBeNull();
  });
});
