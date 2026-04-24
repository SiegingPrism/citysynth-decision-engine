import { useEffect, useRef, useState } from "react";

// Synthetic "live data" feed that mimics blended OSM/sensor inputs:
// - traffic counts (loop detectors)
// - smoke / air-quality risk
// - water-level gauges
// Values drift with smooth noise and feed back into simulation controls.

export type LiveDataSample = {
  trafficCount: number;        // 0..1 normalized hourly count
  smokeRisk: number;           // 0..1
  waterLevel: number;          // 0..1 (0 = normal, 1 = severe)
  trend: "rising" | "falling" | "stable";
  updatedAt: number;
};

export type LiveDataDeltas = {
  trafficVolume: number;       // multiplier delta to apply
  campusEventLoad: number;     // delta
  signalTimingHint: number;    // recommended (not auto-applied)
};

function smooth(prev: number, target: number, k = 0.18) {
  return prev + (target - prev) * k;
}

export function useLiveData(active: boolean): {
  sample: LiveDataSample;
  deltas: LiveDataDeltas;
  history: LiveDataSample[];
} {
  const [sample, setSample] = useState<LiveDataSample>({
    trafficCount: 0.5,
    smokeRisk: 0.05,
    waterLevel: 0.1,
    trend: "stable",
    updatedAt: Date.now(),
  });
  const [history, setHistory] = useState<LiveDataSample[]>([]);
  const phase = useRef(Math.random() * Math.PI * 2);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      phase.current += 0.18;
      const t = phase.current;
      // Multiple harmonics + jitter to mimic noisy sensors
      const traffic = Math.max(
        0,
        Math.min(1, 0.55 + Math.sin(t) * 0.22 + Math.sin(t * 2.7) * 0.08 + (Math.random() - 0.5) * 0.06),
      );
      const smoke = Math.max(
        0,
        Math.min(1, 0.12 + Math.sin(t * 0.6 + 1.1) * 0.18 + (Math.random() - 0.5) * 0.05),
      );
      const water = Math.max(
        0,
        Math.min(1, 0.18 + Math.sin(t * 0.4 + 2.3) * 0.22 + (Math.random() - 0.5) * 0.04),
      );

      setSample((prev) => {
        const next: LiveDataSample = {
          trafficCount: smooth(prev.trafficCount, traffic),
          smokeRisk: smooth(prev.smokeRisk, smoke),
          waterLevel: smooth(prev.waterLevel, water),
          trend:
            traffic - prev.trafficCount > 0.02
              ? "rising"
              : prev.trafficCount - traffic > 0.02
              ? "falling"
              : "stable",
          updatedAt: Date.now(),
        };
        return next;
      });
      setHistory((h) => {
        const n = [...h, sample];
        return n.slice(-30);
      });
    }, 1200);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Derive deltas to nudge the simulation
  const deltas: LiveDataDeltas = {
    trafficVolume: active ? 0.7 + sample.trafficCount * 0.7 : 1, // 0.7..1.4
    campusEventLoad: active ? Math.max(0, Math.min(1, 0.2 + sample.trafficCount * 0.5)) : 0.3,
    signalTimingHint: active ? 1 + (sample.trafficCount - 0.5) * 0.4 : 1,
  };

  return { sample, deltas, history };
}
