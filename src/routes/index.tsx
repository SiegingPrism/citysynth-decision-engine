import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { CityScene } from "@/components/CityScene";
import { ControlPanel } from "@/components/ControlPanel";
import { ForecastChart } from "@/components/ForecastChart";
import { AISuggestions } from "@/components/AISuggestions";
import {
  buildCity,
  project,
  simulate,
  type CrisisMode,
  type SimControls,
} from "@/lib/simulation";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Activity, MapPin, Wind, Users, Clock, Cpu } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Aether — Digital Twin Control Room" },
      {
        name: "description",
        content:
          "A live decision-engine digital twin of a city + campus: simulate, time-travel, and run AI-driven optimizations.",
      },
      { property: "og:title", content: "Aether — Digital Twin Control Room" },
      {
        property: "og:description",
        content:
          "Modify the city, predict outcomes, and let AI propose interventions in real time.",
      },
    ],
  }),
  component: TwinPage,
});

function TwinPage() {
  const city = useMemo(() => buildCity(11), []);
  const [controls, setControls] = useState<SimControls>({
    signalTiming: 1,
    trafficVolume: 1,
    campusEventLoad: 0.3,
    closedRoadIds: [],
  });
  const [crisis, setCrisis] = useState<CrisisMode>("none");
  const [tMinutes, setTMinutes] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [hoveredRoadId, setHoveredRoadId] = useState<string | null>(null);

  // autoplay timeline
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!autoplay) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setTMinutes((t) => {
        const next = t + dt * 30; // 30 sim-minutes per real second
        return next > 24 * 60 ? 0 : next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [autoplay]);

  const snapshot = useMemo(
    () => simulate(city, controls, crisis, tMinutes),
    [city, controls, crisis, tMinutes],
  );

  const forecast = useMemo(
    () => project(city, controls, crisis, tMinutes, 24, 30), // 12h ahead, 30min steps
    [city, controls, crisis, tMinutes],
  );

  const toggleRoad = (id: string) => {
    setControls((c) => ({
      ...c,
      closedRoadIds: c.closedRoadIds.includes(id)
        ? c.closedRoadIds.filter((r) => r !== id)
        : [...c.closedRoadIds, id],
    }));
  };

  const applySuggestion = (patch: Partial<SimControls>) => {
    setControls((c) => ({ ...c, ...patch }));
  };

  const hour = Math.floor(snapshot.hour);
  const minutes = Math.floor((snapshot.hour - hour) * 60);
  const timeLabel = `${hour.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;
  const dayOffset = Math.floor(tMinutes / (24 * 60));
  const tLabel =
    tMinutes === 0
      ? "NOW"
      : `+${Math.floor(tMinutes / 60)}h ${Math.floor(tMinutes % 60)}m`;

  return (
    <main className="h-screen w-screen overflow-hidden text-foreground relative">
      {/* 3D scene fills the screen */}
      <div className="absolute inset-0 grid-bg">
        <CityScene
          city={city}
          snapshot={snapshot}
          closedRoadIds={controls.closedRoadIds}
          onToggleRoad={toggleRoad}
          hoveredRoadId={hoveredRoadId}
          setHoveredRoadId={setHoveredRoadId}
        />
      </div>

      {/* Top bar */}
      <header className="absolute top-0 left-0 right-0 p-4 flex items-start justify-between gap-4 pointer-events-none">
        <div className="hud-panel rounded-lg px-4 py-2.5 pointer-events-auto flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-primary animate-blink" />
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-primary text-glow-cyan">
              Aether · Digital Twin
            </div>
            <div className="text-xs text-muted-foreground">
              Meridian District + Northcrest Campus
            </div>
          </div>
        </div>

        <div className="flex gap-3 pointer-events-auto">
          <KPI
            icon={<Activity className="w-3.5 h-3.5" />}
            label="Congestion"
            value={`${(snapshot.congestion * 100).toFixed(0)}%`}
            tone={
              snapshot.congestion > 0.7
                ? "danger"
                : snapshot.congestion > 0.45
                ? "amber"
                : "emerald"
            }
          />
          <KPI
            icon={<Wind className="w-3.5 h-3.5" />}
            label="Pollution"
            value={`${(snapshot.pollution * 100).toFixed(0)}%`}
            tone={snapshot.pollution > 0.6 ? "amber" : "emerald"}
          />
          <KPI
            icon={<Users className="w-3.5 h-3.5" />}
            label="Crowd"
            value={`${(snapshot.crowdLoad * 100).toFixed(0)}%`}
            tone={snapshot.crowdLoad > 0.6 ? "magenta" : "muted"}
          />
        </div>
      </header>

      {/* Left: Decision panel */}
      <aside className="absolute left-4 top-24 bottom-32 w-[320px] overflow-y-auto pointer-events-auto">
        <ControlPanel
          controls={controls}
          setControls={setControls}
          crisis={crisis}
          setCrisis={setCrisis}
          closedCount={controls.closedRoadIds.length}
          onClearClosures={() =>
            setControls((c) => ({ ...c, closedRoadIds: [] }))
          }
        />
      </aside>

      {/* Right: Forecast + AI suggestions */}
      <aside className="absolute right-4 top-24 bottom-32 w-[360px] overflow-y-auto pointer-events-auto space-y-4">
        <div className="hud-panel rounded-lg p-4 space-y-4">
          <header className="space-y-1">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary text-glow-cyan flex items-center gap-1.5">
              <Cpu className="w-3 h-3" /> Forecast · 12h
            </div>
            <h2 className="font-display text-lg">Projected outcomes</h2>
          </header>
          <ForecastChart series={forecast} metric="congestion" label="Congestion" />
          <ForecastChart series={forecast} metric="pollution" label="Pollution" />
          <ForecastChart series={forecast} metric="crowdLoad" label="Crowd density" />
        </div>

        <AISuggestions
          snapshot={snapshot}
          controls={controls}
          crisis={crisis}
          onApply={applySuggestion}
        />

        {hoveredRoadId && (
          <div className="hud-panel rounded-lg p-3 text-xs space-y-1">
            <div className="flex items-center gap-2 text-primary font-mono uppercase tracking-wider text-[10px]">
              <MapPin className="w-3 h-3" /> Road · {hoveredRoadId}
            </div>
            <div>
              Utilization:{" "}
              <span className="font-mono">
                {((snapshot.roadFlow[hoveredRoadId] ?? 0) * 100).toFixed(0)}%
              </span>
            </div>
            <div className="text-muted-foreground">
              {controls.closedRoadIds.includes(hoveredRoadId)
                ? "Closed — click to reopen"
                : "Click to close this road"}
            </div>
          </div>
        )}
      </aside>

      {/* Bottom: Time travel */}
      <footer className="absolute bottom-0 left-0 right-0 p-4 pointer-events-none">
        <div className="hud-panel rounded-lg p-4 pointer-events-auto max-w-5xl mx-auto space-y-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-primary" />
              <div>
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary">
                  Time travel
                </div>
                <div className="font-mono text-sm">
                  <span className="text-glow-cyan text-primary">{timeLabel}</span>
                  <span className="text-muted-foreground ml-2">
                    Day +{dayOffset} · {tLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex-1">
              <Slider
                value={[tMinutes]}
                min={0}
                max={24 * 60}
                step={5}
                onValueChange={(v) => setTMinutes(v[0])}
              />
            </div>

            <button
              onClick={() => setAutoplay((a) => !a)}
              className={`px-3 py-1.5 rounded-md border text-xs font-mono uppercase tracking-wider transition-all ${
                autoplay
                  ? "border-accent text-accent bg-accent/10 hud-glow"
                  : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {autoplay ? "■ Pause" : "▶ Play"}
            </button>

            <button
              onClick={() => setTMinutes(0)}
              className="px-3 py-1.5 rounded-md border border-border text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground"
            >
              Now
            </button>
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground">
            <span>NOW</span>
            <span>+3h</span>
            <span>+6h</span>
            <span>+9h</span>
            <span>+12h</span>
            <span>+18h</span>
            <span>+24h</span>
          </div>
        </div>
      </footer>
    </main>
  );
}

function KPI({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "emerald" | "amber" | "danger" | "magenta" | "muted";
}) {
  const toneClass =
    tone === "danger"
      ? "text-destructive"
      : tone === "amber"
      ? "text-[var(--amber)]"
      : tone === "magenta"
      ? "text-[var(--magenta)]"
      : tone === "emerald"
      ? "text-[var(--emerald)]"
      : "text-foreground";
  return (
    <div className="hud-panel rounded-lg px-3 py-2 min-w-[110px]">
      <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`font-mono text-lg ${toneClass}`}>{value}</div>
    </div>
  );
}

// Suppress unused import warning
void Badge;
