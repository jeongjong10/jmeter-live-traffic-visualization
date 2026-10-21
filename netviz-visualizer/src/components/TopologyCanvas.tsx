import { useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { cssColor, useThemeVersion } from './FlowParts';

export type TrafficStage = string;
export type TokenKind = 'request' | 'processing' | 'response';
export type TrafficToken = { id: string; stage: TrafficStage; progress: number; status: 'pending' | 'success' | 'error'; kind: TokenKind; userIndex: number; runId: string; estimated?: boolean };
export type StageDefinition = { id: TrafficStage; name: string; endpoint: string; repeat?: boolean };
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
const LANE_GAP = 108;
export const canvasHeightFor = (stageCount: number) => Math.max(360, (stageCount - 1) * LANE_GAP + 120);
export type CanvasHit = { kind: 'stage'; id: string } | { kind: 'token'; id: string; runId: string; stage: string };
type HitArea = CanvasHit & { x: number; y: number; w: number; h: number };

/** Draws one JMeter load generator and a vertically scrollable API flow. */
export default function TopologyCanvas({ tokens, metrics, stages, width, height, currentTime, loadSettings, selectedStage, focusRun, onHover, onSelect }: { tokens: TrafficToken[]; metrics: StageMetric[]; stages: StageDefinition[]; width: number; height: number; currentTime: number; loadSettings: LoadSettings; selectedStage?: string | null; focusRun?: string | null; onHover?: (hit: CanvasHit | null, x: number, y: number) => void; onSelect?: (hit: CanvasHit | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const hits = useRef<HitArea[]>([]);
  const theme = useThemeVersion();
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1; canvas.width = width * dpr; canvas.height = height * dpr; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
    const areas: HitArea[] = [];
    // Theme tokens (dark/light) read at draw time; per-stage identity colors stay fixed.
    const T = { bg: cssColor('--c-slate-950'), grid: cssColor('--c-slate-600', .2), labelBg: cssColor('--c-slate-900', .94), panel: cssColor('--c-slate-900'), selPanel: cssColor('--c-slate-800'),
      muted: cssColor('--c-slate-400'), text: cssColor('--c-slate-300'), textHi: cssColor('--c-slate-200'), err: cssColor('--c-red-400'), errLine: cssColor('--c-red-400', .53), errText: cssColor('--c-red-300'),
      warn: cssColor('--c-orange-400'), warnGlow: cssColor('--c-orange-400', .53), warnText: cssColor('--c-orange-300'), gen: cssColor('--c-amber-300'), genBorder: cssColor('--c-amber-400', .6), busy: cssColor('--c-amber-200'), focus: cssColor('--c-slate-50'),
      series: cssColor('--series-1') }; // one hue for all APIs; color is reserved for state
    const compact = width < 650; const generatorX = compact ? 95 : 132; const generatorW = compact ? 150 : 190; const apiW = compact ? 160 : Math.min(420, Math.max(220, width * .34)); const apiH = 86; const apiX = width - apiW / 2 - (compact ? 14 : 28);
    const top = 58; const bottom = 48; const laneGap = stages.length > 1 ? Math.max(LANE_GAP - 4, (height - top - bottom) / (stages.length - 1)) : 0; const stageY = (index: number) => top + index * laneGap;
    const generatorY = Math.min(height - 85, Math.max(85, Math.min(height / 2, 360)));
    const generatorAnchor = (index: number) => ({ x: generatorX + generatorW / 2, y: generatorY - 24 + ((index % Math.max(1, stages.length)) * 48 / Math.max(1, stages.length - 1)) });
    const apiAnchor = (index: number) => ({ x: apiX - apiW / 2, y: stageY(index) });
    ctx.fillStyle = T.bg; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = T.grid; ctx.lineWidth = 1; for (let y = 12; y < height; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

    stages.forEach((stage, index) => {
      const metric = metrics.find(m => m.stage === stage.id) ?? { stage: stage.id, inbound: 0, inFlight: 0, throughput: 0, errors: 0, errorRate: 0, averageMs: 0, p95Ms: 0, requestFlight: 0, responseFlight: 0 };
      const from = generatorAnchor(index); const to = apiAnchor(index); const color = T.series; const y = stageY(index);
      curve(ctx, from, to, -18); ctx.strokeStyle = `${color}66`; ctx.lineWidth = 2.5; ctx.stroke(); arrow(ctx, pointOnCurve(from, to, -18, .76), color, true);
      curve(ctx, to, from, 18); ctx.strokeStyle = metric.errors ? T.errLine : `${color}55`; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]); arrow(ctx, pointOnCurve(to, from, 18, .25), metric.errors ? T.err : color, false);
      const labelW = compact ? 92 : 120; const labelX = apiX - apiW / 2 - labelW - 10; rounded(ctx, labelX, y - 23, labelW, 46, 6); ctx.fillStyle = T.labelBg; ctx.fill(); ctx.strokeStyle = `${color}55`; ctx.lineWidth = 1; ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '10px system-ui'; ctx.fillStyle = color; ctx.fillText(`→ 요청 ${metric.requestFlight} · ${metric.throughput}/s`, labelX + labelW / 2, y - 10); ctx.fillStyle = metric.errors ? T.errText : T.text; ctx.fillText(`← 응답 ${Math.round(metric.averageMs)}ms · 오류 ${metric.errorRate}%`, labelX + labelW / 2, y + 10);
    });

    const tokenAreas: HitArea[] = [];
    tokens.forEach((token, index) => {
      const stageIndex = stages.findIndex(stage => stage.id === token.stage); if (stageIndex < 0) return;
      const u = generatorAnchor(stageIndex); const api = apiAnchor(stageIndex); let p = { x: api.x, y: api.y };
      if (token.kind === 'request') p = pointOnCurve(u, api, -18, token.progress); if (token.kind === 'response') p = pointOnCurve(api, u, 18, token.progress); if (token.kind === 'processing') p = { x: api.x + ((index % 4) - 1.5) * 10, y: api.y + ((Math.floor(index / 4) % 3) - 1) * 11 };
      const color = token.status === 'error' ? T.err : T.series; const focused = focusRun && token.runId === focusRun;
      ctx.globalAlpha = focusRun && !focused ? .2 : 1;
      tokenAreas.push({ kind: 'token', id: token.id, runId: token.runId, stage: token.stage, x: p.x - 8, y: p.y - 8, w: 16, h: 16 });
      if (focused) { ctx.beginPath(); ctx.strokeStyle = T.focus; ctx.lineWidth = 2; ctx.arc(p.x, p.y, 9, 0, Math.PI * 2); ctx.stroke(); }
      if (token.estimated) { ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([2, 2]); ctx.arc(p.x, p.y, 5.5, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; return; }
      ctx.beginPath(); ctx.fillStyle = `${color}26`; ctx.arc(p.x, p.y, token.kind === 'processing' ? 10 : 8, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; ctx.globalAlpha = 1;
    });

    const details = [`가상 사용자 ${loadSettings.virtualUsers} VU`, `Ramp-up ${loadSettings.rampUpSeconds ?? 0}s`, `${loadSettings.loops === -1 ? '반복 무한' : `반복 ${loadSettings.loops ?? 1}회`}${loadSettings.durationSeconds ? ` · 최대 ${loadSettings.durationSeconds}s` : ''}`, `여정 ${loadSettings.journeys} · 요청 ${loadSettings.requests}`];
    const generatorH = 116; rounded(ctx, generatorX - generatorW / 2, generatorY - generatorH / 2, generatorW, generatorH, 12); ctx.fillStyle = T.panel; ctx.fill(); ctx.strokeStyle = T.genBorder; ctx.lineWidth = 1.5; ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = T.gen; ctx.font = 'bold 12px system-ui'; ctx.fillText('JMeter 부하 발생기', generatorX, generatorY - 38); ctx.font = '10px system-ui'; details.forEach((line, index) => { ctx.fillStyle = index === 0 ? T.textHi : T.muted; ctx.fillText(line, generatorX, generatorY - 15 + index * 16); });

    stages.forEach((stage, index) => {
      const metric = metrics.find(m => m.stage === stage.id) ?? { inbound: 0, inFlight: 0, averageMs: 0, p95Ms: 0, errors: 0 }; const y = stageY(index); const color = T.series; const hot = metric.inFlight > 0; const selected = selectedStage === stage.id;
      const left = apiX - apiW / 2; const topY = y - apiH / 2;
      if (hot) { const glow = 4 + Math.sin(currentTime / 160) * 1.5; rounded(ctx, left - glow, topY - glow, apiW + glow * 2, apiH + glow * 2, 13); ctx.strokeStyle = metric.averageMs >= 500 ? T.warnGlow : `${color}70`; ctx.lineWidth = 2; ctx.stroke(); }
      rounded(ctx, left, topY, apiW, apiH, 10); ctx.fillStyle = selected ? T.selPanel : T.panel; ctx.fill(); ctx.strokeStyle = selected ? T.focus : metric.errors ? T.err : metric.averageMs >= 500 ? T.warn : color; ctx.lineWidth = selected ? 2.5 : hot ? 2 : 1.2; ctx.stroke();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.font = 'bold 12px system-ui';
      const name = wrap(ctx, `${index + 1}. ${stage.name}${stage.repeat ? ' ↻' : ''}`, apiW - 16, 2);
      name.forEach((line, row) => ctx.fillText(line, apiX, y - (name.length === 2 ? 30 : 23) + row * 15));
      ctx.fillStyle = T.muted; ctx.font = '9px system-ui'; ctx.fillText(fit(ctx, stage.endpoint, apiW - 16), apiX, y + 1);
      ctx.fillStyle = metric.inFlight ? T.busy : T.text; ctx.font = '10px system-ui'; ctx.fillText(`유입 ${metric.inbound} · 동시 사용자 ${metric.inFlight} · 오류 ${metric.errors}`, apiX, y + 17); ctx.fillStyle = metric.averageMs >= 500 ? T.warnText : T.muted; ctx.fillText(`평균 ${Math.round(metric.averageMs)} · p95 ${Math.round(metric.p95Ms)}ms`, apiX, y + 31);
      areas.push({ kind: 'stage', id: stage.id, x: left, y: topY, w: apiW, h: apiH });
    });
    ctx.textAlign = 'left'; ctx.fillStyle = T.muted; ctx.font = '10px system-ui'; ctx.fillText('모든 API 같은 색 · 빨간 테두리 = 오류 · 주황 테두리 = 평균 500ms 이상 · 흰 테두리 = 선택 · 파란 링 = 동시 사용자 처리 중 · ↻ 반복 단계', 12, height - 12);
    // Tokens sit on top of nodes, so they are tested first.
    hits.current = [...tokenAreas.reverse(), ...areas];
  }, [tokens, metrics, stages, width, height, currentTime, loadSettings, selectedStage, focusRun, theme]);
  const hitAt = (event: MouseEvent<HTMLCanvasElement>) => { const box = event.currentTarget.getBoundingClientRect(); const x = event.clientX - box.left; const y = event.clientY - box.top; const area = hits.current.find(item => x >= item.x && x <= item.x + item.w && y >= item.y && y <= item.y + item.h); return { x, y, hit: area ? (area.kind === 'stage' ? { kind: 'stage' as const, id: area.id } : { kind: 'token' as const, id: area.id, runId: area.runId, stage: area.stage }) : null }; };
  const interactive = !!(onHover || onSelect);
  return <canvas ref={ref} style={{ width, height }} className="block w-full rounded-xl"
    onMouseMove={interactive ? event => { const { x, y, hit } = hitAt(event); event.currentTarget.style.cursor = hit ? 'pointer' : 'default'; onHover?.(hit, x, y); } : undefined}
    onMouseLeave={interactive ? () => onHover?.(null, 0, 0) : undefined}
    onClick={interactive ? event => onSelect?.(hitAt(event).hit) : undefined} />;
}
