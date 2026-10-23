import type { StageDefinition } from '../TopologyCanvas';
import { slowdownLevel, type StepState } from '../../services/flowModel';
import { loadColor } from '../FlowParts';

/** Every step as one small cell (number = throughput, color = response slowdown), so the whole process is visible without scrolling. */
export default function StepSummaryStrip({ stages, states, summary, selectedStage, onPick }: { stages: StageDefinition[]; states: StepState[]; summary: boolean; selectedStage: string | null; onPick: (id: string) => void }) {
  return <div id="jlt-step-strip" className="flex items-stretch gap-1 overflow-x-auto" aria-label="전체 단계 요약">
    {stages.map((stage, index) => {
      const state = states[index]; const selected = selectedStage === stage.id; const order = stage.order ?? index + 1;
      const level = state.slowdown === null ? null : slowdownLevel(state.slowdown); const fill = level === null ? undefined : loadColor(level, .3 + .4 * level);
      const border = selected ? 'border-slate-50 ring-1 ring-slate-50/60' : 'border-slate-700';
      return <button key={stage.id} id={`jlt-strip-${stage.id}`} data-testid={`strip-cell-${stage.id}`} onClick={() => onPick(stage.id)}
        title={`${order}. ${stage.name}\n${summary ? '최대 처리량' : '처리량'} ${state.throughput} req/s · ${summary ? '최대 동시' : '동시'} ${state.users}명 · 평소 대비${summary ? ' 최대' : ''} ${state.slowdown === null ? '-' : `×${state.slowdown.toFixed(1)}`} · 도달 ${state.reached}명 · 평균 ${Math.round(state.averageMs).toLocaleString()}ms${state.errors ? ` · 오류 ${state.errors}` : ''}\n클릭하면 이 단계로 이동`}
        className={`relative flex h-7 min-w-[40px] flex-1 items-center justify-center gap-1 rounded-md border bg-slate-900 px-1 text-[10px] leading-none hover:bg-slate-800 ${border}`} style={fill ? { background: fill } : undefined}>
        <span id={`jlt-strip-${stage.id}-order`} className="text-slate-400">{order}{stage.repeat ? '↻' : ''}</span>
        <span id={`jlt-strip-${stage.id}-throughput`} className={`text-sm font-bold ${state.throughput ? 'text-slate-50' : 'text-slate-600'}`}>{state.throughput || '·'}</span>
        {state.errors > 0 && <span id={`jlt-strip-${stage.id}-error`} className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-400" />}
      </button>;
    })}
  </div>;
}
