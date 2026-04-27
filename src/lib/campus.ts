// Campus digital twin — graph-based traffic engine.
// Pure functions: buildCampus(), simulateCampus(), optimize().
// No randomness in flow propagation — fully deterministic given inputs.

export type NodeKind = "gate" | "academic" | "cafeteria" | "parking" | "junction";

export type CNode = {
  id: string;
  label: string;
  kind: NodeKind;
  x: number; // canvas-space coords (0..1000)
  y: number;
};

export type CEdge = {
  id: string;
  a: string; // node id
  b: string;
  capacity: number; // vehicles per minute (free-flow)
  length: number;   // arbitrary units (used for delay)
  // dynamic
  closed?: boolean;
  signalWeight?: number; // 0.5..1.5 — multiplier on effective capacity (signal phase share)
};

export type Campus = {
  nodes: CNode[];
  edges: CEdge[];
  byId: Record<string, CNode>;
  adj: Record<string, { edge: CEdge; to: string }[]>;
};

export type ScenarioId = "calm" | "morning" | "lunch" | "exit";

export type Scenario = {
  id: ScenarioId;
  label: string;
  timeLabel: string;
  hour: number;
  description: string;
  // Origin -> Destination demand (vehicles per minute)
  od: Array<{ from: string; to: string; rate: number }>;
};

export type EdgeFlow = {
  load: number;        // vehicles per minute on edge
  vc: number;          // load / capacity
  delaySec: number;    // BPR delay per vehicle on this edge
};

export type SimResult = {
  scenarioId: ScenarioId;
  edgeFlow: Record<string, EdgeFlow>;
  congestion: number;       // 0..1 average v/c (capped)
  avgDelaySec: number;      // mean delay across loaded edges
  flowEfficiency: number;   // 0..1 (1 = no congestion)
  bottleneckEdgeIds: string[]; // top overloaded edges
  totalThroughput: number;  // total vehicles/min successfully routed
};

// ---------- BUILD ----------

export function buildCampus(): Campus {
  // Layout in 0..1000 canvas units. Designed to look like a small campus.
  const nodes: CNode[] = [
    // Gates (perimeter)
    { id: "GA", label: "Gate A", kind: "gate", x: 80,  y: 520 },
    { id: "GB", label: "Gate B", kind: "gate", x: 940, y: 520 },
    // Parking (near gates)
    { id: "PA", label: "Parking A", kind: "parking", x: 230, y: 700 },
    { id: "PB", label: "Parking B", kind: "parking", x: 800, y: 720 },
    // Cafeteria
    { id: "CF", label: "Cafeteria", kind: "cafeteria", x: 520, y: 760 },
    // Academic blocks
    { id: "AC1", label: "Academic 1", kind: "academic", x: 360, y: 280 },
    { id: "AC2", label: "Academic 2", kind: "academic", x: 660, y: 260 },
    { id: "LIB", label: "Library",    kind: "academic", x: 520, y: 420 },
    // Internal junctions
    { id: "J1", label: "J1", kind: "junction", x: 230, y: 460 },
    { id: "J2", label: "J2", kind: "junction", x: 520, y: 540 },
    { id: "J3", label: "J3", kind: "junction", x: 800, y: 470 },
    { id: "J4", label: "J4", kind: "junction", x: 360, y: 400 },
    { id: "J5", label: "J5", kind: "junction", x: 660, y: 400 },
  ];

  const E = (id: string, a: string, b: string, capacity: number) => {
    const na = nodes.find((n) => n.id === a)!;
    const nb = nodes.find((n) => n.id === b)!;
    const length = Math.hypot(na.x - nb.x, na.y - nb.y);
    return { id, a, b, capacity, length, signalWeight: 1 } as CEdge;
  };

  const edges: CEdge[] = [
    // Gate A side
    E("e_GA_J1",  "GA",  "J1",  60),
    E("e_J1_PA",  "J1",  "PA",  40),
    E("e_J1_J4",  "J1",  "J4",  50),
    E("e_J4_AC1", "J4",  "AC1", 45),
    E("e_J1_J2",  "J1",  "J2",  55),
    // Gate B side
    E("e_GB_J3",  "GB",  "J3",  60),
    E("e_J3_PB",  "J3",  "PB",  40),
    E("e_J3_J5",  "J3",  "J5",  50),
    E("e_J5_AC2", "J5",  "AC2", 45),
    E("e_J3_J2",  "J3",  "J2",  55),
    // Spine (central)
    E("e_J4_LIB", "J4",  "LIB", 50),
    E("e_J5_LIB", "J5",  "LIB", 50),
    E("e_LIB_J2", "LIB", "J2",  60),
    E("e_J2_CF",  "J2",  "CF",  55),
    // Cross between academics
    E("e_AC1_AC2","AC1", "AC2", 35),
    // Cafeteria back routes
    E("e_PA_CF",  "PA",  "CF",  35),
    E("e_PB_CF",  "PB",  "CF",  35),
  ];

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const adj: Campus["adj"] = {};
  for (const n of nodes) adj[n.id] = [];
  for (const e of edges) {
    adj[e.a].push({ edge: e, to: e.b });
    adj[e.b].push({ edge: e, to: e.a });
  }
  return { nodes, edges, byId, adj };
}

// ---------- SCENARIOS ----------

export const SCENARIOS: Scenario[] = [
  {
    id: "calm",
    label: "Off-peak",
    timeLabel: "06:30",
    hour: 6.5,
    description: "Light flow across the campus.",
    od: [
      { from: "GA", to: "AC1", rate: 4 },
      { from: "GB", to: "AC2", rate: 4 },
    ],
  },
  {
    id: "morning",
    label: "Entry Rush",
    timeLabel: "08:30",
    hour: 8.5,
    description: "Students arriving — gates → academic blocks.",
    od: [
      { from: "GA", to: "AC1", rate: 38 },
      { from: "GA", to: "AC2", rate: 18 },
      { from: "GA", to: "PA",  rate: 22 },
      { from: "GB", to: "AC2", rate: 36 },
      { from: "GB", to: "AC1", rate: 16 },
      { from: "GB", to: "PB",  rate: 20 },
    ],
  },
  {
    id: "lunch",
    label: "Cafeteria Rush",
    timeLabel: "13:00",
    hour: 13,
    description: "Academic → Cafeteria midday surge.",
    od: [
      { from: "AC1", to: "CF", rate: 42 },
      { from: "AC2", to: "CF", rate: 40 },
      { from: "LIB", to: "CF", rate: 22 },
      { from: "GA",  to: "CF", rate: 10 },
      { from: "GB",  to: "CF", rate: 10 },
    ],
  },
  {
    id: "exit",
    label: "Exit Rush",
    timeLabel: "16:00",
    hour: 16,
    description: "Campus → Gates. Reverse direction of morning rush.",
    od: [
      { from: "AC1", to: "GA", rate: 36 },
      { from: "AC2", to: "GB", rate: 36 },
      { from: "LIB", to: "GA", rate: 14 },
      { from: "LIB", to: "GB", rate: 14 },
      { from: "PA",  to: "GA", rate: 22 },
      { from: "PB",  to: "GB", rate: 22 },
    ],
  },
];

// ---------- ROUTING + SIMULATION ----------

// Dijkstra shortest path by current effective travel cost.
// Cost = length * (1 + congestion penalty). Closed edges are skipped.
function shortestPath(
  campus: Campus,
  from: string,
  to: string,
  edgeCost: Record<string, number>,
): { path: string[]; edges: string[] } | null {
  const dist: Record<string, number> = {};
  const prev: Record<string, { node: string; edge: string } | null> = {};
  for (const n of campus.nodes) {
    dist[n.id] = Infinity;
    prev[n.id] = null;
  }
  dist[from] = 0;
  const visited = new Set<string>();
  // Simple O(N^2) — graph is tiny.
  while (true) {
    let u: string | null = null;
    let best = Infinity;
    for (const n of campus.nodes) {
      if (visited.has(n.id)) continue;
      if (dist[n.id] < best) {
        best = dist[n.id];
        u = n.id;
      }
    }
    if (u === null) break;
    if (u === to) break;
    visited.add(u);
    for (const { edge, to: v } of campus.adj[u]) {
      if (edge.closed) continue;
      const c = edgeCost[edge.id] ?? edge.length;
      const alt = dist[u] + c;
      if (alt < dist[v]) {
        dist[v] = alt;
        prev[v] = { node: u, edge: edge.id };
      }
    }
  }
  if (dist[to] === Infinity) return null;
  const path: string[] = [];
  const edges: string[] = [];
  let cur: string | null = to;
  while (cur !== null && cur !== from) {
    const p: { node: string; edge: string } | null = prev[cur];
    if (!p) return null;
    path.unshift(cur);
    edges.unshift(p.edge);
    cur = p.node;
  }
  path.unshift(from);
  return { path, edges };
}

// Iterative loading: assign demand along shortest path with congestion-aware
// re-routing. Uses BPR delay function: t = t0 * (1 + 0.15 * (v/c)^4).
export function simulateCampus(
  campus: Campus,
  scenario: Scenario,
  opts?: {
    closedEdgeIds?: string[];
    signalWeights?: Record<string, number>;
    rerouteShare?: number; // 0..1 — fraction of demand that takes 2nd-best path
    demandMultiplier?: number;
  },
): SimResult {
  const closed = new Set(opts?.closedEdgeIds ?? []);
  const sigW = opts?.signalWeights ?? {};
  const reroute = Math.max(0, Math.min(1, opts?.rerouteShare ?? 0));
  const demandMul = opts?.demandMultiplier ?? 1;

  // Reset edge state on a working copy
  for (const e of campus.edges) {
    e.closed = closed.has(e.id);
    e.signalWeight = sigW[e.id] ?? 1;
  }

  const load: Record<string, number> = {};
  for (const e of campus.edges) load[e.id] = 0;

  // Iterative assignment to model congestion feedback (3 passes).
  for (let iter = 0; iter < 3; iter++) {
    // Build cost from current load
    const edgeCost: Record<string, number> = {};
    for (const e of campus.edges) {
      const cap = Math.max(1, e.capacity * (e.signalWeight ?? 1));
      const vc = load[e.id] / cap;
      const t0 = e.length;
      const bpr = t0 * (1 + 0.15 * Math.pow(vc, 4));
      edgeCost[e.id] = bpr;
    }
    // Reset loads for this iteration
    for (const e of campus.edges) load[e.id] = 0;

    for (const od of scenario.od) {
      const totalRate = od.rate * demandMul;
      // Primary path
      const primary = shortestPath(campus, od.from, od.to, edgeCost);
      if (!primary) continue;
      const primaryShare = 1 - reroute;
      for (const eid of primary.edges) load[eid] += totalRate * primaryShare;

      if (reroute > 0) {
        // Find a 2nd path by temporarily inflating the primary edges' costs.
        const inflated = { ...edgeCost };
        for (const eid of primary.edges) inflated[eid] = (inflated[eid] ?? 1) * 5;
        const alt = shortestPath(campus, od.from, od.to, inflated);
        const altPath = alt && alt.edges.length ? alt : primary;
        for (const eid of altPath.edges) load[eid] += totalRate * reroute;
      }
    }
  }

  // Final metrics
  const edgeFlow: Record<string, EdgeFlow> = {};
  let sumVc = 0;
  let sumDelay = 0;
  let countLoaded = 0;
  let totalThroughput = 0;
  for (const e of campus.edges) {
    const cap = Math.max(1, e.capacity * (e.signalWeight ?? 1));
    const l = load[e.id];
    const vc = l / cap;
    const t0 = e.length / 50; // ~seconds at free flow
    const delaySec = t0 * (1 + 0.15 * Math.pow(vc, 4)) - t0;
    edgeFlow[e.id] = { load: l, vc, delaySec };
    if (!e.closed) {
      sumVc += Math.min(2, vc);
      if (l > 0.5) {
        sumDelay += delaySec;
        countLoaded++;
      }
      totalThroughput += Math.min(l, cap);
    }
  }
  const avgVc = sumVc / Math.max(1, campus.edges.length);
  const congestion = Math.min(1, avgVc / 1.2);
  const avgDelaySec = countLoaded ? sumDelay / countLoaded : 0;
  const flowEfficiency = Math.max(0, Math.min(1, 1 - congestion));

  const bottleneckEdgeIds = campus.edges
    .filter((e) => !e.closed)
    .sort((a, b) => edgeFlow[b.id].vc - edgeFlow[a.id].vc)
    .slice(0, 3)
    .map((e) => e.id);

  return {
    scenarioId: scenario.id,
    edgeFlow,
    congestion,
    avgDelaySec,
    flowEfficiency,
    bottleneckEdgeIds,
    totalThroughput,
  };
}

// ---------- OPTIMIZER ----------

export type OptimizerPlan = {
  closedEdgeIds: string[];
  signalWeights: Record<string, number>;
  rerouteShare: number;
  description: string[]; // human steps
};

export type OptimizerOutput = {
  baseline: SimResult;
  optimized: SimResult;
  plan: OptimizerPlan;
  improvement: {
    congestionDropPct: number;
    delayDropPct: number;
    flowGainPct: number;
  };
  explanation: string[];
  confidence: number; // 0..1
};

// Search a small set of candidate plans and pick the best.
export function optimize(campus: Campus, scenario: Scenario): OptimizerOutput {
  const baseline = simulateCampus(campus, scenario);

  const top = baseline.bottleneckEdgeIds;
  const candidates: OptimizerPlan[] = [];

  // Always-considered plans
  candidates.push({
    closedEdgeIds: [],
    signalWeights: {},
    rerouteShare: 0.25,
    description: ["Distribute 25% of demand to alternative routes."],
  });
  candidates.push({
    closedEdgeIds: [],
    signalWeights: {},
    rerouteShare: 0.4,
    description: ["Distribute 40% of demand to alternative routes."],
  });

  // Boost capacity (signal weight) on the worst edges, paired with reroute
  for (const reroute of [0.2, 0.35, 0.5]) {
    const sig: Record<string, number> = {};
    const desc: string[] = [];
    for (const eid of top) {
      sig[eid] = 1.3;
      desc.push(`Re-time signal on ${edgeName(campus, eid)} (+30% green time).`);
    }
    desc.push(`Reroute ${Math.round(reroute * 100)}% of traffic to secondary paths.`);
    candidates.push({ closedEdgeIds: [], signalWeights: sig, rerouteShare: reroute, description: desc });
  }

  // Soft-close the single worst edge (force full reroute)
  if (top[0]) {
    candidates.push({
      closedEdgeIds: [top[0]],
      signalWeights: { [top[1] ?? top[0]]: 1.25 },
      rerouteShare: 0.0,
      description: [
        `Temporarily close ${edgeName(campus, top[0])} to break the bottleneck.`,
        top[1] ? `Boost signal on ${edgeName(campus, top[1])} to absorb diverted flow.` : "",
      ].filter(Boolean),
    });
  }

  // Score: lower congestion + lower delay + higher throughput
  const score = (r: SimResult) =>
    r.congestion * 1.0 + r.avgDelaySec * 0.02 - r.flowEfficiency * 0.4 - r.totalThroughput * 0.001;

  let best = { plan: candidates[0], result: simulateCampus(campus, scenario, candidates[0]) };
  let bestScore = score(best.result);
  for (let i = 1; i < candidates.length; i++) {
    const r = simulateCampus(campus, scenario, candidates[i]);
    const s = score(r);
    if (s < bestScore) {
      bestScore = s;
      best = { plan: candidates[i], result: r };
    }
  }

  const congestionDropPct = pctDrop(baseline.congestion, best.result.congestion);
  const delayDropPct = pctDrop(baseline.avgDelaySec, best.result.avgDelaySec);
  const flowGainPct = pctGain(baseline.flowEfficiency, best.result.flowEfficiency);

  const explanation = buildExplanation(campus, scenario, baseline, best.result, best.plan, {
    congestionDropPct,
    delayDropPct,
    flowGainPct,
  });

  const confidence = Math.max(
    0.55,
    Math.min(0.97, 0.6 + (congestionDropPct / 100) * 1.2 + (flowGainPct / 100) * 0.3),
  );

  return {
    baseline,
    optimized: best.result,
    plan: best.plan,
    improvement: { congestionDropPct, delayDropPct, flowGainPct },
    explanation,
    confidence,
  };
}

function pctDrop(before: number, after: number) {
  if (before <= 0.0001) return 0;
  return Math.max(0, ((before - after) / before) * 100);
}
function pctGain(before: number, after: number) {
  if (before <= 0.0001) return after > 0 ? 100 : 0;
  return Math.max(0, ((after - before) / before) * 100);
}

export function edgeName(campus: Campus, eid: string): string {
  const e = campus.edges.find((x) => x.id === eid);
  if (!e) return eid;
  const a = campus.byId[e.a]?.label ?? e.a;
  const b = campus.byId[e.b]?.label ?? e.b;
  return `${a} ↔ ${b}`;
}

// ---------- EXPLAINABILITY ----------

function buildExplanation(
  campus: Campus,
  scenario: Scenario,
  baseline: SimResult,
  optimized: SimResult,
  plan: OptimizerPlan,
  imp: { congestionDropPct: number; delayDropPct: number; flowGainPct: number },
): string[] {
  const lines: string[] = [];

  // 1. Cause of congestion
  const worstId = baseline.bottleneckEdgeIds[0];
  if (worstId) {
    const worst = baseline.edgeFlow[worstId];
    const where = edgeName(campus, worstId);
    const vcPct = Math.round(worst.vc * 100);
    lines.push(
      `During the ${scenario.label.toLowerCase()} (${scenario.timeLabel}), ${where} was overloaded — running at ${vcPct}% of capacity.`,
    );
  }

  // 2. Action taken
  if (plan.closedEdgeIds.length > 0) {
    const closed = plan.closedEdgeIds.map((id) => edgeName(campus, id)).join(", ");
    lines.push(`Traffic was redirected away from ${closed} to relieve the choke point.`);
  } else if (Object.keys(plan.signalWeights).length > 0 && plan.rerouteShare > 0) {
    lines.push(
      `Signals were retimed on the busiest edges (+30% green time) and ${Math.round(
        plan.rerouteShare * 100,
      )}% of traffic was rerouted to secondary paths.`,
    );
  } else if (plan.rerouteShare > 0) {
    lines.push(
      `${Math.round(plan.rerouteShare * 100)}% of traffic was rerouted onto under-used alternative paths.`,
    );
  } else {
    lines.push("Signal phasing was rebalanced to favor the most loaded approach.");
  }

  // 3. Result
  if (imp.congestionDropPct >= 1) {
    lines.push(
      `This reduced overall congestion by ${imp.congestionDropPct.toFixed(0)}% and average delay by ${imp.delayDropPct.toFixed(
        0,
      )}%.`,
    );
  } else {
    lines.push(
      `Network was already near-optimal — flow efficiency improved by ${imp.flowGainPct.toFixed(0)}%.`,
    );
  }

  // 4. New top bottleneck (forward look)
  const newTop = optimized.bottleneckEdgeIds[0];
  if (newTop && optimized.edgeFlow[newTop].vc > 0.85) {
    lines.push(
      `Next likely pressure point: ${edgeName(campus, newTop)} (${Math.round(
        optimized.edgeFlow[newTop].vc * 100,
      )}% of capacity).`,
    );
  }

  return lines;
}
