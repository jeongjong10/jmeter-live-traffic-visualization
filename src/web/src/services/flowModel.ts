import type { StageDefinition, StageMetric, TrafficToken } from '../components/TopologyCanvas';

/** One registered .jmx as parsed by the collector (src/collector/jmx_plan.py). */
export type PlanStep = { id: string; order: number; label: string; method: string; path: string; repeat: boolean };
export type PlanThreadGroup = { id: string; name: string; threads: number | null; rampUpSeconds: number | null; loops: number | null; durationSeconds: number | null; startDelaySeconds: number | null; scheduler: boolean; sameUserOnNextIteration: boolean; delayedStart: boolean; onSampleError: string; steps: PlanStep[] };
export type Plan = { testPlan: string; threadGroups: PlanThreadGroup[]; warnings: string[] };

export type FlowEvent = {
  eventType?: string; phase?: string; outcome?: string; journeyId?: string; stepId?: string; correlationId?: string;
  requestId?: string; jmeterThread?: string; startedAt?: number; timestamp?: number; durationMs?: number;
  success?: boolean; status?: number | string; estimated?: boolean; unmatched?: boolean;
  latency?: number; connect?: number; bytes?: number; failureMessage?: string;
};

/** A user's stay at one step: measured once JMeter reports it, estimated while open. */
export type Visit = { id: string; stepId: string; correlationId: string; thread: string; iteration: number; start: number; end: number | null; estimated: boolean; success: boolean; status: string; durationMs: number; latency: number; connect: number; bytes: number; failureMessage: string };
export type Halt = { stepId: string; correlationId: string; at: number; policy: string };

/** Visual-only travel time between the generator and an API, kept inside the measured span. */
const FLIGHT_MS = 170;

export function stagesOf(group: PlanThreadGroup): StageDefinition[] {
  return group.steps.map(step => ({ id: step.id, name: step.label, endpoint: step.method ? `${step.method} ${step.path}` : step.path, repeat: step.repeat, order: step.order }));
}

const percentile = (values: number[], q: number) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)] : 0;

/** Token positions and per-step metrics at `cursor`, using measured start/end times. */
export function flowAt(visits: Visit[], stages: StageDefinition[], cursor: number): { tokens: TrafficToken[]; metrics: StageMetric[] } {
  const threads = [...new Set(visits.map(visit => visit.thread))];
  const tokens: TrafficToken[] = [];
  const metrics = stages.map(({ id: stage }) => {
    const mine = visits.filter(visit => visit.stepId === stage && visit.start <= cursor);
    const done = mine.filter(visit => visit.end !== null && visit.end <= cursor);
    const durations = done.map(visit => visit.durationMs);
    const errors = done.filter(visit => !visit.success).length;
    let inFlight = 0; let requestFlight = 0; let responseFlight = 0;
    mine.forEach(visit => {
      const end = visit.end ?? Infinity;
      if (cursor >= end) return;
      const flight = visit.end === null ? FLIGHT_MS : Math.min(FLIGHT_MS, (end - visit.start) / 3);
      const base = { id: visit.id, stage, userIndex: threads.indexOf(visit.thread), runId: visit.correlationId, estimated: visit.estimated };
      if (cursor < visit.start + flight) { requestFlight++; tokens.push({ ...base, kind: 'request', progress: (cursor - visit.start) / flight, status: 'pending' }); }
      else if (cursor < end - flight) { inFlight++; tokens.push({ ...base, kind: 'processing', progress: 1, status: 'pending' }); }
      else { responseFlight++; tokens.push({ ...base, kind: 'response', progress: (cursor - (end - flight)) / flight, status: visit.success ? 'success' : 'error' }); }
    });
    return { stage, inbound: mine.length, inFlight, throughput: done.filter(visit => (visit.end ?? 0) > cursor - 1000).length, errors, errorRate: done.length ? Math.round(errors / done.length * 100) : 0, averageMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0, p95Ms: percentile(durations, .95), requestFlight, responseFlight };
  });
  return { metrics, tokens: tokens.slice(-80) };
}

/** One row of the JMeter "Aggregate Report" for samples finished by `cursor`. */
export type AggregateRow = { stepId: string; label: string; samples: number; averageMs: number; medianMs: number; p90Ms: number; p95Ms: number; p99Ms: number; minMs: number; maxMs: number; errorPct: number; throughput: number; receivedKBs: number };

function aggregateOf(stepId: string, label: string, done: Visit[]): AggregateRow {
  const durations = done.map(visit => visit.durationMs);
  const span = done.length ? (Math.max(...done.map(visit => visit.end ?? visit.start)) - Math.min(...done.map(visit => visit.start))) / 1000 : 0;
  const errors = done.filter(visit => !visit.success).length;
  return { stepId, label, samples: done.length, averageMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0, medianMs: percentile(durations, .5), p90Ms: percentile(durations, .9), p95Ms: percentile(durations, .95), p99Ms: percentile(durations, .99), minMs: durations.length ? Math.min(...durations) : 0, maxMs: durations.length ? Math.max(...durations) : 0, errorPct: done.length ? errors / done.length * 100 : 0, throughput: span > 0 ? done.length / span : 0, receivedKBs: span > 0 ? done.reduce((sum, visit) => sum + visit.bytes, 0) / 1024 / span : 0 };
}

export function aggregateReport(visits: Visit[], stages: StageDefinition[], cursor: number): { rows: AggregateRow[]; total: AggregateRow } {
  const done = visits.filter(visit => visit.end !== null && visit.end <= cursor);
  return { rows: stages.map(stage => aggregateOf(stage.id, stage.name, done.filter(visit => visit.stepId === stage.id))), total: aggregateOf('total', '합계', done) };
}

/** Per-step state at `cursor` for the pipeline view. Response times are per call (one sample), so repeated calls by one user do not inflate them. */
export type StepState = { stepId: string; reached: number; calls: number; inFlight: number; done: number; errors: number; averageMs: number; p95Ms: number; users: number; throughput: number;
  /** Response slowdown: what the step does now (median) ÷ its usual time this run (median of finished requests). Null until 5 requests finished, or when the step has no recent or open request. Drives the node color. */
  slowdown: number | null };

const SLOW_WINDOW_MS = 2000; const SLOW_MIN_SAMPLES = 5;
/** Below this the usual time is treated as this many ms, so a 2 ms → 5 ms change does not read as a slowdown. */
const SLOW_FLOOR_MS = 20;
/** "Usual" response time of a step in this run: the median of its finished requests. */
const SLOW_BASE_Q = .5;
const slowBase = (durations: number[]) => Math.max(SLOW_FLOOR_MS, percentile(durations, SLOW_BASE_Q));

/**
 * Median of what the step is doing now — requests finished in the last 2 s plus measured requests still open
 * (their elapsed time, so a stalled endpoint shows up) — over the step's usual time so far (median). An idle step has no value.
 */
export function slowdownAt(finished: Visit[], cursor: number, open: Visit[] = []): number | null {
  if (finished.length < SLOW_MIN_SAMPLES) return null;
  const recent = [...finished.filter(visit => visit.end! > cursor - SLOW_WINDOW_MS).map(visit => visit.durationMs), ...open.filter(visit => !visit.estimated).map(visit => cursor - visit.start)];
  if (!recent.length) return null;
  return percentile(recent, .5) / slowBase(finished.map(visit => visit.durationMs));
}

export function stepStates(visits: Visit[], stages: StageDefinition[], cursor: number): { steps: StepState[]; started: number; finished: number } {
  const shown = visits.filter(visit => visit.start <= cursor);
  const done = shown.filter(visit => visit.end !== null && visit.end <= cursor);
  const steps = stages.map(({ id }) => {
    const mine = shown.filter(visit => visit.stepId === id);
    const finished = done.filter(visit => visit.stepId === id);
    const durations = finished.map(visit => visit.durationMs);
    // Load: users = distinct virtual users with a request open right now, throughput = completions in the last second.
    const open = mine.filter(visit => visit.end === null || visit.end > cursor);
    return { stepId: id, reached: new Set(mine.map(visit => visit.correlationId)).size, calls: mine.length, inFlight: open.length, done: finished.length, errors: finished.filter(visit => !visit.success).length, averageMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0, p95Ms: percentile(durations, .95), users: new Set(open.map(visit => visit.correlationId)).size, throughput: finished.filter(visit => (visit.end ?? 0) > cursor - 1000).length, slowdown: slowdownAt(finished, cursor, open) };
  });
  const lastStep = stages[stages.length - 1]?.id;
  return { steps, started: new Set(shown.map(visit => visit.correlationId)).size, finished: new Set(done.filter(visit => visit.stepId === lastStep).map(visit => visit.correlationId)).size };
}

/** One time bucket of the over-time charts (JMeter dashboard "Over Time" graphs). */
export type SeriesPoint = { t: number; active: number; throughput: number; p50: number | null; p95: number | null; errors: number;
  p90: number | null; p99: number | null; errorPct: number | null;
  /** Average response-time parts of the bucket's samples: connect, server wait (latency - connect), receive (elapsed - latency). */
  connect: number | null; wait: number | null; receive: number | null;
  code2xx: number; code3xx: number; code4xx: number; code5xx: number; codeOther: number };
const NICE_BUCKETS = [250, 500, 1000, 2000, 5000, 10000, 30000, 60000];

/** Buckets from `from` to `to`; response times can be limited to one step, the other series cover all steps. */
export function timeSeries(visits: Visit[], from: number, to: number, stepId: string | null): { bucketMs: number; points: SeriesPoint[] } {
  const span = Math.max(1, to - from);
  const bucketMs = NICE_BUCKETS.find(size => span / size <= 150) ?? 60000;
  const spans = new Map<string, { first: number; last: number }>();
  visits.forEach(visit => { const end = visit.end ?? Infinity; const known = spans.get(visit.thread); spans.set(visit.thread, known ? { first: Math.min(known.first, visit.start), last: Math.max(known.last, end) } : { first: visit.start, last: end }); });
  const threadSpans = [...spans.values()];
  const count = Math.max(1, Math.ceil(span / bucketMs));
  const ended: Visit[][] = Array.from({ length: count }, () => []);
  visits.forEach(visit => { if (visit.end === null || visit.end < from || visit.end > to) return; ended[Math.min(count - 1, Math.floor((visit.end - from) / bucketMs))].push(visit); });
  return { bucketMs, points: ended.map((bucket, index) => {
    const t = from + (index + 1) * bucketMs;
    const scoped = stepId ? bucket.filter(visit => visit.stepId === stepId) : bucket;
    const timed = scoped.map(visit => visit.durationMs);
    const mean = (part: (visit: Visit) => number) => scoped.length ? scoped.reduce((sum, visit) => sum + Math.max(0, part(visit)), 0) / scoped.length : null;
    const codes = { code2xx: 0, code3xx: 0, code4xx: 0, code5xx: 0, codeOther: 0 };
    bucket.forEach(visit => { const code = Number(visit.status); if (code >= 200 && code < 300) codes.code2xx++; else if (code >= 300 && code < 400) codes.code3xx++; else if (code >= 400 && code < 500) codes.code4xx++; else if (code >= 500 && code < 600) codes.code5xx++; else codes.codeOther++; });
    const errors = bucket.filter(visit => !visit.success).length;
    return { t, active: threadSpans.filter(item => item.first <= t && item.last >= t - bucketMs).length, throughput: bucket.length / (bucketMs / 1000), p50: timed.length ? percentile(timed, .5) : null, p95: timed.length ? percentile(timed, .95) : null, errors,
      p90: timed.length ? percentile(timed, .9) : null, p99: timed.length ? percentile(timed, .99) : null, errorPct: bucket.length ? errors / bucket.length * 100 : null,
      connect: mean(visit => visit.connect), wait: mean(visit => visit.latency - visit.connect), receive: mean(visit => visit.durationMs - visit.latency), ...codes };
  }) };
}

/** Step x time grid for the heatmap: distinct users with a request open, completions, summed duration and errors per bucket. */
export type HeatGrid = { bucketMs: number; columns: number; users: number[][]; completions: number[][]; totalMs: number[][]; errors: number[][] };
const HEAT_BUCKETS = [250, 500, 1000, 2000, 5000, 10000, 30000, 60000];

export function stepHeatmap(visits: Visit[], stages: StageDefinition[], from: number, to: number): HeatGrid {
  const span = Math.max(1, to - from);
  const bucketMs = HEAT_BUCKETS.find(size => span / size <= 120) ?? 60000;
  const columns = Math.max(1, Math.ceil(span / bucketMs));
  const row = new Map(stages.map((stage, index) => [stage.id, index]));
  const grid = () => stages.map(() => new Array<number>(columns).fill(0));
  const users = stages.map(() => Array.from({ length: columns }, () => new Set<string>()));
  const completions = grid(); const totalMs = grid(); const errors = grid();
  const column = (time: number) => Math.min(columns - 1, Math.max(0, Math.floor((time - from) / bucketMs)));
  visits.forEach(visit => {
    const r = row.get(visit.stepId); if (r === undefined || visit.start > to) return;
    const last = column(Math.min(visit.end ?? to, to));
    for (let c = column(visit.start); c <= last; c++) users[r][c].add(visit.correlationId);
    if (visit.end !== null && visit.end <= to) { const c = column(visit.end); completions[r][c]++; totalMs[r][c] += visit.durationMs; if (!visit.success) errors[r][c]++; }
  });
  return { bucketMs, columns, users: users.map(cells => cells.map(set => set.size)), completions, totalMs, errors };
}

/** Comparison badges from the final results (whole run); shown only after the test has ended. */
export type Badge = { text: string; tone: 'error' | 'warn' };
export function finalBadges(visits: Visit[], stages: StageDefinition[]): Map<string, Badge[]> {
  const rows = aggregateReport(visits, stages, Infinity).rows.filter(row => row.samples > 0);
  const badges = new Map<string, Badge[]>(); const add = (stepId: string, badge: Badge) => badges.set(stepId, [...(badges.get(stepId) ?? []), badge]);
  const top = (value: (row: AggregateRow) => number) => rows.reduce<AggregateRow | null>((best, row) => !best || value(row) > value(best) ? row : best, null);
  rows.filter(row => row.errorPct > 0).forEach(row => add(row.stepId, { text: `✖ 오류 ${Math.round(row.errorPct * row.samples / 100)}건 (${row.errorPct.toFixed(1)}%)`, tone: 'error' }));
  const slowAvg = top(row => row.averageMs); if (slowAvg && slowAvg.averageMs > 0) add(slowAvg.stepId, { text: '⏱ 평균 최대', tone: 'warn' });
  const slowP95 = top(row => row.p95Ms); if (slowP95 && slowP95.p95Ms > 0) add(slowP95.stepId, { text: '⚠ p95 최대', tone: 'warn' });
  return badges;
}

/**
 * Completed-run summary: per step, the peak concurrent users (a sweep over request open/close times),
 * the peak throughput (most completions in any 1 s window) and the final per-call average, p95 and errors.
 * Requests that never finished (cancelled estimates) are left out so they cannot inflate the peak.
 */
export function stepPeaks(visits: Visit[], stages: StageDefinition[]): StepState[] {
  return stages.map(({ id }) => {
    const mine = visits.filter(visit => visit.stepId === id);
    const done = mine.filter(visit => visit.end !== null);
    const durations = done.map(visit => visit.durationMs);
    // Ends sort before starts at the same instant, so back-to-back requests of one user do not count twice.
    const edges = done.flatMap(visit => [[visit.start, 1], [visit.end!, -1]] as [number, number][]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let open = 0; let users = 0; edges.forEach(([, delta]) => { open += delta; users = Math.max(users, open); });
    const ends = done.map(visit => visit.end!).sort((a, b) => a - b);
    let throughput = 0; for (let head = 0, tail = 0; head < ends.length; head++) { while (ends[head] - ends[tail] >= 1000) tail++; throughput = Math.max(throughput, head - tail + 1); }
    return { stepId: id, reached: new Set(mine.map(visit => visit.correlationId)).size, calls: mine.length, inFlight: 0, done: done.length, errors: done.filter(visit => !visit.success).length,
      averageMs: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0, p95Ms: percentile(durations, .95), users, throughput, slowdown: peakSlowdown(done) };
  });
}

/**
 * Completed run: the largest value `slowdownAt` takes at any moment of the run, so the summary is never below
 * what playback showed. The value only changes when a request starts or ends, or leaves the 2 s window,
 * so it is evaluated just before and at each of those moments (one sweep, the baseline kept sorted).
 */
function peakSlowdown(done: Visit[]): number | null {
  if (done.length < SLOW_MIN_SAMPLES) return null;
  const byEnd = [...done].sort((a, b) => a.end! - b.end!); const byStart = [...done].sort((a, b) => a.start - b.start);
  const times = new Set<number>();
  done.forEach(visit => { times.add(visit.start - 1); times.add(visit.end! - 1); times.add(visit.end!); times.add(visit.end! + SLOW_WINDOW_MS - 1); });
  const base: number[] = []; const open = new Set<Visit>(); let started = 0; let ended = 0; let windowStart = 0; let peak = 0;
  for (const t of [...times].sort((a, b) => a - b)) {
    while (started < byStart.length && byStart[started].start <= t) open.add(byStart[started++]);
    while (ended < byEnd.length && byEnd[ended].end! <= t) {
      const visit = byEnd[ended++]; open.delete(visit);
      let low = 0; let high = base.length; while (low < high) { const mid = (low + high) >> 1; if (base[mid] < visit.durationMs) low = mid + 1; else high = mid; } base.splice(low, 0, visit.durationMs);
    }
    if (ended < SLOW_MIN_SAMPLES) continue;
    while (windowStart < ended && byEnd[windowStart].end! <= t - SLOW_WINDOW_MS) windowStart++;
    const recent = byEnd.slice(windowStart, ended).map(visit => visit.durationMs); open.forEach(visit => recent.push(t - visit.start));
    if (!recent.length) continue;
    const baseline = Math.max(SLOW_FLOOR_MS, base[Math.min(base.length - 1, Math.ceil(base.length * SLOW_BASE_Q) - 1)]);
    peak = Math.max(peak, percentile(recent, .5) / baseline);
  }
  return peak || null;
}

/** Slowdown → 0..1 color position: ≤1.2× blue, 1.6× amber, ≥2× red. */
export const slowdownLevel = (slowdown: number) => Math.max(0, Math.min(1, (slowdown - 1.2) / .8));
