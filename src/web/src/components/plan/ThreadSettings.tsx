import type { PlanThreadGroup, Visit } from '../../services/flowModel';

const sec = (ms: number) => `${(ms / 1000).toFixed(1)}초`;
/** Plans stored by older collector versions lack these flags. */
const flag = (value: boolean | undefined) => value === undefined ? '-' : value ? '체크' : '해제';

/** The Thread Group "쓰레드 속성" as configured in the .jmx, what each means for this run, and what was observed. */
export default function ThreadSettings({ group, visits, testStartedAt }: { group: PlanThreadGroup; visits: Visit[]; testStartedAt: number | null }) {
  const threads = group.threads ?? 0;
  const ramp = group.rampUpSeconds ?? 0;
  // Older stored plans have no scheduler flag; a duration was only recorded when it was on.
  const scheduler = group.scheduler ?? group.durationSeconds !== null;
  const firstStart = new Map<string, number>();
  visits.forEach(visit => { const known = firstStart.get(visit.thread); if (known === undefined || visit.start < known) firstStart.set(visit.thread, visit.start); });
  const starts = [...firstStart.values()].sort((a, b) => a - b);
  const ends = visits.map(visit => visit.end ?? visit.start);
  const iterations = visits.length ? Math.max(...visits.map(visit => visit.iteration)) : 0;
  const observed = visits.length > 0;
  const rows: [string, string, string, string][] = [
    ['쓰레드들의 수 (사용자 수)', `${group.threads ?? '변수'}`, `가상 사용자 ${threads}명이 각자 시나리오를 실행합니다.`, observed ? `${starts.length}명 시작${group.threads !== null && starts.length > group.threads ? ' ⚠ jmx 값과 다름 (JMeter UI에서만 바꾸고 저장·재등록하지 않음)' : ''}` : '-'],
    ['Ramp-up 시간', `${group.rampUpSeconds ?? '변수'}초`, threads > 1 ? `${ramp}초 동안 ${(ramp / threads).toFixed(2)}초 간격으로 1명씩 시작합니다.` : '사용자가 1명이라 바로 시작합니다.', starts.length > 1 ? `첫 사용자 → 마지막 사용자 ${sec(starts[starts.length - 1] - starts[0])}` : '-'],
    ['루프 카운트', group.loops === -1 ? '무한' : `${group.loops ?? '변수'}`, group.loops === -1 ? '지속 시간이 끝날 때까지 반복합니다.' : `사용자마다 시나리오를 ${group.loops}회 실행합니다 (총 ${threads * (group.loops ?? 0)}여정).`, observed ? `최대 ${iterations}회차` : '-'],
    ['각 반복 실행 시 동일 사용자', flag(group.sameUserOnNextIteration), group.sameUserOnNextIteration === undefined ? '-' : group.loops === 1 ? '루프가 1회라 영향이 없습니다.' : group.sameUserOnNextIteration ? '반복 사이에 쿠키·캐시를 유지합니다(같은 사용자).' : '반복마다 쿠키·캐시를 비웁니다(새 사용자처럼).', '관측 불가'],
    ['필요 시까지 쓰레드 생성 지연', flag(group.delayedStart), group.delayedStart === undefined ? '-' : group.delayedStart ? 'Ramp-up 일정이 되었을 때 쓰레드를 만듭니다.' : '테스트 시작 시 쓰레드를 모두 만들어 두고 일정에 맞춰 시작합니다.', '관측 불가'],
    ['쓰레드 생명주기 지정', flag(scheduler), scheduler ? '아래 지속 시간과 시작 지연을 적용합니다.' : '루프가 끝날 때까지 실행합니다 (지속 시간·시작 지연 무시).', '-'],
    ['지속 시간 (초)', scheduler ? `${group.durationSeconds ?? '변수'}초` : '사용 안 함', scheduler ? `루프가 남아 있어도 ${group.durationSeconds}초가 지나면 종료합니다.` : '-', observed ? `실제 실행 ${sec(Math.max(...ends) - starts[0])}` : '-'],
    ['시작 지연 시간 (초)', scheduler ? (group.startDelaySeconds === undefined ? '-' : `${group.startDelaySeconds ?? 0}초`) : '사용 안 함', scheduler && group.startDelaySeconds ? `테스트 시작 후 ${group.startDelaySeconds}초 기다렸다가 시작합니다.` : '바로 시작합니다.', observed && testStartedAt ? `테스트 시작 → 첫 요청 ${sec(starts[0] - testStartedAt)}` : '-'],
    ['Sampler 에러 후 수행할 작업', group.onSampleError, ({ continue: '오류가 나도 다음 요청을 계속합니다.', startnextloop: '오류가 나면 그 사용자의 다음 반복으로 넘어갑니다.', stopthread: '오류가 난 사용자만 멈춥니다.', stoptest: '오류가 나면 모든 사용자를 멈춥니다(진행 중 요청은 마침).', stoptestnow: '오류가 나면 모든 사용자를 즉시 멈춥니다.' } as Record<string, string>)[group.onSampleError] ?? '-', '-'],
  ];
  return <details className="rounded-xl border border-slate-700 bg-slate-900 text-sm">
    <summary className="cursor-pointer px-4 py-3"><span className="font-semibold">쓰레드 속성</span><span className="ml-2 text-xs text-slate-400">사용자 {group.threads ?? '변수'}명 · Ramp-up {group.rampUpSeconds ?? '변수'}초 · 루프 {group.loops === -1 ? '무한' : group.loops ?? '변수'}{scheduler ? ` · 지속 ${group.durationSeconds}초` : ''} · 오류 시 {group.onSampleError}{observed && group.threads !== null && starts.length > group.threads ? ` · ⚠ 실제 ${starts.length}명 실행` : ''} — 펼쳐서 설정·의미·실측 보기</span></summary>
    <div className="overflow-x-auto border-t border-slate-700/70">
      <table className="w-full min-w-[820px] text-xs">
        <thead className="text-slate-400"><tr><th className="py-2 pl-4 text-left">항목 (JMeter 화면 이름)</th><th className="text-left">설정</th><th className="text-left">이 설정의 의미</th><th className="pr-4 text-left">실측</th></tr></thead>
        <tbody>{rows.map(([name, value, meaning, actual]) => <tr key={name} className="border-t border-slate-800"><td className="py-1.5 pl-4 text-slate-300">{name}</td><td className="font-semibold text-slate-100">{value}</td><td className="text-slate-300">{meaning}</td><td className={`pr-4 ${actual.includes('⚠') ? 'text-amber-300' : 'text-slate-400'}`}>{actual}</td></tr>)}</tbody>
      </table>
    </div>
  </details>;
}
