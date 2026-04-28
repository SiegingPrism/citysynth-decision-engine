import { useEffect, useState } from "react";
import { Brain, Loader2, Sparkles, AlertTriangle, Target, ShieldAlert } from "lucide-react";
import { campusStrategist } from "@/lib/aiServer";
import {
  edgeName,
  type Campus,
  type OptimizerOutput,
  type Scenario,
  type SimResult,
} from "@/lib/campus";

type Analysis = {
  diagnosis: string;
  strategy: string;
  impact?: string;
  risks?: string;
  talking_points: string[];
  confidence: number;
};

type Props = {
  campus: Campus;
  scenario: Scenario;
  baseline: SimResult;
  optimization: OptimizerOutput | null;
  demandMultiplier: number;
};

export function CampusAIStrategist({
  campus,
  scenario,
  baseline,
  optimization,
  demandMultiplier,
}: Props) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-run when an optimization completes
  useEffect(() => {
    if (optimization) run();
    else setAnalysis(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optimization]);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const bottlenecks = baseline.bottleneckEdgeIds.slice(0, 3).map((eid) => ({
        name: edgeName(campus, eid),
        vc: baseline.edgeFlow[eid]?.vc ?? 0,
      }));

      const res = await campusStrategist({
        data: {
          scenario: {
            id: scenario.id,
            label: scenario.label,
            description: scenario.description,
            timeLabel: scenario.timeLabel,
          },
          baseline: {
            congestion: baseline.congestion,
            avgDelaySec: baseline.avgDelaySec,
            flowEfficiency: baseline.flowEfficiency,
            bottlenecks,
          },
          optimized: optimization
            ? {
                congestion: optimization.optimized.congestion,
                avgDelaySec: optimization.optimized.avgDelaySec,
                flowEfficiency: optimization.optimized.flowEfficiency,
              }
            : undefined,
          plan: optimization
            ? {
                description: optimization.plan.description,
                closedEdges: optimization.plan.closedEdgeIds.map((id) =>
                  edgeName(campus, id),
                ),
                rerouteShare: optimization.plan.rerouteShare ?? 0,
                signalRetimes: Object.entries(
                  optimization.plan.signalWeights ?? {},
                ).map(([eid, w]) => ({ edge: edgeName(campus, eid), weight: w })),
              }
            : undefined,
          improvement: optimization?.improvement,
          demandMultiplier,
        },
      });

      if (res.error) setError(res.error);
      setAnalysis(res.analysis);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="rounded-lg border border-fuchsia-400/25 bg-gradient-to-b from-fuchsia-500/[0.06] to-transparent p-3 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-fuchsia-300">
          <Sparkles className="w-3 h-3" /> Gemini AI Strategist
        </div>
        <button
          onClick={run}
          disabled={loading}
          className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded border border-fuchsia-400/30 bg-fuchsia-500/10 text-fuchsia-200 hover:bg-fuchsia-500/20 disabled:opacity-50 transition-colors"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin inline" />
          ) : (
            "Analyze"
          )}
        </button>
      </div>

      {error && (
        <div className="flex gap-1.5 items-start text-[11px] text-red-300 bg-red-500/10 border border-red-400/30 rounded px-2 py-1.5 mb-2">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {!analysis && !loading && !error && (
        <p className="text-[11px] text-white/55 leading-relaxed">
          Click <span className="text-fuchsia-300 font-semibold">Analyze</span>{" "}
          to ask Gemini to diagnose the bottleneck and narrate the optimization
          for judges.
        </p>
      )}

      {analysis && (
        <div className="space-y-2.5 animate-in fade-in duration-300">
          <Block icon={<Brain className="w-3 h-3 text-cyan-300" />} label="Diagnosis">
            {analysis.diagnosis}
          </Block>
          <Block icon={<Target className="w-3 h-3 text-emerald-300" />} label="Strategy">
            {analysis.strategy}
          </Block>
          {analysis.impact && (
            <Block icon={<Sparkles className="w-3 h-3 text-amber-300" />} label="Impact">
              {analysis.impact}
            </Block>
          )}
          {analysis.risks && (
            <Block icon={<ShieldAlert className="w-3 h-3 text-orange-300" />} label="Risks">
              {analysis.risks}
            </Block>
          )}

          {analysis.talking_points?.length > 0 && (
            <div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-white/45 mb-1">
                Judge talking points
              </div>
              <ul className="space-y-1">
                {analysis.talking_points.map((t, i) => (
                  <li
                    key={i}
                    className="text-[11px] leading-snug text-white/85 pl-2 border-l border-fuchsia-400/40"
                  >
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="pt-1.5 border-t border-white/10 flex items-center justify-between text-[10px] font-mono uppercase tracking-wider">
            <span className="text-white/50">Gemini confidence</span>
            <span
              className={
                analysis.confidence > 0.75
                  ? "text-emerald-300"
                  : analysis.confidence > 0.5
                    ? "text-amber-300"
                    : "text-red-300"
              }
            >
              {(analysis.confidence * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      )}
    </section>
  );
}

function Block({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[9px] font-mono uppercase tracking-wider text-white/55 mb-0.5">
        {icon} {label}
      </div>
      <div className="text-[12px] leading-relaxed text-white/90">{children}</div>
    </div>
  );
}
