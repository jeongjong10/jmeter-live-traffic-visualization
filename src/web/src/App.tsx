import PlanFlowView, { PlanUpload } from './components/PlanFlowView';
import { ThemeSelect } from './components/FlowParts';
import { usePlanFlow } from './hooks/usePlanFlow';

/** A test plan (sent by the listener when a test starts, or a chosen .jmx) opens the dashboard; until then, how to connect JMeter. */
export default function App() {
  const flow = usePlanFlow();
  return flow.plan ? <PlanFlowView flow={flow} /> : <ConnectGuide connected={flow.connected} onUpload={flow.uploadPlan} />;
}

const STEPS: [string, string, string][] = [
  ['jar', '리스너 JAR 넣기', 'src/listener/target/jmeter-backend-listener-0.1.0-SNAPSHOT.jar → JMeter lib/ext (또는 -Juser.classpath)'],
  ['listener', 'Backend Listener 추가', 'Test Plan 아래 · 구현 클래스 io.axtutorlog.jmeter.backend.EventCollectorBackendListener · collectorUrl http://127.0.0.1:8765/events'],
  ['run', '테스트 실행', '시작하면 테스트 계획이 자동으로 전송되고 이 화면이 대시보드로 바뀝니다'],
];

/** Shown while no test plan is known (fresh collector): the three steps to connect, plus choosing a .jmx to view records only. */
function ConnectGuide({ connected, onUpload }: { connected: boolean; onUpload: (file: File) => Promise<void> }) {
  return <main id="jlt-app" className="min-h-screen bg-slate-950 text-slate-100">
    <div id="jlt-theme-float" className="fixed right-2 top-2 z-50 rounded-lg shadow-lg"><ThemeSelect /></div>
    <section id="jlt-connect" className="mx-auto max-w-3xl px-4 py-16">
      <p id="jlt-connect-brand" className="text-xs font-semibold tracking-[.18em] text-blue-300">JMETER LIVE TRAFFIC</p>
      <h1 id="jlt-connect-title" className="mt-1 text-2xl font-bold">JMeter를 연결하세요</h1>
      <p id="jlt-connect-status" className={`mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${connected ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'}`}><span id="jlt-connect-status-dot" className={`h-2 w-2 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />{connected ? 'collector 연결됨 · 테스트 시작을 기다리는 중' : 'collector 연결 중… (계속되면 docker/에서 docker compose up -d 확인)'}</p>
      <ol id="jlt-connect-steps" className="mt-6 space-y-3">
        {STEPS.map(([id, title, detail], index) => <li key={id} id={`jlt-connect-step-${id}`} className="flex gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
          <span id={`jlt-connect-step-${id}-number`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500 text-sm font-bold text-white">{index + 1}</span>
          <div id={`jlt-connect-step-${id}-body`}><p id={`jlt-connect-step-${id}-title`} className="font-semibold">{title}</p><p id={`jlt-connect-step-${id}-detail`} className="mt-1 break-all font-mono text-xs text-slate-400">{detail}</p></div>
        </li>)}
      </ol>
      <div id="jlt-connect-upload" className="mt-6 flex flex-wrap items-center gap-3 text-sm text-slate-400"><span id="jlt-connect-upload-label">리스너 없이 화면만 먼저 보려면</span><PlanUpload onUpload={onUpload} /></div>
    </section>
  </main>;
}
