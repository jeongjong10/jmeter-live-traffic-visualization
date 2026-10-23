import { useEffect, useRef, useState } from 'react';
import type { SeriesPoint } from '../../services/flowModel';

/* Chart tokens for the app's dark surface (#0f172a); the series pair and the
 * status red were checked with the dataviz palette validator on that surface. */
const INK = { primary: '#f0efec', secondary: '#c3c2b7', muted: '#898781', grid: '#1e293b', axis: '#334155' };
const SERIES_1 = '#3987e5';
const SERIES_2 = '#d95926';
const CRITICAL = '#d03b3b';
/** Every chart is optional; these four are on until the viewer changes the selection (remembered per browser). */
const SHOWN_KEY = 'jlt-charts-shown';
const DEFAULT_SHOWN = ['active', 'throughput', 'response', 'errors'];
const readShown = (): Set<string> => { try { const saved = localStorage.getItem(SHOWN_KEY); return new Set(saved ? JSON.parse(saved) as string[] : DEFAULT_SHOWN); } catch { return new Set(DEFAULT_SHOWN); } };
const HEIGHT = 132; const PAD = { left: 44, right: 10, top: 10, bottom: 20 };

// Extra categorical hues for the candidate charts (3+ series); checked against the same dark surface.
const SERIES_3 = '#2bb3a3'; const SERIES_4 = '#9c6ade'; const NEUTRAL = '#898781';
type SeriesKey = Exclude<keyof SeriesPoint, 't'>;
type Series = { key: SeriesKey; label: string; color: string };
/** `stack` draws one bar per bucket split into the series (parts of a whole). */
type ChartSpec = { id: string; title: string; unit: string; kind: 'line' | 'bars' | 'stack'; series: Series[]; format: (value: number) => string; note?: string };

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
  const values = (spec.kind === 'stack' ? points.map(point => spec.series.reduce((sum, series) => sum + (point[series.key] ?? 0), 0)) : points.flatMap(point => spec.series.map(series => point[series.key]))).filter((value): value is number => value !== null && value > 0).sort((a, b) => a - b);
  const peak = values[values.length - 1] ?? 0; const q95 = values[Math.floor((values.length - 1) * .95)] ?? 0;
  const capped = spec.kind === 'line' && values.length >= 20 && peak > q95 * 4;
  const max = niceCeil(capped ? q95 * 1.5 : peak);
  const x = (t: number) => PAD.left + (t - from) / span * plotW; const y = (value: number) => PAD.top + plotH - Math.min(value, max) / max * plotH;
  const bucket = points.length > 1 ? points[1].t - points[0].t : span;
  const current = cursor >= from && points.length ? points[Math.min(points.length - 1, Math.floor((cursor - from) / bucket))] : null;
  const shown = hover !== null ? points[hover] : current;
  const path = (key: Series['key']) => { let d = ''; let pen = false; points.forEach(point => { const value = point[key]; if (value === null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${x(point.t).toFixed(1)},${y(value).toFixed(1)}`; pen = true; }); return d; };
  const barW = Math.max(1, Math.min(24, plotW / Math.max(1, points.length) - 2));
  const clipId = `jlt-chart-${spec.id}-clip`; const c = `jlt-chart-${spec.id}`;
  const nearest = (clientX: number, box: DOMRect) => { const t = from + (clientX - box.left - PAD.left) / plotW * span; let best = 0; points.forEach((point, index) => { if (Math.abs(point.t - bucket / 2 - t) < Math.abs(points[best].t - bucket / 2 - t)) best = index; }); return best; };
  const valueOf = (series: Series) => shown && shown[series.key] !== null ? spec.format(shown[series.key]!) : '-';
  const where = hover !== null ? `${seconds(points[hover].t - from)} 구간` : '현재 구간';
  return <div ref={ref} id={c} className="rounded-xl border border-slate-700 bg-slate-900 p-3">
    <p id={`${c}-title`} className="text-xs text-slate-400" title={spec.note}>{spec.title}{spec.note && <span id={`${c}-info`} className="ml-1 cursor-help text-slate-500">ⓘ</span>}</p>
    {spec.series.length > 1
      // One column per series: its name above its value, both in the series color, so each number reads with its line.
      ? <div id={`${c}-values`} className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">{spec.series.map(series => <div key={series.key} id={`${c}-${series.key}`} className="leading-tight" style={{ color: series.color }}>
          <p id={`${c}-${series.key}-label`} className="flex items-center gap-1 text-[11px] font-semibold"><span id={`${c}-${series.key}-swatch`} className="inline-block h-0.5 w-3 rounded" style={{ background: series.color }} />{series.label}</p>
          <p id={`${c}-${series.key}-value`} className="text-lg font-semibold">{valueOf(series)}</p></div>)}
          <p id={`${c}-unit`} className="pb-0.5 text-xs text-slate-400">{spec.unit} · {where}</p></div>
      : <p id={`${c}-value`} className="mt-0.5 text-lg font-semibold text-slate-100">{valueOf(spec.series[0])}<span id={`${c}-unit`} className="ml-1 text-xs font-normal text-slate-400">{spec.unit} · {where}</span></p>}
    <svg id={`${c}-plot`} width={width} height={HEIGHT} role="img" aria-label={`${spec.title} 시간 추이`} className="cursor-crosshair"
      onMouseMove={event => setHover(nearest(event.clientX, event.currentTarget.getBoundingClientRect()))} onMouseLeave={() => setHover(null)}
      onClick={event => { const index = nearest(event.clientX, event.currentTarget.getBoundingClientRect()); onSeek(points[index].t - bucket / 2); }}>
      <defs><clipPath id={clipId}><rect x={0} y={0} width={Math.max(0, x(Math.min(cursor, to)))} height={HEIGHT} /></clipPath></defs>
      {[0, .5, 1].map(f => <g key={f}><line x1={PAD.left} x2={width - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke={f === 0 ? INK.axis : INK.grid} strokeWidth={1} /><text x={PAD.left - 6} y={y(max * f) + 3} textAnchor="end" fontSize={10} fill={INK.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>{compact(max * f)}</text></g>)}
      {[0, .5, 1].map(f => <text key={f} x={PAD.left + f * plotW} y={HEIGHT - 5} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fontSize={10} fill={INK.muted}>{seconds(span * f)}</text>)}
      {[false, true].map(clipped => <g key={String(clipped)} clipPath={clipped ? `url(#${clipId})` : undefined} opacity={clipped ? 1 : .3}>
        {spec.kind === 'stack'
          ? points.map(point => { let base = 0; return <g key={point.t}>{spec.series.map(series => { const value = point[series.key] ?? 0; if (value <= 0) return null; const top = y(base + value); const bottom = y(base); base += value; return <rect key={series.key} x={x(point.t - bucket / 2) - barW / 2} y={top} width={barW} height={Math.max(0, bottom - top)} fill={series.color} />; })}</g>; })
          : spec.kind === 'bars'
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

/** Response time and throughput against the number of active users (JMeter "vs Threads" graphs): where adding users stops adding throughput. */
function ScalabilityChart({ points }: { points: SeriesPoint[] }) {
  const [ref, width] = useWidth();
  const groups = new Map<number, { throughput: number[]; p95: number[] }>();
  points.forEach(point => { if (point.active <= 0) return; const group = groups.get(point.active) ?? { throughput: [], p95: [] }; group.throughput.push(point.throughput); if (point.p95 !== null) group.p95.push(point.p95); groups.set(point.active, group); });
  const users = [...groups.keys()].sort((a, b) => a - b);
  const avg = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const panelW = Math.max(160, (width - 12) / 2); const maxUsers = niceCeil(Math.max(1, ...users));
  const panel = (title: string, unit: string, color: string, pick: (group: { throughput: number[]; p95: number[] }) => number | null, format: (value: number) => string) => {
    const rows = users.map(count => ({ count, value: pick(groups.get(count)!) })).filter((row): row is { count: number; value: number } => row.value !== null);
    const max = niceCeil(Math.max(0, ...rows.map(row => row.value)));
    const plotW = panelW - PAD.left - PAD.right; const plotH = HEIGHT - PAD.top - PAD.bottom;
    const x = (count: number) => PAD.left + count / maxUsers * plotW; const y = (value: number) => PAD.top + plotH - value / max * plotH;
    return <div id={`jlt-chart-scalability-${color === SERIES_1 ? 'throughput' : 'p95'}`}><p id={`jlt-chart-scalability-${color === SERIES_1 ? 'throughput' : 'p95'}-title`} className="mb-1 text-[11px] text-slate-400">{title}</p>
      <svg id={`jlt-chart-scalability-${color === SERIES_1 ? 'throughput' : 'p95'}-plot`} width={panelW} height={HEIGHT} role="img" aria-label={title}>
        {[0, .5, 1].map(f => <g key={f}><line x1={PAD.left} x2={panelW - PAD.right} y1={y(max * f)} y2={y(max * f)} stroke={f === 0 ? INK.axis : INK.grid} /><text x={PAD.left - 6} y={y(max * f) + 3} textAnchor="end" fontSize={10} fill={INK.muted}>{compact(max * f)}</text></g>)}
        {[0, .5, 1].map(f => <text key={f} x={PAD.left + f * plotW} y={HEIGHT - 5} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fontSize={10} fill={INK.muted}>{`${Math.round(maxUsers * f)}명`}</text>)}
        <path d={rows.map((row, index) => `${index ? 'L' : 'M'}${x(row.count).toFixed(1)},${y(row.value).toFixed(1)}`).join('')} fill="none" stroke={color} strokeWidth={2} />
        {rows.map(row => <circle key={row.count} cx={x(row.count)} cy={y(row.value)} r={3.5} fill={color}><title>{`활성 사용자 ${row.count}명 → ${format(row.value)} ${unit}`}</title></circle>)}
      </svg></div>;
  };
  return <div ref={ref} id="jlt-chart-scalability" className="rounded-xl border border-slate-700 bg-slate-900 p-3">
    <p id="jlt-chart-scalability-title" className="text-xs text-slate-400" title="같은 활성 사용자 수였던 시간 구간들의 평균입니다. 사용자가 늘어도 처리량이 더 오르지 않고 응답시간만 오르기 시작하는 지점이 포화점입니다.">사용자 수 대비 처리량·응답시간 (포화점)<span id="jlt-chart-scalability-info" className="ml-1 cursor-help text-slate-500">ⓘ</span></p>
    {users.length < 2 ? <p id="jlt-chart-scalability-empty" className="mt-6 text-sm text-slate-500">활성 사용자 수가 두 가지 이상 관측되면 그려집니다.</p>
      : <div id="jlt-chart-scalability-panels" className="mt-1 flex flex-wrap gap-3">{panel('활성 사용자 → 처리량 (req/s)', 'req/s', SERIES_1, group => avg(group.throughput), value => value.toFixed(1))}{panel('활성 사용자 → p95 응답시간 (ms)', 'ms', SERIES_2, group => avg(group.p95), value => Math.round(value).toLocaleString())}</div>}
  </div>;
}

export default function TimeSeriesCharts({ points, from, to, cursor, stepLabel, onSeek }: { points: SeriesPoint[]; from: number; to: number; cursor: number; stepLabel: string | null; onSeek: (time: number) => void }) {
  const charts: ChartSpec[] = [
    { id: 'active', title: '활성 사용자', unit: '명', kind: 'line', series: [{ key: 'active', label: '활성 사용자', color: SERIES_1 }], format: value => `${Math.round(value)}` },
    { id: 'throughput', title: '처리량 (완료 요청)', unit: 'req/s', kind: 'line', series: [{ key: 'throughput', label: '처리량', color: SERIES_1 }], format: value => value.toFixed(1) },
    { id: 'response', title: stepLabel ? `응답시간 — ${stepLabel}` : '응답시간 (전체 단계)', unit: 'ms', kind: 'line', series: [{ key: 'p50', label: 'p50', color: SERIES_1 }, { key: 'p95', label: 'p95', color: SERIES_2 }], format: value => Math.round(value).toLocaleString() },
    { id: 'errors', title: '✖ 오류', unit: '건', kind: 'bars', series: [{ key: 'errors', label: '오류', color: CRITICAL }], format: value => `${Math.round(value)}` },
  ];
  const scope = stepLabel ? ` — ${stepLabel}` : ' (전체 단계)';
  const candidates: ChartSpec[] = [
    { id: 'breakdown', title: `응답시간 구성${scope}`, unit: 'ms', kind: 'stack', note: '구간에 끝난 요청의 평균을 연결 시간(connect), 서버 대기(latency − connect, 첫 바이트까지), 수신(elapsed − latency)으로 나눴습니다. 어느 부분이 늘었는지로 원인이 네트워크·서버·응답 크기 중 어디인지 봅니다.',
      series: [{ key: 'connect', label: '연결', color: SERIES_4 }, { key: 'wait', label: '서버 대기', color: SERIES_1 }, { key: 'receive', label: '수신', color: SERIES_3 }], format: value => Math.round(value).toLocaleString() },
    { id: 'codes', title: '응답 코드별 건수 (전체 단계)', unit: '건', kind: 'stack', note: '구간에 끝난 요청을 응답 코드 범위별로 쌓았습니다. 4xx는 요청 쪽 문제, 5xx는 서버 오류입니다. 기타는 연결 실패처럼 HTTP 코드가 없는 경우입니다.',
      series: [{ key: 'code2xx', label: '2xx', color: SERIES_1 }, { key: 'code3xx', label: '3xx', color: SERIES_3 }, { key: 'code4xx', label: '4xx', color: SERIES_2 }, { key: 'code5xx', label: '5xx', color: CRITICAL }, { key: 'codeOther', label: '기타', color: NEUTRAL }], format: value => `${Math.round(value)}` },
    { id: 'percentiles', title: `응답시간 백분위${scope}`, unit: 'ms', kind: 'line', note: '구간에 끝난 요청의 p50·p90·p95·p99입니다. p99가 p50에서 멀어질수록 일부 요청만 크게 느린 것입니다.',
      series: [{ key: 'p50', label: 'p50', color: SERIES_1 }, { key: 'p90', label: 'p90', color: SERIES_3 }, { key: 'p95', label: 'p95', color: SERIES_2 }, { key: 'p99', label: 'p99', color: SERIES_4 }], format: value => Math.round(value).toLocaleString() },
    { id: 'error-rate', title: '오류율 (전체 단계)', unit: '%', kind: 'line', note: '구간에 끝난 요청 중 실패 비율입니다. 처리량이 변해도 비교할 수 있습니다.',
      series: [{ key: 'errorPct', label: '오류율', color: CRITICAL }], format: value => value.toFixed(1) },
  ];
  // Picker order = display order.
  const all: ({ id: string; label: string; spec?: ChartSpec })[] = [
    ...charts.map(spec => ({ id: spec.id, label: spec.id === 'response' ? '응답시간' : spec.title.replace('✖ ', ''), spec })),
    { id: 'scalability', label: '사용자 수 대비 처리량·응답시간' },
    ...candidates.map(spec => ({ id: spec.id, label: spec.title.replace(scope, '').replace(' (전체 단계)', ''), spec })),
  ];
  const [shown, setShown] = useState<Set<string>>(readShown);
  const toggle = (id: string) => setShown(current => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); try { localStorage.setItem(SHOWN_KEY, JSON.stringify([...next])); } catch { /* storage unavailable */ } return next; });
  return <div id="jlt-charts" className="space-y-3">
    <div id="jlt-charts-picker" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs"><span id="jlt-charts-picker-title" className="font-semibold text-slate-300">그래프 선택</span>
      {all.map(option => <label key={option.id} id={`jlt-chart-pick-${option.id}`} className="flex cursor-pointer items-center gap-1 text-slate-300"><input id={`jlt-chart-pick-${option.id}-input`} type="checkbox" checked={shown.has(option.id)} onChange={() => toggle(option.id)} className="accent-blue-500" /><span id={`jlt-chart-pick-${option.id}-label`}>{option.label}</span></label>)}
      <span id="jlt-charts-picker-hint" className="text-slate-500">체크한 그래프만 표시 · 이 브라우저에 기억 · 제목의 ⓘ = 읽는 법</span></div>
    {shown.size > 0 && <div id="jlt-charts-grid" className="grid gap-3 md:grid-cols-2">{all.filter(option => shown.has(option.id)).map(option => option.spec ? <Chart key={option.id} spec={option.spec} points={points} from={from} to={to} cursor={cursor} onSeek={onSeek} /> : <ScalabilityChart key={option.id} points={points} />)}</div>}
  </div>;
}
