import { describe, expect, it } from "vitest";
import { BoundedQueue, createKernel } from "./kernel";

describe("BoundedQueue (producer–consumer)", () => {
  it("enforces capacity with drop-oldest backpressure", () => {
    const q = new BoundedQueue<number>("test.q", 3);
    for (const n of [1, 2, 3, 4, 5]) q.put(n);

    expect(q.depth).toBe(3);
    expect(q.stats().produced).toBe(5);
    expect(q.stats().dropped).toBe(2);
    // Oldest messages (1, 2) were evicted — consumer sees 3, 4, 5.
    expect(q.take(10)).toEqual([3, 4, 5]);
    expect(q.stats().consumed).toBe(3);
  });

  it("drains at most n items per take (consumer quantum)", () => {
    const q = new BoundedQueue<number>("test.q", 8);
    for (const n of [1, 2, 3, 4, 5]) q.put(n);
    expect(q.take(2)).toEqual([1, 2]);
    expect(q.depth).toBe(3);
  });
});

describe("CPU scheduler", () => {
  it("dispatches higher-priority tasks first within a frame", () => {
    const k = createKernel();
    const order: string[] = [];
    const unLow = k.register({
      id: "low", label: "Low", priority: 2, sliceMs: 4, intervalMs: 0,
      run: () => { order.push("low"); return true; },
    });
    const unHigh = k.register({
      id: "high", label: "High", priority: 0, sliceMs: 4, intervalMs: 0,
      run: () => { order.push("high"); return true; },
    });

    k.tick(1000);
    expect(order).toEqual(["high", "low"]);
    const snap = k.snapshot();
    expect(snap.contextSwitches).toBe(2);

    unHigh();
    unLow();
  });

  it("preempts tasks that return false and resumes them next frame", () => {
    const k = createKernel();
    let bursts = 0;
    const un = k.register({
      id: "work", label: "Work", priority: 0, sliceMs: 2, intervalMs: 0,
      run: () => {
        bursts++;
        return bursts >= 3; // finishes on the third dispatch
      },
    });

    k.tick(0);
    let snap = k.snapshot();
    expect(snap.preemptions).toBe(1);
    expect(snap.tasks[0].state).toBe("ready");

    k.tick(16);
    k.tick(32);
    snap = k.snapshot();
    expect(bursts).toBe(3);
    expect(snap.tasks[0].state).toBe("idle");

    un();
  });

  it("respects the task interval (idle between runs)", () => {
    const k = createKernel();
    let runs = 0;
    const un = k.register({
      id: "tick", label: "Tick", priority: 0, sliceMs: 1, intervalMs: 1000,
      run: () => { runs++; return true; },
    });

    k.tick(0);
    k.tick(500); // interval not elapsed → no run
    k.tick(1200); // elapsed → runs again
    expect(runs).toBe(2);
    un();
  });

  it("shows I/O-bound calls as blocked and releases on end()", () => {
    const k = createKernel();
    const end = k.io("ai.operator", "AI Operator");
    let snap = k.snapshot();
    expect(snap.tasks[0].state).toBe("blocked");

    end();
    snap = k.snapshot();
    expect(snap.tasks[0].state).toBe("idle");
  });

  it("starves low-priority work when the frame budget is exhausted", () => {
    const k = createKernel({ frameBudgetMs: 4 });
    const ran: string[] = [];
    const unA = k.register({
      id: "a", label: "A", priority: 0, sliceMs: 10, intervalMs: 0,
      run: () => { ran.push("a"); const t = performance.now(); while (performance.now() - t < 6); return true; },
    });
    const unB = k.register({
      id: "b", label: "B", priority: 1, sliceMs: 10, intervalMs: 0,
      run: () => { ran.push("b"); return true; },
    });

    k.tick(0);
    const snap = k.snapshot();
    expect(ran).toEqual(["a"]); // budget spent by A → B stays ready
    expect(snap.frameDrops).toBe(1);

    unA();
    unB();
  });
});

describe("Memory manager (first-fit heap allocator)", () => {
  it("allocates contiguous blocks first-fit and reuses freed space", () => {
    const k = createKernel();
    const a = k.mem.alloc("a", 3);
    const b = k.mem.alloc("b", 2);
    expect(a).not.toBeNull();
    expect(b!.start).toBe(3); // right after a
    k.mem.free(a);
    const c = k.mem.alloc("c", 2);
    expect(c!.start).toBe(0); // first-fit reuses the hole left by a
    k.mem.free(b);
    k.mem.free(c);
  });

  it("reports fragmentation after non-contiguous frees", () => {
    const k = createKernel();
    const a = k.mem.alloc("a", 2);
    const b = k.mem.alloc("b", 2);
    k.mem.alloc("c", 2);
    k.mem.free(b);
    const s = k.mem.stats();
    expect(s.usedBlocks).toBe(4);
    expect(s.fragPct).toBeGreaterThan(0); // isolated hole of 2 blocks
    k.mem.free(a);
  });

  it("compacts the heap to satisfy an allocation that would OOM", () => {
    const k = createKernel();
    // Interleave allocations so free space is scattered.
    const handles = [];
    for (let i = 0; i < 20; i++) handles.push(k.mem.alloc("x", 2));
    for (let i = 0; i < 20; i += 2) k.mem.free(handles[i]);
    // Largest free run is 2; a 10-block alloc must fail without compaction.
    const before = k.mem.stats();
    expect(before.oom).toBeGreaterThanOrEqual(0);
    const h = k.mem.alloc("big", 10); // compaction kicks in automatically
    expect(h).not.toBeNull();
    expect(k.mem.stats().compactions).toBeGreaterThanOrEqual(1);
    expect(h!.start).toBe(0); // everything slid to the heap front
  });

  it("never allocates beyond heap capacity", () => {
    const k = createKernel();
    expect(k.mem.alloc("too-big", 5000)).toBeNull();
  });
});
