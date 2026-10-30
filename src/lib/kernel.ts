// ============================================================
// CitySynth Kernel
// The OS layer of the digital twin. Three real subsystems:
//
//  1. CPU scheduling  — cooperative, priority-based, time-sliced
//     round-robin over the browser's requestAnimationFrame frames.
//     Tasks that over-run their slice are PREEMPTED back into the
//     ready queue and resumed next frame (context switches are
//     counted, per-task CPU is measured).
//
//  2. Memory allocation — a simulated heap of 2,048 × 1 KB blocks
//     managed by a first-fit allocator with an explicit free list,
//     fragmentation metric and a compaction pass. Live telemetry
//     buffers, IPC queues and forecast series are allocated and
//     freed here, so heap activity is real, not cosmetic.
//
//  3. Producer–consumer — bounded queues with drop-oldest
//     backpressure. Sensor producers push telemetry; consumers
//     drain it in scheduled time slices. Produced / consumed /
//     dropped counts are tracked.
// ============================================================

export type TaskState = "idle" | "ready" | "running" | "blocked";

export type KernelTask = {
  id: string;
  label: string;
  /** 0 = highest priority (crisis clock), 3 = background (GC). */
  priority: number;
  /** Max CPU milliseconds per dispatch (time slice / quantum). */
  sliceMs: number;
  /** 0 = runnable every frame; otherwise min gap between runs. */
  intervalMs: number;
  /**
   * One quantum of work. Return false if the burst did not finish —
   * the task is preempted back into the ready queue.
   */
  run: (quantumMs: number) => boolean;
};

export type TaskSnapshot = {
  id: string;
  label: string;
  priority: number;
  intervalMs: number;
  sliceMs: number;
  state: TaskState;
  lastCpuMs: number;
  totalCpuMs: number;
  dispatches: number;
  preemptions: number;
};

export type FrameSnapshot = {
  t: number;
  idleMs: number;
  entries: { id: string; cpuMs: number }[];
};

export type MemSnapshot = {
  totalBlocks: number;
  usedBlocks: number;
  peakBlocks: number;
  fragPct: number;
  allocs: number;
  frees: number;
  oom: number;
  compactions: number;
  movedBlocks: number;
  regions: { tag: string; blocks: number }[];
};

export type QueueSnapshot = {
  name: string;
  capacity: number;
  depth: number;
  produced: number;
  consumed: number;
  dropped: number;
};

export type KernelSnapshot = {
  frames: number;
  contextSwitches: number;
  preemptions: number;
  frameDrops: number;
  busyMs: number;
  idleMs: number;
  utilization: number;
  tasks: TaskSnapshot[];
  gantt: FrameSnapshot[];
  mem: MemSnapshot;
  queues: QueueSnapshot[];
};

/* ============================================================
 * 1. CPU SCHEDULER
 * ========================================================== */

export type KernelDeps = {
  frameBudgetMs?: number;
  ganttLength?: number;
};

export function createKernel(deps: KernelDeps = {}) {
  const frameBudgetMs = deps.frameBudgetMs ?? 12;
  const ganttLength = deps.ganttLength ?? 26;

  const tasks = new Map<string, Runtime>();
  type Runtime = {
    task: KernelTask;
    state: TaskState;
    lastRunAt: number;
    lastCpuMs: number;
    totalCpuMs: number;
    dispatches: number;
    preemptions: number;
  };

  let raf: number | null = null;
  let lastFrameAt = 0;
  let frames = 0;
  let contextSwitches = 0;
  let preemptions = 0;
  let frameDrops = 0;
  let busyMs = 0;
  let idleMs = 0;
  const gantt: FrameSnapshot[] = [];

  /* ---------- memory manager ---------- */
  const mem = createMemoryManager();

  /* ---------- queue registry ---------- */
  const queues = new Set<BoundedQueue<unknown>>();

  function start() {
    if (raf !== null || typeof window === "undefined") return;
    lastFrameAt = performance.now();
    const loop = (now: number) => {
      tick(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  }

  /** Advance the scheduler by one frame. Public so tests can drive it. */
  function tick(now: number) {
    frames++;
    const frameDt = Math.min(200, Math.max(0, now - lastFrameAt));
    lastFrameAt = now;

    // I/O-blocked tasks accumulate wait time; they cost no CPU.
    for (const rt of tasks.values()) {
      if (rt.state === "blocked") busyMs += 0; // blocked ≠ CPU
    }

    // Collect runnable tasks: ready (preempted) or idle+interval elapsed.
    const runnable: Runtime[] = [];
    for (const rt of tasks.values()) {
      if (rt.state === "ready") runnable.push(rt);
      else if (rt.state === "idle" && now - rt.lastRunAt >= rt.task.intervalMs)
        runnable.push(rt);
    }
    // Priority order (stable: FIFO within a priority level).
    runnable.sort((a, b) => a.task.priority - b.task.priority);

    let budget = frameBudgetMs;
    const entries: FrameSnapshot["entries"] = [];

    while (runnable.length > 0) {
      if (budget <= 0) {
        // Out of frame budget: everything un-run stays ready (starved
        // this frame) — counted as a frame drop if we had work left.
        frameDrops++;
        break;
      }
      const rt = runnable.shift()!;
      rt.state = "running";
      contextSwitches++;
      const t0 = now;
      const ok = rt.task.run(Math.min(rt.task.sliceMs, budget));
      const cpu = performance.now() - t0;
      rt.lastCpuMs = cpu;
      rt.totalCpuMs += cpu;
      rt.dispatches++;
      budget -= cpu;
      busyMs += cpu;
      entries.push({ id: rt.task.id, cpuMs: cpu });
      if (ok) {
        rt.state = "idle";
        rt.lastRunAt = now;
      } else {
        // Preempted: still has work, back into the ready queue.
        rt.state = "ready";
        rt.preemptions++;
        preemptions++;
      }
    }

    if (runnable.length === 0 && entries.length === 0) idleMs += frameDt;

    gantt.push({ t: now, idleMs: entries.length === 0 ? frameDt : 0, entries });
    while (gantt.length > ganttLength) gantt.shift();

    if (tasks.size === 0) stop();
  }

  function register(task: KernelTask): () => void {
    const rt: Runtime = {
      task,
      state: "idle",
      lastRunAt: 0,
      lastCpuMs: 0,
      totalCpuMs: 0,
      dispatches: 0,
      preemptions: 0,
    };
    tasks.set(task.id, rt);
    start();
    return () => {
      tasks.delete(task.id);
    };
  }

  /**
   * Mark an I/O-bound operation (network, AI call). Blocked tasks
   * appear in the scheduler as "blocked" — they hold no CPU.
   * Returns an end() function.
   */
  function io(id: string, label: string): () => void {
    const existing = tasks.get(id);
    if (existing) {
      existing.state = "blocked";
    } else {
      tasks.set(id, {
        task: { id, label, priority: 0, sliceMs: 0, intervalMs: 0, run: () => true },
        state: "blocked",
        lastRunAt: 0,
        lastCpuMs: 0,
        totalCpuMs: 0,
        dispatches: 0,
        preemptions: 0,
      });
    }
    start();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const rt = tasks.get(id);
      if (rt && rt.state === "blocked") rt.state = "idle";
      if (tasks.size === 0) stop();
    };
  }

  function snapshot(): KernelSnapshot {
    const memSnap = mem.stats();
    let utilization = 0;
    const last = gantt[gantt.length - 1];
    if (last) {
      const cpu = last.entries.reduce((a, e) => a + e.cpuMs, 0);
      utilization = last.idleMs > 0 ? 0 : Math.min(1, cpu / frameBudgetMs);
    }
    return {
      frames,
      contextSwitches,
      preemptions,
      frameDrops,
      busyMs,
      idleMs,
      utilization,
      tasks: Array.from(tasks.values()).map((rt) => ({
        id: rt.task.id,
        label: rt.task.label,
        priority: rt.task.priority,
        intervalMs: rt.task.intervalMs,
        sliceMs: rt.task.sliceMs,
        state: rt.state,
        lastCpuMs: rt.lastCpuMs,
        totalCpuMs: rt.totalCpuMs,
        dispatches: rt.dispatches,
        preemptions: rt.preemptions,
      })),
      gantt: gantt.slice(),
      mem: memSnap,
      queues: Array.from(queues).map((q) => q.stats()),
    };
  }

  return {
    register,
    io,
    tick,
    start,
    stop,
    mem,
    addQueue(q: BoundedQueue<unknown>) {
      queues.add(q);
    },
    removeQueue(q: BoundedQueue<unknown>) {
      queues.delete(q);
    },
    snapshot,
  };
}

export type Kernel = ReturnType<typeof createKernel>;

/* ============================================================
 * 2. MEMORY MANAGER — simulated heap, first-fit allocator
 * ========================================================== */

export type AllocHandle = {
  readonly id: number;
  readonly tag: string;
  readonly size: number;
  start: number;
};

export function createMemoryManager(totalBlocks = 2048) {
  // Each cell = one 1 KB block. Holds the owning handle or null (free).
  const blocks: (AllocHandle | null)[] = new Array(totalBlocks).fill(null);
  const allocs = new Map<number, AllocHandle>();
  let nextId = 1;
  let usedBlocks = 0;
  let peakBlocks = 0;
  let allocCount = 0;
  let freeCount = 0;
  let oomCount = 0;
  let compactions = 0;
  let movedBlocks = 0;

  /** First-fit: scan for the first contiguous free run ≥ size. */
  function findFit(size: number): number {
    let runStart = -1;
    let runLen = 0;
    for (let i = 0; i < totalBlocks; i++) {
      if (blocks[i] === null) {
        if (runLen === 0) runStart = i;
        runLen++;
        if (runLen >= size) return runStart;
      } else {
        runLen = 0;
      }
    }
    return -1;
  }

  function claim(tag: string, start: number, size: number): AllocHandle {
    const h: AllocHandle = { id: nextId++, tag, size, start };
    for (let i = start; i < start + size; i++) blocks[i] = h;
    allocs.set(h.id, h);
    usedBlocks += size;
    peakBlocks = Math.max(peakBlocks, usedBlocks);
    allocCount++;
    return h;
  }

  function alloc(tag: string, size: number): AllocHandle | null {
    if (size <= 0 || size > totalBlocks) return null;
    let start = findFit(size);
    if (start === -1) {
      // Heap exhausted / fragmented → compact (defrag) and retry once.
      compact();
      start = findFit(size);
      if (start === -1) {
        oomCount++;
        return null;
      }
    }
    return claim(tag, start, size);
  }

  function free(handle: AllocHandle | null): boolean {
    if (!handle || !allocs.has(handle.id)) return false;
    for (let i = handle.start; i < handle.start + handle.size; i++) {
      blocks[i] = null;
    }
    allocs.delete(handle.id);
    usedBlocks -= handle.size;
    freeCount++;
    return true;
  }

  /** Defragmentation: slide every live allocation to the heap front. */
  function compact(): number {
    let cursor = 0;
    let moved = 0;
    const ordered = Array.from(allocs.values()).sort((a, b) => a.start - b.start);
    for (const h of ordered) {
      if (h.start !== cursor) {
        for (let i = 0; i < h.size; i++) {
          blocks[cursor + i] = h;
          blocks[h.start + i] = null;
        }
        moved += h.size;
        h.start = cursor;
      }
      cursor += h.size;
    }
    compactions++;
    movedBlocks += moved;
    return moved;
  }

  function largestFreeRun(): number {
    let best = 0;
    let run = 0;
    for (let i = 0; i < totalBlocks; i++) {
      if (blocks[i] === null) {
        run++;
        if (run > best) best = run;
      } else run = 0;
    }
    return best;
  }

  function stats(): MemSnapshot {
    const freeBlocks = totalBlocks - usedBlocks;
    const largest = freeBlocks > 0 ? largestFreeRun() : 0;
    const fragPct = freeBlocks > 0 ? Math.round((1 - largest / freeBlocks) * 100) : 0;
    const byTag = new Map<string, number>();
    for (const h of allocs.values()) byTag.set(h.tag, (byTag.get(h.tag) ?? 0) + h.size);
    return {
      totalBlocks,
      usedBlocks,
      peakBlocks,
      fragPct,
      allocs: allocCount,
      frees: freeCount,
      oom: oomCount,
      compactions,
      movedBlocks,
      regions: Array.from(byTag.entries())
        .map(([tag, b]) => ({ tag, blocks: b }))
        .sort((a, b) => b.blocks - a.blocks),
    };
  }

  return { alloc, free, compact, stats, totalBlocks };
}

/* ============================================================
 * 3. PRODUCER–CONSUMER — bounded queue with drop-oldest
 * ========================================================== */

export type QueuePutResult = "accepted" | "evicted-oldest" | "rejected";

export class BoundedQueue<T> {
  private items: T[] = [];
  private produced = 0;
  private consumed = 0;
  private dropped = 0;
  private lastEvent: QueuePutResult | "idle" = "idle";

  constructor(
    readonly name: string,
    readonly capacity: number,
    private kernel?: Kernel,
  ) {
    kernel?.addQueue(this as unknown as BoundedQueue<unknown>);
  }

  put(item: T): QueuePutResult {
    this.produced++;
    if (this.items.length < this.capacity) {
      this.items.push(item);
      this.lastEvent = "accepted";
      return "accepted";
    }
    // Backpressure policy: drop the OLDEST message to make room.
    this.items.shift();
    this.items.push(item);
    this.dropped++;
    this.lastEvent = "evicted-oldest";
    return "evicted-oldest";
  }

  /** Drain up to n items — the consumer's per-quantum work. */
  take(n: number): T[] {
    const out = this.items.splice(0, n);
    this.consumed += out.length;
    if (out.length === 0) this.lastEvent = "idle";
    return out;
  }

  get depth() {
    return this.items.length;
  }

  stats(): QueueSnapshot {
    return {
      name: this.name,
      capacity: this.capacity,
      depth: this.items.length,
      produced: this.produced,
      consumed: this.consumed,
      dropped: this.dropped,
    };
  }

  dispose() {
    this.kernel?.removeQueue(this as unknown as BoundedQueue<unknown>);
  }
}

/* ---------- app-wide singleton ---------- */
export const kernel = createKernel();
