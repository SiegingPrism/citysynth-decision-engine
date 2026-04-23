import { useEffect, useMemo, useRef, useState } from "react";
import type { CityModel, CrisisMode, SimSnapshot } from "@/lib/simulation";
import { Radio } from "lucide-react";

type LogEntry = {
  t: number; // seconds since crisis start
  level: "info" | "warn" | "crit" | "ok";
  msg: string;
};

type Props = {
  city: CityModel;
  snapshot: SimSnapshot;
  crisis: CrisisMode;
  crisisPlaySeconds: number;
};

/**
 * Reactive timestamped event log. Pure derivation from snapshot + clock,
 * so scrubbing the timeline regenerates the right log automatically.
 */
export function EventLog({ city, snapshot, crisis, crisisPlaySeconds }: Props) {
  const [tick, setTick] = useState(0);
  const lastEmitted = useRef(-1);

  // force a re-render every 500ms so log entries appear smoothly during play
  useEffect(() => {
    if (crisis === "none") return;
    const id = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [crisis]);
  void tick;

  const entries = useMemo<LogEntry[]>(() => {
    if (crisis === "none") return [];
    const out: LogEntry[] = [];
    out.push({ t: 0, level: "crit", msg: `[ALERT] ${crisis.toUpperCase()} declared. Activating protocol.` });

    if (snapshot.fire) {
      const stations = city.buildings.filter((b) => b.kind === "firestation");
      stations.forEach((s, i) => {
        out.push({
          t: 0.5 + i * 0.4,
          level: "info",
          msg: `Engine FS-${i + 1} (${s.label ?? "Station"}) dispatched to (${s.pos.x.toFixed(0)}, ${s.pos.z.toFixed(0)}).`,
        });
      });
      // Ignition events
      city.buildings.forEach((b) => {
        const dx = b.pos.x - snapshot.fire!.pos.x;
        const dz = b.pos.z - snapshot.fire!.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > snapshot.fire!.radius + 8) return;
        const ignite = (d / Math.max(1, snapshot.fire!.radius)) * 18;
        if (crisisPlaySeconds > ignite) {
          out.push({
            t: ignite,
            level: "warn",
            msg: `Ignition: ${b.label ?? b.kind} (~${d.toFixed(0)}m from epicenter).`,
          });
        }
        if (crisisPlaySeconds > ignite + 22) {
          out.push({
            t: ignite + 22,
            level: "crit",
            msg: `STRUCTURE LOST: ${b.label ?? b.kind} collapsed.`,
          });
        }
      });
      if (crisisPlaySeconds > 12) {
        out.push({ t: 12, level: "ok", msg: "All units on scene. Beginning suppression." });
      }
      if (crisisPlaySeconds > 12 + 60) {
        out.push({ t: 72, level: "ok", msg: "Suppression complete. Damping hot spots." });
      }
    }

    if (snapshot.flood) {
      out.push({ t: 1, level: "warn", msg: "Water level rising. Issuing evac order to district A." });
      if (crisisPlaySeconds > 4) {
        out.push({ t: 4, level: "info", msg: "Rescue boats launched: 4 units inbound." });
      }
      if (crisisPlaySeconds > 10) {
        out.push({ t: 10, level: "warn", msg: `Predicted spread: +${(snapshot.flood.predictedRadius - snapshot.flood.radius).toFixed(0)}m in 30 min.` });
      }
      if (crisisPlaySeconds > 20) {
        out.push({ t: 20, level: "ok", msg: "Pump stations engaged. Drainage at 60% capacity." });
      }
    }

    if (snapshot.surge) {
      out.push({ t: 1, level: "warn", msg: "Crowd density critical at Student Union." });
      if (crisisPlaySeconds > 3) {
        out.push({ t: 3, level: "info", msg: "Opening secondary egress routes (2 channels)." });
      }
      if (crisisPlaySeconds > 8) {
        out.push({ t: 8, level: "info", msg: "Mutual-aid units staged at perimeter." });
      }
    }

    // sort + filter to "already happened"
    return out
      .filter((e) => e.t <= crisisPlaySeconds + 0.1)
      .sort((a, b) => a.t - b.t);
  }, [city.buildings, snapshot, crisis, crisisPlaySeconds]);

  // auto-scroll to bottom when entries grow
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    if (entries.length > 0) lastEmitted.current = entries[entries.length - 1].t;
  }, [entries.length]);

  if (crisis === "none") return null;

  return (
    <div className="hud-panel rounded-lg p-3 space-y-2 max-w-md">
      <header className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-accent text-glow-magenta">
        <Radio className="w-3 h-3 animate-blink" /> Operations log · LIVE
        <span className="ml-auto text-muted-foreground">{entries.length} events</span>
      </header>
      <div
        ref={scrollRef}
        className="max-h-[180px] overflow-y-auto space-y-1 pr-1 font-mono text-[11px] leading-tight"
      >
        {entries.map((e, i) => (
          <div key={i} className="flex gap-2 items-start">
            <span className="text-muted-foreground shrink-0 w-12 tabular-nums">
              {fmt(e.t)}
            </span>
            <span className={levelClass(e.level)}>{prefix(e.level)}</span>
            <span className="flex-1">{e.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function prefix(l: LogEntry["level"]) {
  return l === "crit" ? "✕" : l === "warn" ? "!" : l === "ok" ? "✓" : "›";
}

function levelClass(l: LogEntry["level"]) {
  return l === "crit"
    ? "text-destructive shrink-0 w-3"
    : l === "warn"
    ? "text-[var(--amber)] shrink-0 w-3"
    : l === "ok"
    ? "text-[var(--emerald)] shrink-0 w-3"
    : "text-primary shrink-0 w-3";
}
