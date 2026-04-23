// Digital Twin simulation engine.
// Procedural city grid (city blocks + a campus quarter) with agent-based
// traffic and crowd simulation. Pure functions so we can run "what-if"
// scenarios for time-travel and decision sliders.

export type Vec2 = { x: number; z: number };

export type Building = {
  id: string;
  pos: Vec2;
  w: number;
  d: number;
  h: number;
  kind: "office" | "residential" | "campus" | "cafeteria" | "lecture" | "library" | "parking" | "firestation";
  capacity: number;
  label?: string;
};

export type Road = {
  id: string;
  a: Vec2;
  b: Vec2;
  capacity: number; // vehicles per minute baseline
};

export type Intersection = {
  id: string;
  pos: Vec2;
  signalCycle: number; // seconds
};

export type Hotspot = {
  id: string;
  pos: Vec2;
  radius: number;
  intensity: number; // 0..1 crowd density
  label: string;
};

export type CityModel = {
  size: number;
  buildings: Building[];
  roads: Road[];
  intersections: Intersection[];
  campusBounds: { x: number; z: number; w: number; d: number };
};

export type SimControls = {
  signalTiming: number;       // 0.5 .. 2 (multiplier)
  closedRoadIds: string[];
  campusEventLoad: number;    // 0..1 extra campus crowd
  trafficVolume: number;      // 0.4 .. 1.6
};

export type CrisisMode = "none" | "flood" | "fire" | "surge";

export type CrisisEpicenter = {
  pos: Vec2;
  radius: number;       // current active radius
  predictedRadius: number; // projected radius in ~30 min
  level: number;        // 0..1 severity
};

export type SimSnapshot = {
  tMinutes: number;            // minutes from "now"
  hour: number;                // 0..23
  congestion: number;          // 0..1 city-wide
  pollution: number;           // 0..1
  crowdLoad: number;           // 0..1
  hotspots: Hotspot[];
  roadFlow: Record<string, number>; // 0..1 utilization
  riskZones: { pos: Vec2; radius: number; level: number }[];
  evacuationRoutes: { a: Vec2; b: Vec2 }[];
  crisis: CrisisMode;
  // Crisis-specific
  fire?: CrisisEpicenter;
  flood?: CrisisEpicenter & { waterLevel: number };
  surge?: CrisisEpicenter;
  crisisElapsedMin: number;     // minutes since crisis was activated (player-facing)
};

const rand = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
};

export function buildCity(seed = 7): CityModel {
  const r = rand(seed);
  const size = 1100;
  const blockSize = 60;
  const half = size / 2;

  const buildings: Building[] = [];
  const roads: Road[] = [];
  const intersections: Intersection[] = [];

  // Grid roads
  for (let x = -half; x <= half; x += blockSize) {
    roads.push({ id: `r-v-${x}`, a: { x, z: -half }, b: { x, z: half }, capacity: 60 });
  }
  for (let z = -half; z <= half; z += blockSize) {
    roads.push({ id: `r-h-${z}`, a: { x: -half, z }, b: { x: half, z }, capacity: 60 });
  }
  for (let x = -half; x <= half; x += blockSize) {
    for (let z = -half; z <= half; z += blockSize) {
      intersections.push({ id: `i-${x}-${z}`, pos: { x, z }, signalCycle: 60 });
    }
  }

  // Campus quarter (top-right): a 3x3 block area
  const campusBounds = { x: 60, z: -240, w: 240, d: 240 };

  // City buildings
  for (let x = -half + blockSize / 2; x < half; x += blockSize) {
    for (let z = -half + blockSize / 2; z < half; z += blockSize) {
      const inCampus =
        x > campusBounds.x &&
        x < campusBounds.x + campusBounds.w &&
        z > campusBounds.z &&
        z < campusBounds.z + campusBounds.d;
      if (inCampus) continue;

      const w = 18 + r() * 22;
      const d = 18 + r() * 22;
      const h = 12 + r() * 80;
      const kind: Building["kind"] = r() > 0.6 ? "residential" : "office";
      buildings.push({
        id: `b-${x}-${z}`,
        pos: { x: x + (r() - 0.5) * 6, z: z + (r() - 0.5) * 6 },
        w,
        d,
        h,
        kind,
        capacity: Math.round(h * 4),
      });
    }
  }

  // Campus buildings — recognizable layout
  const campus: Array<Omit<Building, "id">> = [
    { pos: { x: 100, z: -200 }, w: 50, d: 30, h: 22, kind: "lecture", capacity: 800, label: "Lecture Hall A" },
    { pos: { x: 170, z: -200 }, w: 50, d: 30, h: 22, kind: "lecture", capacity: 800, label: "Lecture Hall B" },
    { pos: { x: 240, z: -200 }, w: 40, d: 30, h: 30, kind: "library", capacity: 600, label: "Library" },
    { pos: { x: 100, z: -130 }, w: 70, d: 35, h: 14, kind: "cafeteria", capacity: 500, label: "Cafeteria" },
    { pos: { x: 200, z: -130 }, w: 60, d: 40, h: 18, kind: "campus", capacity: 1200, label: "Student Union" },
    { pos: { x: 100, z: -60 }, w: 45, d: 45, h: 26, kind: "campus", capacity: 700, label: "Engineering" },
    { pos: { x: 175, z: -60 }, w: 45, d: 45, h: 26, kind: "campus", capacity: 700, label: "Sciences" },
    { pos: { x: 250, z: -60 }, w: 45, d: 30, h: 8, kind: "parking", capacity: 400, label: "Parking" },
  ];
  campus.forEach((b, i) => buildings.push({ id: `c-${i}`, ...b }));

  // Fire stations spread across the larger map
  const fireStations: Array<Omit<Building, "id">> = [
    { pos: { x: -360, z: -300 }, w: 38, d: 28, h: 12, kind: "firestation", capacity: 40, label: "Fire Station 1" },
    { pos: { x: 360, z: 240 }, w: 38, d: 28, h: 12, kind: "firestation", capacity: 40, label: "Fire Station 2" },
    { pos: { x: -300, z: 360 }, w: 38, d: 28, h: 12, kind: "firestation", capacity: 40, label: "Fire Station 3" },
    { pos: { x: 240, z: -360 }, w: 38, d: 28, h: 12, kind: "firestation", capacity: 40, label: "Fire Station 4" },
  ];
  // Remove any pre-existing block buildings overlapping the fire station footprints
  fireStations.forEach((fs, i) => {
    const idx = buildings.findIndex(
      (b) => Math.abs(b.pos.x - fs.pos.x) < 35 && Math.abs(b.pos.z - fs.pos.z) < 35,
    );
    if (idx >= 0) buildings.splice(idx, 1);
    buildings.push({ id: `fs-${i}`, ...fs });
  });

  return { size, buildings, roads, intersections, campusBounds };
}

// Diurnal demand curve (0..1)
function demandAt(hour: number) {
  // Two peaks: morning 8–10, evening 17–19; campus midday spike
  const base = 0.25;
  const morning = Math.exp(-Math.pow((hour - 9) / 1.4, 2));
  const evening = Math.exp(-Math.pow((hour - 18) / 1.6, 2));
  const lunch = Math.exp(-Math.pow((hour - 13) / 0.8, 2)) * 0.7;
  return Math.min(1, base + morning + evening * 0.9 + lunch * 0.4);
}

function distance(a: Vec2, b: Vec2) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function simulate(
  city: CityModel,
  controls: SimControls,
  crisis: CrisisMode,
  tMinutes: number,
  baseHour = new Date().getHours(),
  crisisStartMin = 0,
): SimSnapshot {
  const hour = (baseHour + tMinutes / 60 + 24) % 24;
  const demand = demandAt(hour);
  const elapsed = Math.max(0, tMinutes - crisisStartMin);

  // Signal efficiency: closer to 1 timing => optimal; deviation reduces flow
  const signalPenalty = Math.abs(controls.signalTiming - 1) * 0.35;
  const closedSet = new Set(controls.closedRoadIds);

  // Road utilization
  const roadFlow: Record<string, number> = {};
  let totalUtil = 0;
  let counted = 0;
  for (const road of city.roads) {
    if (closedSet.has(road.id)) {
      roadFlow[road.id] = 1; // jammed/closed
      totalUtil += 1;
      counted++;
      continue;
    }
    // Roads near closed roads get spillover
    let spill = 0;
    for (const cid of controls.closedRoadIds) {
      const cr = city.roads.find((rr) => rr.id === cid);
      if (!cr) continue;
      const d = Math.min(distance(road.a, cr.a), distance(road.b, cr.b));
      if (d < 120) spill += (1 - d / 120) * 0.45;
    }
    let util =
      demand * controls.trafficVolume * 0.7 +
      signalPenalty +
      spill * 0.6;
    if (crisis === "flood") util += 0.25;
    if (crisis === "fire") util += 0.15;
    if (crisis === "surge") util += 0.2;
    util = Math.max(0, Math.min(1, util));
    roadFlow[road.id] = util;
    totalUtil += util;
    counted++;
  }
  const congestion = counted ? totalUtil / counted : 0;

  // Crowd hotspots
  const hotspots: Hotspot[] = [];
  for (const b of city.buildings) {
    let intensity = 0;
    let label = b.label ?? b.kind;
    if (b.kind === "cafeteria") {
      // Lunch spike
      const lunch = Math.exp(-Math.pow((hour - 13) / 0.5, 2));
      intensity = lunch * (0.7 + controls.campusEventLoad * 0.4);
    } else if (b.kind === "lecture") {
      // Class change spikes on the hour
      const minuteOfHour = (tMinutes % 60 + 60) % 60;
      const onTheHour = Math.exp(-Math.pow((minuteOfHour - 0) / 8, 2));
      const dayWeight = hour > 8 && hour < 18 ? 1 : 0.1;
      intensity = onTheHour * dayWeight * (0.6 + controls.campusEventLoad * 0.5);
    } else if (b.kind === "library") {
      intensity = (hour > 9 && hour < 22 ? 0.55 : 0.15) * (0.7 + controls.campusEventLoad * 0.3);
    } else if (b.kind === "campus" || b.kind === "parking") {
      intensity = (hour > 8 && hour < 19 ? 0.4 : 0.1) * (0.7 + controls.campusEventLoad * 0.5);
    } else {
      intensity = demand * 0.25;
    }
    if (crisis === "surge" && (b.kind === "campus" || b.kind === "lecture" || b.kind === "cafeteria")) {
      intensity = Math.min(1, intensity + 0.5);
    }
    if (intensity > 0.18) {
      hotspots.push({
        id: `h-${b.id}`,
        pos: b.pos,
        radius: 18 + intensity * 28,
        intensity: Math.min(1, intensity),
        label,
      });
    }
  }

  // Pollution rises with congestion + traffic volume + fire crisis
  let pollution = congestion * 0.7 + controls.trafficVolume * 0.1;
  if (crisis === "fire") pollution = Math.min(1, pollution + 0.45);
  pollution = Math.max(0, Math.min(1, pollution));

  // Crisis features — radii grow with elapsed minutes (capped)
  const riskZones: SimSnapshot["riskZones"] = [];
  const evacuationRoutes: SimSnapshot["evacuationRoutes"] = [];
  let fire: SimSnapshot["fire"];
  let flood: SimSnapshot["flood"];
  let surge: SimSnapshot["surge"];

  // Spread factor: 0 at t=0, ~1 after 30 min
  const spread = Math.min(1, elapsed / 30);
  const futureSpread = Math.min(1, (elapsed + 30) / 30);

  if (crisis === "flood") {
    const epi: Vec2 = { x: -120, z: 80 };
    const r = 80 + spread * 160;
    const rNext = 80 + futureSpread * 160;
    flood = { pos: epi, radius: r, predictedRadius: rNext, level: Math.min(1, 0.4 + spread * 0.6), waterLevel: 0.5 + spread * 2.5 };
    riskZones.push({ pos: epi, radius: r, level: 0.85 });
    riskZones.push({ pos: { x: 80, z: 180 }, radius: 60 + spread * 100, level: 0.55 });
    evacuationRoutes.push({ a: epi, b: { x: 280, z: -260 } });
    evacuationRoutes.push({ a: { x: 80, z: 180 }, b: { x: -260, z: -260 } });
  } else if (crisis === "fire") {
    const epi: Vec2 = { x: 60, z: -40 };
    const r = 30 + spread * 100;
    const rNext = 30 + futureSpread * 100;
    fire = { pos: epi, radius: r, predictedRadius: rNext, level: Math.min(1, 0.5 + spread * 0.5) };
    riskZones.push({ pos: epi, radius: r, level: 0.95 });
    evacuationRoutes.push({ a: epi, b: { x: 280, z: -280 } });
    evacuationRoutes.push({ a: epi, b: { x: -280, z: -280 } });
  } else if (crisis === "surge") {
    const epi: Vec2 = { x: 175, z: -130 };
    const r = 50 + spread * 80;
    const rNext = 50 + futureSpread * 80;
    surge = { pos: epi, radius: r, predictedRadius: rNext, level: Math.min(1, 0.6 + spread * 0.4) };
    riskZones.push({ pos: epi, radius: r, level: 0.8 });
    evacuationRoutes.push({ a: epi, b: { x: 280, z: 280 } });
    evacuationRoutes.push({ a: epi, b: { x: -280, z: 280 } });
  }

  const crowdLoad =
    hotspots.reduce((s, h) => s + h.intensity, 0) / Math.max(1, hotspots.length);

  return {
    tMinutes,
    hour,
    congestion,
    pollution,
    crowdLoad,
    hotspots,
    roadFlow,
    riskZones,
    evacuationRoutes,
    crisis,
    fire,
    flood,
    surge,
    crisisElapsedMin: crisis === "none" ? 0 : elapsed,
  };
}

// Project N points forward to draw forecast charts.
export function project(
  city: CityModel,
  controls: SimControls,
  crisis: CrisisMode,
  fromMin: number,
  steps: number,
  stepMin: number,
) {
  const out: SimSnapshot[] = [];
  for (let i = 0; i < steps; i++) {
    out.push(simulate(city, controls, crisis, fromMin + i * stepMin));
  }
  return out;
}
