import { Activity, Droplets, Flame, Radio, TrendingDown, TrendingUp, Minus } from "lucide-react";
import type { LiveDataSample } from "@/hooks/useLiveData";

type Props = {
  active: boolean;
  onToggle: (v: boolean) => void;
  sample: LiveDataSample;
};

export function LiveDataPanel({ active, onToggle, sample }: Props) {
  const TrendIcon =
    sample.trend === "rising"
      ? TrendingUp
      : sample.trend === "falling"
      ? TrendingDown
      : Minus;

  return (
    <div className="hud-panel rounded-lg p-3 space-y-2.5">
      <header className="flex items-center justify-between">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary text-glow-cyan flex items-center gap-1.5">
          <Radio className={`w-3 h-3 ${active ? "animate-pulse" : "opacity-50"}`} />
          Live Data Feed
        </div>
        <button
          onClick={() => onToggle(!active)}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            active ? "bg-[var(--emerald)]" : "bg-secondary"
          }`}
          aria-label="Toggle live data"
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-background transition-transform ${
              active ? "translate-x-5" : "translate-x-1"
            }`}
          />
        </button>
      </header>

      {active ? (
        <>
          <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--emerald)] animate-pulse" />
            Streaming OSM + sensor inputs · {new Date(sample.updatedAt).toLocaleTimeString()}
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <Metric
              icon={<Activity className="w-3 h-3" />}
              label="Traffic"
              value={`${(sample.trafficCount * 100).toFixed(0)}%`}
              accent="text-[var(--cyan)]"
            />
            <Metric
              icon={<Flame className="w-3 h-3" />}
              label="Smoke"
              value={`${(sample.smokeRisk * 100).toFixed(0)}`}
              accent="text-[var(--amber)]"
            />
            <Metric
              icon={<Droplets className="w-3 h-3" />}
              label="Water"
              value={`${(sample.waterLevel * 100).toFixed(0)}`}
              accent="text-[var(--magenta)]"
            />
          </div>

          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-muted-foreground uppercase tracking-wider">Trend</span>
            <span className="flex items-center gap-1 text-foreground">
              <TrendIcon className="w-3 h-3" /> {sample.trend}
            </span>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          Toggle on to blend synthetic OSM traffic counts, smoke risk and water-level gauges into the simulation in real time.
        </p>
      )}
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
    <div className="rounded-md border border-border bg-card/40 px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`font-mono text-sm ${accent}`}>{value}</div>
    </div>
  );
}
