import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopologyCanvas, { canvasHeightFor, type CanvasHit, type LoadSettings, type StageDefinition, type StageMetric } from './TopologyCanvas';
import { loadColor, PlaybackClock, ThemeSelect, Tile, TimelineScrubber, useClock } from './FlowParts';
import AggregateReport from './plan/AggregateReport';
import ResultsTree from './plan/ResultsTree';
import UserTimeline from './plan/UserTimeline';
import ThreadSettings from './plan/ThreadSettings';
import TimeSeriesCharts from './plan/TimeSeriesCharts';
import FlowPipeline, { FlowGuide, TRAVEL_MS, type TokenStyle } from './plan/FlowPipeline';
import ErrorSummary from './plan/ErrorSummary';
import StepSummaryStrip from './plan/StepSummaryStrip';
import StepHeatmap from './plan/StepHeatmap';
import { aggregateReport, finalBadges, flowAt, stagesOf, stepPeaks, stepStates, timeSeries, type Badge, type Visit } from '../services/flowModel';
import type { PlanFlow } from '../hooks/usePlanFlow';

/** Live mode draws this far behind the wall clock so that, given the Backend
 * Listener flush interval (1 s by default), a step's measured result has
 * usually arrived before the cursor reaches the end of that step. */
const LIVE_DELAY_MS = 1500;
/** Statistics, charts and tables follow the playback position at this interval; only tokens move every frame. */
const STAT_INTERVAL_MS = 250;
const speeds = [0.05, 0.1, 0.25, 0.5, 1, 2] as const;
const policyText: Record<string, string> = { stoptest: '테스트 전체 중단', stoptestnow: '테스트 즉시 중단', stopthread: '해당 사용자 중단' };
const tabs = [['aggregate', '집계 보고서'], ['tree', '결과 트리'], ['users', '사용자 타임라인'], ['heatmap', '단계×시간 히트맵']] as const;
const flowTabs = [['pipeline', '단계 흐름', '사용자가 업무 단계를 따라 이동하는 모습'], ['roundtrip', '요청·응답 왕복', 'JMeter와 각 API 사이를 오가는 요청과 응답']] as const;
const timeOfDay = (value: number) => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const TOKEN_STYLE_KEY = 'jlt-token-style';
const readTokenStyle = (): TokenStyle => { try { return localStorage.getItem(TOKEN_STYLE_KEY) === 'person' ? 'person' : 'chip'; } catch { return 'chip'; } };

export function PlanUpload({ onUpload }: { onUpload: (file: File) => Promise<void> }) {
  const [error, setError] = useState('');
  return <label id="jlt-plan-upload" className="cursor-pointer rounded-lg border border-blue-400/50 px-2.5 py-1 text-xs font-semibold text-blue-200 hover:bg-blue-500/10" title={error || '테스트 시작 시 리스너가 테스트 계획을 자동으로 보냅니다. 리스너 없이 기록만 볼 때 .jmx를 직접 선택하세요.'}>
    <input id="jlt-plan-upload-input" type="file" accept=".jmx" className="hidden" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { await onUpload(file); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }} />
    <span id="jlt-plan-upload-text">jmx 선택</span>{error && <span id="jlt-plan-upload-error" className="ml-2 text-red-300">{error}</span>}
  </label>;
}

export default function PlanFlowView({ flow }: { flow: PlanFlow }) {
  const viewing = flow.viewRun;
  const store = viewing?.store ?? flow.store;
  const version = viewing ? viewing.store.version : flow.version;
  const plan = viewing?.plan ?? flow.plan!;
  const [groupId, setGroupId] = useState(plan.threadGroups[0].id);
  const group = plan.threadGroups.find(item => item.id === groupId) ?? plan.threadGroups[0];
  const stages = useMemo(() => stagesOf(group), [group]);
  const visits = useMemo(() => store.visits(group.id), [store, version, group.id]);
  const halts = useMemo(() => [...store.haltsOf(group.id)], [store, version, group.id]);
  const test = useMemo(() => ({ ...store.test }), [store, version]);
  const unmatched = store.unmatched;
  const range = useMemo(() => {
    if (!visits.length) return null;
    let max = visits[0].start + 1; for (const visit of visits) max = Math.max(max, visit.end ?? visit.start);
    return { min: visits[0].start, max };
  }, [visits]);

  // Playback: the clock moves every frame; React state follows it every STAT_INTERVAL_MS.
  const playback = useRef(new PlaybackClock(Date.now() - LIVE_DELAY_MS)).current;
  const [statCursor, setStatCursor] = useState(playback.cursor);
  const [mode, setModeState] = useState<'live' | 'replay'>('live');
  const [playing, setPlayingState] = useState(true);
  const [speed, setSpeedState] = useState(0.25);
  const modeRef = useRef(mode); const playingRef = useRef(playing); const speedRef = useRef(speed);
  const rangeRef = useRef(range); rangeRef.current = range;
  const endedRef = useRef(test.ended); endedRef.current = test.ended;
  const setMode = useCallback((next: 'live' | 'replay') => { modeRef.current = next; setModeState(next); }, []);
  const setPlaying = useCallback((next: boolean) => { playingRef.current = next; setPlayingState(next); }, []);
  const setSpeed = (next: number) => { speedRef.current = next; setSpeedState(next); };
  const moveTo = useCallback((time: number) => { playback.set(time); setStatCursor(time); }, [playback]);
  useEffect(() => {
    let frame = 0; let last = performance.now(); let lastStat = 0;
    const tick = (now: number) => {
      const delta = now - last; last = now;
      const span = rangeRef.current;
      if (modeRef.current === 'live') {
        // After the test ends, live mode stops at the last recorded moment instead of following the wall clock.
        playback.set(endedRef.current && span ? Math.min(Date.now() - LIVE_DELAY_MS, span.max) : Date.now() - LIVE_DELAY_MS);
      } else if (playingRef.current && span) {
        const next = Math.min(span.max, playback.cursor + delta * speedRef.current);
        playback.set(next);
        if (next >= span.max) setPlaying(false);
      }
      if (now - lastStat >= STAT_INTERVAL_MS) { lastStat = now; setStatCursor(playback.cursor); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playback, setPlaying]);
  /** Timeline-bar control: keeps playing if it was playing (live counts as playing); stays paused otherwise. */
  const seek = useCallback((time: number) => { if (modeRef.current === 'live') { setMode('replay'); setPlaying(true); } moveTo(time); }, [moveTo, setMode, setPlaying]);
  /** Inspection jumps (a sample, a step): pause at that moment. */
  const pauseAt = useCallback((time: number) => { setMode('replay'); setPlaying(false); moveTo(time); }, [moveTo, setMode, setPlaying]);
  const togglePlay = () => {
    if (modeRef.current === 'live') { setMode('replay'); setPlaying(false); return; }
    if (!playingRef.current && range && playback.cursor >= range.max) moveTo(range.min);
    setPlaying(!playingRef.current);
  };
  const replayFromStart = () => { if (!range) return; setMode('replay'); moveTo(range.min); setPlaying(true); };
  const goLive = () => { void flow.selectRun(null); setMode('live'); setPlaying(true); };
  // A stored run always opens paused at its beginning.
  useEffect(() => { if (!viewing) { setMode('live'); setPlaying(true); return; } setMode('replay'); setPlaying(false); setFocusRun(null); setSelectedVisitId(null); }, [viewing, setMode, setPlaying]);
  useEffect(() => { if (viewing && range) moveTo(range.min); }, [viewing, range?.min]);

  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [focusRun, setFocusRun] = useState<string | null>(null);
  const [selectedVisitId, setSelectedVisitId] = useState<string | null>(null);
  const [tab, setTab] = useState<(typeof tabs)[number][0]>('aggregate');
  const [flowTab, setFlowTab] = useState<(typeof flowTabs)[number][0]>('pipeline');
  const [tokenStyle, setTokenStyleState] = useState<TokenStyle>(readTokenStyle);
  const setTokenStyle = (next: TokenStyle) => { setTokenStyleState(next); try { localStorage.setItem(TOKEN_STYLE_KEY, next); } catch { /* storage unavailable */ } };

  const report = useMemo(() => aggregateReport(visits, stages, statCursor), [visits, stages, statCursor]);
  const byId = useMemo(() => new Map(visits.map(visit => [visit.id, visit])), [visits]);
  const flowState = useMemo(() => stepStates(visits, stages, statCursor), [visits, stages, statCursor]);
  const chartTo = range ? (mode === 'live' && !test.ended ? Math.max(range.max, statCursor) : range.max) : statCursor;
  const series = useMemo(() => range ? timeSeries(visits, range.min, chartTo, selectedStage) : null, [visits, range, chartTo, selectedStage]);
  const now = series && range && statCursor >= range.min ? series.points[Math.min(series.points.length - 1, Math.floor((statCursor - range.min) / series.bucketMs))] : null;
  const plannedUsers = useMemo(() => Math.max(group.threads ?? 0, new Set(visits.map(visit => visit.thread)).size), [group.threads, visits]);
  // Requests that can be on screen before the next statistics tick; the per-frame layers only scan these.
  const candidates = useMemo(() => { const window = 1500 + STAT_INTERVAL_MS * speed * 2; return visits.filter(visit => visit.start <= statCursor + window && (visit.end === null || visit.end >= statCursor - window)); }, [visits, statCursor, speed]);
  // For each request, the step its user came from (-1 = JMeter start), for the travel animation.
  const previous = useMemo(() => { const stepIndex = new Map(stages.map((stage, index) => [stage.id, index])); const last = new Map<string, number>(); const from = new Map<string, number>(); visits.forEach(visit => { from.set(visit.id, last.get(visit.correlationId) ?? -1); last.set(visit.correlationId, stepIndex.get(visit.stepId) ?? -1); }); return from; }, [visits, stages]);
  // Completed run at its last moment: show each step's peaks (a static summary) instead of the last instant.
  const peaks = useMemo(() => test.ended ? stepPeaks(visits, stages) : null, [test.ended, visits, stages]);
  // The timeline input moves in 10 ms steps, so dragging to the end can stop a few ms short of the last moment.
  const completed = !!range && !!peaks && statCursor >= range.max - 20;
  const shownSteps = completed ? peaks! : flowState.steps;
  const roundTripMetrics = useMemo(() => {
    if (flowTab !== 'roundtrip') return [];
    const metrics = flowAt(visits, stages, statCursor).metrics;
    return completed ? metrics.map((metric, index) => ({ ...metric, throughput: peaks![index].throughput, inFlight: 0, requestFlight: 0, responseFlight: 0 })) : metrics;
  }, [flowTab, visits, stages, statCursor, completed, peaks]);
  const visibleHalts = useMemo(() => halts.filter(halt => halt.at <= statCursor), [halts, statCursor]);
  // A completed run is a static summary: no user tokens (requests ending at the very last moment would otherwise linger).
  const tokenVisits = completed ? [] : candidates;
  // Same "users waiting" figure as the step-flow nodes, so both views show the same load.
  const roundTripUsers = useMemo(() => new Map(shownSteps.map(state => [state.stepId, state.users])), [shownSteps]);
  const roundTripSlowdowns = useMemo(() => new Map(shownSteps.map(state => [state.stepId, state.slowdown])), [shownSteps]);
  // Comparison badges use the final results and appear only once the test has ended.
  const badges = useMemo(() => test.ended ? finalBadges(visits, stages) : new Map<string, Badge[]>(), [test.ended, visits, stages]);
  const stepName = (stepId: string) => { const step = group.steps.find(item => item.id === stepId); return step ? `${step.order}. ${step.label}` : stepId; };
  const selectVisit = useCallback((visit: Visit) => { setSelectedVisitId(visit.id); setTab('tree'); }, []);
  const selectStage = useCallback((id: string | null) => { setSelectedStage(current => current === id ? null : id); }, []);
  const selectToken = useCallback((visit: Visit) => { setFocusRun(visit.correlationId); selectVisit(visit); }, [selectVisit]);
  /** Summary strip: select the step and bring its node into view (round-trip view: the canvas row). */
  const pickFromStrip = (id: string) => { setSelectedStage(id); document.querySelector(`[data-testid="step-node-${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); };
  /** Jump to the previous/next request start and select that sample (pauses). */
  const step = (direction: 1 | -1) => {
    const arrival = (visit: Visit) => visit.start + Math.min(TRAVEL_MS, visit.end === null ? TRAVEL_MS : (visit.end - visit.start) / 2);
    const ordered = focusRun ? visits.filter(visit => visit.correlationId === focusRun) : visits;
    const at = playback.cursor;
    const target = direction === 1 ? ordered.find(visit => arrival(visit) > at + 1) : [...ordered].reverse().find(visit => arrival(visit) < at - 1);
    if (!target) return;
    pauseAt(arrival(target)); setSelectedVisitId(target.id);
  };
  const stepRef = useRef(step); stepRef.current = step;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === 'ArrowRight') { event.preventDefault(); stepRef.current(1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); stepRef.current(-1); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, []);
  const selectedRow = selectedStage ? report.rows.find(row => row.stepId === selectedStage) : null;
  const errorCount = report.rows.reduce((sum, row) => sum + Math.round(row.errorPct * row.samples / 100), 0);

  return <main id="jlt-app" className="min-h-screen bg-slate-950 text-slate-100">
    <div id="jlt-theme-float" className="fixed right-2 top-2 z-50 rounded-lg shadow-lg"><ThemeSelect /></div>
    <div id="jlt-sticky" className="sticky top-0 z-30 border-b border-slate-700/70 bg-slate-950/95 backdrop-blur">
      <header id="jlt-header" className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 pr-28 pt-2 lg:px-8 lg:pr-28 min-[1500px]:pr-8">
        <div id="jlt-heading" className="min-w-0"><p id="jlt-brand" className="truncate text-[10px] font-semibold tracking-[.18em] text-blue-300">JMETER LIVE TRAFFIC · {plan.testPlan}</p><h1 id="jlt-title" className="truncate text-base font-bold leading-tight">{group.name}<span id="jlt-title-meta" className="ml-2 text-xs font-normal text-slate-400">{group.steps.length}개 단계 · 오류 시 동작: {group.onSampleError}</span></h1></div>
        <div id="jlt-sources" className="flex flex-wrap items-center gap-1.5">
          <select id="jlt-run-select" aria-label="실행 기록" value={viewing?.id ?? ''} onChange={event => { event.currentTarget.blur(); void flow.selectRun(event.target.value || null); }} className="max-w-[220px] rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs">
            <option id="jlt-run-option-live" value="">● 실시간 (현재 실행)</option>
            {flow.runs.map(run => <option key={run.id} id={`jlt-run-option-${run.id}`} value={run.id}>{timeOfDay(run.startedAt)} · {run.samples}건{run.errors ? ` · 오류 ${run.errors}` : ''}{run.live ? ' (현재)' : ''}</option>)}
          </select>
          {plan.threadGroups.length > 1 && <select id="jlt-thread-group-select" aria-label="Thread Group" value={group.id} onChange={event => { event.currentTarget.blur(); setGroupId(event.target.value); setSelectedStage(null); setFocusRun(null); }} className="max-w-[220px] rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs">{plan.threadGroups.map(item => <option key={item.id} id={`jlt-thread-group-option-${item.id}`} value={item.id}>{item.name}</option>)}</select>}
          <PlanUpload onUpload={flow.uploadPlan} />
        </div>
      </header>
      <section id="jlt-kpis" className="mx-auto grid max-w-7xl grid-cols-2 gap-1.5 px-4 py-1.5 sm:grid-cols-5 lg:px-8">
        <Tile id="jlt-kpi-status" label={viewing ? '저장된 기록' : mode === 'live' ? `실시간 (${LIVE_DELAY_MS / 1000}초 지연)` : `재생 ${speed}×`} value={!flow.connected ? 'collector 연결 끊김' : !test.started ? '시작 대기' : completed ? '실행 완료 · 최대치 표시' : test.ended ? '테스트 종료' : '테스트 실행 중'} red={!flow.connected} />
        <Tile id="jlt-kpi-active-users" label="활성 사용자" value={`${now?.active ?? 0} / ${plannedUsers}명`} />
        <Tile id="jlt-kpi-throughput" label="처리량" value={`${(now?.throughput ?? 0).toFixed(1)} req/s`} />
        <Tile id="jlt-kpi-p95" label="p95 응답시간 (누적)" value={`${Math.round(report.total.p95Ms).toLocaleString()} ms`} />
        <Tile id="jlt-kpi-errors" label="오류율 (누적)" value={`${report.total.errorPct.toFixed(1)}% · ${errorCount}건`} red={report.total.errorPct > 0} />
      </section>
      <section id="jlt-playback-section" className="mx-auto max-w-7xl px-4 pb-1.5 lg:px-8">
        <div id="jlt-playback" className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-1.5 py-1">
          <button id="jlt-live-button" onClick={goLive} title="실시간으로 돌아가기" className={`whitespace-nowrap rounded px-2 py-0.5 text-xs font-bold ${mode === 'live' ? 'bg-red-500/80 text-white' : 'bg-slate-700 text-slate-200'}`}>● 실시간</button>
          <button id="jlt-replay-button" onClick={replayFromStart} disabled={!range} title="기록 처음부터 재생" className="whitespace-nowrap rounded bg-blue-500 px-2 py-0.5 text-xs font-bold text-white disabled:opacity-40">⏮ 처음부터</button>
          <div id="jlt-playback-bar" className="min-w-[240px] flex-1">{range ? <LiveScrubber playback={playback} min={range.min} max={chartTo} playing={mode === 'live' || playing} onChange={seek} onPlayToggle={togglePlay} /> : <span id="jlt-playback-waiting" className="text-xs text-slate-400">JMeter 실행을 기다리는 중입니다. 테스트를 시작하면 바로 움직입니다.</span>}</div>
          <div id="jlt-speed" className="flex items-center gap-0.5 rounded bg-slate-800 p-0.5" title="재생 속도 (실시간 모드에는 적용되지 않음) · ←/→ 키 = 이전/다음 요청"><span id="jlt-speed-label" className="px-1 text-[10px] text-slate-400">속도</span>{speeds.map(value => <button key={value} id={`jlt-speed-${String(value).replace('.', '_')}`} data-testid={`speed-${value}`} onClick={() => setSpeed(value)} className={`rounded px-1 py-0.5 text-[11px] font-semibold ${speed === value ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>{value}×</button>)}</div>
        </div>
      </section>
      <section id="jlt-strip-section" className="mx-auto max-w-7xl px-4 pb-1.5 lg:px-8">
        <div id="jlt-strip-header" className="mb-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px]">
          <p id="jlt-strip-title" className="text-slate-300"><b id="jlt-strip-title-text" className="text-slate-100">전체 단계 요약</b><span id="jlt-strip-key" className="ml-3 inline-flex items-center gap-2 align-middle text-slate-400" title="칸을 누르면 그 단계로 이동합니다"><span id="jlt-strip-key-number" className="inline-flex items-center gap-1"><b id="jlt-strip-key-number-sample" className="rounded border border-slate-700 bg-slate-900 px-1 text-slate-50">44</b>{completed ? '최대 처리량 req/s' : '처리량 req/s'}</span><span id="jlt-strip-key-color" className="inline-flex items-center gap-0.5">{[0, .5, 1].map(level => <span key={level} id={`jlt-strip-key-color-${String(level).replace('.', '_')}`} className="inline-block h-3 w-4 rounded-sm" style={{ background: loadColor(level, .3 + .4 * level) }} />)}<span id="jlt-strip-key-color-label" className="ml-1">평소 대비 느려짐</span></span><span id="jlt-strip-key-error" className="inline-flex items-center gap-1"><span id="jlt-strip-key-error-dot" className="inline-block h-1.5 w-1.5 rounded-full bg-red-400" />오류</span></span></p>
          {selectedVisitId && byId.get(selectedVisitId) && <StepLabel visit={byId.get(selectedVisitId)!} name={stepName(byId.get(selectedVisitId)!.stepId)} />}
        </div>
        <StepSummaryStrip stages={stages} states={shownSteps} summary={completed} selectedStage={selectedStage} onPick={pickFromStrip} />
      </section>
    </div>
    <section id="jlt-notices" className="mx-auto max-w-7xl space-y-2 px-4 py-3 lg:px-8">
      <ThreadSettings group={group} visits={visits} testStartedAt={test.startedAt} />
      {visibleHalts.map((halt, index) => <div key={`${halt.correlationId}-${halt.at}`} id={`jlt-halt-${index}`} data-testid="halt-banner" className="rounded-xl border border-red-400/60 bg-red-500/10 px-4 py-3 text-sm text-red-100">⛔ <b id={`jlt-halt-${index}-step`}>{stepName(halt.stepId)}</b>에서 오류 → {policyText[halt.policy] ?? halt.policy} (on_sample_error={halt.policy}, {halt.correlationId})</div>)}
      {plan.warnings.length > 0 && <div id="jlt-plan-warnings" className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-4 py-3 text-xs text-amber-100"><p id="jlt-plan-warnings-title" className="font-semibold">jmx 해석 경고</p><ul id="jlt-plan-warnings-list" className="mt-1 list-disc pl-5">{plan.warnings.map((warning, index) => <li key={warning} id={`jlt-plan-warning-${index}`}>{warning}</li>)}</ul></div>}
      {unmatched > 0 && <div id="jlt-unmatched-warning" className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">테스트 계획에 없는 Sampler 결과 {unmatched}건이 들어왔습니다. 실행한 jmx와 화면의 테스트 계획이 같은지 확인하세요.</div>}
    </section>
    <section id="jlt-main" className="mx-auto max-w-7xl space-y-3 px-4 pb-4 lg:px-8">
      {series && range && <TimeSeriesCharts points={series.points} from={range.min} to={chartTo} cursor={statCursor} stepLabel={selectedStage ? stepName(selectedStage) : null} onSeek={seek} />}
      <ErrorSummary visits={visits} stages={stages} cursor={statCursor} onSelect={visit => { setSelectedStage(visit.stepId); selectToken(visit); }} />
      <div id="jlt-flow" className="rounded-2xl border border-slate-700 bg-slate-900/80 p-3 sm:p-4">
        <div id="jlt-flow-header" className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div id="jlt-flow-heading-row" className="flex flex-wrap items-center gap-3"><h2 id="jlt-flow-heading" className="text-base font-bold text-slate-100">업무 흐름</h2>
            <div id="jlt-flow-tabs" role="tablist" aria-label="업무 흐름 보기" className="inline-flex rounded-xl border border-slate-600 bg-slate-950 p-1">{flowTabs.map(([id, label, hint]) => <button key={id} id={`jlt-flow-tab-${id}`} role="tab" aria-selected={flowTab === id} onClick={() => setFlowTab(id)} className={`rounded-lg px-4 py-1.5 text-left transition-colors ${flowTab === id ? 'bg-blue-500 text-white shadow' : 'text-slate-300 hover:bg-slate-800'}`}><span id={`jlt-flow-tab-${id}-label`} className="block text-sm font-semibold">{label}</span><span id={`jlt-flow-tab-${id}-hint`} className={`block text-[11px] ${flowTab === id ? 'text-white/80' : 'text-slate-500'}`}>{hint}</span></button>)}</div></div>
          {completed && <span id="jlt-flow-completed" className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-200">✔ 실행 완료 · 최대치</span>}
          {flowTab === 'pipeline' && <div id="jlt-token-style" className="flex items-center gap-1 rounded-lg bg-slate-800 p-1 text-xs"><span id="jlt-token-style-label" className="px-1 text-slate-400">사용자 표시</span>{([['chip', '칩'], ['person', '사람 아이콘']] as const).map(([id, label]) => <button key={id} id={`jlt-token-style-${id}`} data-testid={`token-style-${id}`} onClick={() => setTokenStyle(id)} className={`rounded px-2 py-1 font-semibold ${tokenStyle === id ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>{label}</button>)}</div>}
        </div>
        <FlowGuide style={tokenStyle} view={flowTab} />
        {flowTab === 'pipeline' ? <>
          <FlowPipeline stages={stages} states={shownSteps} summary={completed} started={flowState.started} finished={flowState.finished} plannedUsers={plannedUsers} halts={visibleHalts} showTokens={!completed} selectedStage={selectedStage} focusRun={focusRun} clock={playback} candidates={tokenVisits} previous={previous} tokenStyle={tokenStyle} badges={badges} onSelectStage={selectStage} onSelectVisit={selectToken} />
        </> : <RoundTripView badges={badges} users={roundTripUsers} slowdowns={roundTripSlowdowns} summary={completed} playback={playback} candidates={tokenVisits} stages={stages} metrics={roundTripMetrics} loadSettings={{ virtualUsers: plannedUsers, rampUpSeconds: group.rampUpSeconds ?? undefined, loops: group.loops ?? undefined, durationSeconds: group.durationSeconds ?? undefined, journeys: flowState.started, requests: report.total.samples }} selectedStage={selectedStage} focusRun={focusRun} onSelectStage={id => selectStage(id)} onSelectVisit={visitId => { const visit = byId.get(visitId); if (visit) selectToken(visit); }} />}
      </div>
    </section>
    {selectedRow && <section id="jlt-selected-step-section" className="mx-auto max-w-7xl px-4 pb-3 lg:px-8"><div id="jlt-selected-step" className="rounded-xl border border-slate-400/40 bg-slate-900 p-4 text-sm"><div id="jlt-selected-step-header" className="flex items-start justify-between gap-3"><div id="jlt-selected-step-heading"><p id="jlt-selected-step-endpoint" className="text-xs text-slate-400">{stages.find(stage => stage.id === selectedStage)?.endpoint}</p><h3 id="jlt-selected-step-name" className="mt-1 font-bold">{stepName(selectedStage!)}</h3></div><button id="jlt-selected-step-close" onClick={() => setSelectedStage(null)} className="text-slate-400 hover:text-slate-100">✕</button></div>
      <p id="jlt-selected-step-stats" className="mt-2 text-slate-300">샘플 {selectedRow.samples}건 · 평균 {Math.round(selectedRow.averageMs)} ms · 중앙값 {Math.round(selectedRow.medianMs)} · 90% {Math.round(selectedRow.p90Ms)} · 95% {Math.round(selectedRow.p95Ms)} · 최소 {Math.round(selectedRow.minMs)} · 최대 {Math.round(selectedRow.maxMs)} · <span id="jlt-selected-step-errors" className={selectedRow.errorPct ? 'text-red-300' : ''}>오류 {selectedRow.errorPct.toFixed(2)}%</span></p></div></section>}
    <section id="jlt-tables-section" className="mx-auto max-w-7xl px-4 pb-8 lg:px-8"><div id="jlt-tables" className="rounded-2xl border border-slate-700 bg-slate-900/80 p-3 sm:p-5">
      <div id="jlt-tabs-bar" className="mb-3 flex gap-1 border-b border-slate-700">{tabs.map(([id, label]) => <button key={id} id={`jlt-tab-${id}`} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-blue-400 font-semibold text-slate-50' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{label}</button>)}</div>
      {tab === 'aggregate' && <AggregateReport rows={report.rows} total={report.total} selectedStage={selectedStage} onSelectStage={selectStage} />}
      {tab === 'tree' && <ResultsTree visits={visits} stages={stages} origin={range?.min ?? 0} cursor={statCursor} stageFilter={selectedStage} onStageFilter={setSelectedStage} selected={selectedVisitId ? byId.get(selectedVisitId) ?? null : null} onSelect={visit => setSelectedVisitId(visit.id)} onSeek={pauseAt} focusRun={focusRun} onFocusRun={setFocusRun} />}
      {tab === 'heatmap' && (range ? <StepHeatmap visits={visits} stages={stages} from={range.min} to={chartTo} cursor={statCursor} selectedStage={selectedStage} onPick={(id, time) => { setSelectedStage(id); pauseAt(time); }} /> : <p id="jlt-heatmap-empty" className="text-sm text-slate-400">아직 기록이 없습니다.</p>)}
      {tab === 'users' && (range ? <UserTimeline visits={visits} stages={stages} range={range} cursor={statCursor} selectedStage={selectedStage} focusRun={focusRun} onFocusRun={setFocusRun} onSelect={selectVisit} onSeek={seek} /> : <p id="jlt-user-timeline-empty" className="text-sm text-slate-400">아직 기록이 없습니다.</p>)}
    </div></section>
  </main>;
}

/** The timeline bar follows the frame clock without re-rendering the dashboard. */
function LiveScrubber({ playback, ...props }: { playback: PlaybackClock; min: number; max: number; playing: boolean; onChange: (value: number) => void; onPlayToggle: () => void }) {
  const cursor = useClock(playback);
  return <TimelineScrubber id="jlt-timeline" value={cursor} {...props} max={Math.max(props.max, Math.min(cursor, props.max))} />;
}

/** The earlier generator-to-API round-trip view, redrawn every frame from the nearby requests only. */
function RoundTripView({ badges, users, slowdowns, summary, playback, candidates, stages, metrics, loadSettings, selectedStage, focusRun, onSelectStage, onSelectVisit }: {
  badges: Map<string, Badge[]>; users: Map<string, number>; slowdowns: Map<string, number | null>; summary: boolean; playback: PlaybackClock; candidates: Visit[]; stages: StageDefinition[]; metrics: StageMetric[]; loadSettings: LoadSettings; selectedStage: string | null; focusRun: string | null;
  onSelectStage: (id: string) => void; onSelectVisit: (visitId: string) => void;
}) {
  const cursor = useClock(playback);
  const host = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(1100);
  useEffect(() => { const el = host.current; if (!el) return; const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width))); observer.observe(el); return () => observer.disconnect(); }, []);
  const tokens = flowAt(candidates, stages, cursor).tokens;
  const onSelect = (hit: CanvasHit | null) => { if (!hit) return; if (hit.kind === 'stage') onSelectStage(hit.id); else onSelectVisit(hit.id); };
  return <div id="jlt-flow-roundtrip" ref={host} className="max-h-[760px] overflow-y-auto">
    <TopologyCanvas id="jlt-roundtrip-canvas" badges={badges} users={users} slowdowns={slowdowns} summary={summary} width={width - 2} height={canvasHeightFor(stages.length)} tokens={tokens} metrics={metrics} stages={stages} currentTime={cursor} loadSettings={loadSettings} selectedStage={selectedStage} focusRun={focusRun} onSelect={onSelect} />
  </div>;
}

function StepLabel({ visit, name }: { visit: Visit; name: string }) {
  return <span id="jlt-step-current" title="선택한 요청 (← → 키로 이전·다음 요청)" className="max-w-full truncate rounded bg-slate-800 px-2 py-0.5 text-slate-200">선택한 요청: {name} · {visit.end === null ? '처리 중' : `${visit.durationMs.toLocaleString()} ms`}{visit.end !== null && !visit.success ? ` · 오류 ${visit.status}` : ''} · {visit.correlationId}</span>;
}
