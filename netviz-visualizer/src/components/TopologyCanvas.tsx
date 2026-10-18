import { useEffect, useRef } from 'react';

export type TrafficStage = string;
export type TokenKind = 'request' | 'processing' | 'response';
export type TrafficToken = { id: string; stage: TrafficStage; progress: number; status: 'pending' | 'success' | 'error'; kind: TokenKind; userIndex: number; runId: string };
export type StageDefinition = { id: TrafficStage; name: string; endpoint: string };
export type StageMetric = { stage: TrafficStage; inbound: number; inFlight: number; throughput: number; errors: number; errorRate: number; averageMs: number; p95Ms: number; requestFlight: number; responseFlight: number };
export type LoadSettings = { virtualUsers: number; rampUpSeconds?: number; loops?: number; journeys: number; requests: number };

const palette = ['#60a5fa', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#22d3ee', '#fb923c', '#c084fc'];
const colorFor = (index: number) => palette[index % palette.length];
function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }
function curve(ctx: CanvasRenderingContext2D, from: { x: number; y: number }, to: { x: number; y: number }, bend: number) { const mid = (from.x + to.x) / 2; ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.bezierCurveTo(mid, from.y + bend, mid, to.y + bend, to.x, to.y); }
function pointOnCurve(from: { x: number; y: number }, to: { x: number; y: number }, bend: number, t: number) { const mid = (from.x + to.x) / 2; const cubic = (a: number, b: number, c: number, d: number) => (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d; return { x: cubic(from.x, mid, mid, to.x), y: cubic(from.y, from.y + bend, to.y + bend, to.y) }; }
function arrow(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, color: string, right: boolean) { ctx.fillStyle = color; ctx.beginPath(); if (right) { ctx.moveTo(at.x + 5, at.y); ctx.lineTo(at.x - 4, at.y - 4); ctx.lineTo(at.x - 4, at.y + 4); } else { ctx.moveTo(at.x - 5, at.y); ctx.lineTo(at.x + 4, at.y - 4); ctx.lineTo(at.x + 4, at.y + 4); } ctx.closePath(); ctx.fill(); }

/** Draws one JMeter load generator and a vertically scrollable API flow. */
export default function TopologyCanvas({ tokens, metrics, stages, width, height, currentTime, loadSettings }: { tokens: TrafficToken[]; metrics: StageMetric[]; stages: StageDefinition[]; width: number; height: number; currentTime: number; loadSettings: LoadSettings }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current; if (!canvas) return; const ctx = canvas.getContext('2d'); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1; canvas.width = width * dpr; canvas.height = height * dpr; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
    const compact = width < 650; const generatorX = compact ? 95 : 132; const generatorW = compact ? 150 : 190; const apiW = compact ? 142 : 184; const apiH = 72; const apiX = width - apiW / 2 - (compact ? 14 : 36);
    const top = 55; const bottom = 44; const laneGap = stages.length > 1 ? Math.max(92, (height - top - bottom) / (stages.length - 1)) : 0; const stageY = (index: number) => top + index * laneGap;
    const generatorY = Math.min(height - 85, Math.max(85, height / 2));
    const generatorAnchor = (index: number) => ({ x: generatorX + generatorW / 2, y: generatorY - 24 + ((index % Math.max(1, stages.length)) * 48 / Math.max(1, stages.length - 1)) });
    const apiAnchor = (index: number) => ({ x: apiX - apiW / 2, y: stageY(index) });
    ctx.fillStyle = '#09101f'; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = 'rgba(71,85,105,.20)'; ctx.lineWidth = 1; for (let y = 12; y < height; y += 28) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }

    stages.forEach((stage, index) => {
      const metric = metrics.find(m => m.stage === stage.id) ?? { stage: stage.id, inbound: 0, inFlight: 0, throughput: 0, errors: 0, errorRate: 0, averageMs: 0, p95Ms: 0, requestFlight: 0, responseFlight: 0 };
      const from = generatorAnchor(index); const to = apiAnchor(index); const color = colorFor(index); const y = stageY(index);
      curve(ctx, from, to, -18); ctx.strokeStyle = `${color}66`; ctx.lineWidth = 2.5; ctx.stroke(); arrow(ctx, pointOnCurve(from, to, -18, .76), color, true);
      curve(ctx, to, from, 18); ctx.strokeStyle = metric.errors ? '#fb718588' : `${color}55`; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.stroke(); ctx.setLineDash([]); arrow(ctx, pointOnCurve(to, from, 18, .25), metric.errors ? '#fb7185' : color, false);
      const labelW = compact ? 92 : 120; const labelX = apiX - apiW / 2 - labelW - 10; rounded(ctx, labelX, y - 23, labelW, 46, 6); ctx.fillStyle = '#0d1729ef'; ctx.fill(); ctx.strokeStyle = `${color}55`; ctx.lineWidth = 1; ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = '10px system-ui'; ctx.fillStyle = color; ctx.fillText(`→ 요청 ${metric.requestFlight} · ${metric.throughput}/s`, labelX + labelW / 2, y - 10); ctx.fillStyle = metric.errors ? '#fda4af' : '#cbd5e1'; ctx.fillText(`← 응답 ${Math.round(metric.averageMs)}ms · 오류 ${metric.errorRate}%`, labelX + labelW / 2, y + 10);
    });

    tokens.forEach((token, index) => { const stageIndex = stages.findIndex(stage => stage.id === token.stage); if (stageIndex < 0) return; const u = generatorAnchor(stageIndex); const api = apiAnchor(stageIndex); let p = { x: api.x, y: api.y }; if (token.kind === 'request') p = pointOnCurve(u, api, -18, token.progress); if (token.kind === 'response') p = pointOnCurve(api, u, 18, token.progress); if (token.kind === 'processing') p = { x: api.x + ((index % 4) - 1.5) * 10, y: api.y + ((Math.floor(index / 4) % 3) - 1) * 11 }; const color = token.status === 'error' ? '#fb7185' : colorFor(stageIndex); ctx.beginPath(); ctx.fillStyle = `${color}26`; ctx.arc(p.x, p.y, token.kind === 'processing' ? 10 : 8, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10; ctx.arc(p.x, p.y, 3.6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; });

    const details = [`가상 사용자 ${loadSettings.virtualUsers} VU`, `Ramp-up ${loadSettings.rampUpSeconds ?? 0}s`, `반복 ${loadSettings.loops ?? 1}회`, `여정 ${loadSettings.journeys} · 요청 ${loadSettings.requests}`];
    const generatorH = 116; rounded(ctx, generatorX - generatorW / 2, generatorY - generatorH / 2, generatorW, generatorH, 12); ctx.fillStyle = '#101a2d'; ctx.fill(); ctx.strokeStyle = '#fbbf2499'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fcd34d'; ctx.font = 'bold 12px system-ui'; ctx.fillText('JMeter 부하 발생기', generatorX, generatorY - 38); ctx.font = '10px system-ui'; details.forEach((line, index) => { ctx.fillStyle = index === 0 ? '#e2e8f0' : '#94a3b8'; ctx.fillText(line, generatorX, generatorY - 15 + index * 16); });

    stages.forEach((stage, index) => { const metric = metrics.find(m => m.stage === stage.id) ?? { inbound: 0, inFlight: 0, averageMs: 0, p95Ms: 0, errors: 0 }; const y = stageY(index); const color = colorFor(index); const hot = metric.inFlight > 0; if (hot) { ctx.beginPath(); ctx.strokeStyle = metric.averageMs >= 500 ? '#fb923c88' : `${color}70`; ctx.lineWidth = 2; ctx.arc(apiX, y, apiW * .43 + 8 + Math.sin(currentTime / 160) * 2, 0, Math.PI * 2); ctx.stroke(); } rounded(ctx, apiX - apiW / 2, y - apiH / 2, apiW, apiH, 10); ctx.fillStyle = '#101a2d'; ctx.fill(); ctx.strokeStyle = metric.errors ? '#fb7185' : metric.averageMs >= 500 ? '#fb923c' : color; ctx.lineWidth = hot ? 2 : 1.2; ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color; ctx.font = 'bold 12px system-ui'; ctx.fillText(`${index + 1}. ${stage.name} API`, apiX, y - 18); ctx.fillStyle = '#94a3b8'; ctx.font = '9px system-ui'; ctx.fillText(stage.endpoint, apiX, y - 4); ctx.fillStyle = metric.inFlight ? '#fde68a' : '#cbd5e1'; ctx.font = '10px system-ui'; ctx.fillText(`유입 ${metric.inbound} · 처리 중 ${metric.inFlight} · 오류 ${metric.errors}`, apiX, y + 13); ctx.fillStyle = metric.averageMs >= 500 ? '#fdba74' : '#94a3b8'; ctx.fillText(`평균 ${Math.round(metric.averageMs)} · p95 ${Math.round(metric.p95Ms)}ms`, apiX, y + 27); });
    ctx.textAlign = 'left'; ctx.fillStyle = '#94a3b8'; ctx.font = '10px system-ui'; ctx.fillText('실선 → 요청 · 점선 ← 응답 · 점 = 실제 상관관계 이벤트 · API 체류 시간 = JMeter 실측', 12, height - 12);
  }, [tokens, metrics, stages, width, height, currentTime, loadSettings]);
  return <canvas ref={ref} style={{ width, height }} className="block w-full rounded-xl" />;
}
