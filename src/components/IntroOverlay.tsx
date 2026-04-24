import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, Radio, Layers, ArrowRight, Activity, Zap, Globe, ShieldAlert } from "lucide-react";

type Props = {
  onEnter: () => void;
};

const BOOT_LINES = [
  "Initializing geospatial mesh · 1100m grid…",
  "Loading 247 agents, 184 road segments, 4 stations…",
  "Connecting to AI Operator (gemini-3-flash)…",
  "Calibrating diurnal demand curves…",
  "Spinning up crisis-prediction models…",
  "Twin online · all systems nominal.",
];

export function IntroOverlay({ onEnter }: Props) {
  const [visible, setVisible] = useState(true);
  const [bootStep, setBootStep] = useState(0);

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i++;
      if (i >= BOOT_LINES.length) {
        clearInterval(id);
        return;
      }
      setBootStep(i);
    }, 280);
    return () => clearInterval(id);
  }, []);

  function enter() {
    setVisible(false);
    setTimeout(onEnter, 480);
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden"
          style={{
            background:
              "radial-gradient(ellipse at center, oklch(0.10 0.02 250) 0%, oklch(0.04 0.01 250) 100%)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, filter: "blur(12px)" }}
          transition={{ duration: 0.5 }}
        >
          {/* Animated grid */}
          <motion.div
            className="absolute inset-0 grid-bg opacity-40"
            initial={{ scale: 1.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 0.4 }}
            transition={{ duration: 2, ease: "easeOut" }}
          />

          {/* Scanlines */}
          <div
            className="absolute inset-0 pointer-events-none opacity-30"
            style={{
              background:
                "repeating-linear-gradient(to bottom, transparent 0, transparent 3px, color-mix(in oklab, var(--cyan) 8%, transparent) 3px, color-mix(in oklab, var(--cyan) 8%, transparent) 4px)",
              mixBlendMode: "overlay",
            }}
          />

          {/* Orbiting rings */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center pointer-events-none"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.55 }}
            transition={{ delay: 0.3, duration: 1 }}
          >
            {[0, 1, 2].map((i) => (
              <motion.div
                key={i}
                className="absolute rounded-full border border-primary/30"
                style={{
                  width: 320 + i * 220,
                  height: 320 + i * 220,
                  borderStyle: "dashed",
                }}
                animate={{ rotate: i % 2 === 0 ? 360 : -360 }}
                transition={{ duration: 30 + i * 10, repeat: Infinity, ease: "linear" }}
              />
            ))}
          </motion.div>

          {/* Corner targeting marks */}
          {[
            { top: 24, left: 24, rotate: 0 },
            { top: 24, right: 24, rotate: 90 },
            { bottom: 24, right: 24, rotate: 180 },
            { bottom: 24, left: 24, rotate: 270 },
          ].map((pos, i) => (
            <motion.div
              key={i}
              className="absolute w-12 h-12 pointer-events-none"
              style={pos}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 + i * 0.1, duration: 0.5 }}
            >
              <div
                className="absolute inset-0"
                style={{
                  transform: `rotate(${pos.rotate}deg)`,
                }}
              >
                <div className="absolute top-0 left-0 w-6 h-[2px] bg-primary" />
                <div className="absolute top-0 left-0 w-[2px] h-6 bg-primary" />
              </div>
            </motion.div>
          ))}

          {/* Floating telemetry chips */}
          <FloatingChip text="LAT 40.7128° N · LON 74.0060° W" top="14%" left="6%" delay={0.6} />
          <FloatingChip text="SECTOR · MERIDIAN-07" top="18%" right="6%" delay={0.7} />
          <FloatingChip text="MESH NODES · 1,840" bottom="22%" left="6%" delay={0.8} />
          <FloatingChip text="LATENCY · 12 ms" bottom="22%" right="6%" delay={0.9} />

          <motion.div
            className="relative max-w-2xl px-8 text-center space-y-5 z-10"
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15, duration: 0.7 }}
          >
            <div className="flex items-center justify-center gap-2 text-[11px] font-mono uppercase tracking-[0.4em] text-primary text-glow-cyan">
              <span className="w-2 h-2 rounded-full bg-primary animate-blink" />
              Aether OS · v2.4.1 · build 2049
            </div>

            <motion.h1
              className="font-display text-7xl md:text-8xl font-bold leading-none"
              initial={{ letterSpacing: "0.5em", opacity: 0 }}
              animate={{ letterSpacing: "0.05em", opacity: 1 }}
              transition={{ duration: 1.1, delay: 0.25 }}
            >
              <span className="text-primary text-glow-cyan">A</span>
              <span className="text-foreground">ETHER</span>
            </motion.h1>

            <motion.div
              className="text-[10px] font-mono uppercase tracking-[0.4em] text-muted-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55 }}
            >
              Decision Engine · Digital Twin · Crisis Operations
            </motion.div>

            <motion.p
              className="text-base md:text-lg text-muted-foreground max-w-lg mx-auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
            >
              A live decision-engine{" "}
              <span className="text-primary">digital twin</span> of a city +
              campus. Modify reality, predict outcomes, and deploy AI-driven
              interventions in real time.
            </motion.p>

            <motion.div
              className="flex flex-wrap items-center justify-center gap-3 text-xs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.85 }}
            >
              <Pill icon={<Layers className="w-3.5 h-3.5" />} label="3D Twin" />
              <Pill icon={<Cpu className="w-3.5 h-3.5" />} label="AI Operator" />
              <Pill icon={<ShieldAlert className="w-3.5 h-3.5" />} label="Crisis Mode" />
              <Pill icon={<Activity className="w-3.5 h-3.5" />} label="Live Sensors" />
              <Pill icon={<Zap className="w-3.5 h-3.5" />} label="What-if Sliders" />
              <Pill icon={<Globe className="w-3.5 h-3.5" />} label="Time Travel" />
            </motion.div>

            {/* boot console */}
            <div className="hud-panel rounded-md p-3 font-mono text-[11px] text-left space-y-0.5 max-w-md mx-auto">
              {BOOT_LINES.slice(0, bootStep + 1).map((s, i) => (
                <div
                  key={i}
                  className={
                    i === bootStep ? "text-primary" : "text-muted-foreground"
                  }
                >
                  <span className="text-[var(--emerald)]">$</span> {s}
                  {i === bootStep && <span className="animate-blink">_</span>}
                </div>
              ))}
            </div>

            <motion.button
              onClick={enter}
              disabled={bootStep < BOOT_LINES.length - 1}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{
                opacity: bootStep >= BOOT_LINES.length - 1 ? 1 : 0.4,
                scale: 1,
              }}
              transition={{ delay: 1 }}
              className="group inline-flex items-center gap-2 px-7 py-3 rounded-md bg-primary text-primary-foreground font-mono uppercase tracking-[0.25em] text-sm hud-glow disabled:cursor-wait hover:scale-[1.04] active:scale-[0.98] transition"
            >
              Enter Control Room
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition" />
            </motion.button>

            <div className="text-[10px] text-muted-foreground font-mono">
              ↑↓←→ orbit · scroll zoom · click roads to close · 1-4 crisis modes · Space play
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Pill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/25 bg-primary/5 text-foreground/80 font-mono uppercase tracking-wider text-[10px]">
      <span className="text-primary">{icon}</span>
      {label}
    </span>
  );
}

function FloatingChip({
  text,
  top,
  left,
  right,
  bottom,
  delay,
}: {
  text: string;
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  delay: number;
}) {
  return (
    <motion.div
      className="absolute hud-panel rounded px-2.5 py-1 font-mono text-[10px] text-primary text-glow-cyan pointer-events-none"
      style={{ top, left, right, bottom }}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
    >
      <span className="inline-block w-1.5 h-1.5 bg-primary rounded-full mr-1.5 animate-blink" />
      {text}
    </motion.div>
  );
}
