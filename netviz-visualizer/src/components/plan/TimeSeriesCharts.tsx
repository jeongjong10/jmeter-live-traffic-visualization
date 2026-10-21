import { useEffect, useRef, useState } from 'react';
import type { SeriesPoint } from '../../services/flowModel';

/* Chart tokens for the app's dark surface (#0f172a); the series pair and the
 * status red were checked with the dataviz palette validator on that surface. */
const INK = { primary: '#f0efec', secondary: '#c3c2b7', muted: '#898781', grid: '#1e293b', axis: '#334155' };
const SERIES_1 = '#3987e5';
const SERIES_2 = '#d95926';
const CRITICAL = '#d03b3b';
const HEIGHT = 132; const PAD = { left: 44, right: 10, top: 10, bottom: 20 };

type Series = { key: 'active' | 'throughput' | 'p50' | 'p95' | 'errors'; label: string; color: string };
type ChartSpec = { title: string; unit: string; kind: 'line' | 'bars'; series: Series[]; format: (value: number) => string };

const niceCeil = (value: number) => { if (value <= 0) return 1; const power = 10 ** Math.floor(Math.log10(value)); return [1, 2, 2.5, 5, 10].map(step => step * power).find(step => step >= value)!; };
const compact = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}K` : `${Math.round(value * 10) / 10}`;
const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;

function useWidth() {
  const ref = useRef<HTMLDivElement>(null); const [width, setWidth] = useState(400);
  useEffect(() => { const el = ref.current; if (!el) return; const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, entry.contentRect.width))); observer.observe(el); return () => observer.disconnect(); }, []);
  return [ref, width] as const;
}

function Chart({ spec, points, from, to, cursor, onSeek }: { spec: ChartSpec; points: SeriesPoint[]; from: number; to: number; cursor: number; onSeek: (time: number) => void }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const span = Math.max(1, to - from); const plotW = width - PAD.left - PAD.right; const plotH = HEIGHT - PAD.top - PAD.bottom;
  // A few extreme buckets (e.g. one PDF export) would flatten everything else: cap the axis and mark them instead.
  const values = points.flatMap(point => spec.series.map(series => point[series.key])).filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b);
  const peak = values[values.length - 1] ?? 0; const q95 = values[Math.floor((values.length - 1) * .95)] ?? 0;
  const capped = spec.kind === 'line' && values.length >= 20 && peak > q95 * 4;
  const max = niceCeil(capped ? q95 * 1.5 : peak);
  const x = (t: number) => PAD.left + (t - from) / span * plotW; const y = (value: number) => PAD.top + plotH - Math.min(value, max) / max * plotH;
  const bucket = points.length > 1 ? points[1].t - points[0].t : span;
  const current = cursor >= from && points.length ? points[Math.min(points.length - 1, Math.floor((cursor - from) / bucket))] : null;
  const shown = hover !== null ? points[hover] : current;
  const path = (key: Series['key']) => { let d = ''; let pen = false; points.forEach(point => { const value = point[key]; if (value === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(point.t).toFixed(1)},${y(value).toFixed(1)}`; pen = true; }); return d; };
  const barW = Math.max(1, Math.min(24, plotW / Math.max(1, points.length) - 2));
  const clipId = `clip-${spec.series[0].key}`;
  const nearest = (clientX: number, box: DOMRect) => { const t = from + (clientX - box.left - PAD.left) / plotW * span; let best = 0; points.forEach((point, index) => { if (Math.abs(point.t - bucket / 2 - t) < Math.abs(points[best].t - bucket / 2 - t)) best = index; }); return best; };
  return <div ref={ref} className="rounded-xl border border-slate-700 bg-slate-900 p-3">
    <div className="flex items-baseline justify-between gap-2"><p className="text-xs text-slate-400">{spec.title}</p>
      {spec.series.length > 1 && <div className="flex gap-3 text-[11px] text-slate-400">{spec.series.map(series => <span key={series.key} className="flex items-center gap-1"><span className="inline-block h-0.5 w-3 rounded" style={{ background: series.color }} />{series.label}</span>)}</div>}</div>
    <p className="mt-0.5 text-lg font-semibold text-slate-100">{shown ? spec.series.map(series => shown[series.key] === null ? '-' : `${spec.format(shown[series.key]!)}`).join(' / ') : '-'}<span className="ml-1 text-xs font-normal text-slate-400">{spec.unit}{hover !== null ? ` · ${seconds(points[hover].t - from)} 구간` : ' · 현재 구간'}</span></p>
    <svg width={width} height={HEIGHT} role="img" aria-label={`${spec.title} 시간 추이`} className="cursor-crosshair"
      onMouseMove={event => setHover(nearest(event.clientX, event.currentTarget.getBoundingClientRect()))} onMouseLeave={() => setHover(null)}
      onClick={event => { const index = nearest(event.clientX, event.currentTarget.getBoundingClientRect()); onSeek(points[index].t - bucket / 2); }}>
      <defs><clipPath id={clipId}><rect x={0} y={0} width={Math.max(0, x(Math.min(cursor, to)))} height={HEIGHT} /></clipPath></defs>
      {[0, .5, 1].map(f => <g key={f}><line x1={PAD.left} x2={width - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke={f === 0 ? INK.axis : INK.grid} strokeWidth={1} /><text x={PAD.left - 6} y={y(max * f) + 3} textAnchor="end" fontSize={10} fill={INK.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>{compact(max * f)}</text></g>)}
      {[0, .5, 1].map(f => <text key={f} x={PAD.left + f * plotW} y={HEIGHT - 5} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fontSize={10} fill={INK.muted}>{seconds(span * f)}</text>)}
      {[false, true].map(clipped => <g key={String(clipped)} clipPath={clipped ? `url(#${clipId})` : undefined} opacity={clipped ? 1 : .3}>
        {spec.kind === 'bars'
          ? points.map(point => point[spec.series[0].key] ? <path key={point.t} d={roundedTop(x(point.t - bucket / 2) - barW / 2, y(point[spec.series[0].key]!), barW, PAD.top + plotH - y(point[spec.series[0].key]!))} fill={spec.series[0].color} /> : null)
          : spec.series.map(series => <g key={series.key}>{spec.series.length === 1 && <path d={`${path(series.key)}L${x(points[points.length - 1]?.t ?? to)},${y(0)}L${x(points[0]?.t ?? from)},${y(0)}Z`} fill={series.color} opacity={.1} />}<path d={path(series.key)} fill="none" stroke={series.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" /></g>)}
      </g>)}
      {capped && points.filter(point => spec.series.some(series => (point[series.key] ?? 0) > max)).map(point => <path key={`over-${point.t}`} d={`M${x(point.t)},${PAD.top - 1}l-4,6h8z`} fill={INK.secondary}><title>{spec.series.map(series => `${series.label} ${spec.format(point[series.key] ?? 0)}${spec.unit}`).join(' / ')}</title></path>)}
      {capped && <text x={width - PAD.right} y={PAD.top + 8} textAnchor="end" fontSize={10} fill={INK.secondary}>▲ 축 밖 최대 {spec.format(peak)}{spec.unit}</text>}
      <line x1={x(Math.min(cursor, to))} x2={x(Math.min(cursor, to))} y1={PAD.top} y2={PAD.top + plotH} stroke={INK.secondary} strokeWidth={1} />
      {hover !== null && <line x1={x(points[hover].t - bucket / 2)} x2={x(points[hover].t - bucket / 2)} y1={PAD.top} y2={PAD.top + plotH} stroke={INK.muted} strokeWidth={1} />}
    </svg>
  </div>;
}

/** Bar with a 4px rounded data-end and a square baseline. */
function roundedTop(left: number, top: number, width: number, height: number) {
  const r = Math.min(4, width / 2, height); const bottom = top + height;
  return `M${left},${bottom}V${top + r}Q${left},${top} ${left + r},${top}H${left + width - r}Q${left + width},${top} ${left + width},${top + r}V${bottom}Z`;
}

export default function TimeSeriesCharts({ points, from, to, cursor, stepLabel, onSeek }: { points: SeriesPoint[]; from: number; to: number; cursor: number; stepLabel: string | null; onSeek: (time: number) => void }) {
  const charts: ChartSpec[] = [
    { title: '활성 사용자', unit: '명', kind: 'line', series: [{ key: 'active', label: '활성 사용자', color: SERIES_1 }], format: value => `${Math.round(value)}` },
    { title: '처리량 (완료 요청)', unit: 'req/s', kind: 'line', series: [{ key: 'throughput', label: '처리량', color: SERIES_1 }], format: value => value.toFixed(1) },
    { title: stepLabel ? `응답시간 — ${stepLabel}` : '응답시간 (전체 단계)', unit: 'ms', kind: 'line', series: [{ key: 'p50', label: 'p50', color: SERIES_1 }, { key: 'p95', label: 'p95', color: SERIES_2 }], format: value => Math.round(value).toLocaleString() },
    { title: '✖ 오류', unit: '건', kind: 'bars', series: [{ key: 'errors', label: '오류', color: CRITICAL }], format: value => `${Math.round(value)}` },
  ];
  return <div className="grid gap-3 md:grid-cols-2">{charts.map(spec => <Chart key={spec.title} spec={spec} points={points} from={from} to={to} cursor={cursor} onSeek={onSeek} />)}</div>;
}
