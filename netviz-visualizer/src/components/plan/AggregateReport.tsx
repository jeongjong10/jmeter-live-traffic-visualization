import { memo } from 'react';
import type { AggregateRow } from '../../services/flowModel';

const ms = (value: number) => Math.round(value).toLocaleString();
const columns: [string, (row: AggregateRow) => string][] = [
  ['샘플', row => row.samples.toLocaleString()], ['평균', row => ms(row.averageMs)], ['중앙값', row => ms(row.medianMs)],
  ['90%', row => ms(row.p90Ms)], ['95%', row => ms(row.p95Ms)], ['99%', row => ms(row.p99Ms)], ['최소', row => ms(row.minMs)],
  ['최대', row => ms(row.maxMs)], ['오류 %', row => `${row.errorPct.toFixed(2)}%`], ['처리량/s', row => row.throughput.toFixed(2)],
  ['수신 KB/s', row => row.receivedKBs.toFixed(2)],
];

/** JMeter "Aggregate Report" for the samples finished up to the current cursor. */
export default memo(function AggregateReport({ rows, total, selectedStage, onSelectStage }: { rows: AggregateRow[]; total: AggregateRow; selectedStage: string | null; onSelectStage: (id: string) => void }) {
  return <div id="jlt-aggregate" className="overflow-x-auto">
    <table className="w-full min-w-[900px] text-right text-xs">
      <thead className="text-slate-400"><tr className="border-b border-slate-700"><th className="py-2 pl-3 text-left font-semibold">단계 (Sampler)</th>{columns.map(([name]) => <th key={name} className="px-2 font-semibold">{name}</th>)}</tr></thead>
      <tbody>
        <tr id="jlt-aggregate-total" className="border-b border-slate-600 bg-slate-800/40 font-semibold"><td className="py-2 pl-3 text-left text-slate-100">{total.label}</td>{columns.map(([name, value]) => <td key={name} className={`px-2 ${name === '오류 %' && total.errorPct > 0 ? 'text-red-300' : 'text-slate-100'}`}>{value(total)}</td>)}</tr>
        {rows.map((row, index) => <tr key={row.stepId} data-testid={`aggregate-row-${row.stepId}`} onClick={() => onSelectStage(row.stepId)} className={`cursor-pointer border-b border-slate-800 hover:bg-slate-800/60 ${selectedStage === row.stepId ? 'bg-blue-500/15' : ''}`}>
          <td className="max-w-[360px] truncate py-1.5 pl-3 text-left text-slate-200" title={row.label}>{index + 1}. {row.label}</td>
          {columns.map(([name, value]) => <td key={name} className={`px-2 ${name === '오류 %' && row.errorPct > 0 ? 'text-red-300' : 'text-slate-300'}`}>{value(row)}</td>)}
        </tr>)}
      </tbody>
    </table>
    <p className="mt-2 px-3 text-[11px] text-slate-500">시간 단위 ms. 현재 화면 시점까지 끝난 샘플만 집계합니다. 행을 클릭하면 해당 단계를 선택합니다.</p>
  </div>;
});
