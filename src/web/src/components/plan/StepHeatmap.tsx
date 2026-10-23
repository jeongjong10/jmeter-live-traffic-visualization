import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { StageDefinition } from '../TopologyCanvas';
import { clock as formatClock } from '../FlowParts';
import { stepHeatmap, type HeatGrid, type Visit } from '../../services/flowModel';

type Metric = 'users' | 'throughput' | 'average' | 'errors';
const METRICS: { id: Metric; label: string; unit: string; color: string; hint: string; read: string }[] = [
  { id: 'users', label: '동시 사용자 (부하 위치)', unit: '명', color: 'var(--series-1)', hint: '칸 하나 = 그 시간 구간에 이 단계 응답을 기다린 서로 다른 가상 사용자 수',
    read: '진한 칸이 가로로 길게 이어지면 사용자가 그 단계에 오래 몰려 있는 것(병목 후보), 위에서 아래로 내려가는 대각선은 사용자가 다음 단계로 넘어가는 흐름입니다.' },
  { id: 'throughput', label: '처리량', unit: 'req/s', color: 'var(--series-1)', hint: '칸 하나 = 그 시간 구간에 이 단계에서 끝난 요청 수 ÷ 구간 길이',
    read: '진할수록 그 단계가 그 시점에 요청을 많이 처리했습니다. 동시 사용자가 많은데 처리량이 옅으면 그 단계가 느려서 쌓이고 있는 것입니다.' },
  { id: 'average', label: '평균 응답시간 (1회 호출)', unit: 'ms', color: 'var(--series-2)', hint: '칸 하나 = 그 시간 구간에 이 단계에서 끝난 요청 1회의 평균 응답시간',
    read: '진할수록 느렸습니다. 같은 행에서 시간이 갈수록 진해지면 부하가 늘며 그 단계 응답이 느려진 것입니다. 빈칸은 그 구간에 끝난 요청이 없다는 뜻입니다.' },
  { id: 'errors', label: '오류', unit: '건', color: 'var(--critical)', hint: '칸 하나 = 그 시간 구간에 이 단계에서 실패한 요청 수',
    read: '오류가 언제, 어느 단계에서 났는지 봅니다. 칸을 누르면 그 시점으로 이동해 결과 트리에서 실패 사유를 확인할 수 있습니다.' },
];
const ROW_H = 20; const AXIS_H = 22;

function valueOf(grid: HeatGrid, metric: Metric, r: number, c: number) {
  if (metric === 'users') return grid.users[r][c];
  if (metric === 'throughput') return grid.completions[r][c] / (grid.bucketMs / 1000);
  if (metric === 'average') return grid.completions[r][c] ? grid.totalMs[r][c] / grid.completions[r][c] : 0;
  return grid.errors[r][c];
}
const show = (value: number, metric: Metric) => metric === 'throughput' ? value.toFixed(1) : Math.round(value).toLocaleString();

/** Cells only change with the data; the cursor line moves separately. */
const Cells = memo(function Cells({ grid, metric, peak, stages, labelW, cellW, from, selectedStage, onPick }: { grid: HeatGrid; metric: Metric; peak: number; stages: StageDefinition[]; labelW: number; cellW: number; from: number; selectedStage: string | null; onPick: (stageId: string, time: number) => void }) {
  const info = METRICS.find(item => item.id === metric)!;
  return <>
    {stages.map((stage, r) => { const selected = selectedStage === stage.id; return <g key={stage.id}>
      {selected && <rect x={0} y={r * ROW_H} width={labelW + cellW * grid.columns} height={ROW_H} style={{ fill: 'rgb(var(--c-slate-800))' }} />}
      <text x={labelW - 8} y={r * ROW_H + 14} textAnchor="end" fontSize={11} fontWeight={selected ? 700 : 400} style={{ fill: selected ? 'rgb(var(--c-slate-50))' : 'rgb(var(--c-slate-300))' }}>
        {`${stage.order ?? r + 1}${stage.repeat ? '↻' : ''} ${stage.name.length > 22 ? `${stage.name.slice(0, 21)}…` : stage.name}`}<title>{`${stage.order ?? r + 1}. ${stage.name}`}</title>
      </text>
      {Array.from({ length: grid.columns }, (_, c) => { const value = valueOf(grid, metric, r, c); const at = from + c * grid.bucketMs;
        return <rect key={c} id={`jlt-heat-${stage.id}-${c}`} data-testid={`heat-${stage.id}-${c}`} x={labelW + c * cellW + .5} y={r * ROW_H + 1} width={Math.max(1, cellW - 1)} height={ROW_H - 2} rx={2} className="cursor-pointer"
          style={{ fill: value > 0 ? info.color : 'rgb(var(--c-slate-800))', opacity: value > 0 ? .2 + .8 * value / (peak || 1) : .45 }} onClick={() => onPick(stage.id, at + grid.bucketMs / 2)}>
          <title>{`${stage.order ?? r + 1}. ${stage.name}\n${formatClock(at - from)} ~ ${formatClock(at - from + grid.bucketMs)}\n동시 사용자 ${grid.users[r][c]}명 · 완료 ${grid.completions[r][c]}건 · 평균 ${grid.completions[r][c] ? Math.round(grid.totalMs[r][c] / grid.completions[r][c]) : 0}ms · 오류 ${grid.errors[r][c]}건`}</title>
        </rect>; })}
    </g>; })}
  </>;
});

/** Steps (rows) over time (columns): where the load sits, how it moves to the next step, and when a step stalls. */
export default function StepHeatmap({ visits, stages, from, to, cursor, selectedStage, onPick }: { visits: Visit[]; stages: StageDefinition[]; from: number; to: number; cursor: number; selectedStage: string | null; onPick: (stageId: string, time: number) => void }) {
  const [metric, setMetric] = useState<Metric>('users');
  const host = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(1100);
  useEffect(() => { const el = host.current; if (!el) return; const observer = new ResizeObserver(([entry]) => setWidth(Math.max(480, entry.contentRect.width))); observer.observe(el); return () => observer.disconnect(); }, []);
  const grid = useMemo(() => stepHeatmap(visits, stages, from, to), [visits, stages, from, to]);
  const labelW = width < 760 ? 150 : 230; const cellW = (width - labelW) / grid.columns; const height = stages.length * ROW_H;
  const cursorX = labelW + (Math.min(Math.max(cursor, from), to) - from) / grid.bucketMs * cellW;
  const ticks = Array.from({ length: 7 }, (_, index) => index / 6);
  const info = METRICS.find(item => item.id === metric)!;
  const peak = useMemo(() => { let max = 0; stages.forEach((_, r) => { for (let c = 0; c < grid.columns; c++) max = Math.max(max, valueOf(grid, metric, r, c)); }); return max; }, [grid, metric, stages]);
  const bucket = grid.bucketMs >= 1000 ? `${grid.bucketMs / 1000}초` : `${grid.bucketMs}ms`;
  return <div id="jlt-flow-heatmap" ref={host}>
    <div id="jlt-heatmap-header" className="mb-3 space-y-2 text-xs">
      <div id="jlt-heatmap-metrics" className="flex flex-wrap items-center gap-2"><span id="jlt-heatmap-metrics-label" className="text-slate-400">지표</span>
        <div id="jlt-heatmap-metric-buttons" className="inline-flex rounded-lg bg-slate-800 p-1">{METRICS.map(item => <button key={item.id} id={`jlt-heatmap-metric-${item.id}`} data-testid={`heat-metric-${item.id}`} onClick={() => setMetric(item.id)} className={`rounded px-2.5 py-1 font-semibold ${metric === item.id ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>{item.label}</button>)}</div></div>
      <div id="jlt-heatmap-guide" className="rounded-lg border border-slate-700 bg-slate-950/40 px-3 py-2">
        <p id="jlt-heatmap-guide-title" className="text-sm font-bold" style={{ color: info.color }}>{info.label}</p>
        <p id="jlt-heatmap-guide-cell" className="mt-0.5 text-slate-300">{info.hint} ({bucket} 단위)</p>
        <p id="jlt-heatmap-guide-read" className="mt-0.5 text-slate-400"><b id="jlt-heatmap-guide-read-label" className="text-slate-300">읽는 법</b> · {info.read}</p>
        <div id="jlt-heatmap-legend-row" className="mt-2 flex items-center gap-2 text-slate-400"><span id="jlt-heatmap-legend-min">0</span><span id="jlt-heatmap-legend" data-testid="heat-legend" className="h-2.5 w-40 rounded" style={{ background: `linear-gradient(90deg, rgb(var(--c-slate-800)), ${info.color})` }} /><span id="jlt-heatmap-legend-max" data-testid="heat-peak">{show(peak, metric)} {info.unit} (최대)</span><span id="jlt-heatmap-legend-hint" className="ml-3">칸 클릭 = 그 시점·단계로 이동 · 세로선 = 현재 위치</span></div>
      </div>
    </div>
    <svg id="jlt-heatmap-plot" width={width} height={height + AXIS_H + 30} className="block overflow-visible">
      <g transform="translate(0,14)">
        <text x={labelW - 8} y={-4} textAnchor="end" fontSize={10} fontWeight={600} style={{ fill: 'var(--ink-muted)' }}>단계 (jmx 순서) ↓</text>
        <text x={width} y={height + AXIS_H + 8} textAnchor="end" fontSize={10} fontWeight={600} style={{ fill: 'var(--ink-muted)' }}>경과 시간 →</text>
        <Cells grid={grid} metric={metric} peak={peak} stages={stages} labelW={labelW} cellW={cellW} from={from} selectedStage={selectedStage} onPick={onPick} />
        {ticks.map(t => <text key={t} x={labelW + t * (width - labelW)} y={height + 15} textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'} fontSize={10} style={{ fill: 'var(--ink-muted)' }}>{formatClock(t * grid.columns * grid.bucketMs)}</text>)}
        <line data-testid="heat-cursor" x1={cursorX} x2={cursorX} y1={-2} y2={height + 2} style={{ stroke: 'rgb(var(--c-slate-50))' }} strokeWidth={1.5} />
      </g>
    </svg>
  </div>;
}
