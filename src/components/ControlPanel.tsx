import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CrisisMode, SimControls } from "@/lib/simulation";
import { Flame, Waves, Users2, ShieldCheck, RotateCcw } from "lucide-react";

type Props = {
  controls: SimControls;
  setControls: (c: SimControls) => void;
  crisis: CrisisMode;
  setCrisis: (c: CrisisMode) => void;
  closedCount: number;
  onClearClosures: () => void;
};

export function ControlPanel({
  controls,
  setControls,
  crisis,
  setCrisis,
  closedCount,
  onClearClosures,
}: Props) {
  return (
    <div className="hud-panel rounded-lg p-4 space-y-5">
      <header className="space-y-1">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary text-glow-cyan">
          Decision Console
        </div>
        <h2 className="font-display text-lg">Modify the city</h2>
        <p className="text-xs text-muted-foreground">
          Tweak inputs. The twin recomputes outcomes in real time.
        </p>
      </header>

      <div className="space-y-4">
        <SliderRow
          label="Signal timing"
          value={controls.signalTiming}
          min={0.5}
          max={2}
          step={0.05}
          format={(v) => `${v.toFixed(2)}×`}
          onChange={(v) => setControls({ ...controls, signalTiming: v })}
          hint="1.00× is optimal. Drift reduces flow."
        />
        <SliderRow
          label="Traffic volume"
          value={controls.trafficVolume}
          min={0.4}
          max={1.6}
          step={0.05}
          format={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => setControls({ ...controls, trafficVolume: v })}
        />
        <SliderRow
          label="Campus event load"
          value={controls.campusEventLoad}
          min={0}
          max={1}
          step={0.05}
          format={(v) => `${(v * 100).toFixed(0)}%`}
          onChange={(v) => setControls({ ...controls, campusEventLoad: v })}
          hint="Sports day, festival, exam week."
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Road closures
          </span>
          <Badge variant="outline" className="font-mono">
            {closedCount} closed
          </Badge>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Click any road in the 3D view to close/reopen it.
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={onClearClosures}
          disabled={closedCount === 0}
        >
          <RotateCcw className="w-3 h-3 mr-1" /> Reopen all
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Crisis mode
        </div>
        <div className="grid grid-cols-2 gap-2">
          <CrisisButton
            active={crisis === "none"}
            onClick={() => setCrisis("none")}
            icon={<ShieldCheck className="w-3.5 h-3.5" />}
            label="Normal"
            tone="muted"
          />
          <CrisisButton
            active={crisis === "flood"}
            onClick={() => setCrisis("flood")}
            icon={<Waves className="w-3.5 h-3.5" />}
            label="Flood"
            tone="cyan"
          />
          <CrisisButton
            active={crisis === "fire"}
            onClick={() => setCrisis("fire")}
            icon={<Flame className="w-3.5 h-3.5" />}
            label="Fire"
            tone="amber"
          />
          <CrisisButton
            active={crisis === "surge"}
            onClick={() => setCrisis("surge")}
            icon={<Users2 className="w-3.5 h-3.5" />}
            label="Crowd surge"
            tone="magenta"
          />
        </div>
      </div>
    </div>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs">{label}</label>
        <span className="text-xs font-mono text-primary text-glow-cyan">
          {format(value)}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function CrisisButton({
  active,
  onClick,
  icon,
  label,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  tone: "muted" | "cyan" | "amber" | "magenta";
}) {
  const toneClass =
    tone === "cyan"
      ? "border-[var(--cyan)]/60 text-[var(--cyan)]"
      : tone === "amber"
      ? "border-[var(--amber)]/60 text-[var(--amber)]"
      : tone === "magenta"
      ? "border-[var(--magenta)]/60 text-[var(--magenta)]"
      : "border-border text-muted-foreground";
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-mono uppercase tracking-wider transition-all ${toneClass} ${
        active ? "bg-card hud-glow" : "bg-transparent hover:bg-card/60"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
