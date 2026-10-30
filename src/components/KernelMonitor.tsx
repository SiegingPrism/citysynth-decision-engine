import { useEffect, useState } from "react";
import { Cpu, HardDrive, GitBranch, Info } from "lucide-react";
import { kernel, type KernelSnapshot, type TaskState } from "@/lib/kernel";
import { Button } from "@/components/ui/button";

// Live view of the CitySynth kernel: CPU scheduler, heap allocator and
// the bounded producer-consumer queues. Everything shown is real state
// measured from the running app, not mock data.

const TASK_COLORS: Record<string, string> = {
  "clock.crisis": "var(--magenta)",
  "clock.timeline": "var(--cyan)",
  "sensors.producer": "var(--amber)",
  "sensors.consumer": "var(--emerald)",
};
const FALLBACK = ["var(--cyan)", "var(--amber)", "var(--emerald)", "var(--magenta)"];
function taskColor(id: string) {
  if (TASK_COLORS[id]) return TASK_COLORS[id];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

const STATE_STYLE: Record<TaskState, string> = {
  running: "bg-[var(--emerald)]/15 text-[var(--emerald)] border-[var(--emerald)]/40",
  ready: "bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/40",
  blocked: "bg-[var(--magenta)]/15 text-[var(--magenta)] border-[var(--magenta)]/40",
  idle: "bg-muted text-muted-foreground border-border",
};

export function KernelMonitor() {
  const [snap, setSnap] = useState<KernelSnapshot | null>(null);

  useEffect(() => {
    const id = setInterval(() => setSnap(kernel.snapshot()), 220);
    setSnap(kernel.snapshot());
    return () => clearInterval(id);
  }, []);

  const mem = snap?.mem;
  const usedPct = mem ? (mem.usedBlocks / mem.totalBlocks) * 100 : 0;

  return (
    <div className="hud-panel rounded-lg p-4 space-y-3">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-primary text-glow-cyan flex items-center gap-1.5">
            <Cpu className="w-3 h-3" /> OS Kernel Monitor
          </div>
          <h2 className="font-display text-lg">Runtime subsystems</h2>
        </div>
        <span className="text-[9px] font-mono text-muted-foreground">
          {snap?.frames ?? 0} frames
        </span>
      </header>

      {/* ============ CPU SCHEDULER ============ */}
      <section className="space-y-1.5">
        <SectionTitle
          icon={<Cpu className="w-3 h-3" />}
          label="CPU Scheduler · priority round-robin, time-sliced"
        />
        <div className="grid grid-cols-4 gap-1.5 text-[9px] font-mono">
          <MiniStat label="Util." value={snap ? `${Math.round(snap.utilization * 100)}%` : "—"} />
          <MiniStat label="Switches" value={snap ? `${snap.contextSwitches}` : "—"} />
          <MiniStat label="Preempt" value={snap ? `${snap.preemptions}` : "—"} />
          <MiniStat
            label="Drops"
            value={snap ? `${snap.frameDrops}` : "—"}
            tone={snap && snap.frameDrops > 0 ? "text-[var(--amber)]" : undefined}
          />
        </div>

        {/* per-frame Gantt */}
        <div className="flex gap-[2px] h-7 items-stretch rounded-sm overflow-hidden border border-border/60 bg-black/30 p-[2px]">
          {(snap?.gantt ?? []).map((f, i) => (
            <div key={i} className="flex-1 flex flex-col justify-end gap-[1px] min-w-0">
              {f.entries.length === 0 ? (
                <div className="flex-1 bg-muted/30 rounded-[1px]" />
              ) : (
                f.entries.map((e, j) => {
                  const total = f.entries.reduce((a, x) => a + x.cpuMs, 0) || 1;
                  return (
                    <div
                      key={j}
                      style={{
                        background: taskColor(e.id),
                        height: `${Math.max(12, Math.min(100, (e.cpuMs / Math.max(total, 12)) * 100))}%`,
                      }}
                      className="rounded-[1px] min-w-0"
                    />
                  );
                })
              )}
            </div>
          ))}
          {(snap?.gantt.length ?? 0) === 0 && (
            <div className="flex-1 flex items-center justify-center text-[9px] font-mono text-muted-foreground/60">
              idle — scheduler waiting for tasks
            </div>
          )}
        </div>

        <div className="space-y-1">
          {(snap?.tasks ?? []).map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 text-[10px] font-mono rounded border border-border/50 bg-card/40 px-2 py-1"
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: taskColor(t.id) }}
              />
              <span className="text-foreground truncate flex-1">{t.label}</span>
              <span className="text-muted-foreground">P{t.priority}</span>
              <span className="text-muted-foreground w-12 text-right">
                {t.lastCpuMs.toFixed(1)}ms
              </span>
              {t.preemptions > 0 && (
                <span className="text-[var(--amber)]" title="preemptions">
                  ⟳{t.preemptions}
                </span>
              )}
              <span
                className={`text-[8px] uppercase px-1 rounded border ${STATE_STYLE[t.state]}`}
              >
                {t.state}
              </span>
            </div>
          ))}
          {(snap?.tasks.length ?? 0) === 0 && (
            <p className="text-[10px] text-muted-foreground">
              Start autoplay (Space), a crisis, or Live Data to see scheduled tasks.
            </p>
          )}
        </div>
      </section>

      {/* ============ MEMORY ============ */}
      <section className="space-y-1.5">
        <SectionTitle
          icon={<HardDrive className="w-3 h-3" />}
          label="Heap Allocator · first-fit, 2 MB simulated heap"
        />
        <div className="h-3 rounded-sm overflow-hidden border border-border/60 bg-black/40 relative">
          <div
            className="h-full bg-primary/60 transition-all duration-300"
            style={{ width: `${usedPct}%` }}
          />
        </div>
        <div className="grid grid-cols-4 gap-1.5 text-[9px] font-mono">
          <MiniStat
            label="Used"
            value={mem ? `${mem.usedBlocks}/${mem.totalBlocks} KB` : "—"}
          />
          <MiniStat label="Peak" value={mem ? `${mem.peakBlocks} KB` : "—"} />
          <MiniStat
            label="Frag"
            value={mem ? `${mem.fragPct}%` : "—"}
            tone={mem && mem.fragPct > 35 ? "text-[var(--amber)]" : undefined}
          />
          <MiniStat
            label="OOM"
            value={mem ? `${mem.oom}` : "—"}
            tone={mem && mem.oom > 0 ? "text-destructive" : undefined}
          />
        </div>
        <div className="text-[9px] font-mono text-muted-foreground">
          allocs {mem?.allocs ?? 0} · frees {mem?.frees ?? 0} · compactions {mem?.compactions ?? 0}
        </div>
        <div className="space-y-1">
          {(mem?.regions ?? []).map((r) => (
            <div key={r.tag} className="flex items-center gap-2 text-[9px] font-mono">
              <span className="w-[130px] truncate text-muted-foreground">{r.tag}</span>
              <div className="flex-1 h-1.5 rounded-sm bg-black/40 overflow-hidden">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${(r.blocks / (mem?.totalBlocks ?? 1)) * 100}%`,
                    background: taskColor(r.tag),
                  }}
                />
              </div>
              <span className="text-foreground w-10 text-right">{r.blocks} KB</span>
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] border-border/60"
          onClick={() => kernel.mem.compact()}
        >
          Run heap compaction
        </Button>
      </section>

      {/* ============ PRODUCER–CONSUMER ============ */}
      <section className="space-y-1.5">
        <SectionTitle
          icon={<GitBranch className="w-3 h-3" />}
          label="IPC · bounded queues, drop-oldest backpressure"
        />
        {(snap?.queues.length ?? 0) === 0 && (
          <p className="text-[10px] text-muted-foreground">
            Enable Live Data to open the sensor telemetry queue.
          </p>
        )}
        {(snap?.queues ?? []).map((q) => (
          <div
            key={q.name}
            className="rounded border border-border/50 bg-card/40 px-2 py-1.5 space-y-1"
          >
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <span className="text-foreground flex-1 truncate">{q.name}</span>
              {q.dropped > 0 ? (
                <span className="text-[8px] uppercase px-1 rounded border bg-[var(--amber)]/15 text-[var(--amber)] border-[var(--amber)]/40">
                  backpressure · {q.dropped} evicted
                </span>
              ) : (
                <span className="text-[8px] uppercase px-1 rounded border bg-[var(--emerald)]/15 text-[var(--emerald)] border-[var(--emerald)]/40">
                  flowing
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-sm bg-black/40 overflow-hidden">
                <div
                  className="h-full bg-[var(--magenta)] transition-all duration-200"
                  style={{ width: `${(q.depth / q.capacity) * 100}%` }}
                />
              </div>
              <span className="text-[9px] font-mono text-muted-foreground">
                {q.depth}/{q.capacity}
              </span>
            </div>
            <div className="text-[9px] font-mono text-muted-foreground">
              produced {q.produced} · consumed {q.consumed} · dropped {q.dropped}
            </div>
          </div>
        ))}
      </section>

      <div className="flex gap-2 items-start text-[9px] font-mono text-muted-foreground/80 leading-relaxed pt-1 border-t border-border/40">
        <Info className="w-3 h-3 shrink-0 mt-[1px]" />
        <div>
          Every clock, sensor read and AI call in this twin is dispatched by the kernel:
          priority-scheduled with time slices, memory drawn from an explicit allocator,
          telemetry moved through a bounded queue. Scrub time or toggle Live Data to watch it work.
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="text-[9px] font-mono uppercase tracking-[0.18em] text-accent text-glow-magenta flex items-center gap-1.5">
      {icon}
      {label}
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded border border-border/50 bg-card/40 px-1.5 py-1">
      <div className="text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={tone ?? "text-foreground"}>{value}</div>
    </div>
  );
}
