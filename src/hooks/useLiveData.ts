import { useEffect, useMemo, useRef, useState } from "react";
import { BoundedQueue, kernel } from "@/lib/kernel";

// Live sensor feed built on the CitySynth kernel:
// - The PRODUCER is a scheduled kernel task that samples the blended
//   OSM/sensor stream every 1.2 s and pushes into a BOUNDED QUEUE.
// - The CONSUMER is a higher-priority scheduled task that drains the
//   queue in its own time slice and updates React state.
// - The history buffer and the IPC queue occupy real blocks in the
//   kernel's simulated heap (allocated on mount, freed on unmount).

export type LiveDataSample = {
  trafficCount: number; // 0..1 normalized hourly count
  smokeRisk: number; // 0..1
  waterLevel: number; // 0..1 (0 = normal, 1 = severe)
  trend: "rising" | "falling" | "stable";
  updatedAt: number;
};

export type LiveDataDeltas = {
  trafficVolume: number; // multiplier delta to apply
  campusEventLoad: number; // delta
  signalTimingHint: number; // recommended (not auto-applied)
};

function smooth(prev: number, target: number, k = 0.18) {
  return prev + (target - prev) * k;
}

function genTarget(t: number) {
  return {
    traffic: Math.max(
      0,
      Math.min(1, 0.55 + Math.sin(t) * 0.22 + Math.sin(t * 2.7) * 0.08 + (Math.random() - 0.5) * 0.06),
    ),
    smoke: Math.max(
      0,
      Math.min(1, 0.12 + Math.sin(t * 0.6 + 1.1) * 0.18 + (Math.random() - 0.5) * 0.05),
    ),
    water: Math.max(
      0,
      Math.min(1, 0.18 + Math.sin(t * 0.4 + 2.3) * 0.22 + (Math.random() - 0.5) * 0.04),
    ),
  };
}

const INITIAL: LiveDataSample = {
  trafficCount: 0.5,
  smokeRisk: 0.05,
  waterLevel: 0.1,
  trend: "stable",
  updatedAt: Date.now(),
};

export function useLiveData(active: boolean): {
  sample: LiveDataSample;
  deltas: LiveDataDeltas;
  history: LiveDataSample[];
} {
  const [sample, setSample] = useState<LiveDataSample>(INITIAL);
  const [history, setHistory] = useState<LiveDataSample[]>([]);
  const phase = useRef(Math.random() * Math.PI * 2);
  const lastTarget = useRef({ traffic: 0.5, smoke: 0.12, water: 0.18 });

  useEffect(() => {
    if (!active) return;

    // Producer-consumer wiring lives in the kernel:
    const queue = new BoundedQueue<LiveDataSample>("sensors.telemetry", 5, kernel);
    // Both the queue slots and the 30-sample history ring occupy real heap blocks:
    const queueMem = kernel.mem.alloc("ipc.queue.telemetry", 5);
    const historyMem = kernel.mem.alloc("sensors.history", 30);

    // PRODUCER — low priority, runs every 1.2 s, pushes into the bounded queue.
    const unregisterProducer = kernel.register({
      id: "sensors.producer",
      label: "Sensor Producer",
      priority: 1,
      sliceMs: 1.2,
      intervalMs: 1200,
      run: () => {
        phase.current += 0.18;
        const t = phase.current;
        const tgt = genTarget(t);
        const next: LiveDataSample = {
          trafficCount: smooth(lastTarget.current.traffic, tgt.traffic),
          smokeRisk: smooth(lastTarget.current.smoke, tgt.smoke),
          waterLevel: smooth(lastTarget.current.water, tgt.water),
          trend:
            tgt.traffic - lastTarget.current.traffic > 0.02
              ? "rising"
              : lastTarget.current.traffic - tgt.traffic > 0.02
              ? "falling"
              : "stable",
          updatedAt: Date.now(),
        };
        lastTarget.current = { traffic: next.trafficCount, smoke: next.smokeRisk, water: next.waterLevel };
        queue.put(next); // bounded — under pressure the oldest sample is evicted
        return true;
      },
    });

    // CONSUMER — highest priority, drains up to 2 messages per quantum.
    const unregisterConsumer = kernel.register({
      id: "sensors.consumer",
      label: "Sensor Consumer",
      priority: 0,
      sliceMs: 2,
      intervalMs: 250,
      run: () => {
        const batch = queue.take(2);
        if (batch.length === 0) return true;
        setSample(batch[batch.length - 1]);
        setHistory((h) => {
          const n = [...h, ...batch];
          return n.slice(-30);
        });
        return true;
      },
    });

    return () => {
      unregisterProducer();
      unregisterConsumer();
      queue.dispose();
      kernel.mem.free(queueMem); // IPC buffer returned to the heap
      kernel.mem.free(historyMem); // history ring returned to the heap
    };
  }, [active]);

  // Derive deltas to nudge the simulation
  const deltas: LiveDataDeltas = useMemo(
    () => ({
      trafficVolume: active ? 0.7 + sample.trafficCount * 0.7 : 1, // 0.7..1.4
      campusEventLoad: active ? Math.max(0, Math.min(1, 0.2 + sample.trafficCount * 0.5)) : 0.3,
      signalTimingHint: active ? 1 + (sample.trafficCount - 0.5) * 0.4 : 1,
    }),
    [active, sample.trafficCount],
  );

  return { sample, deltas, history };
}
