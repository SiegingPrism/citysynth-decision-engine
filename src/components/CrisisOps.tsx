import { useMemo } from "react";
import type { CityModel, SimSnapshot } from "@/lib/simulation";
import { Truck, Users, Building2, Timer, ShieldAlert } from "lucide-react";

type Props = {
  city: CityModel;
  snapshot: SimSnapshot;
  crisisPlaySeconds: number;
};

/**
 * Live operational dashboard during a crisis.
 * Numbers are derived from the simulation snapshot + the realtime crisis clock,
 * so they update smoothly as the user scrubs the timeline.
 */
export function CrisisOps({ city, snapshot, crisisPlaySeconds }: Props) {
  const stations = useMemo(
    () => city.buildings.filter((b) => b.kind === "firestation"),
    [city.buildings],
  );

  if (snapshot.crisis === "none") return null;

  // ------------- Metrics ----------------------------------------------------
  let unitsDispatched = 0;
  let etaSeconds = 0;
  let structuresAtRisk = 0;
  let structuresLost = 0;
  let evacuated = 0;
  let suppressionPct = 0;

  if (snapshot.fire) {
    unitsDispatched = stations.length;
    // matches DRIVE_DURATION in CityScene FireTrucks
    const DRIVE = 12;
    etaSeconds = Math.max(0, DRIVE - crisisPlaySeconds);

    structuresAtRisk = city.buildings.filter((b) => {
      const dx = b.pos.x - snapshot.fire!.pos.x;
      const dz = b.pos.z - snapshot.fire!.pos.z;
      return Math.sqrt(dx * dx + dz * dz) <= snapshot.fire!.radius + 8;
    }).length;

    // Damage growth — collapse occurs ~22s after ignition; ignition delay scales with distance
    structuresLost = city.buildings.filter((b) => {
      const dx = b.pos.x - snapshot.fire!.pos.x;
      const dz = b.pos.z - snapshot.fire!.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > snapshot.fire!.radius + 8) return false;
      const delay = (d / Math.max(1, snapshot.fire!.radius)) * 18;
      return crisisPlaySeconds - delay > 22;
    }).length;

    // Suppression: starts when trucks arrive (12s), reaches 100% over next ~60s
    const sprayElapsed = Math.max(0, crisisPlaySeconds - DRIVE);
    suppressionPct = Math.min(100, (sprayElapsed / 60) * 100);
  }

  if (snapshot.flood) {
    evacuated = Math.min(
      18000,
      Math.floor(crisisPlaySeconds * 240 + snapshot.flood.radius * 8),
    );
    structuresAtRisk = city.buildings.filter((b) => {
      const dx = b.pos.x - snapshot.flood!.pos.x;
      const dz = b.pos.z - snapshot.flood!.pos.z;
      return Math.sqrt(dx * dx + dz * dz) <= snapshot.flood!.radius;
    }).length;
    unitsDispatched = 4; // boats
  }

  if (snapshot.surge) {
    // crowd evacuated grows with time
    evacuated = Math.min(
      9500,
      Math.floor(crisisPlaySeconds * 180 + snapshot.surge.radius * 6),
    );
    structuresAtRisk = city.buildings.filter((b) => {
      const dx = b.pos.x - snapshot.surge!.pos.x;
      const dz = b.pos.z - snapshot.surge!.pos.z;
      return Math.sqrt(dx * dx + dz * dz) <= snapshot.surge!.radius;
    }).length;
  }

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m > 0 ? `${m}m ${sec.toString().padStart(2, "0")}s` : `${sec}s`;
  };

  const elapsed = Math.floor(crisisPlaySeconds);

  const crisisLabel =
    snapshot.crisis === "fire"
      ? "STRUCTURE FIRE"
      : snapshot.crisis === "flood"
      ? "FLASH FLOOD"
      : "CROWD SURGE";

  const accent =
    snapshot.crisis === "fire"
      ? "var(--danger)"
      : snapshot.crisis === "flood"
      ? "var(--cyan)"
      : "var(--magenta)";

  return (
    <div
      className="hud-panel rounded-lg p-3 space-y-3 border-2"
      style={{ borderColor: `color-mix(in oklab, ${accent} 50%, transparent)` }}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" style={{ color: accent }} />
          <div>
            <div
              className="text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{ color: accent }}
            >
              Crisis Ops · LIVE
            </div>
            <div className="font-display text-sm">{crisisLabel}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-mono uppercase text-muted-foreground">
            T+ elapsed
          </div>
          <div className="font-mono text-sm tabular-nums" style={{ color: accent }}>
            {fmtTime(elapsed)}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <Metric
          icon={<Truck className="w-3 h-3" />}
          label={snapshot.flood ? "Boats deployed" : "Units dispatched"}
          value={unitsDispatched.toString()}
          accent={accent}
        />
        {snapshot.fire && (
          <Metric
            icon={<Timer className="w-3 h-3" />}
            label="ETA on scene"
            value={etaSeconds > 0 ? fmtTime(etaSeconds) : "ON SCENE"}
            accent={etaSeconds > 0 ? "var(--amber)" : "var(--emerald)"}
          />
        )}
        {(snapshot.flood || snapshot.surge) && (
          <Metric
            icon={<Users className="w-3 h-3" />}
            label="Evacuated"
            value={evacuated.toLocaleString()}
            accent="var(--emerald)"
          />
        )}
        <Metric
          icon={<Building2 className="w-3 h-3" />}
          label="Structures at risk"
          value={structuresAtRisk.toString()}
          accent="var(--amber)"
        />
        {snapshot.fire && (
          <>
            <Metric
              icon={<Building2 className="w-3 h-3" />}
              label="Lost"
              value={structuresLost.toString()}
              accent="var(--danger)"
            />
            <SuppressionBar pct={suppressionPct} />
          </>
        )}
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="rounded-md border border-border bg-card/40 p-2">
      <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className="font-mono text-base tabular-nums mt-0.5"
        style={{ color: accent }}
      >
        {value}
      </div>
    </div>
  );
}

function SuppressionBar({ pct }: { pct: number }) {
  return (
    <div className="col-span-2 rounded-md border border-border bg-card/40 p-2">
      <div className="flex items-center justify-between text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
        <span>Suppression</span>
        <span style={{ color: "var(--emerald)" }}>{pct.toFixed(0)}%</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-border/40 overflow-hidden">
        <div
          className="h-full transition-all duration-300"
          style={{
            width: `${pct}%`,
            background:
              "linear-gradient(90deg, var(--amber), var(--emerald))",
          }}
        />
      </div>
    </div>
  );
}
