import { Fragment, useMemo, useState } from 'react';
import type { StageDefinition } from '../TopologyCanvas';
import type { Visit } from '../../services/flowModel';

const offset = (value: number, origin: number) => `+${((value - origin) / 1000).toFixed(3)}s`;
const clockOf = (value: number) => new Date(value).toLocaleTimeString('ko-KR', { hour12: false }) + `.${String(value % 1000).padStart(3, '0')}`;
type Status = 'all' | 'ok' | 'error' | 'open';

/** JMeter "View Results Tree": filterable sample list with a detail pane. */
export default function ResultsTree({ visits, stages, origin, cursor, stageFilter, onStageFilter, selected, onSelect, onSeek, focusRun, onFocusRun }: {
  visits: Visit[]; stages: StageDefinition[]; origin: number; cursor: number; stageFilter: string | null; onStageFilter: (id: string | null) => void;
  selected: Visit | null; onSelect: (visit: Visit) => void; onSeek: (time: number) => void; focusRun: string | null; onFocusRun: (runId: string | null) => void;
}) {
  const [status, setStatus] = useState<Status>('all');
  const users = useMemo(() => [...new Set(visits.map(visit => visit.correlationId))], [visits]);
  const stageIndex = (id: string) => stages.findIndex(stage => stage.id === id);
  const rows = visits.filter(visit => visit.start <= cursor)
    .filter(visit => !stageFilter || visit.stepId === stageFilter)
    .filter(visit => !focusRun || visit.correlationId === focusRun)
    .filter(visit => { const open = visit.end === null || visit.end > cursor; return status === 'all' || (status === 'open' ? open : !open && (status === 'ok') === visit.success); })
    .reverse();
  return <div id="jlt-results-tree" className="grid gap-3 lg:grid-cols-[1fr_340px]">
    <div id="jlt-results-list-area">
      <div id="jlt-results-filters" className="mb-2 flex flex-wrap gap-2 text-xs">
        <select id="jlt-results-filter-step" value={stageFilter ?? ''} onChange={event => onStageFilter(event.target.value || null)} className="max-w-[280px] rounded border border-slate-600 bg-slate-800 px-2 py-1"><option id="jlt-results-filter-step-all" value="">모든 단계</option>{stages.map((stage, index) => <option key={stage.id} id={`jlt-results-filter-step-${stage.id}`} value={stage.id}>{index + 1}. {stage.name}</option>)}</select>
        <select id="jlt-results-filter-status" value={status} onChange={event => setStatus(event.target.value as Status)} className="rounded border border-slate-600 bg-slate-800 px-2 py-1"><option id="jlt-results-filter-status-all" value="all">모든 결과</option><option id="jlt-results-filter-status-ok" value="ok">성공</option><option id="jlt-results-filter-status-error" value="error">오류</option><option id="jlt-results-filter-status-open" value="open">처리 중</option></select>
        <select id="jlt-results-filter-user" value={focusRun ?? ''} onChange={event => onFocusRun(event.target.value || null)} className="max-w-[280px] rounded border border-slate-600 bg-slate-800 px-2 py-1"><option id="jlt-results-filter-user-all" value="">모든 사용자</option>{users.map((user, at) => <option key={user} id={`jlt-results-filter-user-${at}`} value={user}>{user}</option>)}</select>
        <span id="jlt-results-count" className="self-center text-slate-500">{rows.length.toLocaleString()}건 (최근 300건 표시)</span>
      </div>
      <div id="jlt-results-scroll" className="max-h-[420px] overflow-y-auto rounded-lg border border-slate-800">
        <table id="jlt-results-table" className="w-full text-xs">
          <thead id="jlt-results-head" className="sticky top-0 bg-slate-900 text-slate-400"><tr id="jlt-results-head-row"><th id="jlt-results-head-start" className="py-1.5 pl-2 text-left">시작</th><th id="jlt-results-head-user" className="text-left">사용자</th><th id="jlt-results-head-step" className="text-left">단계</th><th id="jlt-results-head-elapsed" className="pr-2 text-right">응답시간</th><th id="jlt-results-head-code" className="pr-2 text-right">코드</th></tr></thead>
          <tbody id="jlt-results-body">{rows.slice(0, 300).map(visit => { const open = visit.end === null || visit.end > cursor; const r = `jlt-result-${visit.id}`; return <tr key={visit.id} id={r} onClick={() => { onSelect(visit); onSeek(visit.start); }} className={`cursor-pointer border-t border-slate-800 hover:bg-slate-800/60 ${selected?.id === visit.id ? 'bg-blue-500/15' : ''}`}>
            <td id={`${r}-start`} className="py-1 pl-2 font-mono text-slate-400">{offset(visit.start, origin)}</td>
            <td id={`${r}-user`} className="max-w-[180px] truncate text-slate-300" title={visit.correlationId}>{visit.correlationId}</td>
            <td id={`${r}-step`} className="max-w-[280px] truncate" title={stages[stageIndex(visit.stepId)]?.name}><span id={`${r}-mark`} className={open ? 'text-amber-300' : visit.success ? 'text-emerald-300' : 'text-red-300'}>{open ? '◌' : visit.success ? '✔' : '✖'}</span> {stageIndex(visit.stepId) + 1}. {stages[stageIndex(visit.stepId)]?.name}</td>
            <td id={`${r}-elapsed`} className="pr-2 text-right font-mono text-slate-300">{open ? `${Math.round(Math.max(0, cursor - visit.start)).toLocaleString()}…` : visit.durationMs.toLocaleString()} ms</td>
            <td id={`${r}-code`} className={`pr-2 text-right font-mono ${visit.success ? 'text-slate-400' : 'text-red-300'}`}>{open ? '-' : visit.status}</td>
          </tr>; })}</tbody>
        </table>
      </div>
    </div>
    <SampleDetail visit={selected} stages={stages} cursor={cursor} onSeek={onSeek} onFocusRun={onFocusRun} />
  </div>;
}

function SampleDetail({ visit, stages, cursor, onSeek, onFocusRun }: { visit: Visit | null; stages: StageDefinition[]; cursor: number; onSeek: (time: number) => void; onFocusRun: (runId: string) => void }) {
  if (!visit) return <div id="jlt-sample-detail-empty" className="rounded-lg border border-dashed border-slate-700 p-4 text-xs text-slate-500">목록이나 흐름 화면의 토큰을 클릭하면 샘플 상세가 표시됩니다.</div>;
  const index = stages.findIndex(stage => stage.id === visit.stepId); const stage = stages[index]; const open = visit.end === null || visit.end > cursor;
  const rows: [string, string][] = [
    ['결과', open ? (visit.estimated ? '처리 중 (추정)' : '처리 중') : visit.success ? '성공' : '오류'], ['응답 코드', open ? '-' : visit.status || '-'],
    ...(!open && !visit.success ? [['실패 사유', visit.failureMessage || '없음 (이전 버전 리스너로 수집된 기록)'] as [string, string]] : []),
    ['스레드', visit.thread], ['회차', `${visit.iteration}회차`], ['시작', clockOf(visit.start)], ['종료', visit.end === null ? '-' : clockOf(visit.end)],
    ['응답시간 (elapsed)', open ? `${Math.round(Math.max(0, cursor - visit.start)).toLocaleString()} ms (진행 중)` : `${visit.durationMs.toLocaleString()} ms`],
    ['Latency', open ? '-' : `${visit.latency.toLocaleString()} ms`], ['Connect', open ? '-' : `${visit.connect.toLocaleString()} ms`], ['수신 bytes', open ? '-' : visit.bytes.toLocaleString()],
  ];
  return <div id="jlt-sample-detail" className="rounded-lg border border-slate-700 bg-slate-950/60 p-4 text-xs">
    <p id="jlt-sample-detail-endpoint" className="text-slate-400">{stage?.endpoint}</p>
    <h4 id="jlt-sample-detail-step" className="mt-1 text-sm font-bold text-slate-100">{index + 1}. {stage?.name}</h4>
    <dl id="jlt-sample-detail-fields" className="mt-3 grid grid-cols-[110px_1fr] gap-y-1.5">{rows.map(([name, value], at) => <Fragment key={name}><dt id={`jlt-sample-detail-${at}-name`} className="text-slate-500">{name}</dt><dd id={`jlt-sample-detail-${at}-value`} className={`break-words ${(name === '결과' || name === '실패 사유') && !open && !visit.success ? 'text-red-300' : 'text-slate-200'}`}>{value}</dd></Fragment>)}</dl>
    <div id="jlt-sample-detail-actions" className="mt-3 flex gap-2"><button id="jlt-sample-detail-seek" onClick={() => onSeek(visit.start)} className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600">이 시점으로 이동</button><button id="jlt-sample-detail-focus" onClick={() => onFocusRun(visit.correlationId)} className="rounded bg-slate-700 px-2 py-1 hover:bg-slate-600">이 사용자 여정 강조</button></div>
    <p id="jlt-sample-detail-note" className="mt-3 text-[11px] text-slate-500">요청·응답 본문과 헤더는 개인정보가 포함될 수 있어 수집하지 않습니다.</p>
  </div>;
}
