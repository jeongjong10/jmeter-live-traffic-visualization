import type { StageDefinition } from '../TopologyCanvas';
import type { Visit } from '../../services/flowModel';

/** Failed samples up to the cursor, grouped by step, response code and failure reason. */
export default function ErrorSummary({ visits, stages, cursor, onSelect }: { visits: Visit[]; stages: StageDefinition[]; cursor: number; onSelect: (visit: Visit) => void }) {
  const failed = visits.filter(visit => visit.end !== null && visit.end <= cursor && !visit.success);
  if (!failed.length) return null;
  const groups = new Map<string, Visit[]>();
  failed.forEach(visit => { const key = `${visit.stepId}|${visit.status}|${visit.failureMessage}`; groups.set(key, [...(groups.get(key) ?? []), visit]); });
  const order = (stepId: string) => stages.findIndex(stage => stage.id === stepId);
  return <div className="rounded-xl border border-red-400/50 bg-red-500/5 p-3 text-xs">
    <p className="mb-2 font-semibold text-red-100">✖ 오류 {failed.length}건 — 단계·응답 코드·실패 사유별</p>
    <ul className="space-y-1">{[...groups.values()].sort((a, b) => order(a[0].stepId) - order(b[0].stepId)).map(group => { const first = group[0]; const index = order(first.stepId);
      return <li key={`${first.stepId}|${first.status}|${first.failureMessage}`}><button onClick={() => onSelect(first)} className="w-full rounded px-2 py-1 text-left hover:bg-red-500/10">
        <span className="font-semibold text-slate-100">{index + 1}. {stages[index]?.name}</span>
        <span className="ml-2 text-slate-300">{group.length}건 · 코드 {first.status || '-'}</span>
        <span className="block truncate text-slate-400" title={first.failureMessage}>{first.failureMessage || '실패 사유 없음 (이전 버전 리스너로 수집된 기록)'}</span>
      </button></li>; })}</ul>
  </div>;
}
