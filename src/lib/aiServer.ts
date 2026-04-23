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
