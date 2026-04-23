import type { SimSnapshot } from "@/lib/simulation";

type Props = {
  snapshot: SimSnapshot;
};

/**
 * Composite "City Resilience Index" 0..100.
 * Lower congestion / pollution / crowdLoad → higher score.
 * Crisis applies a heavy penalty until suppression progresses.
 */
export function ResilienceGauge({ snapshot }: Props) {
  const base =
    100 -
    snapshot.congestion * 35 -
    snapshot.pollution * 25 -
    snapshot.crowdLoad * 20;

  let crisisPenalty = 0;
  if (snapshot.crisis === "fire") crisisPenalty = 35;
  else if (snapshot.crisis === "flood") crisisPenalty = 28;
  else if (snapshot.crisis === "surge") crisisPenalty = 22;

  const score = Math.max(0, Math.min(100, Math.round(base - crisisPenalty)));

  const color =
    score >= 75 ? "var(--emerald)" : score >= 50 ? "var(--amber)" : "var(--danger)";

  const status =
    score >= 75
      ? "NOMINAL"
      : score >= 50
      ? "STRAINED"
      : score >= 25
      ? "DEGRADED"
      : "CRITICAL";

  // Arc maths
  const SIZE = 110;
  const R = 44;
  const C = 2 * Math.PI * R;
  const dash = (score / 100) * C;

  return (
    <div className="hud-panel rounded-lg px-3 py-2 flex items-center gap-3 min-w-[220px]">
      <svg width={SIZE / 2 + 10} height={SIZE / 2 + 10} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke="currentColor"
          className="text-border/40"
          strokeWidth={8}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${C - dash}`}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: "stroke-dasharray 0.4s ease" }}
        />
        <text
          x="50%"
          y="50%"
          textAnchor="middle"
          dy="0.35em"
          className="font-mono"
          style={{ fontSize: 28, fill: color, fontWeight: 600 }}
        >
          {score}
        </text>
      </svg>
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          Resilience Index
        </div>
        <div
          className="font-mono text-sm font-medium"
          style={{ color }}
        >
          {status}
        </div>
        <div className="text-[10px] text-muted-foreground">
          {score >= 75
            ? "All systems within tolerance"
            : score >= 50
            ? "Multiple stressors detected"
            : "Operator action required"}
        </div>
      </div>
    </div>
  );
}
