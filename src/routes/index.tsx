import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { CityScene } from "@/components/CityScene";
import { ControlPanel } from "@/components/ControlPanel";
import { ForecastChart } from "@/components/ForecastChart";
import { AISuggestions } from "@/components/AISuggestions";
import { MiniMap } from "@/components/MiniMap";
import { ScenarioPresets, type Scenario } from "@/components/ScenarioPresets";
import { CrisisOps } from "@/components/CrisisOps";
import { EventLog } from "@/components/EventLog";
import { ResilienceGauge } from "@/components/ResilienceGauge";
import { AIVerdict } from "@/components/AIVerdict";
import { IntroOverlay } from "@/components/IntroOverlay";
import { IncidentCommander } from "@/components/IncidentCommander";
import { LiveDataPanel } from "@/components/LiveDataPanel";
import { OptimizerPanel } from "@/components/OptimizerPanel";
import { useLiveData } from "@/hooks/useLiveData";
import {
  buildCity,
  project,
  simulate,
  type CrisisMode,
  type SimControls,
} from "@/lib/simulation";
import { Slider } from "@/components/ui/slider";
import { Activity, MapPin, Wind, Users, Clock, Cpu, Eye, Crosshair, Footprints, Plane, Orbit, Flame, Gauge } from "lucide-react";
import type { FlythroughKind } from "@/components/CityScene";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CitySynth — Predictive Digital Twin" },
      {
        name: "description",
        content:
          "A live decision-engine digital twin of a city + campus: simulate, time-travel, and run AI-driven optimizations.",
      },
      { property: "og:title", content: "CitySynth — Predictive Digital Twin" },
      {
        property: "og:description",
        content:
          "Modify the city, predict outcomes, and let AI propose interventions in real time.",
      },
    ],
  }),
  component: TwinPage,
});

const BASE_HOUR = 7; // simulation reference hour for "Now"

function TwinPage() {
  const city = useMemo(() => buildCity(11), []);
  const [controls, setControls] = useState<SimControls>({
    signalTiming: 1,
    trafficVolume: 1,
    campusEventLoad: 0.3,
    closedRoadIds: [],
  });
  const [crisis, setCrisis] = useState<CrisisMode>("none");
  const [crisisStartMin, setCrisisStartMin] = useState(0);
  const [crisisPlaySeconds, setCrisisPlaySeconds] = useState(0);
  const [tMinutes, setTMinutes] = useState(0);
  const [autoplay, setAutoplay] = useState(false);
  const [hoveredRoadId, setHoveredRoadId] = useState<string | null>(null);
  const [intro, setIntro] = useState(true);
  const [flyTo, setFlyTo] = useState<{
    x: number;
    z: number;
    preset?: "overview" | "tactical" | "street";
    nonce: number;
  } | null>(null);
  const [liveData, setLiveData] = useState(false);
  const [flythrough, setFlythrough] = useState<{ kind: FlythroughKind; nonce: number; focus?: { x: number; z: number } } | null>(null);
  const [quality, setQuality] = useState<"high" | "medium" | "low">("high");
  const { sample: liveSample, deltas: liveDeltas } = useLiveData(liveData);

  // When live data is on, gently steer simulation inputs toward the feed
  useEffect(() => {
    if (!liveData) return;
    setControls((c) => ({
      ...c,
      trafficVolume: c.trafficVolume + (liveDeltas.trafficVolume - c.trafficVolume) * 0.25,
      campusEventLoad: c.campusEventLoad + (liveDeltas.campusEventLoad - c.campusEventLoad) * 0.25,
    }));
  }, [liveData, liveDeltas.trafficVolume, liveDeltas.campusEventLoad]);

  // Reset crisis play clock when crisis changes
  useEffect(() => {
    setCrisisPlaySeconds(0);
    setCrisisStartMin(tMinutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crisis]);

  // Real-time clock that drives particle / damage animations whenever a crisis is active
  useEffect(() => {
    if (crisis === "none") return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setCrisisPlaySeconds((s) => s + dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [crisis]);

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

  // Hotkeys
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (intro) return;
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      switch (e.key) {
        case "1": setCrisis("none"); break;
        case "2": setCrisis("flood"); break;
        case "3": setCrisis("fire"); break;
        case "4": setCrisis("surge"); break;
        case " ":
          e.preventDefault();
          setAutoplay((a) => !a);
          break;
        case "r":
        case "R":
          setTMinutes(0);
          break;
        case "o":
        case "O":
          flyToPreset("overview");
          break;
        case "t":
        case "T":
          flyToPreset("tactical");
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [intro]);

  const snapshot = useMemo(
    () => simulate(city, controls, crisis, tMinutes, BASE_HOUR, crisisStartMin),
    [city, controls, crisis, tMinutes, crisisStartMin],
  );

  const forecast = useMemo(
    () => project(city, controls, crisis, tMinutes, 24, 30), // 12h ahead, 30min steps
    [city, controls, crisis, tMinutes],
  );

  // Auto-play cinematic crisis flythrough when one becomes active
  useEffect(() => {
    if (crisis === "none") return;
    const epi =
      snapshot.fire?.pos ??
      snapshot.flood?.pos ??
      snapshot.surge?.pos ??
      null;
    if (!epi) return;
    setFlythrough({ kind: "crisis", nonce: Date.now(), focus: { x: epi.x, z: epi.z } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crisis]);

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

  const applyScenario = (s: Scenario, tMin: number) => {
    setControls((c) => ({ ...c, ...s.controls }));
    setCrisis(s.crisis);
    setTMinutes(tMin);
  };

  const flyToPreset = (preset: "overview" | "tactical" | "street") => {
    if (preset === "overview") {
      setFlyTo({ x: 0, z: 0, preset, nonce: Date.now() });
    } else {
      // fly toward whatever is interesting: crisis epicenter, hottest hotspot, or center
      const target =
        snapshot.fire?.pos ??
        snapshot.flood?.pos ??
        snapshot.surge?.pos ??
        snapshot.hotspots[0]?.pos ??
        { x: 0, z: 0 };
      setFlyTo({ x: target.x, z: target.z, preset, nonce: Date.now() });
    }
  };

  const playFlythrough = (kind: NonNullable<FlythroughKind>) => {
    const focus =
      snapshot.fire?.pos ??
      snapshot.flood?.pos ??
      snapshot.surge?.pos ??
      snapshot.hotspots[0]?.pos ??
      { x: 0, z: 0 };
    setFlythrough({ kind, nonce: Date.now(), focus });
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
      {intro && (
        <IntroOverlay
          onEnter={() => {
            setIntro(false);
            setTimeout(() => setFlythrough({ kind: "arrival", nonce: Date.now() }), 150);
          }}
        />
      )}

      {/* 3D scene fills the screen */}
      <div className="absolute inset-0 grid-bg">
        <CityScene
          city={city}
          snapshot={snapshot}
          closedRoadIds={controls.closedRoadIds}
          onToggleRoad={toggleRoad}
          hoveredRoadId={hoveredRoadId}
          setHoveredRoadId={setHoveredRoadId}
          crisisPlaySeconds={crisisPlaySeconds}
          flyTo={flyTo}
          flythrough={flythrough}
          onQualityChange={setQuality}
        />
      </div>

      {/* Vignette */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 50%, oklch(0 0 0 / 0.55) 100%)",
        }}
      />

      {/* Top bar */}
      <header className="absolute top-0 left-0 right-0 p-4 flex items-start justify-between gap-4 pointer-events-none">
        <div className="flex flex-col gap-3 pointer-events-auto">
          <div className="hud-panel rounded-lg px-4 py-2.5 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-primary animate-blink" />
            <div>
              <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-primary text-glow-cyan">
                CitySynth · Predictive Twin
              </div>
              <div className="text-xs text-muted-foreground">
                Meridian District + Northcrest Campus
              </div>
            </div>
          </div>

          <Link
            to="/campus"
            className="hud-panel rounded-lg px-3 py-2 flex items-center gap-2 hover:bg-cyan-500/10 transition-colors group"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-300 animate-pulse" />
            <div>
              <div className="text-[9px] font-mono uppercase tracking-[0.25em] text-cyan-300">
                Campus Decision Engine →
              </div>
              <div className="text-[10px] text-white/55 group-hover:text-white/75">
                Graph-based twin · scenarios · explainable optimizer
              </div>
            </div>
          </Link>

          <AIVerdict snapshot={snapshot} />
        </div>

        <div className="flex flex-col items-end gap-3 pointer-events-auto">
          <div className="flex gap-3">
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
            <ResilienceGauge snapshot={snapshot} />
          </div>
        </div>
      </header>

      {/* Left: Decision panel + scenarios */}
      <aside className="absolute left-4 top-44 bottom-32 w-[320px] overflow-y-auto pointer-events-auto space-y-3">
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

        <ScenarioPresets baseHour={BASE_HOUR} onApply={applyScenario} />

        {/* Camera presets */}
        <div className="hud-panel rounded-lg p-3 space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary text-glow-cyan">
            Camera presets
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <CamBtn icon={<Eye className="w-3 h-3" />} label="Overview" hint="O" onClick={() => flyToPreset("overview")} />
            <CamBtn icon={<Crosshair className="w-3 h-3" />} label="Tactical" hint="T" onClick={() => flyToPreset("tactical")} />
            <CamBtn icon={<Footprints className="w-3 h-3" />} label="Street" hint="" onClick={() => flyToPreset("street")} />
          </div>
        </div>

        {/* Cinematic flythroughs */}
        <div className="hud-panel rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary text-glow-cyan">
              Cinematic flythrough
            </div>
            <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
              <Gauge className="w-2.5 h-2.5" />
              <span
                className={
                  quality === "high"
                    ? "text-[var(--emerald)]"
                    : quality === "medium"
                    ? "text-[var(--amber)]"
                    : "text-destructive"
                }
              >
                {quality}
              </span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <CamBtn icon={<Plane className="w-3 h-3" />} label="Arrival" hint="" onClick={() => playFlythrough("arrival")} />
            <CamBtn icon={<Orbit className="w-3 h-3" />} label="Orbit" hint="" onClick={() => playFlythrough("overview")} />
            <CamBtn icon={<Flame className="w-3 h-3" />} label="Crisis" hint="" onClick={() => playFlythrough("crisis")} />
          </div>
          <div className="text-[9px] font-mono text-muted-foreground/70 leading-tight pt-1">
            Press a flythrough — drag the view at any time to take back control.
          </div>
        </div>

        <EventLog
          city={city}
          snapshot={snapshot}
          crisis={crisis}
          crisisPlaySeconds={crisisPlaySeconds}
        />
      </aside>

      {/* Right: Mini-map + Crisis ops + AI suggestions + forecast */}
      <aside className="absolute right-4 top-44 bottom-32 w-[360px] overflow-y-auto pointer-events-auto space-y-3">
        <OptimizerPanel
          city={city}
          controls={controls}
          crisis={crisis}
          tMinutes={tMinutes}
          baseHour={BASE_HOUR}
          crisisStartMin={crisisStartMin}
          onApply={applySuggestion}
        />

        <MiniMap
          city={city}
          snapshot={snapshot}
          closedRoadIds={controls.closedRoadIds}
          onFocus={(p) => setFlyTo({ x: p.x, z: p.z, preset: "tactical", nonce: Date.now() })}
        />

        <LiveDataPanel active={liveData} onToggle={setLiveData} sample={liveSample} />

        <IncidentCommander
          city={city}
          snapshot={snapshot}
          crisis={crisis}
          resilience={1 - (snapshot.congestion * 0.4 + snapshot.pollution * 0.3 + (crisis !== "none" ? 0.3 : 0))}
          liveData={liveData}
        />

        <CrisisOps
          city={city}
          snapshot={snapshot}
          crisisPlaySeconds={crisisPlaySeconds}
        />

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
              title="Reset (R)"
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

function CamBtn({
  icon,
  label,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 rounded-md border border-border bg-card/40 px-2 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground hover:text-primary hover:border-primary/40 transition"
    >
      <span className="text-primary">{icon}</span>
      {label}
      {hint && <span className="text-[8px] opacity-50">[{hint}]</span>}
    </button>
  );
}
