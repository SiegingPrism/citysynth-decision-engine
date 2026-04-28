import { createServerFn } from "@tanstack/react-start";

type SuggestionInput = {
  snapshot: {
    hour: number;
    congestion: number;
    pollution: number;
    crowdLoad: number;
    crisis: string;
    topHotspots: { label: string; intensity: number }[];
  };
  controls: {
    signalTiming: number;
    trafficVolume: number;
    campusEventLoad: number;
  };
};

const SYSTEM = `You are the AI operator of a city + campus Digital Twin.
You receive the current state and current operator controls.
Propose 3 concrete OPTIMIZATION MOVES the operator should take RIGHT NOW.
Each suggestion MUST include:
- title: short imperative (max 60 chars)
- rationale: 1-2 sentences referencing real numbers from input
- predicted_impact: a measurable estimate, e.g. "reduces congestion by ~22%" or "evacuates 1,200 in 6 min"
- apply: an object that may contain new values for signalTiming (0.5-2), trafficVolume (0.4-1.6), or campusEventLoad (0-1). Omit fields that should not change.

Be SHARP, NUMERIC, and OPERATIONAL. No fluff. If a crisis is active, prioritize evacuation/safety first.`;

export const suggestOptimizations = createServerFn({ method: "POST" })
  .inputValidator((data: SuggestionInput) => data)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return {
        suggestions: [],
        error: "AI key not configured",
      };
    }

    const userMsg = `STATE:
- local hour: ${data.snapshot.hour.toFixed(1)}
- congestion: ${(data.snapshot.congestion * 100).toFixed(0)}%
- pollution: ${(data.snapshot.pollution * 100).toFixed(0)}%
- crowd load: ${(data.snapshot.crowdLoad * 100).toFixed(0)}%
- crisis: ${data.snapshot.crisis}
- top hotspots: ${data.snapshot.topHotspots
      .map((h) => `${h.label} (${(h.intensity * 100).toFixed(0)}%)`)
      .join(", ") || "none"}

CONTROLS:
- signalTiming: ${data.controls.signalTiming.toFixed(2)}
- trafficVolume: ${data.controls.trafficVolume.toFixed(2)}
- campusEventLoad: ${data.controls.campusEventLoad.toFixed(2)}`;

    try {
      const res = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: SYSTEM },
              { role: "user", content: userMsg },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "submit_suggestions",
                  description: "Return optimization suggestions for the operator.",
                  parameters: {
                    type: "object",
                    properties: {
                      suggestions: {
                        type: "array",
                        minItems: 3,
                        maxItems: 4,
                        items: {
                          type: "object",
                          properties: {
                            title: { type: "string" },
                            rationale: { type: "string" },
                            predicted_impact: { type: "string" },
                            apply: {
                              type: "object",
                              properties: {
                                signalTiming: { type: "number" },
                                trafficVolume: { type: "number" },
                                campusEventLoad: { type: "number" },
                              },
                              additionalProperties: false,
                            },
                          },
                          required: ["title", "rationale", "predicted_impact"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["suggestions"],
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: {
              type: "function",
              function: { name: "submit_suggestions" },
            },
          }),
        },
      );

      if (!res.ok) {
        if (res.status === 429) {
          return {
            suggestions: [],
            error: "Rate limit reached. Try again shortly.",
          };
        }
        if (res.status === 402) {
          return {
            suggestions: [],
            error: "AI credits exhausted. Add funds in Workspace → Usage.",
          };
        }
        const text = await res.text();
        console.error("AI gateway error", res.status, text);
        return { suggestions: [], error: `AI gateway error (${res.status})` };
      }

      const json = await res.json();
      const call = json.choices?.[0]?.message?.tool_calls?.[0];
      const args = call?.function?.arguments
        ? JSON.parse(call.function.arguments)
        : null;

      return {
        suggestions: args?.suggestions ?? [],
        error: null,
      };
    } catch (err) {
      console.error("suggestOptimizations failed", err);
      return {
        suggestions: [],
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  });

/* ============== AI INCIDENT COMMANDER ============== */

type IncidentInput = {
  crisis: string;
  hour: number;
  congestion: number;
  pollution: number;
  crowdLoad: number;
  resilience: number;
  epicenter?: { x: number; z: number; radius: number; predictedRadius: number };
  topHotspots: { label: string; intensity: number }[];
  nearestStations: { label: string; distance: number }[];
  liveData: boolean;
};

const COMMANDER_SYSTEM = `You are the AI Incident Commander for a city + campus Digital Twin.
You receive the live state of an active incident and produce a CONCRETE, SEQUENCED operations plan.

Output a structured plan with these elements:
- summary: 1 sentence headline assessment.
- confidence: 0..1, how confident you are given the data quality (lower if synthetic/noisy live data).
- steps: 4-7 ordered steps. Each step has:
   - order: 1-based integer
   - action: imperative title (max 60 chars)
   - detail: 1 sentence operational detail with numbers
   - kind: one of "dispatch" | "closure" | "evacuation" | "resource" | "comms" | "monitor"
   - eta_min: integer minutes until step is complete
   - priority: "P1" | "P2" | "P3"
- road_closures: 0-3 short labels of intersections/corridors to close, e.g. "5th & Pine", "Campus Loop South".
- resource_priority: ordered list (max 5) of resources, e.g. ["Engine 2", "Engine 4", "Ladder 1", "Ambulance x2"].
- expected_outcome: 1 sentence with a NUMERIC expected outcome (e.g. "Containment in ~12 min; 3 structures saved.")

Be sharp and operational. No fluff.`;

export const generateIncidentPlan = createServerFn({ method: "POST" })
  .inputValidator((data: IncidentInput) => data)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return { plan: null, error: "AI key not configured" };
    }

    const userMsg = `INCIDENT: ${data.crisis.toUpperCase()}
Local hour: ${data.hour.toFixed(1)}
Congestion: ${(data.congestion * 100).toFixed(0)}%
Pollution: ${(data.pollution * 100).toFixed(0)}%
Crowd load: ${(data.crowdLoad * 100).toFixed(0)}%
Resilience index: ${(data.resilience * 100).toFixed(0)}/100
Live sensor blend: ${data.liveData ? "ON (synthetic OSM + sensors)" : "OFF (model-only)"}
${data.epicenter ? `Epicenter: (${data.epicenter.x.toFixed(0)}, ${data.epicenter.z.toFixed(0)}); current R=${data.epicenter.radius.toFixed(0)}m → predicted R=${data.epicenter.predictedRadius.toFixed(0)}m in 30 min.` : ""}
Hot zones: ${data.topHotspots.map((h) => `${h.label} ${(h.intensity * 100).toFixed(0)}%`).join(", ") || "none"}
Nearest stations: ${data.nearestStations.map((s) => `${s.label} @ ${s.distance.toFixed(0)}m`).join(", ") || "none"}`;

    try {
      const res = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: COMMANDER_SYSTEM },
              { role: "user", content: userMsg },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "submit_incident_plan",
                  description: "Return the full incident response plan.",
                  parameters: {
                    type: "object",
                    properties: {
                      summary: { type: "string" },
                      confidence: { type: "number" },
                      steps: {
                        type: "array",
                        minItems: 4,
                        maxItems: 7,
                        items: {
                          type: "object",
                          properties: {
                            order: { type: "integer" },
                            action: { type: "string" },
                            detail: { type: "string" },
                            kind: {
                              type: "string",
                              enum: ["dispatch", "closure", "evacuation", "resource", "comms", "monitor"],
                            },
                            eta_min: { type: "integer" },
                            priority: { type: "string", enum: ["P1", "P2", "P3"] },
                          },
                          required: ["order", "action", "detail", "kind", "eta_min", "priority"],
                          additionalProperties: false,
                        },
                      },
                      road_closures: {
                        type: "array",
                        maxItems: 3,
                        items: { type: "string" },
                      },
                      resource_priority: {
                        type: "array",
                        maxItems: 5,
                        items: { type: "string" },
                      },
                      expected_outcome: { type: "string" },
                    },
                    required: [
                      "summary",
                      "confidence",
                      "steps",
                      "road_closures",
                      "resource_priority",
                      "expected_outcome",
                    ],
                    additionalProperties: false,
                  },
                },
              },
            ],
            tool_choice: {
              type: "function",
              function: { name: "submit_incident_plan" },
            },
          }),
        },
      );

      if (!res.ok) {
        if (res.status === 429) return { plan: null, error: "Rate limit reached. Try again shortly." };
        if (res.status === 402) return { plan: null, error: "AI credits exhausted. Add funds in Workspace → Usage." };
        const text = await res.text();
        console.error("Incident plan error", res.status, text);
        return { plan: null, error: `AI gateway error (${res.status})` };
      }

      const json = await res.json();
      const call = json.choices?.[0]?.message?.tool_calls?.[0];
      const args = call?.function?.arguments
        ? JSON.parse(call.function.arguments)
        : null;

      return { plan: args, error: null };
    } catch (err) {
      console.error("generateIncidentPlan failed", err);
      return { plan: null, error: err instanceof Error ? err.message : "Unknown error" };
    }
  });

/* ============== CAMPUS AI STRATEGIST (Gemini) ============== */

type CampusStrategistInput = {
  scenario: { id: string; label: string; description: string; timeLabel: string };
  baseline: {
    congestion: number;
    avgDelaySec: number;
    flowEfficiency: number;
    bottlenecks: { name: string; vc: number }[];
  };
  optimized?: {
    congestion: number;
    avgDelaySec: number;
    flowEfficiency: number;
  };
  plan?: {
    description: string[];
    closedEdges: string[];
    rerouteShare: number;
    signalRetimes: { edge: string; weight: number }[];
  };
  improvement?: {
    congestionDropPct: number;
    delayDropPct: number;
    flowGainPct: number;
  };
  demandMultiplier: number;
};

const CAMPUS_SYSTEM = `You are the AI Strategist for a campus traffic Digital Twin.
Given a scenario, baseline metrics, optionally an optimized plan, produce a SHARP, NUMERIC narrative for a hackathon judge.

Return:
- diagnosis: 1-2 sentences on WHY congestion is forming (cite the worst bottleneck and v/c).
- strategy: 2-3 sentences explaining the recommended actions in plain English (signal retimes, reroutes, closures).
- impact: 1 sentence with concrete deltas (e.g. "cuts congestion 28%, delay 4.1s → 2.3s").
- risks: 1 short sentence on tradeoffs (e.g. side-street spillover).
- talking_points: 3 bullet phrases (max 12 words each) judges will remember.
- confidence: 0..1.

Be operational, numeric, no fluff. If no optimization yet, omit impact/risks and frame strategy as a recommendation.`;

export const campusStrategist = createServerFn({ method: "POST" })
  .inputValidator((data: CampusStrategistInput) => data)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) return { analysis: null, error: "AI key not configured" };

    const userMsg = `SCENARIO: ${data.scenario.label} (${data.scenario.timeLabel}) — ${data.scenario.description}
Demand multiplier: ×${data.demandMultiplier.toFixed(2)}

BASELINE:
- congestion: ${(data.baseline.congestion * 100).toFixed(0)}%
- avg delay: ${data.baseline.avgDelaySec.toFixed(1)}s
- flow efficiency: ${(data.baseline.flowEfficiency * 100).toFixed(0)}%
- top bottlenecks: ${data.baseline.bottlenecks.map(b => `${b.name} v/c=${b.vc.toFixed(2)}`).join(", ") || "none"}

${data.optimized ? `OPTIMIZED:
- congestion: ${(data.optimized.congestion * 100).toFixed(0)}%
- avg delay: ${data.optimized.avgDelaySec.toFixed(1)}s
- flow efficiency: ${(data.optimized.flowEfficiency * 100).toFixed(0)}%
- improvements: congestion ↓${data.improvement?.congestionDropPct.toFixed(0)}%, delay ↓${data.improvement?.delayDropPct.toFixed(0)}%, flow ↑${data.improvement?.flowGainPct.toFixed(0)}%

PLAN:
${data.plan?.description.map((d, i) => `${i + 1}. ${d}`).join("\n")}
- closures: ${data.plan?.closedEdges.join(", ") || "none"}
- reroute share: ${((data.plan?.rerouteShare ?? 0) * 100).toFixed(0)}%
- signal retimes: ${data.plan?.signalRetimes.map(r => `${r.edge}×${r.weight.toFixed(2)}`).join(", ") || "none"}` : `(No optimization run yet — recommend a plan.)`}`;

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: CAMPUS_SYSTEM },
            { role: "user", content: userMsg },
          ],
          tools: [{
            type: "function",
            function: {
              name: "submit_analysis",
              description: "Return campus strategist analysis.",
              parameters: {
                type: "object",
                properties: {
                  diagnosis: { type: "string" },
                  strategy: { type: "string" },
                  impact: { type: "string" },
                  risks: { type: "string" },
                  talking_points: {
                    type: "array",
                    minItems: 3,
                    maxItems: 3,
                    items: { type: "string" },
                  },
                  confidence: { type: "number" },
                },
                required: ["diagnosis", "strategy", "talking_points", "confidence"],
                additionalProperties: false,
              },
            },
          }],
          tool_choice: { type: "function", function: { name: "submit_analysis" } },
        }),
      });

      if (!res.ok) {
        if (res.status === 429) return { analysis: null, error: "Rate limit reached. Try again shortly." };
        if (res.status === 402) return { analysis: null, error: "AI credits exhausted. Add funds in Workspace → Usage." };
        const text = await res.text();
        console.error("campusStrategist error", res.status, text);
        return { analysis: null, error: `AI gateway error (${res.status})` };
      }

      const json = await res.json();
      const call = json.choices?.[0]?.message?.tool_calls?.[0];
      const args = call?.function?.arguments ? JSON.parse(call.function.arguments) : null;
      return { analysis: args, error: null };
    } catch (err) {
      console.error("campusStrategist failed", err);
      return { analysis: null, error: err instanceof Error ? err.message : "Unknown error" };
    }
  });
