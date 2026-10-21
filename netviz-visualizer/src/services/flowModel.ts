import type { StageDefinition, StageMetric, TrafficToken } from '../components/TopologyCanvas';

/** One registered .jmx as parsed by the collector (live-traffic-poc/jmx_plan.py). */
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
  return group.steps.map(step => ({ id: step.id, name: step.label, endpoint: step.method ? `${step.method} ${step.path}` : step.path, repeat: step.repeat }));
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

/** Per-step state at `cursor` for the pipeline view. `timeShare` is this step's part of all measured time. */
export type StepState = { stepId: string; reached: number; calls: number; inFlight: number; done: number; errors: number; averageMs: number; p95Ms: number; totalMs: number; timeShare: number; users: number; throughput: number };

export function stepStates(visits: Visit[], stages: StageDefinition[], cursor: number): { steps: StepState[]; started: number; finished: number } {
  const shown = visits.filter(visit => visit.start <= cursor);
  const done = shown.filter(visit => visit.end !== null && visit.end <= cursor);
  const allMs = done.reduce((sum, visit) => sum + visit.durationMs, 0);
  const steps = stages.map(({ id }) => {
    const mine = shown.filter(visit => visit.stepId === id);
    const finished = done.filter(visit => visit.stepId === id);
    const durations = finished.map(visit => visit.durationMs);
    const totalMs = durations.reduce((sum, value) => sum + value, 0);
    // Load vs dwell: users = distinct virtual users with a request open right now,
    // throughput = completions in the last second. A single user looping fast shows
    // a busy dwell bar but no users; that difference is the point.
    const open = mine.filter(visit => visit.end === null || visit.end > cursor);
    return { stepId: id, reached: new Set(mine.map(visit => visit.correlationId)).size, calls: mine.length, inFlight: open.length, done: finished.length, errors: finished.filter(visit => !visit.success).length, averageMs: durations.length ? totalMs / durations.length : 0, p95Ms: percentile(durations, .95), totalMs, timeShare: allMs ? totalMs / allMs : 0, users: new Set(open.map(visit => visit.correlationId)).size, throughput: finished.filter(visit => (visit.end ?? 0) > cursor - 1000).length };
  });
  const lastStep = stages[stages.length - 1]?.id;
  return { steps, started: new Set(shown.map(visit => visit.correlationId)).size, finished: new Set(done.filter(visit => visit.stepId === lastStep).map(visit => visit.correlationId)).size };
}

/** One time bucket of the over-time charts (JMeter dashboard "Over Time" graphs). */
export type SeriesPoint = { t: number; active: number; throughput: number; p50: number | null; p95: number | null; errors: number };
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
    const timed = (stepId ? bucket.filter(visit => visit.stepId === stepId) : bucket).map(visit => visit.durationMs);
    return { t, active: threadSpans.filter(item => item.first <= t && item.last >= t - bucketMs).length, throughput: bucket.length / (bucketMs / 1000), p50: timed.length ? percentile(timed, .5) : null, p95: timed.length ? percentile(timed, .95) : null, errors: bucket.filter(visit => !visit.success).length };
  }) };
}
