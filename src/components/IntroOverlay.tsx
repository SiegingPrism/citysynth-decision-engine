import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cpu, Radio, Layers, ArrowRight } from "lucide-react";

type Props = {
  onEnter: () => void;
};

export function IntroOverlay({ onEnter }: Props) {
  const [visible, setVisible] = useState(true);
  const [bootStep, setBootStep] = useState(0);

  useEffect(() => {
    const steps = [
      "Initializing geospatial mesh…",
      "Loading 247 agents, 184 road segments…",
      "Connecting to AI Operator (gemini-3-flash)…",
      "Calibrating diurnal demand curves…",
      "Twin online.",
    ];
    let i = 0;
    const id = setInterval(() => {
      i++;
      if (i >= steps.length) {
        clearInterval(id);
        return;
      }
      setBootStep(i);
    }, 320);
    return () => clearInterval(id);
  }, []);

  function enter() {
    setVisible(false);
    setTimeout(onEnter, 380);
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center"
          style={{
            background:
              "radial-gradient(ellipse at center, oklch(0.10 0.02 250) 0%, oklch(0.04 0.01 250) 100%)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4 }}
        >
          {/* animated grid */}
          <div className="absolute inset-0 grid-bg opacity-30" />
          {/* scanlines */}
          <div
            className="absolute inset-0 pointer-events-none opacity-30"
            style={{
              background:
                "repeating-linear-gradient(to bottom, transparent 0, transparent 3px, color-mix(in oklab, var(--cyan) 8%, transparent) 3px, color-mix(in oklab, var(--cyan) 8%, transparent) 4px)",
              mixBlendMode: "overlay",
            }}
          />

          <motion.div
            className="relative max-w-2xl px-8 text-center space-y-6"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.6 }}
          >
            <div className="flex items-center justify-center gap-2 text-[11px] font-mono uppercase tracking-[0.4em] text-primary text-glow-cyan">
              <span className="w-2 h-2 rounded-full bg-primary animate-blink" />
              Aether OS · v2.4.1
            </div>

            <motion.h1
              className="font-display text-6xl md:text-7xl font-bold leading-tight"
              initial={{ letterSpacing: "0.5em", opacity: 0 }}
              animate={{ letterSpacing: "0.05em", opacity: 1 }}
              transition={{ duration: 1, delay: 0.2 }}
            >
              <span className="text-primary text-glow-cyan">A</span>
              <span className="text-foreground">ETHER</span>
            </motion.h1>

            <motion.p
              className="text-base md:text-lg text-muted-foreground max-w-lg mx-auto"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
            >
              A live decision-engine{" "}
              <span className="text-primary">digital twin</span> of a city +
              campus. Modify reality, predict outcomes, deploy AI-driven
              interventions in real time.
            </motion.p>

            <motion.div
              className="flex items-center justify-center gap-6 text-xs text-muted-foreground"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.8 }}
            >
              <Feature icon={<Layers className="w-3.5 h-3.5" />} label="3D Twin" />
              <Feature icon={<Cpu className="w-3.5 h-3.5" />} label="AI Operator" />
              <Feature icon={<Radio className="w-3.5 h-3.5" />} label="Crisis Mode" />
            </motion.div>

            {/* boot console */}
            <div className="hud-panel rounded-md p-3 font-mono text-[11px] text-left space-y-0.5 max-w-md mx-auto">
              {[
                "Initializing geospatial mesh…",
                "Loading 247 agents, 184 road segments…",
                "Connecting to AI Operator (gemini-3-flash)…",
                "Calibrating diurnal demand curves…",
                "Twin online.",
              ]
                .slice(0, bootStep + 1)
                .map((s, i) => (
                  <div
                    key={i}
                    className={
                      i === bootStep
                        ? "text-primary"
                        : "text-muted-foreground"
                    }
                  >
                    <span className="text-[var(--emerald)]">$</span> {s}
                    {i === bootStep && <span className="animate-blink">_</span>}
                  </div>
                ))}
            </div>

            <motion.button
              onClick={enter}
              disabled={bootStep < 4}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{
                opacity: bootStep >= 4 ? 1 : 0.4,
                scale: 1,
              }}
              transition={{ delay: 0.9 }}
              className="group inline-flex items-center gap-2 px-6 py-3 rounded-md bg-primary text-primary-foreground font-mono uppercase tracking-[0.2em] text-sm hud-glow disabled:cursor-wait hover:scale-[1.02] transition"
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

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-primary">{icon}</span>
      {label}
    </span>
  );
}
