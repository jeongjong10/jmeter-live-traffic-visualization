import { memo, useEffect, useRef, useState } from 'react';
import type { StageDefinition } from '../TopologyCanvas';
import { slowdownLevel, type Badge, type Halt, type StepState, type Visit } from '../../services/flowModel';
import { loadColor, useClock, type PlaybackClock } from '../FlowParts';

const NODE_W = 216; const NODE_H = 196; const GAP_X = 46; const GAP_Y = 58; const PAD = 16;
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
  // Waiting tokens pulse (CSS, so they keep breathing while playback is paused); a delayed one pulses faster and larger.
  const pulse = state === 'processing' ? 'jlt-breathe' : state === 'slow' ? 'jlt-breathe-slow' : undefined;
  if (style === 'person') {
    return <g transform={`translate(${x},${y})`}><g className={pulse}>
      {focused && <rect x={-2} y={-2} width={15} height={20} rx={4} fill="none" style={{ stroke: 'rgb(var(--c-slate-50))' }} strokeWidth={1.5} />}
      <circle cx={5.5} cy={3.5} r={3} style={{ fill: state === 'estimated' ? 'none' : color, stroke: color }} strokeDasharray={dashed} strokeWidth={1.2} />
      <path d="M1,16 V11 Q1,7.5 5.5,7.5 Q10,7.5 10,11 V16 Z" style={{ fill: state === 'estimated' ? 'none' : color, stroke: color }} strokeDasharray={dashed} strokeWidth={1.2} />
      {state === 'failed' && <text x={5.5} y={14.5} textAnchor="middle" fontSize={7} style={{ fill: '#fff' }}>✖</text>}
    </g></g>;
  }
  const { w, h } = SIZE.chip;
  return <g transform={`translate(${x},${y})`}><g className={pulse}>
    <rect width={w} height={h} rx={4} style={{ fill: state === 'failed' ? 'var(--critical)' : 'rgb(var(--c-slate-800))', stroke: focused ? 'rgb(var(--c-slate-50))' : color }} strokeWidth={focused ? 2 : 1.3} strokeDasharray={dashed} />
    <text x={w / 2} y={10.5} textAnchor="middle" fontSize={9} fontWeight={600} style={{ fill: state === 'failed' ? '#fff' : 'var(--ink-primary)' }}>{state === 'failed' ? `✖${label}` : state === 'halted' ? `⛔${label}` : label}</text>
    {(state === 'processing' || state === 'slow' || state === 'moving') && <rect x={2} y={h - 3} height={1.6} width={Math.max(1, Math.min(1, progress) * (w - 4))} rx={0.8} style={{ fill: color }} />}
  </g></g>;
}

/** Nodes and edges: refreshed with the throttled statistics, not every frame. `summary` = completed run, states hold each step's peaks. */
const NodesLayer = memo(function NodesLayer({ stages, states, started, finished, plannedUsers, halts, selectedStage, badges, summary, slots, width, height, onSelectStage }: {
  stages: StageDefinition[]; states: StepState[]; started: number; finished: number; plannedUsers: number; halts: Halt[]; selectedStage: string | null; badges: Map<string, Badge[]>; summary: boolean; slots: Slot[]; width: number; height: number; onSelectStage: (id: string) => void;
}) {
  const halted = new Map<string, number>(); halts.forEach(halt => halted.set(halt.stepId, (halted.get(halt.stepId) ?? 0) + 1));
  return <>
    <svg id="jlt-flow-edges" className="pointer-events-none absolute inset-0" width={width} height={height}>
      <defs><marker id="jlt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0L8,4L0,8Z" style={{ fill: 'rgb(var(--c-slate-600))' }} /></marker></defs>
      {slots.slice(0, -1).map((slot, index) => { const edge = edgePath(slot, slots[index + 1]); const users = index < stages.length ? states[index]?.reached ?? 0 : finished; return <g key={index} id={`jlt-flow-edge-${index}`}>
        <path d={edge.d} style={{ stroke: 'rgb(var(--c-slate-600))' }} strokeWidth={1.5} fill="none" markerEnd="url(#jlt-arrow)" />
        {users > 0 && <text x={edge.mid.x} y={edge.mid.y} textAnchor="middle" fontSize={10} style={{ fill: 'var(--ink-muted)' }}>{users}명</text>}
      </g>; })}
    </svg>
    <div id="jlt-flow-start" className="absolute rounded-xl border border-amber-400/60 bg-slate-900 p-3 text-xs" style={{ left: slots[0].x, top: slots[0].y, width: NODE_W, height: NODE_H }}>
      <p id="jlt-flow-start-title" className="font-semibold text-amber-200">JMeter 시작</p>
      <p id="jlt-flow-start-count" className="mt-2 text-lg font-semibold text-slate-100">{started}<span id="jlt-flow-start-planned" className="ml-1 text-xs font-normal text-slate-400">/ {plannedUsers}명 출발</span></p>
    </div>
    {stages.map((stage, index) => { const state = states[index]; const node = slots[index + 1]; const selected = selectedStage === stage.id; const stops = halted.get(stage.id) ?? 0; const order = stage.order ?? index + 1;
      const level = state.slowdown === null ? null : slowdownLevel(state.slowdown); const perUser = state.reached ? state.calls / state.reached : 0; const n = `jlt-node-${stage.id}`;
      return <button key={stage.id} id={n} data-testid={`step-node-${stage.id}`} onClick={() => onSelectStage(stage.id)} title={`${order}. ${stage.name}\n${stage.endpoint}`}
        className={`absolute flex flex-col rounded-xl border px-2.5 pt-2.5 text-left text-xs transition-colors [&>*]:shrink-0 ${selected ? 'border-slate-50 ring-2 ring-slate-50/60' : 'border-slate-700'}`}
        style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H, paddingBottom: LANE + 2, ...(level !== null && level > 0 && !selected ? { borderColor: loadColor(level) } : {}), background: level === null ? 'rgb(var(--c-slate-900))' : `linear-gradient(${loadColor(level, .16 + .3 * level)}, ${loadColor(level, .16 + .3 * level)}), rgb(var(--c-slate-900))` }}>
        <p id={`${n}-title`} className="line-clamp-2 font-semibold leading-snug text-slate-100"><span id={`${n}-order`} className="mr-1 text-slate-400">{order}</span><span id={`${n}-name`}>{stage.name}</span>{stage.repeat && <span id={`${n}-repeat`} className="ml-1 font-normal text-blue-300" title="전체 호출 수 · 사용자 1명당 평균 호출 수">↻ {state.calls}회{perUser > 0 && ` · 1인 ${perUser.toFixed(1)}회`}</span>}</p>
        <div id={`${n}-load`} className="mt-1 flex items-baseline justify-between" title={summary ? '실행 전체에서 이 단계 응답을 동시에 기다린 사용자 수의 최대값 · 1초 구간에 끝난 요청 수의 최대값' : '동시: 지금 이 단계 응답을 기다리는 서로 다른 가상 사용자 수 · 처리: 최근 1초에 끝난 요청 수'}>
          <span id={`${n}-users`} className="text-slate-300">{summary ? '최대 동시' : '동시'} <b id={`${n}-users-value`} className={`text-base ${state.users ? 'text-slate-50' : 'text-slate-400'}`}>{state.users}</b>명</span>
          <span id={`${n}-throughput`} className="text-slate-400">도달 <b id={`${n}-reached-value`} className="text-slate-200">{state.reached}</b> · {summary ? '최대 ' : ''}<b id={`${n}-throughput-value`} className="text-slate-200">{state.throughput}</b>/s</span>
        </div>
        <div id={`${n}-response`} className="mt-1.5 grid grid-cols-3 gap-1">
          <div id={`${n}-average`} className="rounded bg-slate-950/50 px-1.5 py-0.5"><p id={`${n}-average-label`} className="text-[10px] text-slate-400">평균 응답</p><p id={`${n}-average-value`} className="font-semibold text-slate-100">{Math.round(state.averageMs).toLocaleString()}<span id={`${n}-average-unit`} className="ml-0.5 text-[10px] font-normal text-slate-400">ms</span></p></div>
          <div id={`${n}-p95`} className="rounded bg-slate-950/50 px-1.5 py-0.5"><p id={`${n}-p95-label`} className="text-[10px] text-slate-400">p95 응답</p><p id={`${n}-p95-value`} className="font-semibold text-slate-100">{Math.round(state.p95Ms).toLocaleString()}<span id={`${n}-p95-unit`} className="ml-0.5 text-[10px] font-normal text-slate-400">ms</span></p></div>
          <div id={`${n}-slowdown`} className="rounded bg-slate-950/50 px-1.5 py-0.5"><p id={`${n}-slowdown-label`} className="text-[10px] text-slate-400">{summary ? '평소 대비 최대' : '평소 대비'}</p><p id={`${n}-slowdown-value`} className="font-semibold" style={{ color: level === null ? undefined : loadColor(level) }}>{state.slowdown === null ? '-' : `×${state.slowdown.toFixed(1)}`}</p></div>
        </div>
        <div id={`${n}-badges`} className="mt-1 flex flex-wrap gap-1">
          {state.errors > 0 && !(badges.get(stage.id) ?? []).some(badge => badge.tone === 'error') && <span id={`${n}-errors`} className="text-red-300">오류 {state.errors}건</span>}
          {stops > 0 && <span id={`${n}-halts`} className="rounded bg-red-500/20 px-1 text-red-200">⛔ 중단 {stops}</span>}
          {(badges.get(stage.id) ?? []).map((badge, at) => <span key={badge.text} id={`${n}-badge-${at}`} data-testid="final-badge" className={`rounded px-1 ${badge.tone === 'error' ? 'bg-red-500/20 text-red-200' : 'bg-orange-500/20 text-orange-200'}`} title="테스트 종료 후 최종 결과 기준">{badge.text}</span>)}
        </div>
      </button>; })}
    <div id="jlt-flow-end" className="absolute rounded-xl border border-emerald-500/50 bg-slate-900 p-3 text-xs" style={{ left: slots[slots.length - 1].x, top: slots[slots.length - 1].y, width: NODE_W, height: NODE_H }}>
      <p id="jlt-flow-end-title" className="font-semibold text-emerald-200">✔ 완료</p>
      <p id="jlt-flow-end-count" className="mt-2 text-lg font-semibold text-slate-100">{finished}<span id="jlt-flow-end-started" className="ml-1 text-xs font-normal text-slate-400">/ {started}명</span></p>
      {halts.length > 0 && <p id="jlt-flow-end-halted" className="mt-1 text-red-200">⛔ 오류로 중단된 사용자 {halts.length}명</p>}
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
  return <svg id="jlt-flow-tokens" className="pointer-events-none absolute inset-0" width={width} height={height}>
    {items.map(item => { const dim = focusRun && item.visit && focusRun !== item.visit.correlationId; const focused = !!item.visit && focusRun === item.visit.correlationId;
      return <g key={item.key} id={`jlt-token-${item.key}`} data-testid={`user-token-${item.label}`} className="pointer-events-auto cursor-pointer" opacity={dim ? .25 : 1} onClick={() => item.visit && onSelectVisit(item.visit)}>
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

/** One row of the visual guide: a sample of what is drawn, its name, and one line of meaning. */
function GuideRow({ id, sample, name, meaning }: { id: string; sample: React.ReactNode; name: string; meaning: string }) {
  return <tr id={id} className="border-t border-slate-800"><td id={`${id}-sample`} className="w-56 py-1.5 pl-3">{sample}</td><td id={`${id}-name`} className="w-32 font-semibold text-slate-200">{name}</td><td id={`${id}-meaning`} className="pr-3 text-slate-400">{meaning}</td></tr>;
}
const Cell = ({ id, label, value, color }: { id: string; label: string; value: string; color?: string }) => <span id={id} className="inline-block rounded bg-slate-950/60 px-1.5 py-0.5 align-middle"><span id={`${id}-label`} className="block text-[10px] text-slate-400">{label}</span><span id={`${id}-value`} className="block font-semibold text-slate-100" style={color ? { color } : undefined}>{value}</span></span>;

/** Visual guide for the flow views (replaces prose): node colors and figures, then (step flow) user tokens. */
export function FlowGuide({ style, view }: { style: TokenStyle; view: 'pipeline' | 'roundtrip' }) {
  const g = 'jlt-flow-guide';
  return <details id={g} className="mb-3 rounded-lg border border-slate-700 bg-slate-950/40 text-xs" open>
    <summary id={`${g}-summary`} className="cursor-pointer px-3 py-2 font-semibold">보는 법</summary>
    <table id={`${g}-table`} className="w-full border-t border-slate-700/70"><tbody id={`${g}-body`}>
      <GuideRow id={`${g}-color`} name="노드 색 = 평소 대비" meaning="이 API의 지금 응답시간 ÷ 이번 실행에서의 평소(중앙값). 다른 API와 비교하지 않습니다. 사용자가 몰려도 응답이 평소대로면 파랑입니다."
        sample={<span id={`${g}-color-swatches`} className="flex items-center gap-1">{[[0, '×1.2↓'], [.5, '×1.6'], [1, '×2↑']].map(([level, label]) => <span key={label} id={`${g}-color-${String(level).replace('.', '_')}`} className="rounded border px-1.5 py-0.5 text-[10px] font-semibold text-slate-100" style={{ background: loadColor(level as number, .16 + .3 * (level as number)), borderColor: loadColor(level as number) }}>{label}</span>)}<span id={`${g}-color-none`} className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-400">요청 없음·평소 없음(5건 미만)</span></span>} />
      <GuideRow id={`${g}-users`} name="동시 n명" meaning="지금 이 단계 응답을 기다리는 사용자 수. 색과 무관합니다."
        sample={<span id={`${g}-users-example`} className="text-slate-300">동시 <b id={`${g}-users-example-value`} className="text-base text-slate-50">7</b>명</span>} />
      <GuideRow id={`${g}-cells`} name="응답 칸" meaning="호출 1회 기준 평균·p95 응답시간과 평소 대비 배율."
        sample={<span id={`${g}-cells-example`} className="flex gap-1"><Cell id={`${g}-cell-average`} label="평균 응답" value="163ms" /><Cell id={`${g}-cell-p95`} label="p95 응답" value="169ms" /><Cell id={`${g}-cell-slowdown`} label="평소 대비" value="×1.0" color={loadColor(0)} /></span>} />
      {view === 'pipeline' && <GuideRow id={`${g}-arrow`} name="화살표 숫자" meaning="이 단계에 도달한 사용자 수."
        sample={<svg id={`${g}-arrow-example`} width={90} height={18}><path d="M4,12H70" style={{ stroke: 'rgb(var(--c-slate-600))' }} strokeWidth={1.5} markerEnd="url(#jlt-arrow)" /><text x={37} y={8} textAnchor="middle" fontSize={10} style={{ fill: 'var(--ink-muted)' }}>10명</text></svg>} />}
      {view === 'roundtrip' && <GuideRow id={`${g}-lines`} name="실선 · 점선" meaning="JMeter → API 요청 / API → JMeter 응답. 빨간 점선 = 오류 응답."
        sample={<svg id={`${g}-lines-example`} width={150} height={18}><path d="M4,6H60" style={{ stroke: 'rgb(var(--c-slate-600))' }} strokeWidth={1.5} /><path d="M80,6H140" style={{ stroke: 'rgb(var(--c-slate-600))' }} strokeWidth={1.5} strokeDasharray="6 6" /><path d="M80,14H140" style={{ stroke: 'rgb(var(--c-red-400))' }} strokeWidth={1.5} strokeDasharray="6 6" /></svg>} />}
      <GuideRow id={`${g}-repeat`} name="반복 단계" meaning="전체 호출 수 · 사용자 1명당 호출 수."
        sample={<span id={`${g}-repeat-example`} className="text-blue-300">↻ 67회 · 1인 6.7회</span>} />
      <GuideRow id={`${g}-badges`} name="비교 배지" meaning="테스트가 끝난 뒤 최종 결과로만 붙습니다."
        sample={<span id={`${g}-badges-example`} className="flex flex-wrap gap-1"><span id={`${g}-badge-error`} className="rounded bg-red-500/20 px-1 text-red-200">✖ 오류 1건 (10.0%)</span><span id={`${g}-badge-avg`} className="rounded bg-orange-500/20 px-1 text-orange-200">⏱ 평균 최대</span><span id={`${g}-badge-p95`} className="rounded bg-orange-500/20 px-1 text-orange-200">⚠ p95 최대</span></span>} />
      <GuideRow id={`${g}-completed`} name="실행 완료" meaning="기록 끝에서는 각 단계의 최대치(최대 동시·최대 처리·평소 대비 최대)를 보여 줍니다. 재생 위치를 옮기면 그 시점 값."
        sample={<span id={`${g}-completed-example`} className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-semibold text-emerald-200">✔ 실행 완료 · 최대치</span>} />
    </tbody></table>
    {view === 'pipeline' && <>
      <p id="jlt-token-legend-summary" className="border-t border-slate-700/70 px-3 py-2 font-semibold">사용자 토큰 <span id="jlt-token-legend-hint" className="font-normal text-slate-400">— 하나 = 가상 사용자 한 명(숫자 = 스레드 번호), 노드당 최대 {style === 'chip' ? 11 : 29}개 후 +n</span></p>
      <table id="jlt-token-legend-table" className="w-full"><tbody id="jlt-token-legend-body">{(Object.keys(STATE_TEXT) as TokenState[]).map(state => <tr key={state} id={`jlt-token-legend-${state}`} className="border-t border-slate-800">
        <td id={`jlt-token-legend-${state}-sample`} className="w-56 py-1.5 pl-3"><svg id={`jlt-token-legend-${state}-shape`} width={style === 'chip' ? 34 : 16} height={20}><TokenShape style={style} state={state} x={2} y={2} label="7" progress={state === 'slow' ? 1 : .55} /></svg></td>
        <td id={`jlt-token-legend-${state}-name`} className="w-32 font-semibold text-slate-200">{STATE_TEXT[state].name}</td><td id={`jlt-token-legend-${state}-meaning`} className="pr-3 text-slate-400">{STATE_TEXT[state].meaning}</td></tr>)}</tbody></table>
    </>}
  </details>;
}

export default function FlowPipeline(props: {
  stages: StageDefinition[]; states: StepState[]; started: number; finished: number; plannedUsers: number; halts: Halt[]; selectedStage: string | null; focusRun: string | null;
  clock: PlaybackClock; candidates: Visit[]; previous: Map<string, number>; tokenStyle: TokenStyle; badges: Map<string, Badge[]>; summary: boolean; showTokens: boolean; onSelectStage: (id: string) => void; onSelectVisit: (visit: Visit) => void;
}) {
  const host = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(1100);
  useEffect(() => { const el = host.current; if (!el) return; const observer = new ResizeObserver(([entry]) => setWidth(Math.max(560, entry.contentRect.width))); observer.observe(el); return () => observer.disconnect(); }, []);
  const { slots, height } = layout(props.stages.length + 2, width);
  const stepIndex = new Map(props.stages.map((stage, index) => [stage.id, index]));
  const stepAverage = new Map(props.states.map(state => [state.stepId, state.averageMs]));
  return <div id="jlt-flow-pipeline" ref={host} className="relative overflow-x-auto" style={{ height }}>
    <NodesLayer stages={props.stages} states={props.states} started={props.started} finished={props.finished} plannedUsers={props.plannedUsers} halts={props.halts} selectedStage={props.selectedStage} badges={props.badges} summary={props.summary} slots={slots} width={width} height={height} onSelectStage={props.onSelectStage} />
    {props.showTokens && <TokensLayer clock={props.clock} candidates={props.candidates} previous={props.previous} stepIndex={stepIndex} stepAverage={stepAverage} halts={props.halts} slots={slots} width={width} height={height} style={props.tokenStyle} focusRun={props.focusRun} stages={props.stages} onSelectVisit={props.onSelectVisit} />}
  </div>;
}
