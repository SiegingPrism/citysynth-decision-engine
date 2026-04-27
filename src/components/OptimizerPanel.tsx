import { useMemo, useState } from "react";
import { Sparkles, Zap, TrendingDown, TrendingUp, Check, Loader2, Activity, Timer, Wind } from "lucide-react";
import { Button } from "@/components/ui/button";
import { optimize, type OptimizationResult } from "@/lib/optimizer";
import type { CityModel, CrisisMode, SimControls } from "@/lib/simulation";

type Props = {
  city: CityModel;
  controls: SimControls;
  crisis: CrisisMode;
  tMinutes: number;
  baseHour: number;
  crisisStartMin: number;
  onApply: (patch: Partial<SimControls>) => void;
};

export function OptimizerPanel({
  city,
  controls,
  crisis,
  tMinutes,
  baseHour,
  crisisStartMin,
  onApply,
}: Props) {
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [running, setRunning] = useState(false);
  const [applied, setApplied] = useState(false);

  const run = async () => {
    setRunning(true);
    setApplied(false);
    // Defer one frame so the spinner renders
    await new Promise((r) => setTimeout(r, 350));
    const r = optimize(city, controls, crisis, tMinutes, baseHour, crisisStartMin);
    setResult(r);
    setRunning(false);
  };

  const apply = () => {
    if (!result) return;
    onApply(result.controlsPatch);
    setApplied(true);
  };

  // The "live" before number reflects current controls (in case user keeps tweaking)
  const liveBefore = useMemo(() => {
    if (!result) return null;
    // Re-evaluate base congestion against current controls, but show the
    // optimization that was computed.
    return result;
  }, [result, controls]);

  return (
    <div className="hud-panel rounded-lg p-4 space-y-3 relative overflow-hidden">
      {/* Animated accent */}
      <div
        className="absolute -top-px left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, var(--primary), transparent)",
        }}
      />

      <header className="space-y-1">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary text-glow-cyan flex items-center gap-1.5">
          <Sparkles className="w-3 h-3" /> Decision Engine · MVP Core
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-display text-lg leading-tight">
            Optimize the city
          </h2>
          {result && (
            <span className="text-[10px] font-mono text-muted-foreground">
              {result.candidatesEvaluated} plans evaluated
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground leading-snug">
          Search signal timing, demand smoothing & targeted closures. Pick the plan that minimizes congestion.
        </p>
      </header>

      <Button
        onClick={run}
        disabled={running}
        className="w-full h-10 font-mono uppercase tracking-[0.2em] text-xs bg-primary text-primary-foreground hover:bg-primary/90 shadow-[0_0_24px_-6px_var(--primary)]"
      >
        {running ? (
          <>
            <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" />
            Searching plans…
          </>
        ) : (
          <>
            <Zap className="w-3.5 h-3.5 mr-2" />
            {result ? "Re-run optimization" : "Run optimization"}
          </>
        )}
      </Button>

      {liveBefore && (
        <div className="space-y-3 pt-1 animate-in fade-in slide-in-from-bottom-2 duration-500">
          {/* Headline improvement */}
          <div className="rounded-md border border-primary/30 bg-primary/5 p-3 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Congestion drop
              </div>
              <div className="font-display text-3xl text-primary text-glow-cyan leading-none">
                −{liveBefore.improvementPct.toFixed(0)}%
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                Confidence
              </div>
              <div className="font-mono text-lg text-[var(--emerald,oklch(0.78_0.16_160))]">
                {(liveBefore.confidence * 100).toFixed(0)}%
              </div>
            </div>
          </div>

          {/* Before / After bars */}
          <div className="space-y-2.5">
            <CompareRow
              icon={<Activity className="w-3 h-3" />}
              label="Congestion"
              before={liveBefore.before.congestion * 100}
              after={liveBefore.after.congestion * 100}
              unit="%"
              betterDirection="down"
            />
            <CompareRow
              icon={<Timer className="w-3 h-3" />}
              label="Avg delay"
              before={liveBefore.before.avgDelaySec}
              after={liveBefore.after.avgDelaySec}
              unit="s"
              betterDirection="down"
            />
            <CompareRow
              icon={<TrendingUp className="w-3 h-3" />}
              label="Flow efficiency"
              before={liveBefore.before.flowEfficiency * 100}
              after={liveBefore.after.flowEfficiency * 100}
              unit="%"
              betterDirection="up"
            />
            <CompareRow
              icon={<Wind className="w-3 h-3" />}
              label="Pollution"
              before={liveBefore.before.pollution * 100}
              after={liveBefore.after.pollution * 100}
              unit="%"
              betterDirection="down"
            />
          </div>

          {/* Plan steps */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              Recommended plan
            </div>
            <ol className="space-y-1.5">
              {liveBefore.steps.map((s, i) => (
                <li
                  key={i}
                  className="flex gap-2 text-xs rounded-md border border-border/40 bg-card/40 px-2.5 py-2"
                >
                  <span className="font-mono text-[10px] text-primary mt-0.5 shrink-0">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-medium text-foreground">{s.label}</div>
                    <div className="text-[11px] text-muted-foreground leading-snug">
                      {s.detail}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <Button
            onClick={apply}
            disabled={applied}
            variant={applied ? "outline" : "default"}
            className="w-full h-9 text-xs font-mono uppercase tracking-wider"
          >
            {applied ? (
              <>
                <Check className="w-3.5 h-3.5 mr-2" /> Plan applied
              </>
            ) : (
              <>
                <TrendingDown className="w-3.5 h-3.5 mr-2" /> Apply optimization
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

function CompareRow({
  icon,
  label,
  before,
  after,
  unit,
  betterDirection,
}: {
  icon: React.ReactNode;
  label: string;
  before: number;
  after: number;
  unit: string;
  betterDirection: "up" | "down";
}) {
  const max = Math.max(before, after, 1);
  const beforePct = (before / max) * 100;
  const afterPct = (after / max) * 100;
  const improved =
    betterDirection === "down" ? after < before : after > before;
  const deltaAbs = Math.abs(after - before);
  const deltaSign = improved ? "−" : "+";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          {icon} {label}
        </span>
        <span
          className={`font-mono ${
            improved
              ? "text-[var(--emerald,oklch(0.78_0.16_160))]"
              : "text-muted-foreground"
          }`}
        >
          {deltaSign}
          {deltaAbs.toFixed(unit === "s" ? 0 : 1)}
          {unit}
        </span>
      </div>
      <div className="space-y-0.5">
        <BarRow
          tag="Before"
          value={before}
          pct={beforePct}
          unit={unit}
          tone="muted"
        />
        <BarRow
          tag="After"
          value={after}
          pct={afterPct}
          unit={unit}
          tone={improved ? "good" : "bad"}
        />
      </div>
    </div>
  );
}

function BarRow({
  tag,
  value,
  pct,
  unit,
  tone,
}: {
  tag: string;
  value: number;
  pct: number;
  unit: string;
  tone: "muted" | "good" | "bad";
}) {
  const fill =
    tone === "good"
      ? "var(--emerald, oklch(0.78 0.16 160))"
      : tone === "bad"
      ? "var(--destructive)"
      : "color-mix(in oklab, var(--muted-foreground) 60%, transparent)";
  return (
    <div className="flex items-center gap-2">
      <span className="w-12 text-[9px] font-mono uppercase tracking-wider text-muted-foreground">
        {tag}
      </span>
      <div className="flex-1 h-2 rounded-full bg-card/60 overflow-hidden border border-border/40">
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${Math.max(2, Math.min(100, pct))}%`,
            background: fill,
            boxShadow:
              tone === "good"
                ? "0 0 12px -2px var(--emerald, oklch(0.78 0.16 160))"
                : undefined,
          }}
        />
      </div>
      <span className="w-14 text-right text-[10px] font-mono text-foreground">
        {value.toFixed(unit === "s" ? 0 : 1)}
        {unit}
      </span>
    </div>
  );
}
