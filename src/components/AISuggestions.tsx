import { useEffect, useState } from "react";
import { Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { suggestOptimizations } from "@/lib/aiServer";
import type { CrisisMode, SimControls, SimSnapshot } from "@/lib/simulation";

type Suggestion = {
  title: string;
  rationale: string;
  predicted_impact: string;
  apply?: { signalTiming?: number; trafficVolume?: number; campusEventLoad?: number };
};

type Props = {
  snapshot: SimSnapshot;
  controls: SimControls;
  crisis: CrisisMode;
  onApply: (patch: Partial<SimControls>) => void;
};

export function AISuggestions({ snapshot, controls, crisis, onApply }: Props) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-fetch when crisis changes; manual otherwise
  useEffect(() => {
    if (crisis !== "none") run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crisis]);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await suggestOptimizations({
        data: {
          snapshot: {
            hour: snapshot.hour,
            congestion: snapshot.congestion,
            pollution: snapshot.pollution,
            crowdLoad: snapshot.crowdLoad,
            crisis: snapshot.crisis,
            topHotspots: snapshot.hotspots
              .slice()
              .sort((a, b) => b.intensity - a.intensity)
              .slice(0, 5)
              .map((h) => ({ label: h.label, intensity: h.intensity })),
          },
          controls,
        },
      });
      setItems(res.suggestions ?? []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="hud-panel rounded-lg p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-accent text-glow-magenta">
            AI Operator
          </div>
          <h2 className="font-display text-lg">Autonomous suggestions</h2>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={run}
          disabled={loading}
          className="border-accent/50 text-accent hover:bg-accent/10 hover:text-accent"
        >
          {loading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          <span className="ml-1.5">{loading ? "Thinking" : "Analyze"}</span>
        </Button>
      </header>

      {error && (
        <div className="flex gap-2 items-start text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      {!items.length && !loading && !error && (
        <p className="text-xs text-muted-foreground">
          Run analysis to receive optimization moves with predicted impact.
        </p>
      )}

      <ul className="space-y-2">
        {items.map((s, i) => (
          <li
            key={i}
            className="rounded-md border border-border bg-card/60 p-3 space-y-1.5"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="font-medium text-sm">{s.title}</div>
              {s.apply && Object.keys(s.apply).length > 0 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-[10px] text-primary hover:text-primary"
                  onClick={() => onApply(s.apply!)}
                >
                  Apply
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{s.rationale}</p>
            <div className="text-[11px] font-mono text-emerald-400">
              → {s.predicted_impact}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
