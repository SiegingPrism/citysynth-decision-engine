import { useMemo } from "react";
import type { SimSnapshot } from "@/lib/simulation";
import { Sparkles, Activity } from "lucide-react";

type Props = {
  snapshot: SimSnapshot;
};

/**
 * One-line live verdict from the AI Operator.
 * Heuristic — reacts instantly to state without an API round-trip.
 */
export function AIVerdict({ snapshot }: Props) {
  const verdict = useMemo(() => {
    if (snapshot.crisis === "fire") {
      return {
        tone: "danger",
        text: `STRUCTURE FIRE — dispatching all engines. Predicted spread +${(snapshot.fire!.predictedRadius - snapshot.fire!.radius).toFixed(0)}m / 30 min.`,
      };
    }
    if (snapshot.crisis === "flood") {
      return {
        tone: "danger",
        text: `FLASH FLOOD — water at ${snapshot.flood!.waterLevel.toFixed(1)}m. Rescue boats deployed; opening high-ground evac corridors.`,
      };
    }
    if (snapshot.crisis === "surge") {
      return {
        tone: "warn",
        text: `CROWD SURGE — density at ${(snapshot.crowdLoad * 100).toFixed(0)}%. Channeling egress to perimeter.`,
      };
    }
    if (snapshot.congestion > 0.75) {
      return {
        tone: "warn",
        text: `Heavy congestion (${(snapshot.congestion * 100).toFixed(0)}%). Suggest boosting signal timing +0.15× and rerouting via outer ring.`,
      };
    }
    if (snapshot.pollution > 0.65) {
      return {
        tone: "warn",
        text: `Air quality degrading (PM2.5 proxy ${(snapshot.pollution * 100).toFixed(0)}%). Consider low-emission zone activation.`,
      };
    }
    if (snapshot.crowdLoad > 0.6) {
      return {
        tone: "info",
        text: `Pedestrian density rising at ${snapshot.hotspots[0]?.label ?? "campus core"}. Pre-stage marshals.`,
      };
    }
    return {
      tone: "ok",
      text: "All metrics nominal. Monitoring 12,400 agents across 184 segments.",
    };
  }, [snapshot]);

  const color =
    verdict.tone === "danger"
      ? "var(--danger)"
      : verdict.tone === "warn"
      ? "var(--amber)"
      : verdict.tone === "info"
      ? "var(--cyan)"
      : "var(--emerald)";

  return (
    <div
      className="hud-panel rounded-lg px-3 py-2 flex items-center gap-2.5 min-w-[420px] max-w-[540px] border-l-4"
      style={{ borderLeftColor: color }}
    >
      <div className="relative">
        <Sparkles className="w-4 h-4" style={{ color }} />
        <Activity className="w-2.5 h-2.5 absolute -bottom-1 -right-1 animate-pulse" style={{ color }} />
      </div>
      <div className="min-w-0">
        <div
          className="text-[9px] font-mono uppercase tracking-[0.25em]"
          style={{ color }}
        >
          AI Operator · Verdict
        </div>
        <div className="text-xs truncate">{verdict.text}</div>
      </div>
    </div>
  );
}
