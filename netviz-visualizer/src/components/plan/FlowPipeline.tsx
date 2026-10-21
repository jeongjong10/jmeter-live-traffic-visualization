import { memo, useEffect, useRef, useState } from 'react';
import type { StageDefinition } from '../TopologyCanvas';
import type { Halt, StepState, Visit } from '../../services/flowModel';
import { useClock, type PlaybackClock } from '../FlowParts';

const NODE_W = 216; const NODE_H = 170; const GAP_X = 46; const GAP_Y = 58; const PAD = 16;
/** Height reserved at the bottom of each node for user tokens (two rows). */
const LANE = 42;
/** Visual travel time from the previous step's node; kept inside the measured span. */
export const TRAVEL_MS = 260;
/** A failed request stays visible (red) this long after it ended. */
const FAIL_LINGER_MS = 1500;

export type TokenStyle = 'chip' | 'person';
export type TokenState = 'moving' | 'processing' | 'slow' | 'estimated' | 'failed' | 'halted';
const SIZE: Record<TokenStyle, { w: number; h: number; gap: number }> = { chip: { w: 30, h: 16, gap: 3 }, person: { w: 11, h: 16, gap: 2 } };

type Slot = { x: number; y: number };

/** Steps chained in .jmx order, wrapping row by row (each row reverses so every edge stays short). */
function layout(count: number, width: number) {
  const cols = Math.max(2, Math.floor((width - 2 * PAD + GAP_X) / (NODE_W + GAP_X)));
  const slots: Slot[] = Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / cols); const inRow = index % cols; const col = row % 2 === 0 ? inRow : cols - 1 - inRow;
    return { x: PAD + col * (NODE_W + GAP_X), y: PAD + row * (NODE_H + GAP_Y) };
  });
  const rows = Math.ceil(count / cols);
  return { slots, height: PAD * 2 + rows * NODE_H + (rows - 1) * GAP_Y };
}

function edgePath(from: Slot, to: Slot) {
  if (from.y === to.y) {
    const rightward = to.x > from.x; const y = from.y + 30;
    return { d: `M${rightward ? from.x + NODE_W : from.x},${y}H${rightward ? to.x : to.x + NODE_W}`, mid: { x: (from.x + to.x + NODE_W) / 2, y: y - 7 } };
  }
  const x = from.x + NODE_W / 2;
  return { d: `M${x},${from.y + NODE_H}V${to.y}`, mid: { x: x + 18, y: (from.y + NODE_H + to.y) / 2 + 4 } };
}

const threadNo = (thread: string) => thread.match(/(\d+)$/)?.[1] ?? '?';

/** One user token in either style; `progress` (0..1+) is elapsed time over the step's average. */
export function TokenShape({ style, state, x, y, label, progress = 0, focused = false }: { style: TokenStyle; state: TokenState; x: number; y: number; label: string; progress?: number; focused?: boolean }) {
  const color = state === 'failed' ? 'var(--critical)' : state === 'slow' ? 'var(--series-2)' : state === 'halted' ? 'rgb(var(--c-slate-500))' : 'var(--series-1)';
  const dashed = state === 'estimated' ? '2 2' : undefined;
  if (style === 'person') {
    return <g transform={`translate(${x},${y})`}>
      {focused && <rect x={-2} y={-2} width={15} height={20} rx={4} fill="none" style={{ stroke: 'rgb(var(--c-slate-50))' }} strokeWidth={1.5} />}
      <circle cx={5.5} cy={3.5} r={3} style={{ fill: state === 'estimated' ? 'none' : color, stroke: color }} strokeDasharray={dashed} strokeWidth={1.2} />
      <path d="M1,16 V11 Q1,7.5 5.5,7.5 Q10,7.5 10,11 V16 Z" style={{ fill: state === 'estimated' ? 'none' : color, stroke: color }} strokeDasharray={dashed} strokeWidth={1.2} />
      {state === 'failed' && <text x={5.5} y={14.5} textAnchor="middle" fontSize={7} style={{ fill: '#fff' }}>✖</text>}
    </g>;
  }
  const { w, h } = SIZE.chip;
  return <g transform={`translate(${x},${y})`}>
    <rect width={w} height={h} rx={4} style={{ fill: state === 'failed' ? 'var(--critical)' : 'rgb(var(--c-slate-800))', stroke: focused ? 'rgb(var(--c-slate-50))' : color }} strokeWidth={focused ? 2 : 1.3} strokeDasharray={dashed} />
    <text x={w / 2} y={10.5} textAnchor="middle" fontSize={9} fontWeight={600} style={{ fill: state === 'failed' ? '#fff' : 'var(--ink-primary)' }}>{state === 'failed' ? `✖${label}` : state === 'halted' ? `⛔${label}` : label}</text>
    {(state === 'processing' || state === 'slow' || state === 'moving') && <rect x={2} y={h - 3} height={1.6} width={Math.max(1, Math.min(1, progress) * (w - 4))} rx={0.8} style={{ fill: color }} />}
  </g>;
}

/** Nodes and edges: refreshed with the throttled statistics, not every frame. */
const NodesLayer = memo(function NodesLayer({ stages, states, started, finished, plannedUsers, halts, selectedStage, slots, width, height, onSelectStage }: {
  stages: StageDefinition[]; states: StepState[]; started: number; finished: number; plannedUsers: number; halts: Halt[]; selectedStage: string | null; slots: Slot[]; width: number; height: number; onSelectStage: (id: string) => void;
}) {
  const longest = states.reduce((best, state, index) => state.totalMs > (states[best]?.totalMs ?? 0) ? index : best, 0);
  const slowest = states.reduce((best, state, index) => state.averageMs > (states[best]?.averageMs ?? 0) ? index : best, 0);
  const peakLoad = Math.max(1, ...states.map(state => state.throughput));
  const halted = new Map<string, number>(); halts.forEach(halt => halted.set(halt.stepId, (halted.get(halt.stepId) ?? 0) + 1));
  return <>
    <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
      <defs><marker id="jlt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L8,4L0,8Z" style={{ fill: 'rgb(var(--c-slate-600))' }} /></marker></defs>
      {slots.slice(0, -1).map((slot, index) => { const edge = edgePath(slot, slots[index + 1]); const users = index < stages.length ? states[index]?.reached ?? 0 : finished; return <g key={index}>
        <path d={edge.d} style={{ stroke: 'rgb(var(--c-slate-600))' }} strokeWidth={1.5} fill="none" markerEnd="url(#jlt-arrow)" />
        {users > 0 && <text x={edge.mid.x} y={edge.mid.y} textAnchor="middle" fontSize={10} style={{ fill: 'var(--ink-muted)' }}>{users}명</text>}
      </g>; })}
    </svg>
    <div id="jlt-flow-start" className="absolute rounded-xl border border-amber-400/60 bg-slate-900 p-3 text-xs" style={{ left: slots[0].x, top: slots[0].y, width: NODE_W, height: NODE_H }}>
      <p className="font-semibold text-amber-200">JMeter 시작</p>
      <p className="mt-2 text-lg font-semibold text-slate-100">{started}<span className="ml-1 text-xs font-normal text-slate-400">/ {plannedUsers}명 출발</span></p>
    </div>
    {stages.map((stage, index) => { const state = states[index]; const node = slots[index + 1]; const selected = selectedStage === stage.id; const stops = halted.get(stage.id) ?? 0;
      return <button key={stage.id} data-testid={`step-node-${stage.id}`} onClick={() => onSelectStage(stage.id)} title={`${index + 1}. ${stage.name}\n${stage.endpoint}`}
        className={`absolute flex flex-col rounded-xl border bg-slate-900 px-2.5 pt-2.5 text-left text-xs transition-colors hover:bg-slate-800 ${selected ? 'border-slate-50 ring-2 ring-slate-50/60' : state.inFlight ? 'border-blue-400' : 'border-slate-700'}`}
        style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H, paddingBottom: LANE + 2 }}>
        <p className="line-clamp-2 font-semibold leading-snug text-slate-100"><span className="mr-1 text-slate-400">{index + 1}</span>{stage.name}{stage.repeat && <span className="ml-1 font-normal text-blue-300">↻ {state.calls}회</span>}</p>
        <p className="mt-1 text-slate-400">도달 <b className="text-slate-200">{state.reached}</b>명 · 평균 <b className="text-slate-200">{Math.round(state.averageMs).toLocaleString()}</b>ms · <span title="지금 요청을 기다리는 서로 다른 가상 사용자 수">동시 <b className={state.users > 1 ? 'text-blue-300' : 'text-slate-200'}>{state.users}</b>명</span></p>
        <div className="mt-1 flex items-center gap-1.5" title="체류 비중: 전체 소요 시간 중 이 단계가 차지한 몫 (같은 사용자의 반복 호출 포함)"><div className="h-1 flex-1 rounded bg-slate-800"><div className="h-1 rounded" style={{ width: `${Math.max(state.timeShare ? 2 : 0, state.timeShare * 100)}%`, background: 'rgb(var(--c-slate-400))' }} /></div><span className="w-14 text-right text-slate-400">체류 {Math.round(state.timeShare * 100)}%</span></div>
        <div className="mt-1 flex items-center gap-1.5" title="부하: 최근 1초 완료 요청(전체 단계 중 최대 단계 대비). 동시 사용자 1명의 빠른 반복은 체류는 커도 부하는 낮게 나옵니다"><div className="h-1.5 flex-1 rounded bg-slate-800"><div className="h-1.5 rounded" style={{ width: `${Math.max(state.throughput ? 3 : 0, state.throughput / peakLoad * 100)}%`, background: 'var(--series-1)' }} /></div><span className="w-20 text-right text-slate-400">부하 {state.throughput}/s</span></div>
        <div className="mt-1 flex flex-wrap gap-1">
          {state.errors > 0 && <span className="rounded bg-red-500/20 px-1 text-red-200">✖ 오류 {state.errors}</span>}
          {stops > 0 && <span className="rounded bg-red-500/20 px-1 text-red-200">⛔ 중단 {stops}</span>}
          {index === longest && state.totalMs > 0 && <span className="rounded bg-orange-500/20 px-1 text-orange-200" title="이 단계의 응답시간 합이 가장 큽니다 (호출 수 × 평균)">⚠ 누적 시간 최대</span>}
          {index === slowest && state.averageMs > 0 && <span className="rounded bg-orange-500/20 px-1 text-orange-200" title="요청 하나당 평균 응답시간이 가장 깁니다">⏱ 평균 최대</span>}
        </div>
      </button>; })}
    <div id="jlt-flow-end" className="absolute rounded-xl border border-emerald-500/50 bg-slate-900 p-3 text-xs" style={{ left: slots[slots.length - 1].x, top: slots[slots.length - 1].y, width: NODE_W, height: NODE_H }}>
      <p className="font-semibold text-emerald-200">✔ 완료</p>
      <p className="mt-2 text-lg font-semibold text-slate-100">{finished}<span className="ml-1 text-xs font-normal text-slate-400">/ {started}명</span></p>
      {halts.length > 0 && <p className="mt-1 text-red-200">⛔ 오류로 중단된 사용자 {halts.length}명</p>}
    </div>
  </>;
});

/** User tokens: the only part of the flow redrawn every frame. */
function TokensLayer({ clock, candidates, previous, stepIndex, stepAverage, halts, slots, width, height, style, focusRun, stages, onSelectVisit }: {
  clock: PlaybackClock; candidates: Visit[]; previous: Map<string, number>; stepIndex: Map<string, number>; stepAverage: Map<string, number>; halts: Halt[];
  slots: Slot[]; width: number; height: number; style: TokenStyle; focusRun: string | null; stages: StageDefinition[]; onSelectVisit: (visit: Visit) => void;
}) {
  const cursor = useClock(clock);
  const { w, h, gap } = SIZE[style];
  const perRow = Math.floor((NODE_W - 16 + gap) / (w + gap));
  const capacity = perRow * 2;
  const used = new Map<number, number>(); const overflow = new Map<number, number>();
  const restOf = (index: number) => { const k = used.get(index) ?? 0; used.set(index, k + 1); if (k >= capacity - 1) { overflow.set(index, (overflow.get(index) ?? 0) + 1); return null; } const node = slots[index + 1]; return { x: node.x + 8 + (k % perRow) * (w + gap), y: node.y + NODE_H - LANE + 3 + Math.floor(k / perRow) * (h + 3) }; };
  const items: { key: string; visit: Visit | null; state: TokenState; x: number; y: number; progress: number; label: string }[] = [];
  halts.filter(halt => halt.at <= cursor).forEach(halt => { const index = stepIndex.get(halt.stepId) ?? 0; const rest = restOf(index); if (rest) items.push({ key: `halt-${halt.correlationId}`, visit: null, state: 'halted', ...rest, progress: 0, label: halt.correlationId.match(/(\d+)#/)?.[1] ?? '?' }); });
  candidates.forEach(visit => {
    if (visit.start > cursor) return;
    const open = visit.end === null || visit.end > cursor;
    const failedRecently = !open && !visit.success && cursor - (visit.end ?? 0) <= FAIL_LINGER_MS;
    if (!open && !failedRecently) return;
    const index = stepIndex.get(visit.stepId) ?? 0; const rest = restOf(index); if (!rest) return;
    const elapsed = cursor - visit.start; const average = stepAverage.get(visit.stepId) ?? 0;
    const travel = Math.min(TRAVEL_MS, visit.end === null ? TRAVEL_MS : (visit.end - visit.start) / 2);
    const state: TokenState = failedRecently ? 'failed' : visit.estimated ? 'estimated' : average > 0 && elapsed > average * 2 ? 'slow' : 'processing';
    const t = Math.min(1, elapsed / Math.max(1, travel)); const origin = slots[(previous.get(visit.id) ?? -1) + 1];
    const from = { x: origin.x + NODE_W / 2 - w / 2, y: origin.y + NODE_H / 2 };
    items.push({ key: visit.id, visit, state: t < 1 && !failedRecently ? (state === 'estimated' ? 'estimated' : 'moving') : state, x: from.x + (rest.x - from.x) * t, y: from.y + (rest.y - from.y) * t, progress: average > 0 ? elapsed / average : 0, label: threadNo(visit.thread) });
  });
  return <svg className="pointer-events-none absolute inset-0" width={width} height={height}>
    {items.map(item => { const dim = focusRun && item.visit && focusRun !== item.visit.correlationId; const focused = !!item.visit && focusRun === item.visit.correlationId;
      return <g key={item.key} data-testid={`user-token-${item.label}`} className="pointer-events-auto cursor-pointer" opacity={dim ? .25 : 1} onClick={() => item.visit && onSelectVisit(item.visit)}>
        <title>{item.visit ? `${item.visit.correlationId}\n${stages[stepIndex.get(item.visit.stepId) ?? 0]?.name}\n${STATE_TEXT[item.state].name} · ${Math.round(cursor - item.visit.start).toLocaleString()} ms 경과` : `사용자 ${item.label}: 오류로 중단`}</title>
        <TokenShape style={style} state={item.state} x={item.x} y={item.y} label={item.label} progress={item.progress} focused={focused} />
      </g>; })}
    {[...overflow.entries()].map(([index, extra]) => { const node = slots[index + 1]; const k = capacity - 1; return <text key={`more-${index}`} x={node.x + 8 + (k % perRow) * (w + gap) + w / 2} y={node.y + NODE_H - LANE + 3 + Math.floor(k / perRow) * (h + 3) + 11} textAnchor="middle" fontSize={10} fontWeight={600} style={{ fill: 'var(--ink-secondary)' }}>+{extra + 1}</text>; })}
  </svg>;
}

export const STATE_TEXT: Record<TokenState, { name: string; meaning: string }> = {
  moving: { name: '이동 중', meaning: '직전 단계 응답을 받고 이 단계로 넘어오는 중입니다. 표시용 이동 효과(최대 0.26초)이며 실측 시간 안에서만 움직입니다.' },
  processing: { name: '처리 중 (실측)', meaning: 'JMeter가 이 단계 요청을 보내고 응답을 기다리는 중입니다. 칩 아래 막대 = 경과 시간 ÷ 이 단계 평균 응답시간.' },
  slow: { name: '지연', meaning: '경과 시간이 이 단계 평균 응답시간의 2배를 넘었습니다.' },
  estimated: { name: '처리 중 (추정)', meaning: '직전 요청이 끝나 이 단계를 시작했을 것으로 추정한 상태입니다. JMeter 결과가 도착하면 실측으로 바뀝니다.' },
  failed: { name: '오류', meaning: '방금 실패한 요청입니다(1.5초 동안 표시). 실패 사유는 오류 요약과 결과 트리에서 확인합니다.' },
  halted: { name: '중단', meaning: '오류 때문에 이 사용자가 멈춘 지점입니다. 스레드 그룹의 "Sampler 에러 후 수행할 작업" 설정을 따릅니다.' },
};

export function TokenLegend({ style }: { style: TokenStyle }) {
  return <details id="jlt-token-legend" className="mb-3 rounded-lg border border-slate-700 bg-slate-950/40 text-xs" open>
    <summary className="cursor-pointer px-3 py-2 font-semibold">사용자 표시 설명 <span className="font-normal text-slate-400">— 칩/아이콘 하나 = 가상 사용자 한 명(숫자 = 스레드 번호), 노드당 최대 {style === 'chip' ? 11 : 29}개 표시 후 +n</span></summary>
    <table className="w-full border-t border-slate-700/70"><tbody>{(Object.keys(STATE_TEXT) as TokenState[]).map(state => <tr key={state} className="border-t border-slate-800">
      <td className="w-16 py-1.5 pl-3"><svg width={style === 'chip' ? 34 : 16} height={20}><TokenShape style={style} state={state} x={2} y={2} label="7" progress={state === 'slow' ? 1 : .55} /></svg></td>
      <td className="w-28 font-semibold text-slate-200">{STATE_TEXT[state].name}</td><td className="pr-3 text-slate-400">{STATE_TEXT[state].meaning}</td></tr>)}</tbody></table>
  </details>;
}

export default function FlowPipeline(props: {
  stages: StageDefinition[]; states: StepState[]; started: number; finished: number; plannedUsers: number; halts: Halt[]; selectedStage: string | null; focusRun: string | null;
  clock: PlaybackClock; candidates: Visit[]; previous: Map<string, number>; tokenStyle: TokenStyle; onSelectStage: (id: string) => void; onSelectVisit: (visit: Visit) => void;
}) {
  const host = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(1100);
  useEffect(() => { const el = host.current; if (!el) return; const observer = new ResizeObserver(([entry]) => setWidth(Math.max(560, entry.contentRect.width))); observer.observe(el); return () => observer.disconnect(); }, []);
  const { slots, height } = layout(props.stages.length + 2, width);
  const stepIndex = new Map(props.stages.map((stage, index) => [stage.id, index]));
  const stepAverage = new Map(props.states.map(state => [state.stepId, state.averageMs]));
  return <div id="jlt-flow-pipeline" ref={host} className="relative overflow-x-auto" style={{ height }}>
    <NodesLayer stages={props.stages} states={props.states} started={props.started} finished={props.finished} plannedUsers={props.plannedUsers} halts={props.halts} selectedStage={props.selectedStage} slots={slots} width={width} height={height} onSelectStage={props.onSelectStage} />
    <TokensLayer clock={props.clock} candidates={props.candidates} previous={props.previous} stepIndex={stepIndex} stepAverage={stepAverage} halts={props.halts} slots={slots} width={width} height={height} style={props.tokenStyle} focusRun={props.focusRun} stages={props.stages} onSelectVisit={props.onSelectVisit} />
  </div>;
}
