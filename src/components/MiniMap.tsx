import { useMemo } from "react";
import type { CityModel, SimSnapshot, Vec2 } from "@/lib/simulation";
import { Radar } from "lucide-react";

type Props = {
  city: CityModel;
  snapshot: SimSnapshot;
  closedRoadIds: string[];
  onFocus: (pos: Vec2) => void;
};

/**
 * Top-down tactical radar. Click anywhere to fly the camera there.
 */
export function MiniMap({ city, snapshot, closedRoadIds, onFocus }: Props) {
  const SIZE = 240;
  const half = city.size / 2;
  const project = (p: Vec2) => ({
    x: ((p.x + half) / city.size) * SIZE,
    y: ((p.z + half) / city.size) * SIZE,
  });
  const projectR = (r: number) => (r / city.size) * SIZE;

  const closedSet = useMemo(() => new Set(closedRoadIds), [closedRoadIds]);
  const stations = useMemo(
    () => city.buildings.filter((b) => b.kind === "firestation"),
    [city.buildings],
  );

  return (
    <div className="hud-panel rounded-lg p-3 space-y-2">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-primary text-glow-cyan">
          <Radar className="w-3 h-3 animate-spin-slow" /> Tactical Radar
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          {city.size}m × {city.size}m
        </span>
      </header>

      <div
        className="relative rounded border border-primary/30 overflow-hidden"
        style={{
          width: SIZE,
          height: SIZE,
          background:
            "radial-gradient(ellipse at center, oklch(0.20 0.04 250) 0%, oklch(0.12 0.02 250) 100%)",
        }}
      >
        {/* radar sweep */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "conic-gradient(from 0deg, transparent 0deg, color-mix(in oklab, var(--cyan) 25%, transparent) 30deg, transparent 60deg)",
            animation: "spin 4s linear infinite",
          }}
        />

        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          width={SIZE}
          height={SIZE}
          className="relative cursor-crosshair"
          onClick={(e) => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;
            const fx = (px / SIZE) * city.size - half;
            const fz = (py / SIZE) * city.size - half;
            onFocus({ x: fx, z: fz });
          }}
        >
          {/* grid */}
          {[0.25, 0.5, 0.75].map((g) => (
            <g key={g} stroke="currentColor" className="text-primary/15">
              <line x1={g * SIZE} x2={g * SIZE} y1={0} y2={SIZE} />
              <line x1={0} x2={SIZE} y1={g * SIZE} y2={g * SIZE} />
            </g>
          ))}
          {/* center crosshair */}
          <circle cx={SIZE / 2} cy={SIZE / 2} r={2} fill="var(--cyan)" />

          {/* roads — colored by utilization */}
          {city.roads.map((road) => {
            const a = project(road.a);
            const b = project(road.b);
            const closed = closedSet.has(road.id);
            const util = snapshot.roadFlow[road.id] ?? 0;
            const color = closed
              ? "#ef4444"
              : `hsl(${(1 - util) * 120}, 70%, 50%)`;
            return (
              <line
                key={road.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={closed ? 1.4 : 0.9}
                opacity={closed ? 1 : 0.55}
              />
            );
          })}

          {/* campus quarter */}
          <rect
            x={((city.campusBounds.x + half) / city.size) * SIZE}
            y={((city.campusBounds.z + half) / city.size) * SIZE}
            width={(city.campusBounds.w / city.size) * SIZE}
            height={(city.campusBounds.d / city.size) * SIZE}
            fill="none"
            stroke="var(--cyan)"
            strokeOpacity={0.5}
            strokeDasharray="3 2"
            strokeWidth={1}
          />

          {/* hotspots */}
          {snapshot.hotspots.map((h) => {
            const p = project(h.pos);
            return (
              <circle
                key={h.id}
                cx={p.x}
                cy={p.y}
                r={Math.max(1.5, projectR(h.radius))}
                fill="var(--magenta)"
                opacity={0.18 + h.intensity * 0.4}
              />
            );
          })}

          {/* fire stations */}
          {stations.map((s, i) => {
            const p = project(s.pos);
            return (
              <g key={i}>
                <rect
                  x={p.x - 3}
                  y={p.y - 3}
                  width={6}
                  height={6}
                  fill="#dc2626"
                  stroke="#fde047"
                  strokeWidth={0.6}
                />
              </g>
            );
          })}

          {/* fire epicenter + rings */}
          {snapshot.fire && (
            <g>
              <circle
                cx={project(snapshot.fire.pos).x}
                cy={project(snapshot.fire.pos).y}
                r={projectR(snapshot.fire.predictedRadius)}
                fill="none"
                stroke="#fb923c"
                strokeDasharray="2 2"
                opacity={0.7}
              />
              <circle
                cx={project(snapshot.fire.pos).x}
                cy={project(snapshot.fire.pos).y}
                r={projectR(snapshot.fire.radius)}
                fill="#ef4444"
                opacity={0.35}
              />
              <circle
                cx={project(snapshot.fire.pos).x}
                cy={project(snapshot.fire.pos).y}
                r={2.5}
                fill="#fde047"
              >
                <animate attributeName="r" values="2.5;5;2.5" dur="1s" repeatCount="indefinite" />
              </circle>
            </g>
          )}

          {/* flood */}
          {snapshot.flood && (
            <g>
              <circle
                cx={project(snapshot.flood.pos).x}
                cy={project(snapshot.flood.pos).y}
                r={projectR(snapshot.flood.predictedRadius)}
                fill="none"
                stroke="#7dd3fc"
                strokeDasharray="2 2"
                opacity={0.7}
              />
              <circle
                cx={project(snapshot.flood.pos).x}
                cy={project(snapshot.flood.pos).y}
                r={projectR(snapshot.flood.radius)}
                fill="#1d4ed8"
                opacity={0.4}
              />
            </g>
          )}

          {/* surge */}
          {snapshot.surge && (
            <circle
              cx={project(snapshot.surge.pos).x}
              cy={project(snapshot.surge.pos).y}
              r={projectR(snapshot.surge.radius)}
              fill="#a855f7"
              opacity={0.4}
            />
          )}

          {/* evacuation routes */}
          {snapshot.evacuationRoutes.map((r, i) => {
            const a = project(r.a);
            const b = project(r.b);
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="#22c55e"
                strokeWidth={1.2}
                strokeDasharray="3 2"
                opacity={0.85}
              />
            );
          })}
        </svg>
      </div>

      <div className="flex items-center gap-3 text-[9px] font-mono text-muted-foreground">
        <Legend color="#dc2626" label="Fire stn" />
        <Legend color="#22c55e" label="Evac" />
        <Legend color="#a855f7" label="Hotspot" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}
