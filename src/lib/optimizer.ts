// MVP Decision Engine.
// Tries small, realistic interventions (signal retiming, targeted closures,
// demand smoothing) and picks the configuration with the best composite
// score. Returns Before/After metrics so the UI can prove the win.

import {
  simulate,
  type CityModel,
  type CrisisMode,
  type SimControls,
  type SimSnapshot,
} from "./simulation";

export type OptimizationMetrics = {
  congestion: number;       // 0..1
  avgDelaySec: number;      // estimated avg vehicle delay
  flowEfficiency: number;   // 0..1 — higher is better
  pollution: number;        // 0..1
};

export type OptimizationStep = {
  label: string;
  detail: string;
};

export type OptimizationResult = {
  before: OptimizationMetrics;
  after: OptimizationMetrics;
  improvementPct: number;        // % drop in congestion
  delayImprovementPct: number;   // % drop in delay
  flowImprovementPct: number;    // % gain in efficiency
  controlsPatch: Partial<SimControls>;
  steps: OptimizationStep[];
  confidence: number;            // 0..1
  candidatesEvaluated: number;
};

function metricsFrom(snapshot: SimSnapshot): OptimizationMetrics {
  const congestion = snapshot.congestion;
  // Delay grows non-linearly with congestion (BPR-style curve, scaled to seconds)
  const avgDelaySec = 8 + Math.pow(congestion, 2.4) * 180;
  const flowEfficiency = Math.max(0, 1 - congestion * 0.85 - snapshot.pollution * 0.05);
  return {
    congestion,
    avgDelaySec,
    flowEfficiency,
    pollution: snapshot.pollution,
  };
}

function score(m: OptimizationMetrics) {
  // Lower is better
  return m.congestion * 1.0 + m.pollution * 0.25 - m.flowEfficiency * 0.4;
}

export function optimize(
  city: CityModel,
  baseControls: SimControls,
  crisis: CrisisMode,
  tMinutes: number,
  baseHour: number,
  crisisStartMin: number,
): OptimizationResult {
  const baseSnap = simulate(city, baseControls, crisis, tMinutes, baseHour, crisisStartMin);
  const before = metricsFrom(baseSnap);

  // Identify the worst-utilized roads — candidates for targeted closure (re-route)
  const flowEntries = Object.entries(baseSnap.roadFlow);
  flowEntries.sort((a, b) => b[1] - a[1]);
  const worstRoads = flowEntries.slice(0, 6).map(([id]) => id);

  // Search grid
  const signalCandidates = [0.85, 0.9, 0.95, 1.0, 1.05, 1.1];
  const volumeShapingCandidates = [0, -0.05, -0.1, -0.15]; // demand-management nudge
  const closureSets: string[][] = [
    [],
    [worstRoads[0]].filter(Boolean),
    [worstRoads[0], worstRoads[2]].filter(Boolean),
    [worstRoads[1], worstRoads[3]].filter(Boolean),
  ];

  let best: {
    score: number;
    snap: SimSnapshot;
    controls: SimControls;
    patch: Partial<SimControls>;
    closures: string[];
    signal: number;
    volumeNudge: number;
  } | null = null;
  let evaluated = 0;

  for (const sig of signalCandidates) {
    for (const vol of volumeShapingCandidates) {
      for (const closures of closureSets) {
        evaluated++;
        const candidate: SimControls = {
          ...baseControls,
          signalTiming: sig,
          trafficVolume: Math.max(0.4, Math.min(1.6, baseControls.trafficVolume + vol)),
          // Merge new closures with existing ones, dedup
          closedRoadIds: Array.from(new Set([...baseControls.closedRoadIds, ...closures])),
        };
        const snap = simulate(city, candidate, crisis, tMinutes, baseHour, crisisStartMin);
        const m = metricsFrom(snap);
        const s = score(m);
        if (!best || s < best.score) {
          best = {
            score: s,
            snap,
            controls: candidate,
            patch: {
              signalTiming: sig,
              trafficVolume: candidate.trafficVolume,
              closedRoadIds: candidate.closedRoadIds,
            },
            closures,
            signal: sig,
            volumeNudge: vol,
          };
        }
      }
    }
  }

  const after = best ? metricsFrom(best.snap) : before;

  const improvementPct =
    before.congestion > 0
      ? Math.max(0, (before.congestion - after.congestion) / before.congestion) * 100
      : 0;
  const delayImprovementPct =
    before.avgDelaySec > 0
      ? Math.max(0, (before.avgDelaySec - after.avgDelaySec) / before.avgDelaySec) * 100
      : 0;
  const flowImprovementPct =
    before.flowEfficiency > 0
      ? ((after.flowEfficiency - before.flowEfficiency) / before.flowEfficiency) * 100
      : 0;

  const steps: OptimizationStep[] = [];
  if (best) {
    if (Math.abs(best.signal - baseControls.signalTiming) > 0.02) {
      steps.push({
        label: `Retime signals to ${best.signal.toFixed(2)}×`,
        detail: `Shift cycle length toward optimum to clear arterial backlog.`,
      });
    }
    if (best.volumeNudge < 0) {
      steps.push({
        label: `Demand smoothing −${Math.abs(best.volumeNudge * 100).toFixed(0)}%`,
        detail: `Stagger campus departures / push transit incentives to flatten the peak.`,
      });
    }
    if (best.closures.length > 0) {
      steps.push({
        label: `Re-route via ${best.closures.length} corridor${best.closures.length > 1 ? "s" : ""}`,
        detail: `Temporarily restrict ${best.closures.join(", ")} to relieve choke points.`,
      });
    }
    if (steps.length === 0) {
      steps.push({
        label: "System near optimum",
        detail: "No materially better configuration found — current plan is on the efficient frontier.",
      });
    }
  }

  // Confidence: bigger relative improvement + more candidates evaluated → higher
  const confidence = Math.min(
    0.98,
    0.55 + Math.min(0.4, improvementPct / 60) + Math.min(0.05, evaluated / 500),
  );

  return {
    before,
    after,
    improvementPct,
    delayImprovementPct,
    flowImprovementPct,
    controlsPatch: best?.patch ?? {},
    steps,
    confidence,
    candidatesEvaluated: evaluated,
  };
}
