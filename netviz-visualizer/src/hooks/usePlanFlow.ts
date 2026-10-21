import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlowEvent, Plan } from '../services/flowModel';
import { FlowStore } from '../services/flowStore';

const COLLECTOR = '/collector';
/** The screen re-reads the store at most this often while events stream in. */
const FLUSH_MS = 200;

export type RunSummary = { id: string; startedAt: number; endedAt: number | null; testPlan: string; samples: number; errors: number; live: boolean };
export type StoredRun = { id: string; startedAt: number; endedAt: number | null; plan: Plan | null; store: FlowStore };

/** Registered plan plus the live run, folded incrementally into a FlowStore (recording first, then SSE batches). */
export function usePlanFlow() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [connected, setConnected] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [viewRun, setViewRun] = useState<StoredRun | null>(null);
  const store = useRef(new FlowStore()).current;
  const [version, setVersion] = useState(0);
  const flushTimer = useRef<number | null>(null);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current !== null) return;
    flushTimer.current = window.setTimeout(() => { flushTimer.current = null; setVersion(store.version); }, FLUSH_MS);
  }, [store]);

  const refreshRuns = useCallback(async () => {
    const response = await fetch(`${COLLECTOR}/api/runs`).catch(() => undefined);
    if (response?.ok) setRuns(((await response.json()) as { runs: RunSummary[] }).runs);
  }, []);

  const refreshPlan = useCallback(async () => {
    const response = await fetch(`${COLLECTOR}/api/plan`).catch(() => undefined);
    if (response?.ok) { const body = await response.json() as { plan?: Plan | null }; if (body.plan) setPlan(body.plan); }
  }, []);

  const ingest = useCallback((events: FlowEvent[]) => {
    if (store.ingest(events)) scheduleFlush();
    // A run may start under a plan sent by the listener or registered elsewhere.
    if (events.some(event => event.eventType === 'test')) { void refreshRuns(); void refreshPlan(); }
  }, [store, scheduleFlush, refreshRuns, refreshPlan]);

  const loadRecording = useCallback(async () => {
    const response = await fetch(`${COLLECTOR}/api/recording`).catch(() => undefined);
    if (response?.ok) ingest(((await response.json()) as { events?: FlowEvent[] }).events ?? []);
  }, [ingest]);

  /** null returns to the live run; an id loads that stored run (with the plan it ran under). */
  const selectRun = useCallback(async (id: string | null) => {
    if (!id) { setViewRun(null); return; }
    const response = await fetch(`${COLLECTOR}/api/runs/${id}`);
    if (!response.ok) return;
    const body = await response.json() as { run: { id: string; startedAt: number; endedAt: number | null; plan: Plan | null }; events: FlowEvent[] };
    const runStore = new FlowStore(); runStore.ingest(body.events);
    setViewRun({ ...body.run, store: runStore });
  }, []);

  useEffect(() => {
    void refreshRuns();
    void refreshPlan();
    const stream = new EventSource(`${COLLECTOR}/stream`);
    // (Re)connecting reloads the recording so nothing sent while disconnected is missed; duplicates are ignored.
    stream.onopen = () => { setConnected(true); void loadRecording(); };
    stream.onerror = () => setConnected(false);
    stream.addEventListener('batch', message => {
      try { ingest(JSON.parse((message as MessageEvent<string>).data) as FlowEvent[]); } catch { /* ignore malformed local event */ }
    });
    // The collector asks a viewer that fell behind to reload instead of dropping events.
    stream.addEventListener('resync', () => { void loadRecording(); });
    return () => { stream.close(); if (flushTimer.current !== null) window.clearTimeout(flushTimer.current); };
  }, [ingest, loadRecording, refreshRuns, refreshPlan]);

  const uploadPlan = useCallback(async (file: File) => {
    const response = await fetch(`${COLLECTOR}/api/plan`, { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: await file.text() });
    const body = await response.json() as { plan?: Plan; error?: string };
    if (!response.ok || !body.plan) throw new Error(body.error ?? `jmx 등록 실패 (${response.status})`);
    // The collector starts an empty live recording for the new plan.
    store.reset(); setVersion(store.version);
    setPlan(body.plan);
  }, [store]);

  return { plan, connected, uploadPlan, runs, viewRun, selectRun, store, version };
}

export type PlanFlow = ReturnType<typeof usePlanFlow>;
