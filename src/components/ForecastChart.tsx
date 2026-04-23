import { useMemo } from "react";
import type { SimSnapshot } from "@/lib/simulation";

type Props = {
  series: SimSnapshot[];
  metric: "congestion" | "pollution" | "crowdLoad";
  color?: string;
  label: string;
};

const COLOR_MAP: Record<string, string> = {
  congestion: "var(--cyan)",
  pollution: "var(--amber)",
  crowdLoad: "var(--magenta)",
};

export function ForecastChart({ series, metric, color, label }: Props) {
  const stroke = color ?? COLOR_MAP[metric];
  const w = 320;
  const h = 70;
  const pad = 4;

  const points = useMemo(() => {
    if (!series.length) return "";
    const n = series.length;
    return series
      .map((s, i) => {
        const x = pad + (i / (n - 1)) * (w - pad * 2);
        const v = s[metric];
        const y = h - pad - v * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [series, metric]);

  const area = useMemo(() => {
    if (!series.length) return "";
    const n = series.length;
    const top = series
      .map((s, i) => {
        const x = pad + (i / (n - 1)) * (w - pad * 2);
        const v = s[metric];
        const y = h - pad - v * (h - pad * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" L");
    return `M${top} L${w - pad},${h - pad} L${pad},${h - pad} Z`;
  }, [series, metric]);

  const last = series[series.length - 1]?.[metric] ?? 0;
  const first = series[0]?.[metric] ?? 0;
  const delta = last - first;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider">
        <span className="text-muted-foreground">{label}</span>
        <span style={{ color: stroke }}>
          {(last * 100).toFixed(0)}%
          <span className="ml-1 text-muted-foreground">
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(0)}
          </span>
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-[70px]">
        <defs>
          <linearGradient id={`g-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity="0.45" />
            <stop offset="100%" stopColor={stroke} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* gridlines */}
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1={pad}
            x2={w - pad}
            y1={h - pad - g * (h - pad * 2)}
            y2={h - pad - g * (h - pad * 2)}
            stroke="currentColor"
            className="text-border"
            strokeDasharray="2 3"
          />
        ))}
        <path d={area} fill={`url(#g-${metric})`} />
        <polyline points={points} fill="none" stroke={stroke} strokeWidth="1.6" />
      </svg>
    </div>
  );
}
