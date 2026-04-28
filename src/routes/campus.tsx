import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState, useEffect, useCallback } from "react";
import { CampusMap } from "@/components/CampusMap";
import { CampusAIStrategist } from "@/components/CampusAIStrategist";
import {
  buildCampus,
  simulateCampus,
  optimize,
  SCENARIOS,
  edgeName,
  type ScenarioId,
  type OptimizerOutput,
} from "@/lib/campus";
import {
  Activity, Gauge, Cpu, Sparkles, Play, Pause, RotateCcw, ChevronRight,
  AlertTriangle, ArrowLeft, Brain, Route as RouteIcon, Clock,
} from "lucide-react";

export const Route = createFileRoute("/campus")({
  head: () => ({
    meta: [
      { title: "CitySynth — Real-Time Campus Decision Engine" },
      {
        name: "description",
        content:
          "Graph-based campus traffic twin. Simulate entry, lunch, and exit rushes, then let the AI optimizer cut congestion and explain why.",
      },
      { property: "og:title", content: "CitySynth — Campus Decision Engine" },
      {
        property: "og:description",
        content:
          "Pick a rush hour, watch congestion form, click Optimize, and see a measurable improvement explained step by step.",
      },
    ],
  }),
  component: CampusPage,
});

function CampusPage() {
  const campus = useMemo(() => buildCampus(), []);
  const [scenarioId, setScenarioId] = useState<ScenarioId>("lunch");
  const scenario = useMemo(() => SCENARIOS.find((s) => s.id === scenarioId)!, [scenarioId]);

  const [demandMul, setDemandMul] = useState(1);
  const [closedEdgeIds, setClosedEdgeIds] = useState<string[]>([]);
  const [optimization, setOptimization] = useState<OptimizerOutput | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [showOptimized, setShowOptimized] = useState(false);

  // Timeline (minutes 0..60 within the scenario hour)
  const [timeMin, setTimeMin] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTimeMin((t) => (t + dt * 6) % 60); // 6 sim-min/sec
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // Demand curve within the rush hour: bell-shape peaking at minute 30
  const timeFactor = useMemo(() => {
    const x = (timeMin - 30) / 18;
    return 0.55 + Math.exp(-x * x) * 0.7; // 0.55 .. ~1.25
  }, [timeMin]);

  const baseline = useMemo(
    () => simulateCampus(campus, scenario, {
      closedEdgeIds,
      demandMultiplier: demandMul * timeFactor,
    }),
    [campus, scenario, closedEdgeIds, demandMul, timeFactor],
  );

  const optimizedView = useMemo(() => {
    if (!optimization || !showOptimized) return null;
    return simulateCampus(campus, scenario, {
      closedEdgeIds: optimization.plan.closedEdgeIds,
      signalWeights: optimization.plan.signalWeights,
      rerouteShare: optimization.plan.rerouteShare,
      demandMultiplier: demandMul * timeFactor,
    });
  }, [optimization, showOptimized, campus, scenario, demandMul, timeFactor]);

  // Reset optimization when scenario changes
  useEffect(() => {
    setOptimization(null);
    setShowOptimized(false);
  }, [scenarioId]);

  const runOptimize = useCallback(() => {
    setOptimizing(true);
    setShowOptimized(false);
    // Yield to UI to show "thinking" state
    setTimeout(() => {
      const out = optimize(campus, scenario);
      setOptimization(out);
      setShowOptimized(true);
      setOptimizing(false);
    }, 650);
  }, [campus, scenario]);

  const reset = () => {
    setClosedEdgeIds([]);
    setOptimization(null);
    setShowOptimized(false);
    setDemandMul(1);
    setTimeMin(0);
  };

  const displayResult = optimizedView ?? baseline;
  const highlight = optimization?.optimized.bottleneckEdgeIds ?? baseline.bottleneckEdgeIds;

  return (
    <main className="h-screen w-screen overflow-hidden text-foreground bg-[#05080f]">
      {/* Background grid glow */}
      <div className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at 20% 0%, rgba(60,160,255,0.10), transparent 60%)," +
            "radial-gradient(ellipse at 80% 100%, rgba(255,120,80,0.08), transparent 60%)",
        }}
      />

      {/* Top bar */}
      <header className="absolute top-0 left-0 right-0 z-20 px-5 py-3 flex items-center justify-between gap-4 border-b border-white/5 bg-black/40 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <Link to="/" className="flex items-center gap-1.5 text-xs text-white/60 hover:text-white transition-colors">
            <ArrowLeft className="w-3.5 h-3.5" /> City Twin
          </Link>
          <div className="h-4 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-cyan-300">
                CitySynth · Campus Decision Engine
              </div>
              <div className="text-[11px] text-white/50">
                Graph-based digital twin · {campus.nodes.filter(n => n.kind !== 'junction').length} nodes · {campus.edges.length} road segments
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <KPI label="Congestion" value={`${(displayResult.congestion * 100).toFixed(0)}%`}
               tone={displayResult.congestion > 0.7 ? "danger" : displayResult.congestion > 0.45 ? "amber" : "emerald"} />
          <KPI label="Avg Delay" value={`${displayResult.avgDelaySec.toFixed(1)}s`}
               tone={displayResult.avgDelaySec > 6 ? "danger" : displayResult.avgDelaySec > 3 ? "amber" : "emerald"} />
          <KPI label="Flow Eff." value={`${(displayResult.flowEfficiency * 100).toFixed(0)}%`}
               tone={displayResult.flowEfficiency > 0.6 ? "emerald" : displayResult.flowEfficiency > 0.3 ? "amber" : "danger"} />
        </div>
      </header>

      {/* Map fills the screen */}
      <div className="absolute inset-0 pt-[64px] pb-[120px] pl-[300px] pr-[360px]">
        <CampusMap campus={campus} result={displayResult} highlightEdgeIds={highlight} />
      </div>

      {/* Left sidebar: Scenarios + Controls */}
      <aside className="absolute left-0 top-[64px] bottom-[120px] w-[290px] z-10 p-3 overflow-y-auto space-y-3 border-r border-white/5 bg-black/30 backdrop-blur-md">
        <Panel icon={<Sparkles className="w-3 h-3" />} title="Scenario">
          <div className="space-y-1.5">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => setScenarioId(s.id)}
                className={`w-full text-left rounded-md px-3 py-2 transition-all border ${
                  scenarioId === s.id
                    ? "bg-cyan-500/15 border-cyan-400/60 text-white"
                    : "bg-white/[0.02] border-white/5 text-white/70 hover:bg-white/[0.05]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold tracking-wide">{s.label}</span>
                  <span className="font-mono text-[10px] text-cyan-300">{s.timeLabel}</span>
                </div>
                <div className="text-[10px] text-white/50 mt-0.5 leading-tight">{s.description}</div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel icon={<Gauge className="w-3 h-3" />} title="Traffic Volume">
          <input
            type="range" min={0.5} max={1.6} step={0.05} value={demandMul}
            onChange={(e) => setDemandMul(parseFloat(e.target.value))}
            className="w-full accent-cyan-400"
          />
          <div className="flex justify-between text-[10px] font-mono text-white/50">
            <span>×{demandMul.toFixed(2)}</span>
            <span className="text-cyan-300">surge factor</span>
          </div>
        </Panel>

        <Panel icon={<RouteIcon className="w-3 h-3" />} title="Road Closures">
          <div className="space-y-1 max-h-[180px] overflow-y-auto pr-1">
            {campus.edges.slice(0, 10).map((e) => {
              const closed = closedEdgeIds.includes(e.id);
              return (
                <button
                  key={e.id}
                  onClick={() => setClosedEdgeIds((c) => closed ? c.filter(x => x !== e.id) : [...c, e.id])}
                  className={`w-full text-left rounded px-2 py-1 text-[10px] font-mono transition-colors border ${
                    closed
                      ? "bg-red-500/15 border-red-400/40 text-red-200"
                      : "bg-white/[0.02] border-white/5 text-white/55 hover:bg-white/[0.05]"
                  }`}
                >
                  {closed ? "● CLOSED " : "○ open   "}{edgeName(campus, e.id)}
                </button>
              );
            })}
          </div>
          {closedEdgeIds.length > 0 && (
            <button onClick={() => setClosedEdgeIds([])} className="mt-2 w-full text-[10px] py-1 rounded bg-white/5 hover:bg-white/10 text-white/70">
              Clear closures
            </button>
          )}
        </Panel>

        <Panel icon={<Brain className="w-3 h-3" />} title="Optimizer">
          <div className="space-y-2">
            <button
              onClick={runOptimize}
              disabled={optimizing}
              className="w-full rounded-md py-2 text-xs font-semibold bg-gradient-to-r from-cyan-500 to-blue-500 text-black hover:brightness-110 disabled:opacity-60 transition-all shadow-[0_0_20px_rgba(80,200,255,0.4)]"
            >
              {optimizing ? "Searching plans…" : optimization ? "Re-run optimization" : "▶ Run optimization"}
            </button>
            {optimization && (
              <button
                onClick={() => setShowOptimized((s) => !s)}
                className="w-full rounded-md py-1.5 text-[11px] font-mono uppercase tracking-wider bg-white/5 hover:bg-white/10 text-white/80 border border-white/10"
              >
                {showOptimized ? "View baseline" : "Apply optimized plan"}
              </button>
            )}
          </div>
        </Panel>
      </aside>

      {/* Right sidebar: AI Explanation + Before/After + Bottlenecks */}
      <aside className="absolute right-0 top-[64px] bottom-[120px] w-[350px] z-10 p-3 overflow-y-auto space-y-3 border-l border-white/5 bg-black/30 backdrop-blur-md">
        <Panel icon={<Brain className="w-3 h-3" />} title="AI Explanation" accent="cyan">
          {!optimization ? (
            <div className="text-[11px] text-white/55 leading-relaxed">
              Pick a scenario, watch the heatmap, then click <span className="text-cyan-300 font-semibold">Run optimization</span>. The engine will diagnose the bottleneck, propose an action, and explain the result in plain English.
            </div>
          ) : (
            <div className="space-y-2">
              {optimization.explanation.map((line, i) => (
                <div key={i} className="flex gap-2 text-[12px] leading-relaxed text-white/85">
                  <ChevronRight className="w-3 h-3 text-cyan-300 mt-1 shrink-0" />
                  <span>{line}</span>
                </div>
              ))}
              <div className="mt-3 pt-2 border-t border-white/10 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider">
                <span className="text-white/50">Plan confidence</span>
                <span className="text-cyan-300">{(optimization.confidence * 100).toFixed(0)}%</span>
              </div>
            </div>
          )}
        </Panel>

        {optimization && (
          <Panel icon={<Activity className="w-3 h-3" />} title="Before vs After" accent="emerald">
            <div className="space-y-3">
              <CompareRow
                label="Congestion"
                before={optimization.baseline.congestion * 100}
                after={optimization.optimized.congestion * 100}
                unit="%"
                lowerIsBetter
              />
              <CompareRow
                label="Avg Delay"
                before={optimization.baseline.avgDelaySec}
                after={optimization.optimized.avgDelaySec}
                unit="s"
                lowerIsBetter
              />
              <CompareRow
                label="Flow Efficiency"
                before={optimization.baseline.flowEfficiency * 100}
                after={optimization.optimized.flowEfficiency * 100}
                unit="%"
                lowerIsBetter={false}
              />
              <div className="mt-3 pt-2 border-t border-white/10 grid grid-cols-3 gap-2 text-center">
                <Headline label="Congestion ↓" value={`${optimization.improvement.congestionDropPct.toFixed(0)}%`} good />
                <Headline label="Delay ↓" value={`${optimization.improvement.delayDropPct.toFixed(0)}%`} good />
                <Headline label="Flow ↑" value={`${optimization.improvement.flowGainPct.toFixed(0)}%`} good />
              </div>
            </div>
          </Panel>
        )}

        <Panel icon={<AlertTriangle className="w-3 h-3" />} title="Top Bottlenecks" accent="amber">
          <div className="space-y-1.5">
            {(displayResult.bottleneckEdgeIds).map((eid, i) => {
              const f = displayResult.edgeFlow[eid];
              const vc = f?.vc ?? 0;
              const tone = vc >= 1 ? "bg-red-400" : vc >= 0.85 ? "bg-orange-400" : "bg-yellow-300";
              return (
                <div key={eid} className="flex items-center gap-2 text-[11px]">
                  <span className="w-4 text-center font-mono text-white/40">{i + 1}</span>
                  <div className="flex-1">
                    <div className="text-white/80">{edgeName(campus, eid)}</div>
                    <div className="h-1.5 bg-white/5 rounded mt-1 overflow-hidden">
                      <div className={`h-full ${tone}`} style={{ width: `${Math.min(100, vc * 100)}%` }} />
                    </div>
                  </div>
                  <span className="font-mono text-white/60 w-10 text-right">{(vc * 100).toFixed(0)}%</span>
                </div>
              );
            })}
          </div>
        </Panel>

        {optimization && (
          <Panel icon={<Cpu className="w-3 h-3" />} title="Plan Steps">
            <ol className="space-y-1.5 text-[11px] text-white/75 list-decimal list-inside">
              {optimization.plan.description.map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ol>
          </Panel>
        )}
      </aside>

      {/* Bottom: Timeline */}
      <footer className="absolute bottom-0 left-0 right-0 z-10 p-3 border-t border-white/5 bg-black/40 backdrop-blur-md">
        <div className="max-w-5xl mx-auto flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-cyan-300" />
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-cyan-300">Timeline</div>
              <div className="font-mono text-sm text-white">{formatTime(scenario.hour, timeMin)}</div>
            </div>
          </div>

          <div className="flex-1 flex items-center gap-3">
            <input
              type="range" min={0} max={60} step={1} value={timeMin}
              onChange={(e) => { setPlaying(false); setTimeMin(parseInt(e.target.value)); }}
              className="w-full accent-cyan-400"
            />
            <span className="font-mono text-[10px] text-white/60 w-16 text-right">
              t+{Math.floor(timeMin)}m
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <IconBtn onClick={() => setPlaying((p) => !p)} title={playing ? "Pause" : "Play"}>
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </IconBtn>
            <IconBtn onClick={reset} title="Reset"><RotateCcw className="w-3.5 h-3.5" /></IconBtn>
          </div>

          {/* Mini legend */}
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <Legend color="rgb(80,230,170)" label="smooth" />
            <Legend color="rgb(255,220,90)" label="busy" />
            <Legend color="rgb(255,150,60)" label="congested" />
            <Legend color="rgb(255,70,90)" label="overloaded" />
          </div>
        </div>
      </footer>
    </main>
  );
}

// ----- UI Helpers -----

function Panel({
  icon, title, children, accent = "cyan",
}: { icon: React.ReactNode; title: string; children: React.ReactNode; accent?: "cyan" | "emerald" | "amber" }) {
  const accentColor =
    accent === "emerald" ? "text-emerald-300" :
    accent === "amber" ? "text-amber-300" : "text-cyan-300";
  return (
    <section className="rounded-lg border border-white/8 bg-white/[0.025] p-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
      <div className={`flex items-center gap-1.5 mb-2 text-[10px] font-mono uppercase tracking-[0.2em] ${accentColor}`}>
        {icon}{title}
      </div>
      {children}
    </section>
  );
}

function KPI({ label, value, tone }: { label: string; value: string; tone: "emerald" | "amber" | "danger" }) {
  const color =
    tone === "emerald" ? "text-emerald-300 border-emerald-400/30" :
    tone === "amber" ? "text-amber-300 border-amber-400/30" :
    "text-red-300 border-red-400/40";
  return (
    <div className={`rounded-md px-3 py-1.5 border bg-white/[0.03] ${color}`}>
      <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-white/50">{label}</div>
      <div className="font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}

function CompareRow({
  label, before, after, unit, lowerIsBetter,
}: { label: string; before: number; after: number; unit: string; lowerIsBetter: boolean }) {
  const max = Math.max(before, after, 1);
  const improved = lowerIsBetter ? after < before : after > before;
  return (
    <div>
      <div className="flex justify-between text-[11px] mb-1">
        <span className="text-white/70">{label}</span>
        <span className={`font-mono ${improved ? "text-emerald-300" : "text-white/60"}`}>
          {before.toFixed(1)}{unit} → {after.toFixed(1)}{unit}
        </span>
      </div>
      <div className="space-y-1">
        <Bar value={before / max} color="bg-white/30" />
        <Bar value={after / max} color={improved ? "bg-emerald-400" : "bg-amber-400"} />
      </div>
    </div>
  );
}

function Bar({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 bg-white/5 rounded overflow-hidden">
      <div className={`h-full ${color} transition-all duration-700`} style={{ width: `${Math.min(100, value * 100)}%` }} />
    </div>
  );
}

function Headline({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className={`rounded-md py-1.5 px-1 border ${good ? "border-emerald-400/30 bg-emerald-400/5" : "border-white/10"}`}>
      <div className={`font-mono text-base font-bold ${good ? "text-emerald-300" : "text-white"}`}>{value}</div>
      <div className="text-[9px] font-mono uppercase tracking-wider text-white/50">{label}</div>
    </div>
  );
}

function IconBtn({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick} title={title}
      className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 flex items-center justify-center text-white/80"
    >
      {children}
    </button>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1 text-white/55">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
      {label}
    </span>
  );
}

function formatTime(hour: number, min: number): string {
  const h = Math.floor(hour);
  const m = Math.floor((hour - h) * 60 + min) % 60;
  const totalH = h + Math.floor(((hour - h) * 60 + min) / 60);
  return `${String(totalH).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
