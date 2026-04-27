import { memo, useEffect, useMemo, useRef } from "react";
import type { Campus, SimResult } from "@/lib/campus";

type Props = {
  campus: Campus;
  result: SimResult;
  highlightEdgeIds?: string[];
  className?: string;
};

// Color stops for v/c ratio: green -> yellow -> orange -> red.
function congestionColor(vc: number): string {
  if (vc < 0.5) return "rgb(80, 230, 170)";   // emerald
  if (vc < 0.75) return "rgb(255, 220, 90)";  // yellow
  if (vc < 1.0) return "rgb(255, 150, 60)";   // orange
  return "rgb(255, 70, 90)";                  // red
}

function nodeColor(kind: string): string {
  switch (kind) {
    case "gate": return "rgb(120, 220, 255)";
    case "academic": return "rgb(180, 200, 255)";
    case "cafeteria": return "rgb(255, 200, 120)";
    case "parking": return "rgb(170, 170, 200)";
    default: return "rgb(140, 160, 200)";
  }
}

const CampusMapImpl = ({ campus, result, highlightEdgeIds, className }: Props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<number | null>(null);
  const tRef = useRef(0);

  // Pre-compute particle counts per edge based on load
  const particles = useMemo(() => {
    const out: Record<string, number> = {};
    for (const e of campus.edges) {
      const f = result.edgeFlow[e.id];
      if (!f) { out[e.id] = 0; continue; }
      out[e.id] = Math.min(14, Math.max(0, Math.round(f.load / 4)));
    }
    return out;
  }, [campus, result]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let viewW = 0;
    let viewH = 0;

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      viewW = r.width;
      viewH = r.height;
      canvas.width = Math.floor(viewW * dpr);
      canvas.height = Math.floor(viewH * dpr);
      canvas.style.width = `${viewW}px`;
      canvas.style.height = `${viewH}px`;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // Map design-space (0..1000 x 0..900) to canvas with padding
    const designW = 1000;
    const designH = 900;
    const project = () => {
      const padding = 40;
      const sx = (viewW - padding * 2) / designW;
      const sy = (viewH - padding * 2) / designH;
      const s = Math.min(sx, sy);
      const ox = (viewW - designW * s) / 2;
      const oy = (viewH - designH * s) / 2;
      return { s, ox, oy };
    };

    const draw = () => {
      const { s, ox, oy } = project();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // Background gradient
      const bg = ctx.createRadialGradient(viewW / 2, viewH / 2, 50, viewW / 2, viewH / 2, Math.max(viewW, viewH));
      bg.addColorStop(0, "rgba(20,30,55,1)");
      bg.addColorStop(1, "rgba(6,10,22,1)");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, viewW, viewH);

      // Subtle grid
      ctx.strokeStyle = "rgba(80,140,220,0.07)";
      ctx.lineWidth = 1;
      const gridStep = 60 * s;
      for (let x = ox % gridStep; x < viewW; x += gridStep) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, viewH); ctx.stroke();
      }
      for (let y = oy % gridStep; y < viewH; y += gridStep) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(viewW, y); ctx.stroke();
      }

      // ---- HEATMAP halos around bottlenecks ----
      for (const e of campus.edges) {
        const f = result.edgeFlow[e.id];
        if (!f || f.vc < 0.6) continue;
        const a = campus.byId[e.a];
        const b = campus.byId[e.b];
        const mx = ox + ((a.x + b.x) / 2) * s;
        const my = oy + ((a.y + b.y) / 2) * s;
        const r = (40 + f.vc * 80) * s;
        const intensity = Math.min(1, (f.vc - 0.6) / 0.6);
        const grad = ctx.createRadialGradient(mx, my, 0, mx, my, r);
        const col = f.vc >= 1 ? "255,70,90" : f.vc >= 0.85 ? "255,150,60" : "255,220,90";
        grad.addColorStop(0, `rgba(${col},${0.35 * intensity})`);
        grad.addColorStop(1, `rgba(${col},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
      }

      // ---- EDGES (roads) ----
      for (const e of campus.edges) {
        const a = campus.byId[e.a];
        const b = campus.byId[e.b];
        const ax = ox + a.x * s;
        const ay = oy + a.y * s;
        const bx = ox + b.x * s;
        const by = oy + b.y * s;
        const f = result.edgeFlow[e.id];
        const closed = e.closed;
        const col = closed ? "rgba(120,120,140,0.5)" : congestionColor(f?.vc ?? 0);
        const highlight = highlightEdgeIds?.includes(e.id);

        // Glow base
        ctx.strokeStyle = col;
        ctx.lineCap = "round";
        ctx.shadowColor = col;
        ctx.shadowBlur = highlight ? 22 : 12;
        ctx.lineWidth = (highlight ? 8 : 6);
        if (closed) {
          ctx.setLineDash([8, 8]);
        } else {
          ctx.setLineDash([]);
        }
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

        // Inner bright line
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
        ctx.setLineDash([]);
      }

      // ---- PARTICLES (flow) ----
      const t = tRef.current;
      for (const e of campus.edges) {
        if (e.closed) continue;
        const n = particles[e.id] ?? 0;
        if (n === 0) continue;
        const a = campus.byId[e.a];
        const b = campus.byId[e.b];
        const ax = ox + a.x * s;
        const ay = oy + a.y * s;
        const bx = ox + b.x * s;
        const by = oy + b.y * s;
        const f = result.edgeFlow[e.id];
        const speed = Math.max(0.05, 0.4 - (f?.vc ?? 0) * 0.35); // congestion slows speed
        const col = congestionColor(f?.vc ?? 0);
        for (let i = 0; i < n; i++) {
          let p = ((t * speed) + i / n) % 1;
          const px = ax + (bx - ax) * p;
          const py = ay + (by - ay) * p;
          ctx.shadowColor = col;
          ctx.shadowBlur = 10;
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.arc(px, py, 2.4, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.shadowBlur = 0;

      // ---- NODES ----
      for (const n of campus.nodes) {
        const x = ox + n.x * s;
        const y = oy + n.y * s;
        const isJunction = n.kind === "junction";
        const r = isJunction ? 5 : 12;
        const col = nodeColor(n.kind);
        // outer ring
        if (!isJunction) {
          ctx.shadowColor = col;
          ctx.shadowBlur = 16;
          ctx.fillStyle = "rgba(15,22,40,0.95)";
          ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.fill();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();

        if (!isJunction) {
          ctx.fillStyle = "rgba(230,240,255,0.95)";
          ctx.font = "600 11px 'JetBrains Mono', monospace";
          ctx.textAlign = "center";
          ctx.textBaseline = "top";
          ctx.fillText(n.label.toUpperCase(), x, y + r + 8);
        }
      }
    };

    const tick = () => {
      tRef.current += 0.012;
      draw();
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      ro.disconnect();
    };
  }, [campus, result, highlightEdgeIds, particles]);

  return (
    <div ref={wrapRef} className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
};

export const CampusMap = memo(CampusMapImpl);
