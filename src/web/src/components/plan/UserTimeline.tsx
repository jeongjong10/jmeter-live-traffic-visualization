import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { StageDefinition } from '../TopologyCanvas';
import type { Visit } from '../../services/flowModel';
import { cssColor, useThemeVersion } from '../FlowParts';

const MAX_USERS = 60; const ROW_H = 22; const LABEL_W = 220;

/** One row per virtual-user journey; each bar is one request. Drawn on a canvas so thousands of requests stay cheap. */
export default memo(function UserTimeline({ visits, stages, range, cursor, focusRun, onFocusRun, onSelect, onSeek, selectedStage }: {
  visits: Visit[]; stages: StageDefinition[]; range: { min: number; max: number }; cursor: number; selectedStage: string | null;
  focusRun: string | null; onFocusRun: (runId: string | null) => void; onSelect: (visit: Visit) => void; onSeek: (time: number) => void;
}) {
  const host = useRef<HTMLDivElement>(null); const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(1000); const [hover, setHover] = useState<{ visit: Visit; x: number; y: number } | null>(null);
  const theme = useThemeVersion();
  useEffect(() => { const el = host.current; if (!el) return; const observer = new ResizeObserver(([entry]) => setWidth(Math.max(400, entry.contentRect.width))); observer.observe(el); return () => observer.disconnect(); }, []);
  const users = useMemo(() => [...new Set(visits.map(visit => visit.correlationId))], [visits]);
  const shown = useMemo(() => users.slice(0, MAX_USERS), [users]);
  const rowOf = useMemo(() => new Map(shown.map((user, index) => [user, index])), [shown]);
  const span = Math.max(1, range.max - range.min); const plotW = width - LABEL_W - 8;
  const xOf = (time: number) => LABEL_W + Math.max(0, Math.min(1, (time - range.min) / span)) * plotW;
  const height = shown.length * ROW_H + 4;
  const stepName = (stepId: string) => { const index = stages.findIndex(stage => stage.id === stepId); return `${index + 1}. ${stages[index]?.name ?? stepId}`; };

  useEffect(() => {
    const el = canvas.current; if (!el) return; const ctx = el.getContext('2d'); if (!ctx) return;
    const dpr = window.devicePixelRatio || 1; el.width = width * dpr; el.height = height * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
    const ink = cssColor('--ink-secondary'); const grid = cssColor('--chart-grid'); const bar = cssColor('--series-1'); const selected = cssColor('--series-2'); const critical = cssColor('--critical'); const focusBg = cssColor('--c-blue-500', .15);
    ctx.font = '11px system-ui'; ctx.textBaseline = 'middle';
    shown.forEach((user, row) => {
      const y = row * ROW_H;
      if (user === focusRun) { ctx.fillStyle = focusBg; ctx.fillRect(0, y, width, ROW_H); }
      ctx.fillStyle = ink; ctx.fillText(user.length > 32 ? `…${user.slice(-31)}` : user, 6, y + ROW_H / 2);
      ctx.fillStyle = grid; ctx.fillRect(0, y + ROW_H - 1, width, 1);
    });
    visits.forEach(visit => {
      const row = rowOf.get(visit.correlationId); if (row === undefined || visit.start > cursor) return;
      const open = visit.end === null || visit.end > cursor; const end = open ? cursor : visit.end!;
      const x = xOf(visit.start); const w = Math.max(1.5, xOf(end) - x - 1);
      ctx.globalAlpha = (focusRun && focusRun !== visit.correlationId ? .3 : 1) * (open ? .55 : .9);
      ctx.fillStyle = !open && !visit.success ? critical : visit.stepId === selectedStage ? selected : bar;
      ctx.fillRect(x, row * ROW_H + 4, w, ROW_H - 9);
    });
    ctx.globalAlpha = 1; ctx.fillStyle = ink; ctx.fillRect(xOf(Math.min(cursor, range.max)), 0, 1, height);
  }, [visits, shown, rowOf, width, height, cursor, focusRun, selectedStage, range.min, range.max, theme]);

  const hitTest = (clientX: number, clientY: number) => {
    const box = canvas.current!.getBoundingClientRect(); const x = clientX - box.left; const y = clientY - box.top;
    const row = Math.floor(y / ROW_H); const user = shown[row]; const time = range.min + (x - LABEL_W) / plotW * span;
    if (!user) return { x, y, user: null, visit: null, time };
    const visit = x < LABEL_W ? null : visits.find(item => item.correlationId === user && item.start <= time && (item.end ?? cursor) >= time && item.start <= cursor) ?? null;
    return { x, y, user, visit, time };
  };
  return <div id="jlt-user-timeline">
    <div id="jlt-user-timeline-scroll" ref={host} className="relative max-h-[460px] overflow-y-auto rounded-lg border border-slate-800">
      <canvas id="jlt-user-timeline-canvas" ref={canvas} style={{ width, height }} className="block cursor-pointer"
        onMouseMove={event => { const hit = hitTest(event.clientX, event.clientY); setHover(hit.visit ? { visit: hit.visit, x: hit.x, y: hit.y } : null); }}
        onMouseLeave={() => setHover(null)}
        onClick={event => { const hit = hitTest(event.clientX, event.clientY); if (hit.x < LABEL_W) onFocusRun(hit.user === focusRun ? null : hit.user); else if (hit.visit) onSelect(hit.visit); else onSeek(hit.time); }} />
      {hover && <div id="jlt-user-timeline-tooltip" className="pointer-events-none absolute z-10 rounded-lg border border-slate-600 bg-slate-950/95 px-3 py-2 text-xs" style={{ left: Math.min(hover.x + 12, width - 260), top: hover.y + 12 }}>
        <p id="jlt-user-timeline-tooltip-step" className="font-semibold text-slate-100">{stepName(hover.visit.stepId)}</p>
        <p id="jlt-user-timeline-tooltip-result" className="text-slate-300">{hover.visit.end === null || hover.visit.end > cursor ? '처리 중' : `${hover.visit.durationMs.toLocaleString()} ms · ${hover.visit.success ? '성공' : `오류 ${hover.visit.status}`}`}</p>
      </div>}
    </div>
    <p id="jlt-user-timeline-note" className="mt-2 text-[11px] text-slate-500">가로축은 전체 기록 시간, 막대 하나가 요청 하나입니다. 주황은 선택한 단계, 빨강은 오류, 흐린 막대는 처리 중입니다. 사용자 이름을 클릭하면 여정 강조, 막대를 클릭하면 샘플 상세, 빈 곳을 클릭하면 그 시점으로 이동합니다.{users.length > MAX_USERS ? ` 사용자 ${users.length}명 중 처음 ${MAX_USERS}명만 표시합니다.` : ''}</p>
  </div>;
});
