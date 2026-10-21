import type { HttpMethod, NetworkRequest } from '../types/network';
import { generateId } from '../utils/colors';
import { detectTechStack, getHostname } from '../utils/techDetection';

/** Local-only proxy target supplied by Vite; it forwards to the JMeter collector. */
const COLLECTOR = '/collector';

export interface CollectorEvent {
  /** v1 collector fields */
  timestamp?: number;
  endpoint?: string;
  durationMs?: number;
  success?: boolean;
  status?: number | string;
  /** v2/JMeter aliases accepted during the contract transition. */
  endTime?: number;
  label?: string;
  elapsed?: number;
  responseCode?: number | string;
  requestId?: string;
  bytes?: number;
  latency?: number;
  connect?: number;
  flowId?: string;
  correlationId?: string;
  journeyId?: string;
  stepId?: string;
  stepOrder?: number;
  previousStepId?: string;
  phase?: 'started' | 'completed' | 'aborted' | 'skipped';
  outcome?: string;
  startedAt?: number;
  completedAt?: number;
}

export type RequestCallback = (request: NetworkRequest) => void;
export type ConnectionCallback = (connected: boolean) => void;

let stream: EventSource | null = null;
let onRequest: RequestCallback | null = null;
let onConnection: ConnectionCallback | null = null;

function numericStatus(value: number | string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function methodFromEndpoint(endpoint: string): HttpMethod {
  const candidate = endpoint.trim().split(/\s+/)[0]?.toUpperCase();
  return ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'].includes(candidate)
    ? candidate as HttpMethod
    : 'GET';
}

function endpointTarget(endpoint: string): { url: string; hostname: string } {
  const flowMatch = endpoint.match(/FLOW:([^|]+)\|\s*STEP:\d+-([^|]+)\|\s*SCENARIO:([^|]+)/i);
  if (flowMatch) {
    const flow = flowMatch[1].trim().replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const step = flowMatch[2].trim().replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const scenario = flowMatch[3].trim().replace(/[^a-z0-9-]/gi, '-').toLowerCase();
    const hostname = `${step}.${flow}.local`;
    return { hostname, url: `http://${hostname}/${flow}?scenario=${scenario}` };
  }
  const parts = endpoint.trim().split(/\s+/, 2);
  const path = parts.length === 2 ? parts[1] : parts[0];
  const hostname = 'jmeter.local';
  return { hostname, url: `http://${hostname}${path.startsWith('/') ? path : `/${path}`}` };
}

function flowMetadata(event: CollectorEvent): NetworkRequest['flow'] | undefined {
  const timestamp = Number(event.timestamp ?? event.completedAt ?? event.endTime ?? Date.now());
  if (event.journeyId && event.stepId && event.stepOrder) {
    const scenario = event.outcome === 'failure' ? 'failure' : event.stepId === 'catalog' && Number(event.durationMs) >= 500 ? 'slow' : 'success';
    return {
      name: event.journeyId, step: Number(event.stepOrder), stage: event.stepId,
      scenario, runId: event.correlationId || event.flowId || `${event.journeyId}-${Math.floor(timestamp / 10_000)}`,
      previousStepId: event.previousStepId, phase: event.phase, outcome: event.outcome,
    };
  }
  const match = (event.endpoint ?? event.label ?? '').match(/FLOW:([^|]+)\|\s*STEP:(\d+)-([^|]+)\|\s*SCENARIO:([^|]+)/i);
  if (!match) return undefined;
  const [, rawName, rawStep, rawStage, rawScenario] = match;
  const name = rawName.trim();
  const scenario = rawScenario.trim();
  // Older recordings have no correlation ID. Keep their visual grouping stable
  // only inside a short time window; new mock runs provide flowId directly.
  const fallbackRun = `${name}-${scenario}-${Math.floor(timestamp / 10_000)}`;
  return { name, step: Number(rawStep), stage: rawStage.trim(), scenario, runId: event.flowId || fallbackRun, phase: event.phase, outcome: event.outcome };
}

/** Translate the collector's contract-v1 event into NetViz's native request model. */
export function collectorEventToRequest(event: CollectorEvent): NetworkRequest {
  const endpoint = event.endpoint || event.label || '/unknown';
  const timestamp = Number(event.timestamp ?? event.completedAt ?? event.endTime ?? Date.now());
  const duration = Math.max(0, Number(event.durationMs ?? event.elapsed) || 0);
  const target = endpointTarget(endpoint);
  const url = target.url;
  const method = methodFromEndpoint(endpoint || 'GET');
  const statusCode = numericStatus(event.status ?? event.responseCode ?? 0);
  const requestId = event.requestId || `${timestamp}-${endpoint}-${event.phase || 'completed'}-${duration}`;
  const success = event.success !== false && (statusCode === 0 || statusCode < 400);
  const host = target.hostname || getHostname(url);
  const startTime = Math.max(0, timestamp - duration);

  return {
    id: requestId,
    url,
    hostname: host,
    method,
    status: success ? 'success' : 'error',
    statusCode,
    headers: { 'x-source': 'jmeter-collector' },
    responseHeaders: {},
    timing: { startTime: event.startedAt ?? startTime, connectStart: event.connect, connectEnd: event.connect, responseStart: event.latency, responseEnd: event.completedAt ?? timestamp, duration },
    size: Math.max(0, Number(event.bytes) || 0),
    type: 'jmeter-sampler',
    timestamp,
    techStack: detectTechStack(url),
    payload: JSON.stringify(event),
    tabDomain: 'JMeter run',
    flow: flowMetadata({ ...event, endpoint, timestamp, durationMs: duration }),
  };
}

function deliver(raw: CollectorEvent): void { onRequest?.(collectorEventToRequest(raw)); }

/** Connect to the existing loopback collector's Server-Sent Events stream. */
export function startCapture(callback: RequestCallback, status?: ConnectionCallback): void {
  onRequest = callback;
  onConnection = status ?? null;
  if (stream) return;
  stream = new EventSource(`${COLLECTOR}/stream`);
  stream.onopen = () => onConnection?.(true);
  stream.onerror = () => onConnection?.(false);
  // The collector sends batches; a viewer that fell behind is asked to reload the recording.
  stream.addEventListener('batch', (message) => {
    try { (JSON.parse((message as MessageEvent<string>).data) as CollectorEvent[]).forEach(deliver); } catch { /* ignore malformed local event */ }
  });
  stream.addEventListener('resync', () => { void loadRecording().then(requests => requests.forEach(request => onRequest?.(request))).catch(() => undefined); });
}

export function stopCapture(): void { onRequest = null; }
export function resumeCapture(callback: RequestCallback): void { onRequest = callback; }
export function closeCapture(): void { stream?.close(); stream = null; onRequest = null; onConnection = null; }

/** Read the durable local recording to seed the request list and replay mode. */
export async function loadRecording(): Promise<NetworkRequest[]> {
  // The durable recording is authoritative for replay. A snapshot intentionally
  // keeps only a short live window, which would otherwise make a finished run
  // look incomplete (for example 117 instead of all 156 JMeter samples).
  const response = await fetch(`${COLLECTOR}/api/recording`);
  if (!response.ok) throw new Error(`Collector recording request failed (${response.status})`);
  const body = await response.json() as { events?: CollectorEvent[] };
  const events = body.events ?? [];
  return events.some(event => event.journeyId && event.stepId && event.phase)
    ? lifecycleEventsToRequests(events, Date.now())
    : events.map(collectorEventToRequest);
}

/** Collapse v2 started/completed/aborted events into one request per step.
 * This does not invent token timings: completion events retain JMeter's
 * duration, while a currently active start is measured only until snapshot time. */
function lifecycleEventsToRequests(events: CollectorEvent[], snapshotAt: number): NetworkRequest[] {
  const starts = new Map<string, CollectorEvent>();
  const key = (event: CollectorEvent) => `${event.correlationId || event.flowId || event.requestId || 'unknown'}|${event.stepId || 'unknown'}`;
  const lifecycle = events.filter(event => event.journeyId && event.stepId && event.phase);
  lifecycle.filter(event => event.phase === 'started').forEach(event => starts.set(key(event), event));
  const terminal = lifecycle.filter(event => event.phase === 'completed' || event.phase === 'aborted');
  const terminalKeys = new Set(terminal.map(key));
  const collapsed = terminal.map(event => {
    const start = starts.get(key(event));
    const startedAt = start?.startedAt ?? start?.timestamp ?? event.startedAt ?? event.timestamp ?? snapshotAt;
    return {
      ...event,
      requestId: event.requestId || `${key(event)}|${startedAt}`,
      startedAt,
      timestamp: event.completedAt ?? event.timestamp ?? snapshotAt,
      durationMs: event.durationMs ?? event.elapsed ?? Math.max(0, (event.completedAt ?? event.timestamp ?? snapshotAt) - startedAt),
      success: event.phase !== 'aborted' && event.success !== false,
    };
  });
  const active = lifecycle.filter(event => event.phase === 'started' && !terminalKeys.has(key(event))).map(event => {
    const startedAt = event.startedAt ?? event.timestamp ?? snapshotAt;
    return { ...event, requestId: event.requestId || `${key(event)}|${startedAt}`, startedAt, timestamp: snapshotAt, durationMs: Math.max(0, snapshotAt - startedAt), status: 202, success: true };
  });
  const oldStyle = events.filter(event => !event.journeyId || !event.stepId || !event.phase);
  return [...collapsed, ...active, ...oldStyle].map(collectorEventToRequest);
}

/** A deterministic packet id remains separate from the captured request id. */
export function nextPacketId(): string { return generateId(); }
