import { useEffect, useState } from "react";
import { Brain, Loader2, AlertTriangle, Shield, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateIncidentPlan } from "@/lib/aiServer";
import type { CityModel, CrisisMode, SimSnapshot } from "@/lib/simulation";

type Step = {
  order: number;
  action: string;
  detail: string;
  kind: "dispatch" | "closure" | "evacuation" | "resource" | "comms" | "monitor";
  eta_min: number;
  priority: "P1" | "P2" | "P3";
};

type Plan = {
  summary: string;
  confidence: number;
  steps: Step[];
  road_closures: string[];
  resource_priority: string[];
  expected_outcome: string;
};

type Props = {
  city: CityModel;
  snapshot: SimSnapshot;
  crisis: CrisisMode;
  resilience: number;
  liveData: boolean;
};

const KIND_COLOR: Record<Step["kind"], string> = {
  dispatch: "text-[var(--cyan)] border-[var(--cyan)]/40",
  closure: "text-[var(--amber)] border-[var(--amber)]/40",
  evacuation: "text-[var(--magenta)] border-[var(--magenta)]/40",
  resource: "text-[var(--emerald)] border-[var(--emerald)]/40",
  comms: "text-foreground border-border",
  monitor: "text-muted-foreground border-border",
};

const PRIORITY_COLOR: Record<Step["priority"], string> = {
  P1: "bg-destructive/20 text-destructive border-destructive/50",
  P2: "bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/40",
  P3: "bg-muted/40 text-muted-foreground border-border",
};

export function IncidentCommander({ city, snapshot, crisis, resilience, liveData }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(0);

  // Auto-run the commander when a crisis activates
  useEffect(() => {
    if (crisis !== "none") run();
    else {
      setPlan(null);
      setRevealed(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crisis]);

  // Stagger reveal of steps
  useEffect(() => {
    if (!plan) return;
    setRevealed(0);
    const id = setInterval(() => {
      setRevealed((r) => {
        if (r >= plan.steps.length) {
          clearInterval(id);
          return r;
        }
        return r + 1;
      });
    }, 350);
    return () => clearInterval(id);
  }, [plan]);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const epi =
        snapshot.fire ?? snapshot.flood ?? snapshot.surge ?? null;
      const stations = city.buildings
        .filter((b) => b.kind === "firestation")
        .map((b) => {
          const ref = epi?.pos ?? { x: 0, z: 0 };
          const d = Math.sqrt(
            (b.pos.x - ref.x) ** 2 + (b.pos.z - ref.z) ** 2,
          );
          return { label: b.label ?? "Fire Station", distance: d };
        })
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3);

      const res = await generateIncidentPlan({
        data: {
          crisis: snapshot.crisis,
          hour: snapshot.hour,
          congestion: snapshot.congestion,
          pollution: snapshot.pollution,
          crowdLoad: snapshot.crowdLoad,
          resilience,
          epicenter: epi
            ? {
                x: epi.pos.x,
                z: epi.pos.z,
                radius: epi.radius,
                predictedRadius: epi.predictedRadius,
              }
            : undefined,
          topHotspots: snapshot.hotspots
            .slice()
            .sort((a, b) => b.intensity - a.intensity)
            .slice(0, 4)
            .map((h) => ({ label: h.label, intensity: h.intensity })),
          nearestStations: stations,
          liveData,
        },
      });
      if (res.error) setError(res.error);
      setPlan(res.plan);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="hud-panel rounded-lg p-4 space-y-3 border-l-2 border-[var(--magenta)]/60">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-accent text-glow-magenta flex items-center gap-1.5">
            <Brain className="w-3 h-3" /> AI Incident Commander
          </div>
          <h2 className="font-display text-lg">Live ops plan</h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={run}
          disabled={loading || crisis === "none"}
          className="border-accent/50 text-accent hover:bg-accent/10 hover:text-accent"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Shield className="w-3.5 h-3.5" />
          )}
          <span className="ml-1.5">{loading ? "Planning" : "Re-plan"}</span>
        </Button>
      </header>

      {crisis === "none" && (
        <p className="text-xs text-muted-foreground">
          Activate a crisis to dispatch the AI Incident Commander.
        </p>
      )}

      {error && (
        <div className="flex gap-2 items-start text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {plan && (
        <div className="space-y-3 animate-fade-in">
          {/* Summary + confidence bar */}
          <div className="rounded-md border border-border bg-card/50 p-3 space-y-2">
            <div className="text-sm">{plan.summary}</div>
            <div>
              <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                <span>Confidence</span>
                <span
                  className={
                    plan.confidence > 0.75
                      ? "text-[var(--emerald)]"
                      : plan.confidence > 0.5
                      ? "text-[var(--amber)]"
                      : "text-destructive"
                  }
                >
                  {(plan.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${plan.confidence * 100}%`,
                    background:
                      plan.confidence > 0.75
                        ? "var(--emerald)"
                        : plan.confidence > 0.5
                        ? "var(--amber)"
                        : "var(--danger)",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Steps */}
          <ol className="space-y-1.5">
            {plan.steps.slice(0, revealed).map((s) => (
              <li
                key={s.order}
                className={`rounded-md border bg-card/40 p-2.5 flex gap-2 items-start animate-fade-in ${KIND_COLOR[s.kind]}`}
              >
                <div className="flex flex-col items-center pt-0.5">
                  <div className="w-6 h-6 rounded-full border border-current flex items-center justify-center text-[10px] font-mono">
                    {s.order}
                  </div>
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="text-sm font-medium text-foreground">{s.action}</div>
                    <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${PRIORITY_COLOR[s.priority]}`}>
                      {s.priority}
                    </span>
                    <span className="text-[9px] font-mono uppercase tracking-wider opacity-70">
                      {s.kind} · ETA {s.eta_min}m
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug">{s.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          {revealed >= plan.steps.length && (
            <div className="grid grid-cols-2 gap-2 animate-fade-in">
              {plan.road_closures.length > 0 && (
                <div className="rounded-md border border-[var(--amber)]/40 bg-[var(--amber)]/5 p-2">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--amber)] mb-1">
                    Road closures
                  </div>
                  <ul className="space-y-0.5">
                    {plan.road_closures.map((c, i) => (
                      <li key={i} className="text-xs flex items-center gap-1">
                        <ChevronRight className="w-3 h-3" /> {c}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {plan.resource_priority.length > 0 && (
                <div className="rounded-md border border-[var(--cyan)]/40 bg-[var(--cyan)]/5 p-2">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--cyan)] mb-1">
                    Resource priority
                  </div>
                  <ol className="space-y-0.5">
                    {plan.resource_priority.map((c, i) => (
                      <li key={i} className="text-xs font-mono">
                        {i + 1}. {c}
                      </li>
                    ))}
                  </ol>
                </div>
              )}
            </div>
          )}

          {revealed >= plan.steps.length && (
            <div className="rounded-md border border-[var(--emerald)]/40 bg-[var(--emerald)]/5 p-2 animate-fade-in">
              <div className="text-[10px] font-mono uppercase tracking-wider text-[var(--emerald)] mb-1">
                Expected outcome
              </div>
              <p className="text-xs">{plan.expected_outcome}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
