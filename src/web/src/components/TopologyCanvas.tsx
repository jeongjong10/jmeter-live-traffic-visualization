import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { cssColor, loadColor, useThemeVersion } from './FlowParts';
import { slowdownLevel, type Badge } from '../services/flowModel';

export type TrafficStage = string;
export type TokenKind = 'request' | 'processing' | 'response';
export type TrafficToken = { id: string; stage: TrafficStage; progress: number; status: 'pending' | 'success' | 'error'; kind: TokenKind; userIndex: number; runId: string; estimated?: boolean };
/** `order` is the step number in the .jmx. */
export type StageDefinition = { id: TrafficStage; name: string; endpoint: string; repeat?: boolean; order?: number };
export type StageMetric = { stage: TrafficStage; inbound: number; inFlight: number; throughput: number; errors: number; errorRate: number; averageMs: number; p95Ms: number; requestFlight: number; responseFlight: number };
export type LoadSettings = { virtualUsers: number; rampUpSeconds?: number; loops?: number; durationSeconds?: number; journeys: number; requests: number };

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function curve(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, bend: number) { const mid = (from.x + to.x) / 2; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.bezierCurveTo(mid, from.y + bend, mid, to.y + bend, to.x, to.y); }
function pointOnCurve(from: { x: number; y: number }, to: { x: number; y: number }, bend: number, t: number) { const mid = (from.x + to.x) / 2; const cubic = (a: number, b: number, c: number, d: number) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d; return { x: cubic(from.x, mid, mid, to.x), y: cubic(from.y, from.y + bend, to.y + bend, to.y) }; }
function fit(ctx: CanvasRenderingContext2D, text: string, max: number) { if (ctx.measureText(text).width <= max) return text; let cut = text; while (cut.length > 1 && ctx.measureText(`${cut}…`).width > max) cut = cut.slice(0, -1); return `${cut}…`; }
/** Up to `lines` lines that fit `max`; the last one is shortened with an ellipsis. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number) {
  const out: string[] = []; let rest = text;
  while (rest && out.length < lines - 1 && ctx.measureText(rest).width > max) {
    let cut = rest.length; while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > max) cut--;
    const space = rest.lastIndexOf(' ', cut); if (space > cut * .5) cut = space;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) out.push(fit(ctx, rest, max));
  return out;
}
function arrow(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, color: string, right: boolean) { ctx.fillStyle = color; ctx.beginPath(); if (right) { ctx.moveTo(at.x + 5, at.y); ctx.lineTo(at.x - 4, at.y - 4); ctx.lineTo(at.x - 4, at.y + 4); } else { ctx.moveTo(at.x - 5, at.y); ctx.lineTo(at.x + 4, at.y - 4); ctx.lineTo(at.x + 4, at.y + 4); } ctx.closePath(); ctx.fill(); }

/** Vertical space per API lane; parents size the canvas with `canvasHeightFor`. */
const LANE_GAP = 138;
export const canvasHeightFor = (stageCount: number) => Math.max(380, (stageCount - 1) * LANE_GAP + 150);
export type CanvasHit = { kind: 'stage'; id: string } | { kind: 'token'; id: string; runId: string; stage: string };
type HitArea = CanvasHit & { x: number; y: number; w: number; h: number };

/** Draws one JMeter load generator and a vertically scrollable API flow, with the step-flow view's visual rules. */
export default function TopologyCanvas({ id, tokens, metrics, stages, width, height, currentTime, loadSettings, selectedStage, focusRun, badges, users, slowdowns, summary = false, onHover, onSelect }: { id?: string; summary?: boolean; slowdowns?: Map<string, number | null>; tokens: TrafficToken[]; metrics: StageMetric[]; stages: StageDefinition[]; width: number; height: number; currentTime: number; loadSettings: LoadSettings; selectedStage?: string | null; focusRun?: string | null; badges?: Map<string, Badge[]>; users?: Map<string, number>; onHover?: (hit: CanvasHit | null, x: number, y: number) => void; onSelect?: (hit: CanvasHit | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hits = useRef<HitArea[]>([]);
  const draw = useRef<() => void>(() => {});
  const theme = useThemeVersion();
  useEffect(() => {
    draw.current = () => {
    const canvas = ref.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const areas: HitArea[] = [];
    // Waiting tokens pulse on wall-clock time so they keep breathing while playback is paused.
    const breath = Math.sin(performance.now() / 255);
    // Same theme tokens as the step-flow view (FlowPipeline): gray nodes and edges, color only for state and load.
    const T = { panel: cssColor('--c-slate-900'), border: cssColor('--c-slate-700'), edge: cssColor('--c-slate-600'), track: cssColor('--c-slate-800'),
      title: cssColor('--c-slate-100'), value: cssColor('--c-slate-200'), muted: cssColor('--c-slate-400'),
      err: cssColor('--c-red-400'), errText: cssColor('--c-red-300'), errPill: cssColor('--c-red-500', .2), warnText: cssColor('--c-orange-200'), warnPill: cssColor('--c-orange-500', .2),
      gen: cssColor('--c-amber-200'), genBorder: cssColor('--c-amber-400', .6), focus: cssColor('--c-slate-50'),
      series: cssColor('--series-1') };
    const compact = width < 650; const generatorX = compact ? 95 : 140; const generatorW = compact ? 160 : 210; const apiW = compact ? 180 : Math.min(460, Math.max(260, width * .36)); const apiH = 120; const apiX = width - apiW / 2 - (compact ? 14 : 28);
    const top = 66; const bottom = 52; const laneGap = stages.length > 1 ? Math.max(LANE_GAP - 4, (height - top - bottom) / (stages.length - 1)) : 0; const stageY = (index: number) => top + index * laneGap;
    const generatorY = Math.min(height - 90, Math.max(90, Math.min(height / 2, 380)));
    const generatorAnchor = (index: number) => ({ x: generatorX + generatorW / 2, y: generatorY - 24 + ((index % Math.max(1, stages.length)) * 48 / Math.max(1, stages.length - 1)) });
    const apiAnchor = (index: number) => ({ x: apiX - apiW / 2, y: stageY(index) });
    const metricOf = (stage: string) => metrics.find(m => m.stage === stage) ?? { stage, inbound: 0, inFlight: 0, throughput: 0, errors: 0, errorRate: 0, averageMs: 0, p95Ms: 0, requestFlight: 0, responseFlight: 0 };
    // Load = distinct users waiting at the step (passed from the step-flow model when available).
    const loadOf = (stage: string) => users?.get(stage) ?? metricOf(stage).inFlight;

    stages.forEach((stage, index) => {
      const metric = metricOf(stage.id);
      const from = generatorAnchor(index); const to = apiAnchor(index); const y = stageY(index); const back = metric.errors ? T.err : T.edge;
      curve(ctx, from, to, -18); ctx.strokeStyle = T.edge; ctx.lineWidth = 1.5; ctx.stroke(); arrow(ctx, pointOnCurve(from, to, -18, .76), T.edge, true);
      curve(ctx, to, from, 18); ctx.strokeStyle = back; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]); arrow(ctx, pointOnCurve(to, from, 18, .25), back, false);
      const labelW = compact ? 104 : 140; const labelX = apiX - apiW / 2 - labelW - 12; rounded(ctx, labelX, y - 25, labelW, 50, 7); ctx.fillStyle = T.panel; ctx.fill(); ctx.strokeStyle = T.border; ctx.lineWidth = 1; ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '11px system-ui'; ctx.fillStyle = T.value; ctx.fillText(`→ 요청 ${metric.requestFlight} · ${metric.throughput}/s`, labelX + labelW / 2, y - 11);
      ctx.fillStyle = metric.errors ? T.errText : T.value; ctx.fillText(`← ${Math.round(metric.averageMs)}ms · 오류 ${metric.errorRate}%`, labelX + labelW / 2, y + 11);
    });

    const tokenAreas: HitArea[] = [];
    tokens.forEach((token, index) => {
      const stageIndex = stages.findIndex(stage => stage.id === token.stage); if (stageIndex < 0) return;
      const u = generatorAnchor(stageIndex); const api = apiAnchor(stageIndex); let p = { x: api.x, y: api.y };
      if (token.kind === 'request') p = pointOnCurve(u, api, -18, token.progress); if (token.kind === 'response') p = pointOnCurve(api, u, 18, token.progress); if (token.kind === 'processing') p = { x: api.x + ((index % 4) - 1.5) * 12, y: api.y + ((Math.floor(index / 4) % 3) - 1) * 13 };
      const color = token.status === 'error' ? T.err : T.series; const focused = focusRun && token.runId === focusRun; const pulse = token.kind === 'processing' ? 1 + .22 * breath : 1;
      ctx.globalAlpha = focusRun && !focused ? .2 : 1;
      tokenAreas.push({ kind: 'token', id: token.id, runId: token.runId, stage: token.stage, x: p.x - 9, y: p.y - 9, w: 18, h: 18 });
      if (focused) { ctx.beginPath(); ctx.strokeStyle = T.focus; ctx.lineWidth = 2; ctx.arc(p.x, p.y, 10 * pulse, 0, Math.PI * 2); ctx.stroke(); }
      if (token.estimated) { ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.arc(p.x, p.y, 6 * pulse, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; return; }
      ctx.beginPath(); ctx.fillStyle = cssColor('--c-blue-500', .18); if (token.status === 'error') ctx.fillStyle = cssColor('--c-red-500', .2); ctx.arc(p.x, p.y, (token.kind === 'processing' ? 11 : 8) * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.fillStyle = color; ctx.arc(p.x, p.y, 4.2 * pulse, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
    });

    const details = [`가상 사용자 ${loadSettings.virtualUsers} VU`, `Ramp-up ${loadSettings.rampUpSeconds ?? 0}s`, `${loadSettings.loops === -1 ? '반복 무한' : `반복 ${loadSettings.loops ?? 1}회`}${loadSettings.durationSeconds ? ` · 최대 ${loadSettings.durationSeconds}s` : ''}`, `여정 ${loadSettings.journeys} · 요청 ${loadSettings.requests}`];
    const generatorH = 128; rounded(ctx, generatorX - generatorW / 2, generatorY - generatorH / 2, generatorW, generatorH, 12); ctx.fillStyle = T.panel; ctx.fill(); ctx.strokeStyle = T.genBorder; ctx.lineWidth = 1.5; ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = T.gen; ctx.font = 'bold 14px system-ui'; ctx.fillText('JMeter 부하 발생기', generatorX, generatorY - 42); ctx.font = '12px system-ui'; details.forEach((line, index) => { ctx.fillStyle = index === 0 ? T.value : T.muted; ctx.fillText(line, generatorX, generatorY - 16 + index * 18); });

    stages.forEach((stage, index) => {
      const metric = metricOf(stage.id); const load = loadOf(stage.id); const y = stageY(index); const hot = load > 0; const selected = selectedStage === stage.id;
      const left = apiX - apiW / 2; const topY = y - apiH / 2; const inner = apiW - 24;
      rounded(ctx, left, topY, apiW, apiH, 10); ctx.fillStyle = T.panel; ctx.fill();
      // Node color = response slowdown (same rule as the step-flow view); users waiting are shown as a number only.
      const slowdown = slowdowns?.get(stage.id) ?? null; const level = slowdown === null ? null : slowdownLevel(slowdown);
      if (level !== null) { rounded(ctx, left, topY, apiW, apiH, 10); ctx.fillStyle = loadColor(level, .16 + .3 * level); ctx.fill(); }
      ctx.strokeStyle = selected ? T.focus : level !== null && level > 0 ? loadColor(level) : T.border; ctx.lineWidth = selected ? 2.5 : hot ? 2 : 1.2; ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = T.title; ctx.font = 'bold 13px system-ui';
      const name = wrap(ctx, `${stage.order ?? index + 1}. ${stage.name}${stage.repeat ? ' ↻' : ''}`, inner, 2);
      name.forEach((line, row) => ctx.fillText(line, apiX, y - (name.length === 2 ? 48 : 42) + row * 15));
      ctx.fillStyle = T.muted; ctx.font = '10px system-ui'; ctx.fillText(fit(ctx, stage.endpoint, inner), apiX, y - 17);
      ctx.textAlign = 'left'; ctx.font = 'bold 14px system-ui'; ctx.fillStyle = hot ? T.focus : T.muted; const usersText = `${summary ? '최대 동시' : '동시'} ${load}명`; ctx.fillText(usersText, left + 12, y + 1);
      ctx.textAlign = 'right'; ctx.font = '11px system-ui'; ctx.fillStyle = T.muted; ctx.fillText(`유입 ${metric.inbound} · ${summary ? '최대 ' : ''}${metric.throughput}/s`, left + apiW - 12, y + 1);
      // Per-call response times as two labeled values (same cells as the step-flow nodes).
      const cellW = inner / 3 - 3;
      const cell = (index: number, label: string, value: string, ink = T.title) => { const x = left + 12 + index * (cellW + 4.5); rounded(ctx, x, y + 14, cellW, 28, 4); ctx.fillStyle = T.track; ctx.fill(); ctx.textAlign = 'left'; ctx.font = '10px system-ui'; ctx.fillStyle = T.muted; ctx.fillText(label, x + 6, y + 22); ctx.font = 'bold 12px system-ui'; ctx.fillStyle = ink; ctx.fillText(value, x + 6, y + 35); };
      cell(0, '평균 응답', `${Math.round(metric.averageMs).toLocaleString()} ms`); cell(1, 'p95 응답', `${Math.round(metric.p95Ms).toLocaleString()} ms`);
      cell(2, summary ? '평소 대비 최대' : '평소 대비', slowdown === null ? '-' : `×${slowdown.toFixed(1)}`, level === null ? T.muted : loadColor(level));
      let pillX = left + 12; const pillY = y + 45;
      const pill = (text: string, fill: string, ink: string) => { ctx.font = '10px system-ui'; const w = ctx.measureText(text).width + 10; rounded(ctx, pillX, pillY, w, 14, 3); ctx.fillStyle = fill; ctx.fill(); ctx.fillStyle = ink; ctx.textAlign = 'left'; ctx.fillText(text, pillX + 5, pillY + 7.5); pillX += w + 4; };
      if (metric.errors && !(badges?.get(stage.id)?.some(badge => badge.tone === 'error'))) { ctx.font = '11px system-ui'; ctx.fillStyle = T.errText; ctx.textAlign = 'left'; ctx.fillText(`오류 ${metric.errors}건`, pillX, pillY + 7.5); pillX += ctx.measureText(`오류 ${metric.errors}건`).width + 6; }
      (badges?.get(stage.id) ?? []).forEach(badge => pill(badge.text, badge.tone === 'error' ? T.errPill : T.warnPill, badge.tone === 'error' ? T.errText : T.warnText));
      areas.push({ kind: 'stage', id: stage.id, x: left, y: topY, w: apiW, h: apiH });
    });
    // Tokens sit on top of nodes, so they are tested first.
    hits.current = [...tokenAreas.reverse(), ...areas];
    };
    draw.current();
  }, [tokens, metrics, stages, width, height, currentTime, loadSettings, selectedStage, focusRun, badges, users, slowdowns, summary, theme]);
  // Keep redrawing so waiting tokens pulse even while playback is paused.
  useEffect(() => { let frame = 0; const loop = () => { draw.current(); frame = requestAnimationFrame(loop); }; frame = requestAnimationFrame(loop); return () => cancelAnimationFrame(frame); }, []);
  const hitAt = (event: MouseEvent<HTMLCanvasElement>) => { const box = event.currentTarget.getBoundingClientRect(); const x = event.clientX - box.left; const y = event.clientY - box.top; const area = hits.current.find(item => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h); return { x, y, hit: area ? (area.kind === 'stage' ? { kind: 'stage' as const, id: area.id } : { kind: 'token' as const, id: area.id, runId: area.runId, stage: area.stage }) : null }; };
  const interactive = !!(onHover || onSelect);
  return <canvas id={id} ref={ref} style={{ width, height }} className="block w-full rounded-xl"
    onMouseMove={interactive ? event => { const { x, y, hit } = hitAt(event); event.currentTarget.style.cursor = hit ? 'pointer' : 'default'; onHover?.(hit, x, y); } : undefined}
    onMouseLeave={interactive ? () => onHover?.(null, 0, 0) : undefined}
    onClick={interactive ? event => onSelect?.(hitAt(event).hit) : undefined} />;
}
