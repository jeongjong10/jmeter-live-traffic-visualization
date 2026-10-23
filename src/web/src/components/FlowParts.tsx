import { useEffect, useState, useSyncExternalStore } from 'react';

/** Small UI pieces shared by the dashboard views. */
export const clock = (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1)}초`;

export function TimelineScrubber({ min, max, value, playing, onChange, onPlayToggle, id }: { min: number; max: number; value: number; playing: boolean; onChange: (value: number) => void; onPlayToggle: () => void; id?: string }) {
  const duration = Math.max(1, max - min); const percent = Math.min(100, Math.max(0, (value - min) / duration * 100));
  const track = { background: `linear-gradient(to right, rgb(var(--c-blue-500)) 0%, rgb(var(--c-blue-500)) ${percent}%, rgb(var(--c-slate-700)) ${percent}%, rgb(var(--c-slate-700)) 100%)` };
  return <div id={id} className="flex items-center gap-2 text-xs" title="전체 기록 타임라인: 막대를 클릭하거나 드래그하면 그 시점으로 이동합니다"><button id={id ? `${id}-play` : undefined} onClick={onPlayToggle} className="min-w-8 rounded bg-slate-700 px-2 py-0.5 text-sm hover:bg-slate-600" aria-label={playing ? '일시정지' : '재생'}>{playing ? 'Ⅱ' : '▶'}</button><input id={id ? `${id}-range` : undefined} aria-label="기록 재생 위치" type="range" min={min} max={max} step={10} value={value} onChange={event => onChange(Number(event.target.value))} className="h-2 min-w-0 flex-1 cursor-pointer accent-blue-500" style={track} /><span id={id ? `${id}-time` : undefined} className="whitespace-nowrap text-slate-400">{clock(value - min)} / {clock(duration)}</span></div>;
}

export function Tile({ label, value, red, warn, id }: { label: string; value: string; red?: boolean; warn?: boolean; id?: string }) { return <div id={id} title={`${label}: ${value}`} className="min-w-0 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1"><p id={id ? `${id}-label` : undefined} className="truncate text-[10px] text-slate-400">{label}</p><p id={id ? `${id}-value` : undefined} className={`truncate text-sm font-bold ${red ? 'text-red-300' : warn ? 'text-orange-300' : 'text-blue-200'}`}>{value}</p></div>; }

/**
 * Playback position shared outside React state. Only the parts that move every
 * frame (timeline bar, user tokens, round-trip canvas) subscribe to it, so the
 * rest of the dashboard is not re-rendered 60 times a second.
 */
export class PlaybackClock {
  cursor: number;
  private listeners = new Set<() => void>();
  constructor(cursor: number) { this.cursor = cursor; }
  set(cursor: number) { if (cursor === this.cursor) return; this.cursor = cursor; this.listeners.forEach(listener => listener()); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
}
export function useClock(clockRef: PlaybackClock) { return useSyncExternalStore(clockRef.subscribe, () => clockRef.cursor); }

/* Theme: 'system' follows the OS; 'dark'/'light' are stored per viewer. */
export type ThemeChoice = 'system' | 'dark' | 'light';
const THEME_KEY = 'jlt-theme';
export function readTheme(): ThemeChoice { try { const value = localStorage.getItem(THEME_KEY); return value === 'dark' || value === 'light' ? value : 'system'; } catch { return 'system'; } }
export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = choice;
  try { if (choice === 'system') localStorage.removeItem(THEME_KEY); else localStorage.setItem(THEME_KEY, choice); } catch { /* storage unavailable: choice lasts for this page */ }
  window.dispatchEvent(new Event('jlt-theme'));
}
/** Changes whenever the effective theme may have changed, so canvases can redraw with new colors. */
export function useThemeVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion(value => value + 1); const media = window.matchMedia('(prefers-color-scheme: light)');
    window.addEventListener('jlt-theme', bump); media.addEventListener('change', bump);
    return () => { window.removeEventListener('jlt-theme', bump); media.removeEventListener('change', bump); };
  }, []);
  return version;
}
/** Reads a themed color token as a canvas-usable color, e.g. cssColor('--c-slate-400'). */
export function cssColor(name: string, alpha = 1) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (value.startsWith('#')) return value;
  return alpha === 1 ? `rgb(${value})` : `rgb(${value} / ${alpha})`;
}

/**
 * Load color from the themed palette: blue (light load) → amber → red (load concentrated). `ratio` is 0..1.
 * Plain rgb() so it works for both DOM styles and canvas fills.
 */
export function loadColor(ratio: number, alpha = 1) {
  const read = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim().split(/\s+/).map(Number);
  const t = Math.max(0, Math.min(1, ratio)); const [from, to] = t < .5 ? [read('--c-blue-500'), read('--c-amber-500')] : [read('--c-amber-500'), read('--c-red-500')]; const u = t < .5 ? t * 2 : (t - .5) * 2;
  return `rgb(${from.map((value, index) => Math.round(value + (to[index] - value) * u)).join(' ')} / ${alpha})`;
}

export function ThemeSelect() {
  const [choice, setChoice] = useState<ThemeChoice>(readTheme);
  return <select id="jlt-theme-select" aria-label="테마" value={choice} onChange={event => { const next = event.target.value as ThemeChoice; event.currentTarget.blur(); setChoice(next); applyTheme(next); }} className="rounded-lg border border-slate-600 bg-slate-800 px-2 py-1 text-xs">
    <option id="jlt-theme-option-system" value="system">◐ 시스템</option><option id="jlt-theme-option-dark" value="dark">● 다크</option><option id="jlt-theme-option-light" value="light">○ 라이트</option>
  </select>;
}
