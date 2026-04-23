import { Sunrise, PartyPopper, Trophy, CloudRain, Atom } from "lucide-react";
import type { CrisisMode, SimControls } from "@/lib/simulation";

export type Scenario = {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  controls: Partial<SimControls>;
  crisis: CrisisMode;
  /** Hour of day to set on apply, in minutes from midnight (0..1439) */
  startMinutesOfDay: number;
};

const SCENARIOS: Scenario[] = [
  {
    id: "rush",
    name: "Rush Hour",
    description: "08:30 — peak commute, default signals",
    icon: <Sunrise className="w-3.5 h-3.5" />,
    controls: { signalTiming: 1, trafficVolume: 1.4, campusEventLoad: 0.4 },
    crisis: "none",
    startMinutesOfDay: 8 * 60 + 30,
  },
  {
    id: "concert",
    name: "Concert Night",
    description: "20:00 — student union packed",
    icon: <PartyPopper className="w-3.5 h-3.5" />,
    controls: { signalTiming: 1.1, trafficVolume: 1.1, campusEventLoad: 0.95 },
    crisis: "surge",
    startMinutesOfDay: 20 * 60,
  },
  {
    id: "gameday",
    name: "Game Day",
    description: "13:00 — campus overload",
    icon: <Trophy className="w-3.5 h-3.5" />,
    controls: { signalTiming: 0.95, trafficVolume: 1.5, campusEventLoad: 1 },
    crisis: "none",
    startMinutesOfDay: 13 * 60,
  },
  {
    id: "storm",
    name: "Storm Warning",
    description: "16:00 — flash flood activation",
    icon: <CloudRain className="w-3.5 h-3.5" />,
    controls: { signalTiming: 1.2, trafficVolume: 0.7, campusEventLoad: 0.2 },
    crisis: "flood",
    startMinutesOfDay: 16 * 60,
  },
  {
    id: "blaze",
    name: "Industrial Blaze",
    description: "11:00 — structure fire, all units",
    icon: <Atom className="w-3.5 h-3.5" />,
    controls: { signalTiming: 1.3, trafficVolume: 0.9, campusEventLoad: 0.3 },
    crisis: "fire",
    startMinutesOfDay: 11 * 60,
  },
];

type Props = {
  baseHour: number;
  onApply: (s: Scenario, tMinutes: number) => void;
};

export function ScenarioPresets({ baseHour, onApply }: Props) {
  return (
    <div className="hud-panel rounded-lg p-3 space-y-2">
      <header className="text-[10px] font-mono uppercase tracking-[0.2em] text-accent text-glow-magenta">
        Scenario Library
      </header>
      <div className="grid grid-cols-1 gap-1.5">
        {SCENARIOS.map((s) => {
          // map scenario clock to tMinutes offset relative to baseHour
          const scenarioMin = s.startMinutesOfDay;
          const baseMin = baseHour * 60;
          let tMin = scenarioMin - baseMin;
          if (tMin < 0) tMin += 24 * 60;
          return (
            <button
              key={s.id}
              onClick={() => onApply(s, tMin)}
              className="group flex items-center gap-2 rounded-md border border-border bg-card/40 px-2.5 py-2 text-left transition-all hover:border-accent/60 hover:bg-card hover:hud-glow"
            >
              <span className="text-accent">{s.icon}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-xs font-medium truncate">{s.name}</span>
                <span className="block text-[10px] text-muted-foreground truncate">
                  {s.description}
                </span>
              </span>
              <span className="text-[9px] font-mono text-primary opacity-0 group-hover:opacity-100 transition">
                LOAD
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
