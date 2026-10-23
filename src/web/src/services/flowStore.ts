import type { FlowEvent, Halt, Visit } from './flowModel';

const keyOf = (event: FlowEvent) => `${event.eventType}|${event.requestId ?? ''}|${event.phase}|${event.timestamp}`;
const iterationOf = (correlationId = '') => Number(correlationId.split('#').pop()) || 1;

/**
 * Collector events folded incrementally into per-journey visits, so a busy run
 * costs O(new events) per update instead of re-reading the whole history.
 * A visit is one user's stay at one step: estimated while open, measured once
 * JMeter reports it, removed when the collector cancels the estimate.
 */
export class FlowStore {
  version = 0;
  test: { started: boolean; ended: boolean; startedAt: number | null; endedAt: number | null } = { started: false, ended: false, startedAt: null, endedAt: null };
  unmatched = 0;
  private seen = new Set<string>();
  private journeys = new Map<string, Map<string, Visit>>();
  private halts = new Map<string, Halt[]>();
  private sorted = new Map<string, { version: number; visits: Visit[] }>();

  reset(): void {
    this.seen.clear(); this.journeys.clear(); this.halts.clear(); this.sorted.clear();
    this.test = { started: false, ended: false, startedAt: null, endedAt: null };
    this.unmatched = 0; this.version++;
  }

  /** Returns true when anything changed. Duplicates (recording + live stream overlap) are ignored. */
  ingest(events: FlowEvent[]): boolean {
    let changed = false;
    for (const event of events) {
      const key = keyOf(event);
      if (this.seen.has(key)) continue;
      if (event.eventType === 'test' && event.phase === 'started') this.reset(); // a new JMeter run replaces the live view
      this.seen.add(key); changed = true;
      if (event.eventType === 'test') {
        if (event.phase === 'started') { this.test.started = true; this.test.startedAt = Number(event.timestamp); }
        if (event.phase === 'ended') { this.test.ended = true; this.test.endedAt = Number(event.timestamp); }
        continue;
      }
      if (event.unmatched) { this.unmatched++; continue; }
      if (event.eventType !== 'journey' || !event.journeyId || !event.requestId || !event.stepId) continue;
      if (event.phase === 'halted') {
        const list = this.halts.get(event.journeyId) ?? [];
        list.push({ stepId: event.stepId, correlationId: event.correlationId ?? '', at: Number(event.timestamp), policy: event.outcome ?? '' });
        this.halts.set(event.journeyId, list); continue;
      }
      const visits = this.journeys.get(event.journeyId) ?? new Map<string, Visit>();
      this.journeys.set(event.journeyId, visits);
      const base = { id: event.requestId, stepId: event.stepId, correlationId: event.correlationId ?? '', thread: event.jmeterThread ?? '', iteration: iterationOf(event.correlationId) };
      if (event.phase === 'cancelled') visits.delete(event.requestId);
      else if (event.phase === 'started') { if (!visits.has(event.requestId)) visits.set(event.requestId, { ...base, start: Number(event.startedAt ?? event.timestamp), end: null, estimated: true, success: true, status: '', durationMs: 0, latency: 0, connect: 0, bytes: 0, failureMessage: '' }); }
      else if (event.phase === 'completed' || event.phase === 'aborted') visits.set(event.requestId, { ...base, start: Number(event.startedAt), end: Number(event.timestamp), estimated: false, success: event.phase === 'completed', status: String(event.status ?? ''), durationMs: Number(event.durationMs ?? 0), latency: Number(event.latency ?? 0), connect: Number(event.connect ?? 0), bytes: Number(event.bytes ?? 0), failureMessage: event.failureMessage ?? '' });
    }
    if (changed) this.version++;
    return changed;
  }

  /** Visits of one thread group ordered by start; cached until the next change. */
  visits(journeyId: string): Visit[] {
    const cached = this.sorted.get(journeyId);
    if (cached && cached.version === this.version) return cached.visits;
    const visits = [...(this.journeys.get(journeyId)?.values() ?? [])].sort((a, b) => a.start - b.start);
    this.sorted.set(journeyId, { version: this.version, visits });
    return visits;
  }

  haltsOf(journeyId: string): Halt[] { return this.halts.get(journeyId) ?? []; }
}
