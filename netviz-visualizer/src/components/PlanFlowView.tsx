import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopologyCanvas, { canvasHeightFor, type CanvasHit, type LoadSettings, type StageDefinition, type StageMetric } from './TopologyCanvas';
import { clock as formatClock, PlaybackClock, ThemeSelect, Tile, TimelineScrubber, useClock } from './FlowParts';
import AggregateReport from './plan/AggregateReport';
import ResultsTree from './plan/ResultsTree';
import UserTimeline from './plan/UserTimeline';
import ThreadSettings from './plan/ThreadSettings';
import TimeSeriesCharts from './plan/TimeSeriesCharts';
import FlowPipeline, { TokenLegend, TRAVEL_MS, type TokenStyle } from './plan/FlowPipeline';
import ErrorSummary from './plan/ErrorSummary';
import { aggregateReport, flowAt, stagesOf, stepStates, timeSeries, type Visit } from '../services/flowModel';
import type { PlanFlow } from '../hooks/usePlanFlow';

/** Live mode draws this far behind the wall clock so that, given the Backend
 * Listener flush interval (1 s by default), a step's measured result has
 * usually arrived before the cursor reaches the end of that step. */
const LIVE_DELAY_MS = 1500;
/** Statistics, charts and tables follow the playback position at this interval; only tokens move every frame. */
const STAT_INTERVAL_MS = 250;
const speeds = [0.05, 0.1, 0.25, 0.5, 1, 2, 4] as const;
const policyText: Record<string, string> = { stoptest: '테스트 전체 중단', stoptestnow: '테스트 즉시 중단', stopthread: '해당 사용자 중단' };
const tabs = [['aggregate', '집계 보고서'], ['tree', '결과 트리'], ['users', '사용자 타임라인']] as const;
const flowTabs = [['pipeline', '업무 흐름 (단계 연결)'], ['roundtrip', 'API 왕복 (이전 화면)']] as const;
const timeOfDay = (value: number) => new Date(value).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const TOKEN_STYLE_KEY = 'jlt-token-style';
const readTokenStyle = (): TokenStyle => { try { return localStorage.getItem(TOKEN_STYLE_KEY) === 'person' ? 'person' : 'chip'; } catch { return 'chip'; } };

export function PlanUpload({ onUpload }: { onUpload: (file: File) => Promise<void> }) {
  const [error, setError] = useState('');
  return <label id="jlt-plan-upload" className="cursor-pointer rounded-lg border border-blue-400/50 px-3 py-1.5 text-xs font-semibold text-blue-200 hover:bg-blue-500/10" title={error || '테스트 시작 시 리스너가 테스트 계획을 자동으로 보냅니다. 리스너 없이 기록만 볼 때 .jmx를 직접 등록하세요.'}>
    <input type="file" accept=".jmx" className="hidden" onChange={async event => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { await onUpload(file); setError(''); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } }} />
    jmx 등록{error && <span className="ml-2 text-red-300">{error}</span>}
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
  const [speed, setSpeedState] = useState(1);
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
  const roundTripMetrics = useMemo(() => flowTab === 'roundtrip' ? flowAt(visits, stages, statCursor).metrics : [], [flowTab, visits, stages, statCursor]);
  const visibleHalts = useMemo(() => halts.filter(halt => halt.at <= statCursor), [halts, statCursor]);
  const stepName = (stepId: string) => { const step = group.steps.find(item => item.id === stepId); return step ? `${step.order}. ${step.label}` : stepId; };
  const selectVisit = useCallback((visit: Visit) => { setSelectedVisitId(visit.id); setTab('tree'); }, []);
  const selectStage = useCallback((id: string | null) => { setSelectedStage(current => current === id ? null : id); }, []);
  const selectToken = useCallback((visit: Visit) => { setFocusRun(visit.correlationId); selectVisit(visit); }, [selectVisit]);
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
    <div id="jlt-sticky" className="sticky top-0 z-30 border-b border-slate-700/70 bg-slate-950/95 backdrop-blur">
      <header id="jlt-header" className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 pt-3 lg:px-8">
        <div><p id="jlt-brand" className="text-xs font-semibold tracking-[.18em] text-blue-300">JMETER LIVE TRAFFIC · {plan.testPlan}</p><h1 id="jlt-title" className="mt-.5 text-lg font-bold">{group.name}</h1><p className="text-xs text-slate-400">{group.steps.length}개 단계 · 오류 시 동작: {group.onSampleError}</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <select id="jlt-run-select" aria-label="실행 기록" value={viewing?.id ?? ''} onChange={event => { event.currentTarget.blur(); void flow.selectRun(event.target.value || null); }} className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs">
            <option value="">● 실시간 (현재 실행)</option>
            {flow.runs.map(run => <option key={run.id} value={run.id}>{timeOfDay(run.startedAt)} · {run.samples}건{run.errors ? ` · 오류 ${run.errors}` : ''}{run.live ? ' (현재)' : ''}</option>)}
          </select>
          {plan.threadGroups.length > 1 && <select id="jlt-thread-group-select" aria-label="Thread Group" value={group.id} onChange={event => { event.currentTarget.blur(); setGroupId(event.target.value); setSelectedStage(null); setFocusRun(null); }} className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1.5 text-xs">{plan.threadGroups.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
          <PlanUpload onUpload={flow.uploadPlan} />
          <button id="jlt-live-button" onClick={goLive} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${mode === 'live' ? 'bg-red-500/80 text-white' : 'bg-slate-700 text-slate-200'}`}>● 실시간</button>
          <button id="jlt-replay-button" onClick={replayFromStart} disabled={!range} className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">⏮ 처음부터 재생</button>
          <div id="jlt-speed" className="flex items-center gap-1 rounded-lg bg-slate-800 p-1"><span className="px-1 text-[10px] text-slate-400">속도</span>{speeds.map(value => <button key={value} data-testid={`speed-${value}`} onClick={() => setSpeed(value)} className={`rounded px-1.5 py-1 text-[11px] font-semibold ${speed === value ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>{value}×</button>)}</div>
          <ThemeSelect />
        </div>
      </header>
      <section id="jlt-kpis" className="mx-auto grid max-w-7xl grid-cols-2 gap-2 px-4 py-2 sm:grid-cols-5 lg:px-8">
        <Tile id="jlt-kpi-status" label={viewing ? '저장된 기록' : mode === 'live' ? `실시간 (${LIVE_DELAY_MS / 1000}초 지연)` : `재생 ${speed}×`} value={!flow.connected ? 'collector 연결 끊김' : !test.started ? '시작 대기' : test.ended ? '테스트 종료' : '테스트 실행 중'} red={!flow.connected} />
        <Tile id="jlt-kpi-active-users" label="활성 사용자" value={`${now?.active ?? 0} / ${plannedUsers}명`} />
        <Tile id="jlt-kpi-throughput" label="처리량" value={`${(now?.throughput ?? 0).toFixed(1)} req/s`} />
        <Tile id="jlt-kpi-p95" label="p95 응답시간 (누적)" value={`${Math.round(report.total.p95Ms).toLocaleString()} ms`} />
        <Tile id="jlt-kpi-errors" label="오류율 (누적)" value={`${report.total.errorPct.toFixed(1)}% · ${errorCount}건`} red={report.total.errorPct > 0} />
      </section>
      <section className="mx-auto max-w-7xl space-y-2 px-4 pb-2 lg:px-8">
        {range && <LiveScrubber playback={playback} min={range.min} max={chartTo} playing={mode === 'live' || playing} speed={mode === 'live' ? 1 : speed} onChange={seek} onPlayToggle={togglePlay} />}
        <div id="jlt-step-controls" className="flex flex-wrap items-center gap-2 text-xs text-slate-400">{range && <><button id="jlt-step-prev" onClick={() => step(-1)} className="rounded bg-slate-700 px-2 py-1 text-slate-100 hover:bg-slate-600" title="이전 요청 (← 키)">◀ 이전 요청</button><button id="jlt-step-next" onClick={() => step(1)} className="rounded bg-slate-700 px-2 py-1 text-slate-100 hover:bg-slate-600" title="다음 요청 (→ 키)">다음 요청 ▶</button>{selectedVisitId && byId.get(selectedVisitId) && <StepLabel visit={byId.get(selectedVisitId)!} name={stepName(byId.get(selectedVisitId)!.stepId)} />}</>}<span>{range ? `기록 ${formatClock(Math.min(statCursor, range.max) - range.min)} / ${formatClock(range.max - range.min)}` : 'JMeter 실행을 기다리는 중입니다. 테스트를 시작하면 바로 움직입니다.'}</span>
          {focusRun && <button onClick={() => setFocusRun(null)} className="rounded-full border border-slate-400/60 px-2 py-0.5 text-slate-200">강조 중: {focusRun} ✕</button>}
          {selectedStage && <button onClick={() => setSelectedStage(null)} className="rounded-full border border-slate-400/60 px-2 py-0.5 text-slate-200">선택 단계: {stepName(selectedStage)} ✕</button>}</div>
      </section>
    </div>
    <section className="mx-auto max-w-7xl space-y-2 px-4 py-3 lg:px-8">
      <ThreadSettings group={group} visits={visits} testStartedAt={test.startedAt} />
      {visibleHalts.map(halt => <div key={`${halt.correlationId}-${halt.at}`} data-testid="halt-banner" className="rounded-xl border border-red-400/60 bg-red-500/10 px-4 py-3 text-sm text-red-100">⛔ <b>{stepName(halt.stepId)}</b>에서 오류 → {policyText[halt.policy] ?? halt.policy} (on_sample_error={halt.policy}, {halt.correlationId})</div>)}
      {plan.warnings.length > 0 && <div id="jlt-plan-warnings" className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-4 py-3 text-xs text-amber-100"><p className="font-semibold">jmx 해석 경고</p><ul className="mt-1 list-disc pl-5">{plan.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></div>}
      {unmatched > 0 && <div id="jlt-unmatched-warning" className="rounded-xl border border-amber-400/50 bg-amber-500/10 px-4 py-3 text-xs text-amber-100">테스트 계획에 없는 Sampler 결과 {unmatched}건이 들어왔습니다. 실행한 jmx와 화면의 테스트 계획이 같은지 확인하세요.</div>}
    </section>
    <section className="mx-auto max-w-7xl space-y-3 px-4 pb-4 lg:px-8">
      {series && range && <TimeSeriesCharts points={series.points} from={range.min} to={chartTo} cursor={statCursor} stepLabel={selectedStage ? stepName(selectedStage) : null} onSeek={seek} />}
      <ErrorSummary visits={visits} stages={stages} cursor={statCursor} onSelect={visit => { setSelectedStage(visit.stepId); selectToken(visit); }} />
      <div id="jlt-flow" className="rounded-2xl border border-slate-700 bg-slate-900/80 p-3 sm:p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div id="jlt-flow-tabs" className="flex gap-1">{flowTabs.map(([id, label]) => <button key={id} id={`jlt-flow-tab-${id}`} onClick={() => setFlowTab(id)} className={`rounded-lg px-3 py-1.5 text-sm ${flowTab === id ? 'bg-slate-700 font-semibold text-slate-50' : 'text-slate-400 hover:text-slate-200'}`}>{label}</button>)}</div>
          {flowTab === 'pipeline' && <div id="jlt-token-style" className="flex items-center gap-1 rounded-lg bg-slate-800 p-1 text-xs"><span className="px-1 text-slate-400">사용자 표시</span>{([['chip', '칩'], ['person', '사람 아이콘']] as const).map(([id, label]) => <button key={id} data-testid={`token-style-${id}`} onClick={() => setTokenStyle(id)} className={`rounded px-2 py-1 font-semibold ${tokenStyle === id ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-slate-700'}`}>{label}</button>)}</div>}
        </div>
        {flowTab === 'pipeline' ? <>
          <p className="mb-2 text-xs text-slate-400">화살표 숫자 = 그 단계에 도달한 사용자 · <b>체류 바(회색)</b> = 머문 시간의 비중, 반복 호출 포함 · <b>부하 바(파랑)</b> = 최근 1초 완료 요청(동시 사용자·처리량) · 같은 사용자가 여러 번 호출하는 ↻ 단계는 체류가 커도 부하는 낮습니다 · 노드 클릭 = 단계 선택</p>
          <TokenLegend style={tokenStyle} />
          <FlowPipeline stages={stages} states={flowState.steps} started={flowState.started} finished={flowState.finished} plannedUsers={plannedUsers} halts={visibleHalts} selectedStage={selectedStage} focusRun={focusRun} clock={playback} candidates={candidates} previous={previous} tokenStyle={tokenStyle} onSelectStage={selectStage} onSelectVisit={selectToken} />
        </> : <RoundTripView playback={playback} candidates={candidates} stages={stages} metrics={roundTripMetrics} loadSettings={{ virtualUsers: plannedUsers, rampUpSeconds: group.rampUpSeconds ?? undefined, loops: group.loops ?? undefined, durationSeconds: group.durationSeconds ?? undefined, journeys: flowState.started, requests: report.total.samples }} selectedStage={selectedStage} focusRun={focusRun} onSelectStage={id => selectStage(id)} onSelectVisit={visitId => { const visit = byId.get(visitId); if (visit) selectToken(visit); }} />}
      </div>
    </section>
    {selectedRow && <section className="mx-auto max-w-7xl px-4 pb-3 lg:px-8"><div id="jlt-selected-step" className="rounded-xl border border-slate-400/40 bg-slate-900 p-4 text-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs text-slate-400">{stages.find(stage => stage.id === selectedStage)?.endpoint}</p><h3 className="mt-1 font-bold">{stepName(selectedStage!)}</h3></div><button onClick={() => setSelectedStage(null)} className="text-slate-400 hover:text-slate-100">✕</button></div>
      <p className="mt-2 text-slate-300">샘플 {selectedRow.samples}건 · 평균 {Math.round(selectedRow.averageMs)} ms · 중앙값 {Math.round(selectedRow.medianMs)} · 90% {Math.round(selectedRow.p90Ms)} · 95% {Math.round(selectedRow.p95Ms)} · 최소 {Math.round(selectedRow.minMs)} · 최대 {Math.round(selectedRow.maxMs)} · <span className={selectedRow.errorPct ? 'text-red-300' : ''}>오류 {selectedRow.errorPct.toFixed(2)}%</span></p></div></section>}
    <section className="mx-auto max-w-7xl px-4 pb-8 lg:px-8"><div id="jlt-tables" className="rounded-2xl border border-slate-700 bg-slate-900/80 p-3 sm:p-5">
      <div className="mb-3 flex gap-1 border-b border-slate-700">{tabs.map(([id, label]) => <button key={id} id={`jlt-tab-${id}`} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === id ? 'border-blue-400 font-semibold text-slate-50' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>{label}</button>)}</div>
      {tab === 'aggregate' && <AggregateReport rows={report.rows} total={report.total} selectedStage={selectedStage} onSelectStage={selectStage} />}
      {tab === 'tree' && <ResultsTree visits={visits} stages={stages} origin={range?.min ?? 0} cursor={statCursor} stageFilter={selectedStage} onStageFilter={setSelectedStage} selected={selectedVisitId ? byId.get(selectedVisitId) ?? null : null} onSelect={visit => setSelectedVisitId(visit.id)} onSeek={pauseAt} focusRun={focusRun} onFocusRun={setFocusRun} />}
      {tab === 'users' && (range ? <UserTimeline visits={visits} stages={stages} range={range} cursor={statCursor} selectedStage={selectedStage} focusRun={focusRun} onFocusRun={setFocusRun} onSelect={selectVisit} onSeek={seek} /> : <p className="text-sm text-slate-400">아직 기록이 없습니다.</p>)}
    </div></section>
  </main>;
}

/** The timeline bar follows the frame clock without re-rendering the dashboard. */
function LiveScrubber({ playback, ...props }: { playback: PlaybackClock; min: number; max: number; playing: boolean; speed: number; onChange: (value: number) => void; onPlayToggle: () => void }) {
  const cursor = useClock(playback);
  return <TimelineScrubber id="jlt-timeline" compact value={cursor} {...props} max={Math.max(props.max, Math.min(cursor, props.max))} />;
}

/** The earlier generator-to-API round-trip view, redrawn every frame from the nearby requests only. */
function RoundTripView({ playback, candidates, stages, metrics, loadSettings, selectedStage, focusRun, onSelectStage, onSelectVisit }: {
  playback: PlaybackClock; candidates: Visit[]; stages: StageDefinition[]; metrics: StageMetric[]; loadSettings: LoadSettings; selectedStage: string | null; focusRun: string | null;
  onSelectStage: (id: string) => void; onSelectVisit: (visitId: string) => void;
}) {
  const cursor = useClock(playback);
  const host = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(1100);
  useEffect(() => { const el = host.current; if (!el) return; const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width))); observer.observe(el); return () => observer.disconnect(); }, []);
  const tokens = flowAt(candidates, stages, cursor).tokens;
  const onSelect = (hit: CanvasHit | null) => { if (!hit) return; if (hit.kind === 'stage') onSelectStage(hit.id); else onSelectVisit(hit.id); };
  return <div id="jlt-flow-roundtrip" ref={host} className="max-h-[760px] overflow-y-auto rounded-xl border border-slate-800">
    <TopologyCanvas width={width - 2} height={canvasHeightFor(stages.length)} tokens={tokens} metrics={metrics} stages={stages} currentTime={cursor} loadSettings={loadSettings} selectedStage={selectedStage} focusRun={focusRun} onSelect={onSelect} />
  </div>;
}

function StepLabel({ visit, name }: { visit: Visit; name: string }) {
  return <span id="jlt-step-current" className="rounded bg-slate-800 px-2 py-1 text-slate-200">{name} · {visit.end === null ? '처리 중' : `${visit.durationMs.toLocaleString()} ms`}{visit.end !== null && !visit.success ? ` · 오류 ${visit.status}` : ''} · {visit.correlationId}</span>;
}
