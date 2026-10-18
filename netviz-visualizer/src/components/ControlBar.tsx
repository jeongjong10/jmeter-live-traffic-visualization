const speeds = [0.125, 0.25, 0.5, 0.75, 1, 2] as const;

interface ControlBarProps {
  isCapturing: boolean;
  isReplaying: boolean;
  isTimelinePlaying: boolean;
  recordingCount: number;
  replaySpeed: number;
  onToggleCapture: () => void;
  onClear: () => void;
  onReplay: (speed: number) => void;
  onReplayFromStart: () => void;
  onReplaySpeedChange: (speed: number) => void;
  onTimelinePlayToggle: () => void;
}

export default function ControlBar({ isCapturing, isReplaying, isTimelinePlaying, recordingCount, replaySpeed, onToggleCapture, onClear, onReplay, onReplayFromStart, onReplaySpeedChange, onTimelinePlayToggle }: ControlBarProps) {
  return <div className="flex flex-wrap items-center gap-2">
    <button onClick={onReplayFromStart} disabled={!recordingCount} title="현재 위치를 기록의 처음으로 되돌리고 선택한 속도로 바로 재생합니다" className="rounded-lg bg-blue-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-blue-400 disabled:opacity-40">⏮ 처음부터 재생</button>
    <div className="flex items-center gap-2"><div className={`h-2 w-2 rounded-full ${isCapturing ? 'animate-pulse bg-accent-red' : 'bg-gray-500'}`} /><span className="text-xs text-gray-400">{isCapturing ? '실시간 수집 중' : '수집 일시정지'}</span></div>
    <button onClick={onToggleCapture} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${isCapturing ? 'bg-accent-red/20 text-accent-red hover:bg-accent-red/30' : 'bg-accent-green/20 text-accent-green hover:bg-accent-green/30'}`}>{isCapturing ? '수집 잠시 멈춤' : '실시간 수집 재개'}</button>
    <button onClick={onTimelinePlayToggle} className="rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-gray-200 hover:bg-surface-600">{isTimelinePlaying ? 'Ⅱ 화면 일시정지' : '▶ 화면 재생'}</button>
    <button onClick={() => onReplay(replaySpeed)} disabled={!recordingCount || isReplaying} className="rounded-lg bg-accent-blue/20 px-3 py-1.5 text-xs font-medium text-accent-blue transition-all hover:bg-accent-blue/30 disabled:opacity-40">{isReplaying ? '↻ 기록 재생 중' : `↻ 기록 다시 불러오기 (${recordingCount})`}</button>
    <div className="flex items-center gap-1 rounded-lg bg-slate-800 p-1" aria-label="재생 속도">
      <span className="px-1 text-[10px] text-slate-400">속도</span>
      {speeds.map(speed => <button key={speed} onClick={() => onReplaySpeedChange(speed)} className={`rounded px-1.5 py-1 text-[11px] font-semibold ${replaySpeed === speed ? 'bg-blue-500 text-white' : 'text-slate-300 hover:bg-slate-700'}`} aria-label={`재생 속도 ${speed}배`}>{speed}×</button>)}
    </div>
    <button onClick={onClear} className="rounded-lg bg-surface-700 px-3 py-1.5 text-xs font-medium text-gray-300 transition-all hover:bg-surface-600">화면 초기화</button>
    <div className="hidden items-center gap-2 md:flex"><Legend color="bg-accent-green" label="정상" /><Legend color="bg-orange-400" label="지연" /><Legend color="bg-accent-red" label="오류" /></div>
  </div>;
}

function Legend({ color, label }: { color: string; label: string }) { return <div className="flex items-center gap-1"><div className={`h-2 w-2 rounded-full ${color}`} /><span className="text-[10px] text-gray-500">{label}</span></div>; }
