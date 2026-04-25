import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Html, Stars } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, BrightnessContrast } from "@react-three/postprocessing";
import * as THREE from "three";
import type { Building, BuildingVariant, CityModel, SimSnapshot, Vec2 } from "@/lib/simulation";

export type FlythroughKind = "arrival" | "overview" | "crisis" | null;

type Props = {
  city: CityModel;
  snapshot: SimSnapshot;
  closedRoadIds: string[];
  onToggleRoad: (roadId: string) => void;
  hoveredRoadId: string | null;
  setHoveredRoadId: (id: string | null) => void;
  /** seconds the crisis has been visually playing — drives ignition/collapse */
  crisisPlaySeconds: number;
  /** target the camera should fly to. Re-fires when reference changes. */
  flyTo: { x: number; z: number; preset?: "overview" | "tactical" | "street" } | null;
  /** Cinematic flythrough sequence. Re-fires when nonce changes. */
  flythrough?: { kind: FlythroughKind; nonce: number; focus?: Vec2 } | null;
  /** Reports the runtime quality tier the adaptive scaler picked. */
  onQualityChange?: (tier: "high" | "medium" | "low") => void;
};

/* ------------------------- realistic buildings ------------------------- */

const VARIANT_PALETTE: Record<BuildingVariant, { wall: string; accent: string; window: string; trim?: string; metalness: number; roughness: number }> = {
  "skyscraper-glass":    { wall: "#1a2840", accent: "#0ea5e9", window: "#7dd3fc", trim: "#475569", metalness: 0.85, roughness: 0.18 },
  "skyscraper-classic":  { wall: "#3a4258", accent: "#fde68a", window: "#fcd34d", trim: "#1f2937", metalness: 0.35, roughness: 0.55 },
  "midrise-office":      { wall: "#3d4a60", accent: "#fbbf24", window: "#fde68a", trim: "#27313f", metalness: 0.45, roughness: 0.5 },
  "brownstone":          { wall: "#5a3a28", accent: "#fbbf24", window: "#fde68a", trim: "#3a2418", metalness: 0.05, roughness: 0.95 },
  "tower-residential":   { wall: "#46405a", accent: "#fbbf24", window: "#fde68a", trim: "#2a2538", metalness: 0.25, roughness: 0.7 },
  "campus-modern":       { wall: "#3d5a72", accent: "#5cc8ff", window: "#7dd3fc", trim: "#1f2a38", metalness: 0.55, roughness: 0.35 },
  "campus-brick":        { wall: "#7a3a2a", accent: "#fde68a", window: "#fbbf24", trim: "#3a1f18", metalness: 0.05, roughness: 0.95 },
  "civic":               { wall: "#7a1f1f", accent: "#fde68a", window: "#fbbf24", trim: "#1f1a17", metalness: 0.3, roughness: 0.6 },
  "industrial":          { wall: "#2a3340", accent: "#64748b", window: "#94a3b8", trim: "#1f2937", metalness: 0.4, roughness: 0.8 },
};

function buildingDamageState(
  b: Building,
  snapshot: SimSnapshot,
  playSec: number,
) {
  // Returns { onFire, ignitionAt, collapsed, damage 0..1, flooded 0..1 }
  let onFire = false;
  let ignitionAt = Infinity;
  let damage = 0;
  let flooded = 0;

  if (snapshot.fire) {
    const dx = b.pos.x - snapshot.fire.pos.x;
    const dz = b.pos.z - snapshot.fire.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= snapshot.fire.radius + 8) {
      // ignition delay scales with distance from epicenter
      const delay = (d / Math.max(1, snapshot.fire.radius)) * 18; // sec
      ignitionAt = delay;
      if (playSec > delay) {
        onFire = true;
        const burnTime = Math.max(0, playSec - delay);
        damage = Math.min(1, burnTime / 22); // collapses ~22s after ignition
      }
    }
  }
  if (snapshot.flood) {
    const dx = b.pos.x - snapshot.flood.pos.x;
    const dz = b.pos.z - snapshot.flood.pos.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d <= snapshot.flood.radius) {
      const t = 1 - d / snapshot.flood.radius;
      flooded = Math.min(1, t * (snapshot.flood.waterLevel / 3));
    }
  }
  const collapsed = damage >= 1;
  return { onFire, ignitionAt, collapsed, damage, flooded };
}

function Building3D({
  b,
  hour,
  state,
}: {
  b: Building;
  hour: number;
  state: ReturnType<typeof buildingDamageState>;
}) {
  const palette = VARIANT_PALETTE[b.variant] ?? VARIANT_PALETTE["midrise-office"];
  const isNight = hour < 6.5 || hour > 19;
  const lightProb = isNight ? 0.7 : 0.18;

  const { stories } = useMemo(() => {
    const floorH =
      b.variant === "skyscraper-glass" || b.variant === "skyscraper-classic" ? 4.5 : 3.5;
    return { stories: Math.max(2, Math.floor(b.h / floorH)) };
  }, [b.h, b.variant]);

  // Stable per-building randomness for window lights & rooftop props
  const litMatrix = useMemo(() => {
    const seed = Math.abs(Math.floor(b.pos.x * 13 + b.pos.z * 7));
    const out: number[] = [];
    let s = seed;
    for (let i = 0; i < stories * 8; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      out.push(s / 0xffffffff);
    }
    return out;
  }, [b.pos.x, b.pos.z, stories]);

  if (state.collapsed) {
    return (
      <group position={[b.pos.x, 0, b.pos.z]}>
        {/* Rubble pile of jagged blocks */}
        {Array.from({ length: 6 }).map((_, i) => {
          const a = (i / 6) * Math.PI * 2;
          const r = (i % 3) * 1.6;
          const sz = 1.4 + (i % 3) * 0.8;
          return (
            <mesh key={i} position={[Math.cos(a) * r, 0.6 + (i % 2) * 0.4, Math.sin(a) * r]} rotation={[0, a, 0.3]} castShadow>
              <boxGeometry args={[sz * 1.2, sz, sz]} />
              <meshStandardMaterial color="#1f1a17" roughness={0.95} />
            </mesh>
          );
        })}
        <mesh position={[0, 0.2, 0]}>
          <boxGeometry args={[b.w * 1.05, 0.4, b.d * 1.05]} />
          <meshStandardMaterial color="#0d0807" roughness={0.95} />
        </mesh>
        <pointLight position={[0, 4, 0]} color="#ff6a2a" intensity={0.7} distance={50} />
      </group>
    );
  }

  // Damage tilt + sink
  const tilt = state.damage * 0.18;
  const sink = state.damage * b.h * 0.15;
  const buildingHeight = b.h * (1 - state.damage * 0.12);

  // Color shift for fire damage (sooty)
  const sootMix = state.damage;
  const wallColor = new THREE.Color(palette.wall).lerp(new THREE.Color("#0d0807"), sootMix * 0.7);
  const trimColor = new THREE.Color(palette.trim ?? palette.wall).lerp(new THREE.Color("#0d0807"), sootMix * 0.7);
  const emissiveOnFire = state.onFire
    ? new THREE.Color("#ff5a1f").multiplyScalar(0.6 + Math.sin(performance.now() * 0.01) * 0.25)
    : new THREE.Color("#000");

  // Variant-driven shape
  const isGlass = b.variant === "skyscraper-glass";
  const isClassicTall = b.variant === "skyscraper-classic";
  const isBrownstone = b.variant === "brownstone";
  const isCivic = b.variant === "civic";
  const isIndustrial = b.variant === "industrial";

  // Tier shape: tall buildings get setbacks
  const hasTier = (isGlass || isClassicTall) && b.h > 50;
  const lowerH = hasTier ? buildingHeight * 0.6 : buildingHeight;
  const upperH = hasTier ? buildingHeight * 0.4 : 0;
  const podiumH = isBrownstone ? 1.2 : 0.8;

  // Window strip color (slightly variable per building)
  const winColor = new THREE.Color(palette.window);
  const winEmissiveBase = isGlass ? 0.4 : 0.0;

  return (
    <group
      position={[b.pos.x, 0, b.pos.z]}
      rotation={[tilt * 0.5, b.rotY, tilt]}
    >
      {/* Plaza / podium base */}
      <mesh position={[0, podiumH / 2, 0]} receiveShadow>
        <boxGeometry args={[b.w * 1.1, podiumH, b.d * 1.1]} />
        <meshStandardMaterial color={trimColor} roughness={0.92} metalness={0.1} />
      </mesh>

      {/* LOWER body */}
      <mesh
        position={[0, lowerH / 2 + podiumH - sink, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[b.w, lowerH, b.d]} />
        <meshStandardMaterial
          color={wallColor}
          roughness={palette.roughness}
          metalness={palette.metalness}
          emissive={emissiveOnFire}
          emissiveIntensity={state.onFire ? 0.8 : 0}
        />
      </mesh>

      {/* For glass towers, add an inner emissive "core" through windows */}
      {isGlass && !state.onFire && isNight && (
        <mesh position={[0, lowerH / 2 + podiumH, 0]}>
          <boxGeometry args={[b.w * 0.96, lowerH * 0.96, b.d * 0.96]} />
          <meshBasicMaterial color={palette.accent} transparent opacity={0.18} />
        </mesh>
      )}

      {/* TIERED upper section */}
      {hasTier && (
        <mesh position={[0, lowerH + upperH / 2 + podiumH - sink, 0]} castShadow>
          <boxGeometry args={[b.w * 0.7, upperH, b.d * 0.7]} />
          <meshStandardMaterial
            color={wallColor}
            roughness={palette.roughness * 0.9}
            metalness={palette.metalness}
            emissive={emissiveOnFire}
            emissiveIntensity={state.onFire ? 0.7 : 0}
          />
        </mesh>
      )}

      {/* CROWN — antenna for skyscrapers */}
      {(isGlass || isClassicTall) && b.h > 70 && (
        <>
          <mesh position={[0, buildingHeight + podiumH + 4, 0]}>
            <cylinderGeometry args={[0.3, 0.6, 8, 6]} />
            <meshStandardMaterial color="#94a3b8" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, buildingHeight + podiumH + 8.5, 0]}>
            <sphereGeometry args={[0.4, 8, 8]} />
            <meshBasicMaterial color="#ef4444" />
          </mesh>
          <pointLight position={[0, buildingHeight + podiumH + 8.5, 0]} color="#ef4444" intensity={1.5} distance={40} />
        </>
      )}

      {/* Rooftop equipment box */}
      {!isBrownstone && (
        <mesh position={[0, buildingHeight + podiumH + 0.6, 0]}>
          <boxGeometry args={[b.w * 0.4, 1.2, b.d * 0.4]} />
          <meshStandardMaterial color={trimColor} roughness={0.85} />
        </mesh>
      )}
      {/* AC units / vents */}
      {isIndustrial || isCivic ? null : (
        <>
          <mesh position={[b.w * 0.25, buildingHeight + podiumH + 1, b.d * 0.25]}>
            <boxGeometry args={[2, 1.4, 2]} />
            <meshStandardMaterial color="#475569" />
          </mesh>
          <mesh position={[-b.w * 0.25, buildingHeight + podiumH + 1, -b.d * 0.25]}>
            <boxGeometry args={[1.5, 1, 1.5]} />
            <meshStandardMaterial color="#64748b" />
          </mesh>
        </>
      )}

      {/* Brownstone pitched roof */}
      {isBrownstone && (
        <mesh position={[0, buildingHeight + podiumH + 1, 0]} rotation={[0, Math.PI / 4, 0]}>
          <coneGeometry args={[Math.max(b.w, b.d) * 0.7, 3, 4]} />
          <meshStandardMaterial color="#3a2418" roughness={0.95} />
        </mesh>
      )}

      {/* WINDOW STRIPS */}
      {Array.from({ length: stories }).map((_, floor) => {
        const floorH = lowerH / stories;
        const y = podiumH + 1.2 + floor * floorH;
        if (y > lowerH + podiumH + 0.5) return null;
        const litFront = (litMatrix[floor * 4] ?? 0) < lightProb ? 0.95 : 0.06;
        const litBack = (litMatrix[floor * 4 + 1] ?? 0) < lightProb ? 0.95 : 0.06;
        const litLeft = (litMatrix[floor * 4 + 2] ?? 0) < lightProb ? 0.95 : 0.06;
        const litRight = (litMatrix[floor * 4 + 3] ?? 0) < lightProb ? 0.95 : 0.06;
        const dim = 1 - sootMix * 0.85;
        const stripH = isGlass ? floorH * 0.85 : 1.4;
        return (
          <group key={floor}>
            <mesh position={[0, y, b.d / 2 + 0.05]}>
              <planeGeometry args={[b.w * 0.85, stripH]} />
              <meshBasicMaterial color={winColor} transparent opacity={(litFront + winEmissiveBase) * dim} />
            </mesh>
            <mesh position={[0, y, -b.d / 2 - 0.05]} rotation={[0, Math.PI, 0]}>
              <planeGeometry args={[b.w * 0.85, stripH]} />
              <meshBasicMaterial color={winColor} transparent opacity={(litBack + winEmissiveBase) * dim} />
            </mesh>
            <mesh position={[-b.w / 2 - 0.05, y, 0]} rotation={[0, -Math.PI / 2, 0]}>
              <planeGeometry args={[b.d * 0.85, stripH]} />
              <meshBasicMaterial color={winColor} transparent opacity={(litLeft + winEmissiveBase) * dim} />
            </mesh>
            <mesh position={[b.w / 2 + 0.05, y, 0]} rotation={[0, Math.PI / 2, 0]}>
              <planeGeometry args={[b.d * 0.85, stripH]} />
              <meshBasicMaterial color={winColor} transparent opacity={(litRight + winEmissiveBase) * dim} />
            </mesh>
          </group>
        );
      })}

      {/* Mullions for glass towers — vertical lines */}
      {isGlass && [-1, 1].map((s) => (
        <mesh key={s} position={[0, lowerH / 2 + podiumH, (b.d / 2 + 0.06) * s]}>
          <planeGeometry args={[b.w * 0.85, lowerH * 0.95]} />
          <meshBasicMaterial color="#0f1626" transparent opacity={0.35} />
        </mesh>
      ))}

      {/* fire glow at ignition point */}
      {state.onFire && !state.collapsed && (
        <pointLight
          position={[0, buildingHeight * 0.7, 0]}
          color="#ff5a1f"
          intensity={1.6 + state.damage * 1.4}
          distance={70}
          decay={2}
        />
      )}

      {/* Fire-station signage: red roof beacon + bay doors */}
      {b.kind === "firestation" && !state.collapsed && (
        <>
          <mesh position={[0, buildingHeight + podiumH + 0.4, 0]}>
            <boxGeometry args={[b.w * 1.02, 0.8, b.d * 1.02]} />
            <meshStandardMaterial color="#dc2626" emissive="#7f1d1d" emissiveIntensity={0.4} />
          </mesh>
          <FireStationBeacon height={buildingHeight + podiumH + 2.2} />
          <mesh position={[0, 3, b.d / 2 + 0.06]}>
            <planeGeometry args={[b.w * 0.7, 5]} />
            <meshBasicMaterial color="#fbbf24" />
          </mesh>
          <mesh position={[0, buildingHeight + podiumH - 1.5, b.d / 2 + 0.07]}>
            <planeGeometry args={[b.w * 0.6, 1.2]} />
            <meshBasicMaterial color="#fef08a" />
          </mesh>
        </>
      )}
    </group>
  );
}

function FireStationBeacon({ height }: { height: number }) {
  const ref = useRef<THREE.PointLight>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.intensity = 1.5 + Math.sin(t * 6) * 1.2;
  });
  return (
    <>
      <mesh position={[0, height, 0]}>
        <sphereGeometry args={[0.6, 12, 12]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      <pointLight ref={ref} position={[0, height, 0]} color="#ef4444" intensity={2} distance={60} />
    </>
  );
}

function BuildingsLayer({
  city,
  snapshot,
  playSec,
}: {
  city: CityModel;
  snapshot: SimSnapshot;
  playSec: number;
}) {
  return (
    <>
      {city.buildings.map((b) => {
        const state = buildingDamageState(b, snapshot, playSec);
        return <Building3D key={b.id} b={b} hour={snapshot.hour} state={state} />;
      })}
    </>
  );
}

/* ------------------------------- roads ------------------------------- */

const ROAD_WIDTH = 8;
const SIDEWALK_WIDTH = 11;

function Roads({
  city,
  snapshot,
  closedRoadIds,
  onToggleRoad,
  hoveredRoadId,
  setHoveredRoadId,
}: {
  city: CityModel;
  snapshot: SimSnapshot;
  closedRoadIds: string[];
  onToggleRoad: (id: string) => void;
  hoveredRoadId: string | null;
  setHoveredRoadId: (id: string | null) => void;
}) {
  return (
    <group>
      {city.roads.map((road) => {
        const dx = road.b.x - road.a.x;
        const dz = road.b.z - road.a.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        const cx = (road.a.x + road.b.x) / 2;
        const cz = (road.a.z + road.b.z) / 2;
        const angle = Math.atan2(dz, dx);
        const util = snapshot.roadFlow[road.id] ?? 0;
        const closed = closedRoadIds.includes(road.id);
        const hovered = hoveredRoadId === road.id;

        // Asphalt color based on utilization
        const tint = closed
          ? new THREE.Color("#5b1a1a")
          : new THREE.Color().setHSL((1 - util) * 0.33, 0.4, 0.18);

        return (
          <group
            key={road.id}
            position={[cx, 0.05, cz]}
            rotation={[-Math.PI / 2, 0, -angle]}
          >
            {/* Sidewalk */}
            <mesh receiveShadow>
              <planeGeometry args={[len, SIDEWALK_WIDTH]} />
              <meshStandardMaterial color="#3a4050" roughness={0.95} />
            </mesh>
            {/* Asphalt */}
            <mesh
              position={[0, 0, 0.01]}
              onPointerOver={(e) => {
                e.stopPropagation();
                setHoveredRoadId(road.id);
                document.body.style.cursor = "pointer";
              }}
              onPointerOut={() => {
                setHoveredRoadId(null);
                document.body.style.cursor = "auto";
              }}
              onClick={(e) => {
                e.stopPropagation();
                onToggleRoad(road.id);
              }}
            >
              <planeGeometry args={[len, ROAD_WIDTH]} />
              <meshStandardMaterial
                color={tint}
                roughness={0.85}
                emissive={closed ? new THREE.Color("#ff3030") : new THREE.Color("#000")}
                emissiveIntensity={closed ? 0.4 : hovered ? 0.15 : 0}
              />
            </mesh>
            {/* Lane markings (dashed center line) */}
            {!closed && (
              <mesh position={[0, 0, 0.02]}>
                <planeGeometry args={[len, 0.4]} />
                <meshBasicMaterial color="#fde68a" transparent opacity={0.55} />
              </mesh>
            )}
            {/* Congestion glow strip when high util */}
            {util > 0.55 && !closed && (
              <mesh position={[0, 0, 0.03]}>
                <planeGeometry args={[len, ROAD_WIDTH * 0.2]} />
                <meshBasicMaterial
                  color={new THREE.Color().setHSL((1 - util) * 0.33, 0.95, 0.55)}
                  transparent
                  opacity={0.35 + util * 0.4}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

/* ------------------------------ trees / parks ------------------------------ */

const TREE_VARIANTS = ["oak", "pine", "palm"] as const;
type TreeVariant = (typeof TREE_VARIANTS)[number];

function Trees({ city }: { city: CityModel }) {
  // Generate tree positions split by variant — each rendered as a single InstancedMesh
  // for trunk + canopy. This is ~1000x faster than individual <mesh> per tree.
  const buckets = useMemo(() => {
    const oak: Array<{ x: number; z: number; s: number; rot: number }> = [];
    const pine: Array<{ x: number; z: number; s: number; rot: number }> = [];
    const palm: Array<{ x: number; z: number; s: number; rot: number }> = [];
    let s = 19;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    // Cap tree count so it scales sub-linearly with map size
    const treeCount = Math.min(900, Math.floor((city.size * city.size) / 2200));
    for (let i = 0; i < treeCount; i++) {
      const x = (rnd() - 0.5) * city.size;
      const z = (rnd() - 0.5) * city.size;
      const nx = Math.round(x / 60) * 60 + (rnd() > 0.5 ? 7 : -7);
      const nz = Math.round(z / 60) * 60 + (rnd() > 0.5 ? 7 : -7);
      const item = { x: nx, z: nz, s: 0.7 + rnd() * 0.6, rot: rnd() * Math.PI };
      const which = rnd();
      if (which < 0.55) oak.push(item);
      else if (which < 0.85) pine.push(item);
      else palm.push(item);
    }
    return { oak, pine, palm };
  }, [city.size]);

  return (
    <group>
      <TreeInstances items={buckets.oak} variant="oak" />
      <TreeInstances items={buckets.pine} variant="pine" />
      <TreeInstances items={buckets.palm} variant="palm" />
    </group>
  );
}

function TreeInstances({
  items,
  variant,
}: {
  items: Array<{ x: number; z: number; s: number; rot: number }>;
  variant: TreeVariant;
}) {
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const canopyRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!trunkRef.current || !canopyRef.current) return;
    items.forEach((t, i) => {
      // trunk
      dummy.position.set(t.x, 1.2 * t.s, t.z);
      dummy.rotation.set(0, t.rot, 0);
      dummy.scale.set(t.s, t.s, t.s);
      dummy.updateMatrix();
      trunkRef.current!.setMatrixAt(i, dummy.matrix);
      // canopy (sits on top of trunk)
      const canopyY = variant === "palm" ? 4.4 * t.s : 3.4 * t.s;
      dummy.position.set(t.x, canopyY, t.z);
      dummy.rotation.set(0, t.rot, 0);
      dummy.scale.set(t.s, t.s, t.s);
      dummy.updateMatrix();
      canopyRef.current!.setMatrixAt(i, dummy.matrix);
    });
    trunkRef.current.instanceMatrix.needsUpdate = true;
    canopyRef.current.instanceMatrix.needsUpdate = true;
  }, [items, dummy, variant]);

  if (items.length === 0) return null;
  const n = items.length;

  // Geometry per variant
  let trunkGeom: React.ReactElement;
  let canopyGeom: React.ReactElement;
  let canopyColor: string;
  if (variant === "pine") {
    trunkGeom = <cylinderGeometry args={[0.22, 0.32, 2.4, 6]} />;
    canopyGeom = <coneGeometry args={[1.4, 3.4, 8]} />;
    canopyColor = "#1a5a30";
  } else if (variant === "palm") {
    trunkGeom = <cylinderGeometry args={[0.18, 0.3, 4.4, 6]} />;
    canopyGeom = <icosahedronGeometry args={[1.2, 0]} />;
    canopyColor = "#2f7a3a";
  } else {
    trunkGeom = <cylinderGeometry args={[0.28, 0.4, 2.6, 6]} />;
    canopyGeom = <icosahedronGeometry args={[1.9, 1]} />;
    canopyColor = "#1f6e3a";
  }

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, n]}>
        {trunkGeom}
        <meshStandardMaterial color="#3a2418" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={canopyRef} args={[undefined, undefined, n]}>
        {canopyGeom}
        <meshStandardMaterial color={canopyColor} roughness={0.92} />
      </instancedMesh>
    </group>
  );
}

function TreeMesh({ x, z, scale, variant, rot }: { x: number; z: number; scale: number; variant: TreeVariant; rot: number }) {
  if (variant === "pine") {
    return (
      <group position={[x, 0, z]} scale={[scale, scale, scale]} rotation={[0, rot, 0]}>
        <mesh position={[0, 1.2, 0]}>
          <cylinderGeometry args={[0.22, 0.32, 2.4, 6]} />
          <meshStandardMaterial color="#3a2418" />
        </mesh>
        <mesh position={[0, 3, 0]} castShadow>
          <coneGeometry args={[1.4, 3.4, 8]} />
          <meshStandardMaterial color="#1a5a30" roughness={0.95} />
        </mesh>
        <mesh position={[0, 4.6, 0]} castShadow>
          <coneGeometry args={[1.0, 2.4, 8]} />
          <meshStandardMaterial color="#1f6e3a" roughness={0.95} />
        </mesh>
      </group>
    );
  }
  if (variant === "palm") {
    return (
      <group position={[x, 0, z]} scale={[scale, scale, scale]} rotation={[0, rot, 0]}>
        <mesh position={[0, 2, 0]}>
          <cylinderGeometry args={[0.18, 0.3, 4.4, 6]} />
          <meshStandardMaterial color="#5a3a1a" />
        </mesh>
        {[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 0.6, 4.4, Math.sin(a) * 0.6]} rotation={[0.4, a, 0]} castShadow>
              <boxGeometry args={[2.6, 0.06, 0.5]} />
              <meshStandardMaterial color="#2f7a3a" />
            </mesh>
          );
        })}
      </group>
    );
  }
  // oak (default — round canopy)
  return (
    <group position={[x, 0, z]} scale={[scale, scale, scale]} rotation={[0, rot, 0]}>
      <mesh position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.28, 0.4, 2.6, 6]} />
        <meshStandardMaterial color="#3a2418" />
      </mesh>
      <mesh position={[0, 3.4, 0]} castShadow>
        <icosahedronGeometry args={[1.9, 1]} />
        <meshStandardMaterial color="#1f6e3a" roughness={0.92} />
      </mesh>
      <mesh position={[0.7, 3.0, 0.4]} castShadow>
        <icosahedronGeometry args={[1.1, 0]} />
        <meshStandardMaterial color="#2a8048" roughness={0.92} />
      </mesh>
    </group>
  );
}

/* ------------------------------ STREETLIGHTS ------------------------------ */

function Streetlights({ city, hour }: { city: CityModel; hour: number }) {
  const isNight = hour < 6.5 || hour > 19;
  const positions = useMemo(() => {
    const out: { x: number; z: number }[] = [];
    let s = 91;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    const half = city.size / 2;
    for (let x = -half + 30; x < half; x += 60) {
      for (let z = -half + 30; z < half; z += 60) {
        if (rnd() > 0.45) continue;
        const ox = (rnd() > 0.5 ? 1 : -1) * 5;
        const oz = (rnd() > 0.5 ? 1 : -1) * 5;
        out.push({ x: x + ox, z: z + oz });
      }
    }
    return out;
  }, [city.size]);

  // Three instanced meshes: pole, arm, lamp head. NO per-instance pointLights —
  // night lighting is handled by the lamp's emissive material + bloom, plus the
  // global hemisphere/dir lights. This is the single biggest perf win.
  const poleRef = useRef<THREE.InstancedMesh>(null);
  const armRef = useRef<THREE.InstancedMesh>(null);
  const lampRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!poleRef.current || !armRef.current || !lampRef.current) return;
    positions.forEach((p, i) => {
      // pole
      dummy.position.set(p.x, 3, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleRef.current!.setMatrixAt(i, dummy.matrix);
      // arm
      dummy.position.set(p.x + 0.6, 5.8, p.z);
      dummy.updateMatrix();
      armRef.current!.setMatrixAt(i, dummy.matrix);
      // lamp head
      dummy.position.set(p.x + 1.1, 5.6, p.z);
      dummy.updateMatrix();
      lampRef.current!.setMatrixAt(i, dummy.matrix);
    });
    poleRef.current.instanceMatrix.needsUpdate = true;
    armRef.current.instanceMatrix.needsUpdate = true;
    lampRef.current.instanceMatrix.needsUpdate = true;
  }, [positions, dummy]);

  if (positions.length === 0) return null;
  const n = positions.length;

  return (
    <group>
      <instancedMesh ref={poleRef} args={[undefined, undefined, n]}>
        <cylinderGeometry args={[0.12, 0.18, 6, 6]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={armRef} args={[undefined, undefined, n]}>
        <boxGeometry args={[1.2, 0.18, 0.3]} />
        <meshStandardMaterial color="#1f2937" />
      </instancedMesh>
      <instancedMesh ref={lampRef} args={[undefined, undefined, n]}>
        <sphereGeometry args={[0.32, 8, 8]} />
        <meshBasicMaterial color={isNight ? "#fde68a" : "#374151"} />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------ PARKS ------------------------------ */

function Parks({ city }: { city: CityModel }) {
  // 3 procedural park patches off the campus
  const parks = useMemo(
    () => [
      { x: -260, z: 60, w: 80, d: 80 },
      { x: 320, z: -160, w: 70, d: 70 },
      { x: -120, z: -340, w: 90, d: 60 },
    ].filter((p) => Math.abs(p.x) < city.size / 2 - 60 && Math.abs(p.z) < city.size / 2 - 60),
    [city.size],
  );
  return (
    <group>
      {parks.map((p, i) => (
        <group key={i} position={[p.x, 0, p.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]} receiveShadow>
            <planeGeometry args={[p.w, p.d]} />
            <meshStandardMaterial color="#1a4a28" roughness={0.95} />
          </mesh>
          {/* Pond */}
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.08, 0]}>
            <circleGeometry args={[Math.min(p.w, p.d) * 0.18, 32]} />
            <meshStandardMaterial color="#1d4ed8" metalness={0.7} roughness={0.2} emissive="#3b82f6" emissiveIntensity={0.15} />
          </mesh>
          {/* Trees ringing the park */}
          {Array.from({ length: 8 }).map((_, j) => {
            const a = (j / 8) * Math.PI * 2;
            const r = Math.min(p.w, p.d) * 0.42;
            return (
              <TreeMesh
                key={j}
                x={Math.cos(a) * r}
                z={Math.sin(a) * r}
                scale={1 + (j % 3) * 0.2}
                variant={j % 2 === 0 ? "oak" : "pine"}
                rot={a}
              />
            );
          })}
        </group>
      ))}
    </group>
  );
}

/* ------------------------------ vehicles (detailed cars) ------------------------------ */

const CAR_PALETTE = [
  "#fde68a", // taxi yellow
  "#5cc8ff", // light blue
  "#dc2626", // red
  "#f8fafc", // white
  "#1f2937", // dark
  "#a78bfa", // purple
  "#22c55e", // green
];

function Vehicles({ city, snapshot }: { city: CityModel; snapshot: SimSnapshot }) {
  const data = useMemo(() => {
    const items: Array<{ road: typeof city.roads[number]; offset: number; speed: number; colorIdx: number; lane: number }> = [];
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    for (const road of city.roads) {
      const util = snapshot.roadFlow[road.id] ?? 0;
      if (util >= 1) continue;
      const count = Math.max(0, Math.floor(util * 7));
      const speed = Math.max(0.04, 1 - util) * 0.5;
      for (let i = 0; i < count; i++) {
        items.push({
          road,
          offset: i / count,
          speed,
          colorIdx: Math.floor(rnd() * CAR_PALETTE.length),
          lane: i % 2 === 0 ? 1 : -1,
        });
      }
    }
    return items;
  }, [city, snapshot]);

  // Three instanced meshes: body, windshield strip, headlights
  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const roofRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const tailRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!bodyRef.current) return;
    data.forEach((d, i) => {
      bodyRef.current!.setColorAt(i, new THREE.Color(CAR_PALETTE[d.colorIdx]));
    });
    if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
  }, [data]);

  useFrame(({ clock }) => {
    if (!bodyRef.current || !roofRef.current || !headRef.current || !tailRef.current) return;
    const t = clock.getElapsedTime();
    data.forEach((d, i) => {
      const p = (d.offset + t * d.speed) % 1;
      const x = d.road.a.x + (d.road.b.x - d.road.a.x) * p;
      const z = d.road.a.z + (d.road.b.z - d.road.a.z) * p;
      const angle = Math.atan2(d.road.b.z - d.road.a.z, d.road.b.x - d.road.a.x);
      // lane offset (perpendicular)
      const lx = Math.cos(angle + Math.PI / 2) * d.lane * 1.4;
      const lz = Math.sin(angle + Math.PI / 2) * d.lane * 1.4;

      // body
      dummy.position.set(x + lx, 0.7, z + lz);
      dummy.rotation.y = -angle;
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bodyRef.current!.setMatrixAt(i, dummy.matrix);

      // roof (smaller cab on top)
      dummy.position.set(x + lx - Math.cos(angle) * 0.2, 1.4, z + lz - Math.sin(angle) * 0.2);
      dummy.updateMatrix();
      roofRef.current!.setMatrixAt(i, dummy.matrix);

      // headlights — push forward
      const fx = Math.cos(angle) * 1.7;
      const fz = Math.sin(angle) * 1.7;
      dummy.position.set(x + lx + fx, 0.65, z + lz + fz);
      dummy.updateMatrix();
      headRef.current!.setMatrixAt(i, dummy.matrix);

      // taillights — push back
      dummy.position.set(x + lx - fx, 0.65, z + lz - fz);
      dummy.updateMatrix();
      tailRef.current!.setMatrixAt(i, dummy.matrix);
    });
    bodyRef.current.count = data.length;
    roofRef.current.count = data.length;
    headRef.current.count = data.length;
    tailRef.current.count = data.length;
    bodyRef.current.instanceMatrix.needsUpdate = true;
    roofRef.current.instanceMatrix.needsUpdate = true;
    headRef.current.instanceMatrix.needsUpdate = true;
    tailRef.current.instanceMatrix.needsUpdate = true;
  });

  if (data.length === 0) return null;
  const n = Math.max(1, data.length);

  return (
    <group>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, n]}>
        <boxGeometry args={[3.6, 1.0, 1.7]} />
        <meshStandardMaterial metalness={0.65} roughness={0.32} />
      </instancedMesh>
      <instancedMesh ref={roofRef} args={[undefined, undefined, n]}>
        <boxGeometry args={[2.2, 0.7, 1.55]} />
        <meshStandardMaterial color="#0ea5e9" metalness={0.7} roughness={0.18} transparent opacity={0.75} emissive="#0ea5e9" emissiveIntensity={0.15} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, n]}>
        <boxGeometry args={[0.3, 0.3, 1.5]} />
        <meshBasicMaterial color="#fef9c3" />
      </instancedMesh>
      <instancedMesh ref={tailRef} args={[undefined, undefined, n]}>
        <boxGeometry args={[0.3, 0.3, 1.5]} />
        <meshBasicMaterial color="#ef4444" />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------ PEDESTRIANS ------------------------------ */

function Pedestrians({ city, snapshot }: { city: CityModel; snapshot: SimSnapshot }) {
  // Walk along sidewalks parallel to roads. Limit count for perf.
  const data = useMemo(() => {
    const items: Array<{ road: typeof city.roads[number]; offset: number; speed: number; side: number; color: number }> = [];
    let seed = 31;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };
    // roughly proportional to crowd load
    const total = Math.floor(60 + snapshot.crowdLoad * 180);
    for (let n = 0; n < total; n++) {
      const road = city.roads[Math.floor(rnd() * city.roads.length)];
      items.push({
        road,
        offset: rnd(),
        speed: 0.04 + rnd() * 0.04,
        side: rnd() > 0.5 ? 1 : -1,
        color: Math.floor(rnd() * 5),
      });
    }
    return items;
  }, [city.roads, snapshot.crowdLoad]);

  const bodyRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const palette = useMemo(
    () => [
      new THREE.Color("#5cc8ff"),
      new THREE.Color("#fbbf24"),
      new THREE.Color("#ef4444"),
      new THREE.Color("#a78bfa"),
      new THREE.Color("#22c55e"),
    ],
    [],
  );

  useEffect(() => {
    if (!bodyRef.current) return;
    data.forEach((d, i) => bodyRef.current!.setColorAt(i, palette[d.color]));
    if (bodyRef.current.instanceColor) bodyRef.current.instanceColor.needsUpdate = true;
  }, [data, palette]);

  useFrame(({ clock }) => {
    if (!bodyRef.current || !headRef.current) return;
    const t = clock.getElapsedTime();
    data.forEach((d, i) => {
      const p = (d.offset + t * d.speed) % 1;
      const x = d.road.a.x + (d.road.b.x - d.road.a.x) * p;
      const z = d.road.a.z + (d.road.b.z - d.road.a.z) * p;
      const angle = Math.atan2(d.road.b.z - d.road.a.z, d.road.b.x - d.road.a.x);
      // sidewalk offset
      const sx = Math.cos(angle + Math.PI / 2) * d.side * 5;
      const sz = Math.sin(angle + Math.PI / 2) * d.side * 5;
      const bob = Math.sin(t * 8 + i) * 0.08;
      dummy.position.set(x + sx, 0.8 + bob, z + sz);
      dummy.rotation.y = -angle + (d.side > 0 ? 0 : Math.PI);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      bodyRef.current!.setMatrixAt(i, dummy.matrix);

      dummy.position.set(x + sx, 1.7 + bob, z + sz);
      dummy.updateMatrix();
      headRef.current!.setMatrixAt(i, dummy.matrix);
    });
    bodyRef.current.count = data.length;
    headRef.current.count = data.length;
    bodyRef.current.instanceMatrix.needsUpdate = true;
    headRef.current.instanceMatrix.needsUpdate = true;
  });

  if (data.length === 0) return null;
  const n = Math.max(1, data.length);
  return (
    <group>
      <instancedMesh ref={bodyRef} args={[undefined, undefined, n]}>
        <capsuleGeometry args={[0.3, 0.9, 4, 6]} />
        <meshStandardMaterial roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={headRef} args={[undefined, undefined, n]}>
        <sphereGeometry args={[0.28, 8, 8]} />
        <meshStandardMaterial color="#fde68a" roughness={0.7} />
      </instancedMesh>
    </group>
  );
}

/* ------------------------------ FIRE ------------------------------ */

function FireSystem({
  fire,
  buildings,
  playSec,
}: {
  fire: NonNullable<SimSnapshot["fire"]>;
  buildings: Building[];
  playSec: number;
}) {
  // For each building inside the radius that is ignited, emit particles.
  const burning = useMemo(() => {
    return buildings
      .map((b) => {
        const dx = b.pos.x - fire.pos.x;
        const dz = b.pos.z - fire.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const inside = d <= fire.radius + 8;
        const delay = (d / Math.max(1, fire.radius)) * 18;
        return { b, inside, delay };
      })
      .filter((x) => x.inside && playSec > x.delay);
  }, [buildings, fire.pos.x, fire.pos.z, fire.radius, playSec]);

  // Build a single instanced sprite mesh of flames + smoke
  const PARTICLES_PER_BUILDING = 6;
  const total = Math.max(1, burning.length * PARTICLES_PER_BUILDING);

  const flameRef = useRef<THREE.InstancedMesh>(null);
  const smokeRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    if (!flameRef.current || !smokeRef.current) return;
    const t = clock.getElapsedTime();
    burning.forEach(({ b }, bi) => {
      for (let p = 0; p < PARTICLES_PER_BUILDING; p++) {
        const seed = bi * 17 + p * 3.1;
        const phase = (t * 1.2 + seed) % 1.5;
        const lifeT = phase / 1.5; // 0..1
        const sway = Math.sin(t * 2 + seed) * 1.5;
        const radius = 1 + p * 0.6;
        const angle = seed + t * 0.3;
        const x = b.pos.x + Math.cos(angle) * radius;
        const z = b.pos.z + Math.sin(angle) * radius;

        // FLAME — rises a bit, scales down
        const fy = b.h * 0.7 + lifeT * 6;
        const fs = (1.2 - lifeT) * (3 + Math.sin(seed) * 1.2);
        dummy.position.set(x + sway * 0.3, fy, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(fs, fs, fs);
        dummy.updateMatrix();
        flameRef.current!.setMatrixAt(bi * PARTICLES_PER_BUILDING + p, dummy.matrix);

        // SMOKE — rises further, scales UP
        const sy = b.h * 0.9 + lifeT * 32;
        const ss = 4 + lifeT * 14;
        dummy.position.set(x + sway, sy, z);
        dummy.scale.set(ss, ss, ss);
        dummy.updateMatrix();
        smokeRef.current!.setMatrixAt(bi * PARTICLES_PER_BUILDING + p, dummy.matrix);
      }
    });
    flameRef.current.count = burning.length * PARTICLES_PER_BUILDING;
    smokeRef.current.count = burning.length * PARTICLES_PER_BUILDING;
    flameRef.current.instanceMatrix.needsUpdate = true;
    smokeRef.current.instanceMatrix.needsUpdate = true;
  });

  // Predicted spread ring (where fire will spread to in next 30 min)
  const predictionMesh = (
    <mesh
      position={[fire.pos.x, 0.4, fire.pos.z]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <ringGeometry args={[fire.radius, fire.predictedRadius, 64]} />
      <meshBasicMaterial
        color="#fb923c"
        transparent
        opacity={0.18}
        side={THREE.DoubleSide}
      />
    </mesh>
  );

  // Active danger zone
  const dangerMesh = (
    <mesh
      position={[fire.pos.x, 0.35, fire.pos.z]}
      rotation={[-Math.PI / 2, 0, 0]}
    >
      <circleGeometry args={[fire.radius, 64]} />
      <meshBasicMaterial color="#ef4444" transparent opacity={0.18} side={THREE.DoubleSide} />
    </mesh>
  );

  // Dashed prediction outline
  const ringPoints = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push(
        new THREE.Vector3(
          fire.pos.x + Math.cos(a) * fire.predictedRadius,
          0.5,
          fire.pos.z + Math.sin(a) * fire.predictedRadius,
        ),
      );
    }
    return pts;
  }, [fire.pos.x, fire.pos.z, fire.predictedRadius]);

  return (
    <>
      {dangerMesh}
      {predictionMesh}
      {/* prediction dashed outline */}
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array(ringPoints.flatMap((p) => [p.x, p.y, p.z])),
              3,
            ]}
          />
        </bufferGeometry>
        <lineDashedMaterial color="#fdba74" dashSize={4} gapSize={3} />
      </line>

      {/* Flames */}
      <instancedMesh ref={flameRef} args={[undefined, undefined, total]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial
          color="#ff7a1a"
          transparent
          opacity={0.85}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>

      {/* Smoke */}
      <instancedMesh ref={smokeRef} args={[undefined, undefined, total]}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial
          color="#1a1a1a"
          transparent
          opacity={0.18}
          depthWrite={false}
        />
      </instancedMesh>

      {/* Big epicenter light */}
      <pointLight
        position={[fire.pos.x, 30, fire.pos.z]}
        color="#ff5a1f"
        intensity={3.5}
        distance={fire.radius * 4}
        decay={1.6}
      />
    </>
  );
}

/* ------------------ TIME-TO-IGNITION HEATMAP ------------------- */
// Procedural grid around the fire epicenter. Each cell is colored by the
// estimated minutes until that point ignites given current spread dynamics.
// Also flags the next 3 likely structures to catch.

function IgnitionHeatmap({
  fire,
  buildings,
  playSec,
}: {
  fire: NonNullable<SimSnapshot["fire"]>;
  buildings: Building[];
  playSec: number;
}) {
  const GRID = 22; // cells per axis
  const span = fire.predictedRadius * 2.2;
  const cell = span / GRID;

  // sweep clock for the scanning bar
  const sweep = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!sweep.current) return;
    const t = clock.getElapsedTime();
    sweep.current.rotation.z = (t * 0.6) % (Math.PI * 2);
  });

  // Build a single InstancedMesh of square tiles colored per-cell
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const cells = useMemo(() => {
    const out: { x: number; z: number; t: number; inside: boolean }[] = [];
    const r = fire.predictedRadius;
    for (let i = 0; i < GRID; i++) {
      for (let j = 0; j < GRID; j++) {
        const x = fire.pos.x - r * 1.1 + (i + 0.5) * cell;
        const z = fire.pos.z - r * 1.1 + (j + 0.5) * cell;
        const dx = x - fire.pos.x;
        const dz = z - fire.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d > r * 1.05) continue;
        // ignition delay (sim-minutes from "now") — same model as building damage
        const tMin = (d / Math.max(1, fire.radius)) * 18 / 60 * 30; // ~minutes
        out.push({ x, z, t: tMin, inside: d <= fire.radius });
      }
    }
    return out;
  }, [fire.pos.x, fire.pos.z, fire.radius, fire.predictedRadius, cell]);

  useEffect(() => {
    if (!meshRef.current) return;
    const color = new THREE.Color();
    cells.forEach((c, idx) => {
      dummy.position.set(c.x, 0.32, c.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.set(cell * 0.92, cell * 0.92, 1);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(idx, dummy.matrix);
      // color: red (now) → orange → yellow → cool (later)
      const k = Math.min(1, c.t / 30);
      const hue = 0.0 + k * 0.13; // 0 (red) → ~0.13 (yellow)
      color.setHSL(hue, 0.95, 0.5 + (1 - k) * 0.1);
      meshRef.current!.setColorAt(idx, color);
    });
    meshRef.current.count = cells.length;
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  }, [cells, cell, dummy]);

  // Next likely structures = unburnt buildings just outside current radius,
  // sorted by ignition delay
  const nextTargets = useMemo(() => {
    const cands = buildings
      .map((b) => {
        const dx = b.pos.x - fire.pos.x;
        const dz = b.pos.z - fire.pos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        const delaySec = (d / Math.max(1, fire.radius)) * 18;
        const minutesToIgnition = Math.max(0, (delaySec - playSec)) * (30 / 60); // sim-min
        return { b, d, minutesToIgnition, willBurn: d <= fire.predictedRadius + 4, alreadyBurning: playSec > delaySec && d <= fire.radius + 8 };
      })
      .filter((c) => c.willBurn && !c.alreadyBurning && c.b.kind !== "parking")
      .sort((a, b) => a.minutesToIgnition - b.minutesToIgnition)
      .slice(0, 3);
    return cands;
  }, [buildings, fire.pos.x, fire.pos.z, fire.radius, fire.predictedRadius, playSec]);

  return (
    <group>
      {/* heat tiles */}
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, GRID * GRID]}
      >
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          transparent
          opacity={0.42}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </instancedMesh>

      {/* radar sweep wedge */}
      <mesh ref={sweep} position={[fire.pos.x, 0.55, fire.pos.z]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0, fire.predictedRadius, 48, 1, 0, Math.PI / 6]} />
        <meshBasicMaterial color="#fde68a" transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {/* next-likely structure markers */}
      {nextTargets.map((c, i) => (
        <group key={c.b.id} position={[c.b.pos.x, c.b.h + 8, c.b.pos.z]}>
          <mesh>
            <coneGeometry args={[3, 6, 12]} />
            <meshBasicMaterial color="#fbbf24" />
          </mesh>
          <pointLight color="#fbbf24" intensity={1.4} distance={40} />
          <Html
            center
            distanceFactor={140}
            style={{ pointerEvents: "none" }}
          >
            <div className="px-2 py-1 rounded-md bg-black/80 border border-amber-400/60 text-[10px] font-mono uppercase tracking-wider text-amber-200 whitespace-nowrap shadow-lg">
              <div className="text-amber-300">#{i + 1} · {c.b.label ?? c.b.kind}</div>
              <div className="opacity-70">
                ETI ~ {c.minutesToIgnition < 1 ? "<1" : c.minutesToIgnition.toFixed(0)}m
              </div>
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------ FLOOD ------------------------------ */

function FloodSystem({ flood }: { flood: NonNullable<SimSnapshot["flood"]> }) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);

  // Animate water surface (subtle wave via material map offset)
  useFrame(({ clock }) => {
    if (matRef.current) {
      const t = clock.getElapsedTime();
      // shift via emissiveIntensity pulsing for a subtle "current" feel
      matRef.current.emissiveIntensity = 0.18 + Math.sin(t * 1.4) * 0.04;
    }
  });

  // Predicted spread outline
  const predPoints = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push(
        new THREE.Vector3(
          flood.pos.x + Math.cos(a) * flood.predictedRadius,
          flood.waterLevel + 0.3,
          flood.pos.z + Math.sin(a) * flood.predictedRadius,
        ),
      );
    }
    return pts;
  }, [flood.pos.x, flood.pos.z, flood.predictedRadius, flood.waterLevel]);

  return (
    <group>
      {/* Active water disk (rises with waterLevel) */}
      <mesh
        position={[flood.pos.x, flood.waterLevel, flood.pos.z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[flood.radius, 96]} />
        <meshStandardMaterial
          ref={matRef}
          color="#1d4ed8"
          transparent
          opacity={0.62}
          metalness={0.6}
          roughness={0.2}
          emissive="#3b82f6"
          emissiveIntensity={0.2}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Subtle ripple ring */}
      <mesh
        position={[flood.pos.x, flood.waterLevel + 0.05, flood.pos.z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[flood.radius * 0.75, flood.radius, 96]} />
        <meshBasicMaterial color="#93c5fd" transparent opacity={0.25} side={THREE.DoubleSide} />
      </mesh>

      {/* Predicted next-30-min spread */}
      <mesh
        position={[flood.pos.x, 0.4, flood.pos.z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[flood.radius, flood.predictedRadius, 96]} />
        <meshBasicMaterial color="#3b82f6" transparent opacity={0.16} side={THREE.DoubleSide} />
      </mesh>
      <line>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[
              new Float32Array(predPoints.flatMap((p) => [p.x, p.y, p.z])),
              3,
            ]}
          />
        </bufferGeometry>
        <lineDashedMaterial color="#93c5fd" dashSize={5} gapSize={3} />
      </line>
    </group>
  );
}

/* ------------------------------ SURGE ------------------------------ */

function SurgeSystem({
  surge,
  routes,
}: {
  surge: NonNullable<SimSnapshot["surge"]>;
  routes: { a: Vec2; b: Vec2 }[];
}) {
  const AGENTS_PER_ROUTE = 30;
  const total = Math.max(1, routes.length * AGENTS_PER_ROUTE);

  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    let i = 0;
    routes.forEach((route, ri) => {
      for (let n = 0; n < AGENTS_PER_ROUTE; n++) {
        const seed = ri * 31 + n * 1.7;
        const speed = 0.06 + (n % 5) * 0.01;
        const offset = n / AGENTS_PER_ROUTE;
        const p = (offset + t * speed) % 1;
        const x = route.a.x + (route.b.x - route.a.x) * p;
        const z = route.a.z + (route.b.z - route.a.z) * p;
        const sway = Math.sin(t * 3 + seed) * 1.2;
        dummy.position.set(x + sway, 1, z + sway);
        dummy.scale.setScalar(0.6 + (n % 3) * 0.15);
        dummy.updateMatrix();
        ref.current!.setMatrixAt(i, dummy.matrix);
        i++;
      }
    });
    ref.current.count = total;
    ref.current.instanceMatrix.needsUpdate = true;
  });

  // Pulsing epicenter ring
  const epiRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!epiRef.current) return;
    const t = clock.getElapsedTime();
    const s = 1 + (Math.sin(t * 2.5) * 0.5 + 0.5) * 0.6;
    epiRef.current.scale.set(s, 1, s);
  });

  return (
    <group>
      {/* Active surge zone */}
      <mesh
        position={[surge.pos.x, 0.4, surge.pos.z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <circleGeometry args={[surge.radius, 64]} />
        <meshBasicMaterial color="#a855f7" transparent opacity={0.22} side={THREE.DoubleSide} />
      </mesh>
      {/* Pulsing ring */}
      <mesh
        ref={epiRef}
        position={[surge.pos.x, 0.5, surge.pos.z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[surge.radius * 0.9, surge.radius, 64]} />
        <meshBasicMaterial color="#d8b4fe" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      {/* Predicted */}
      <mesh
        position={[surge.pos.x, 0.45, surge.pos.z]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <ringGeometry args={[surge.radius, surge.predictedRadius, 64]} />
        <meshBasicMaterial color="#a855f7" transparent opacity={0.13} side={THREE.DoubleSide} />
      </mesh>

      {/* Crowd agents flowing along evac routes */}
      <instancedMesh ref={ref} args={[undefined, undefined, total]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshStandardMaterial color="#34d399" emissive="#34d399" emissiveIntensity={0.6} />
      </instancedMesh>
    </group>
  );
}

/* ----------------------------- evac arrows ----------------------------- */

function EvacuationArrows({ routes }: { routes: { a: Vec2; b: Vec2 }[] }) {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.children.forEach((c, i) => {
      (c as THREE.Mesh).position.y = 0.6 + Math.sin(t * 2 + i) * 0.2;
    });
  });
  return (
    <group ref={groupRef}>
      {routes.map((r, i) => {
        const dx = r.b.x - r.a.x;
        const dz = r.b.z - r.a.z;
        const len = Math.sqrt(dx * dx + dz * dz);
        const cx = (r.a.x + r.b.x) / 2;
        const cz = (r.a.z + r.b.z) / 2;
        const angle = Math.atan2(dz, dx);
        return (
          <mesh
            key={i}
            position={[cx, 0.6, cz]}
            rotation={[-Math.PI / 2, 0, -angle]}
          >
            <planeGeometry args={[len * 0.95, 2.5]} />
            <meshBasicMaterial
              color="#22c55e"
              transparent
              opacity={0.55}
              side={THREE.DoubleSide}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/* ------------------------- FIRE TRUCKS (dispatch + spray) ------------------------- */

type TruckPath = {
  station: Vec2;
  fire: Vec2;
  // detour waypoint so the truck follows roads (Manhattan path)
  via: Vec2;
  totalLen: number;
  // per-truck phase offset so they don't overlap
  phase: number;
};

function FireTrucks({
  fire,
  stations,
  playSec,
}: {
  fire: NonNullable<SimSnapshot["fire"]>;
  stations: Building[];
  playSec: number;
}) {
  // Build a path per station — Manhattan route via an L-bend so it follows the grid.
  const paths = useMemo<TruckPath[]>(() => {
    return stations.map((s, i) => {
      const via: Vec2 = { x: fire.pos.x, z: s.pos.z };
      const seg1 = Math.abs(via.x - s.pos.x) + Math.abs(via.z - s.pos.z);
      const seg2 = Math.abs(fire.pos.x - via.x) + Math.abs(fire.pos.z - via.z);
      return {
        station: s.pos,
        fire: fire.pos,
        via,
        totalLen: seg1 + seg2,
        phase: i * 0.6,
      };
    });
  }, [stations, fire.pos.x, fire.pos.z]);

  // Each truck takes ~12 seconds to drive there, then sprays for 6 sec, then idles.
  const DRIVE_DURATION = 12;
  const SPRAY_DURATION = 8;
  const TOTAL = DRIVE_DURATION + SPRAY_DURATION;

  // Spray particles (instanced)
  const sprayRef = useRef<THREE.InstancedMesh>(null);
  const SPRAY_PER_TRUCK = 14;
  const sprayTotal = Math.max(1, paths.length * SPRAY_PER_TRUCK);
  const sprayDummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    if (!sprayRef.current) return;
    const t = clock.getElapsedTime();
    let i = 0;
    paths.forEach((p, pi) => {
      const local = Math.max(0, playSec - p.phase);
      const driving = local < DRIVE_DURATION;
      if (driving) {
        // hide sprays during drive — push offscreen
        for (let n = 0; n < SPRAY_PER_TRUCK; n++) {
          sprayDummy.position.set(0, -200, 0);
          sprayDummy.scale.setScalar(0.001);
          sprayDummy.updateMatrix();
          sprayRef.current!.setMatrixAt(i, sprayDummy.matrix);
          i++;
        }
        return;
      }
      // truck has parked near fire — spray water in arc toward epicenter
      const sprayElapsed = local - DRIVE_DURATION;
      const sprayActive = sprayElapsed < SPRAY_DURATION;
      // Park position: just outside the fire radius along the path
      const dx = p.fire.x - p.via.x;
      const dz = p.fire.z - p.via.z;
      const segLen = Math.max(1, Math.sqrt(dx * dx + dz * dz));
      const parkDist = Math.max(8, fire.radius * 0.85);
      const parkRatio = Math.max(0, 1 - parkDist / segLen);
      const px = p.via.x + dx * parkRatio;
      const pz = p.via.z + dz * parkRatio;

      for (let n = 0; n < SPRAY_PER_TRUCK; n++) {
        if (!sprayActive) {
          sprayDummy.position.set(0, -200, 0);
          sprayDummy.scale.setScalar(0.001);
        } else {
          // arc particle — life cycles
          const seed = pi * 11 + n;
          const life = ((t * 1.6 + seed * 0.31) % 1);
          // arc from truck nozzle (height 3) to fire epicenter
          const ax = px + (p.fire.x - px) * life;
          const az = pz + (p.fire.z - pz) * life;
          const ay = 3 + Math.sin(life * Math.PI) * 8 - life * 0.5;
          sprayDummy.position.set(ax, ay, az);
          sprayDummy.scale.setScalar(0.6 + (1 - life) * 1.2);
        }
        sprayDummy.updateMatrix();
        sprayRef.current!.setMatrixAt(i, sprayDummy.matrix);
        i++;
      }
    });
    sprayRef.current.count = sprayTotal;
    sprayRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      {paths.map((p, i) => (
        <FireTruck
          key={i}
          path={p}
          driveDuration={DRIVE_DURATION}
          totalDuration={TOTAL}
          playSec={playSec}
          fireRadius={fire.radius}
        />
      ))}

      {/* Water spray particles */}
      <instancedMesh ref={sprayRef} args={[undefined, undefined, sprayTotal]}>
        <sphereGeometry args={[0.7, 8, 8]} />
        <meshBasicMaterial
          color="#7dd3fc"
          transparent
          opacity={0.85}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </instancedMesh>
    </group>
  );
}

function FireTruck({
  path,
  driveDuration,
  totalDuration,
  playSec,
  fireRadius,
}: {
  path: TruckPath;
  driveDuration: number;
  totalDuration: number;
  playSec: number;
  fireRadius: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const beaconRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();

    const local = Math.max(0, playSec - path.phase) % (totalDuration + 4); // small idle gap
    let x: number;
    let z: number;
    let yaw = 0;

    if (local < driveDuration) {
      // animate along Manhattan path: station -> via -> (parkDist before fire)
      const ratio = local / driveDuration;
      const seg1Len = Math.abs(path.via.x - path.station.x) + Math.abs(path.via.z - path.station.z);
      const dx = path.fire.x - path.via.x;
      const dz = path.fire.z - path.via.z;
      const segLen2Full = Math.max(1, Math.sqrt(dx * dx + dz * dz));
      const parkDist = Math.max(8, fireRadius * 0.85);
      const parkRatio = Math.max(0, 1 - parkDist / segLen2Full);
      const seg2Len = segLen2Full * parkRatio;
      const total = seg1Len + seg2Len;
      const traveled = ratio * total;

      if (traveled < seg1Len) {
        const r = traveled / Math.max(1, seg1Len);
        x = path.station.x + (path.via.x - path.station.x) * r;
        z = path.station.z + (path.via.z - path.station.z) * r;
        yaw = Math.atan2(path.via.z - path.station.z, path.via.x - path.station.x);
      } else {
        const r = (traveled - seg1Len) / Math.max(1, seg2Len);
        const px = path.via.x + dx * parkRatio;
        const pz = path.via.z + dz * parkRatio;
        x = path.via.x + (px - path.via.x) * r;
        z = path.via.z + (pz - path.via.z) * r;
        yaw = Math.atan2(dz, dx);
      }
    } else {
      // parked
      const dx = path.fire.x - path.via.x;
      const dz = path.fire.z - path.via.z;
      const segLen2Full = Math.max(1, Math.sqrt(dx * dx + dz * dz));
      const parkDist = Math.max(8, fireRadius * 0.85);
      const parkRatio = Math.max(0, 1 - parkDist / segLen2Full);
      x = path.via.x + dx * parkRatio;
      z = path.via.z + dz * parkRatio;
      yaw = Math.atan2(dz, dx);
    }

    ref.current.position.set(x, 1.4, z);
    ref.current.rotation.y = -yaw;

    if (beaconRef.current) {
      beaconRef.current.intensity = 1.5 + Math.sin(t * 14) * 1.2;
    }
  });

  return (
    <group ref={ref}>
      {/* Cab */}
      <mesh castShadow position={[1.6, 0.3, 0]}>
        <boxGeometry args={[2.4, 2.2, 2.4]} />
        <meshStandardMaterial color="#dc2626" metalness={0.4} roughness={0.45} />
      </mesh>
      {/* Windshield */}
      <mesh position={[2.6, 0.7, 0]}>
        <boxGeometry args={[0.4, 1.2, 2.0]} />
        <meshStandardMaterial color="#0ea5e9" metalness={0.6} roughness={0.2} emissive="#0ea5e9" emissiveIntensity={0.2} />
      </mesh>
      {/* Tank body */}
      <mesh castShadow position={[-1.2, 0.4, 0]}>
        <boxGeometry args={[3.6, 2.4, 2.4]} />
        <meshStandardMaterial color="#b91c1c" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* Yellow safety stripe */}
      <mesh position={[-1.2, -0.2, 1.21]}>
        <planeGeometry args={[3.6, 0.4]} />
        <meshBasicMaterial color="#fde047" />
      </mesh>
      <mesh position={[-1.2, -0.2, -1.21]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[3.6, 0.4]} />
        <meshBasicMaterial color="#fde047" />
      </mesh>
      {/* Hose / nozzle pointing forward */}
      <mesh position={[3.0, 1.0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.18, 0.18, 1.2, 8]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      {/* Roof beacon */}
      <mesh position={[1.6, 1.7, 0]}>
        <boxGeometry args={[1.4, 0.35, 1.6]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      <mesh position={[1.6, 1.95, 0.5]}>
        <sphereGeometry args={[0.25, 10, 10]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      <mesh position={[1.6, 1.95, -0.5]}>
        <sphereGeometry args={[0.25, 10, 10]} />
        <meshBasicMaterial color="#3b82f6" />
      </mesh>
      <pointLight ref={beaconRef} position={[1.6, 2.4, 0]} color="#ef4444" intensity={2} distance={30} />
      {/* Wheels */}
      {[
        [2.2, -0.8, 1.3],
        [2.2, -0.8, -1.3],
        [-0.5, -0.8, 1.3],
        [-0.5, -0.8, -1.3],
        [-2.4, -0.8, 1.3],
        [-2.4, -0.8, -1.3],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.55, 0.55, 0.5, 12]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------- FLOOD EXTRAS (rain + boats + debris) ------------------------- */

function RainParticles({
  center,
  radius,
}: {
  center: Vec2;
  radius: number;
}) {
  const COUNT = 600;
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      arr[i * 3] = center.x + Math.cos(a) * r;
      arr[i * 3 + 1] = Math.random() * 80;
      arr[i * 3 + 2] = center.z + Math.sin(a) * r;
    }
    return arr;
  }, [center.x, center.z, radius]);

  useFrame((_, dt) => {
    if (!ref.current) return;
    const pos = ref.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 1] -= 60 * dt;
      if (arr[i * 3 + 1] < 0) {
        arr[i * 3 + 1] = 80;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * radius;
        arr[i * 3] = center.x + Math.cos(a) * r;
        arr[i * 3 + 2] = center.z + Math.sin(a) * r;
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#bae6fd" size={0.8} transparent opacity={0.55} sizeAttenuation />
    </points>
  );
}

function FloodRipples({ center, radius }: { center: Vec2; radius: number }) {
  // Three expanding rings that loop
  const rings = useRef<THREE.Mesh[]>([]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    rings.current.forEach((m, i) => {
      if (!m) return;
      const phase = ((t * 0.25 + i / 3) % 1);
      const s = 0.2 + phase * 1.0;
      m.scale.set(s, s, s);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - phase) * 0.5;
    });
  });
  return (
    <group position={[center.x, 0.2, center.z]}>
      {[0, 1, 2].map((i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) rings.current[i] = el;
          }}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[radius * 0.95, radius, 96]} />
          <meshBasicMaterial color="#bae6fd" transparent opacity={0.4} side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function RescueBoats({
  flood,
}: {
  flood: NonNullable<SimSnapshot["flood"]>;
}) {
  const COUNT = 4;
  const refs = useRef<THREE.Group[]>([]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    refs.current.forEach((g, i) => {
      if (!g) return;
      const seed = i * 1.7;
      const angle = t * 0.18 + seed;
      const r = flood.radius * (0.35 + (i % 3) * 0.18);
      g.position.x = flood.pos.x + Math.cos(angle) * r;
      g.position.z = flood.pos.z + Math.sin(angle) * r;
      g.position.y = flood.waterLevel + Math.sin(t * 2 + seed) * 0.15;
      g.rotation.y = -angle + Math.PI / 2;
    });
  });
  return (
    <>
      {Array.from({ length: COUNT }).map((_, i) => (
        <group
          key={i}
          ref={(el) => {
            if (el) refs.current[i] = el;
          }}
        >
          {/* Hull */}
          <mesh castShadow>
            <boxGeometry args={[5, 0.6, 1.8]} />
            <meshStandardMaterial color="#fb923c" metalness={0.3} roughness={0.5} />
          </mesh>
          {/* Cabin */}
          <mesh position={[-0.6, 0.6, 0]}>
            <boxGeometry args={[1.6, 0.8, 1.4]} />
            <meshStandardMaterial color="#f8fafc" />
          </mesh>
          {/* Light */}
          <pointLight position={[2.2, 1, 0]} color="#fde68a" intensity={0.8} distance={20} />
        </group>
      ))}
    </>
  );
}

function FloodDebris({ flood }: { flood: NonNullable<SimSnapshot["flood"]> }) {
  const COUNT = 30;
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const seeds = useMemo(
    () =>
      Array.from({ length: COUNT }).map(() => ({
        a: Math.random() * Math.PI * 2,
        r: Math.random(),
        s: 0.4 + Math.random() * 0.6,
        spin: (Math.random() - 0.5) * 0.5,
      })),
    [],
  );

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    seeds.forEach((d, i) => {
      const a = d.a + t * 0.12;
      const r = d.r * flood.radius * 0.95;
      const x = flood.pos.x + Math.cos(a) * r;
      const z = flood.pos.z + Math.sin(a) * r;
      dummy.position.set(x, flood.waterLevel + 0.15 + Math.sin(t * 1.5 + i) * 0.1, z);
      dummy.rotation.y = a + t * d.spin;
      dummy.scale.setScalar(d.s);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
    });
    ref.current.count = COUNT;
    ref.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, COUNT]}>
      <boxGeometry args={[2, 0.3, 1]} />
      <meshStandardMaterial color="#3a2418" roughness={0.95} />
    </instancedMesh>
  );
}

/* ------------------------- ember sparks for fire ------------------------- */

function EmberSparks({ fire }: { fire: NonNullable<SimSnapshot["fire"]> }) {
  const COUNT = 200;
  const ref = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * fire.radius * 0.9;
      arr[i * 3] = fire.pos.x + Math.cos(a) * r;
      arr[i * 3 + 1] = Math.random() * 60;
      arr[i * 3 + 2] = fire.pos.z + Math.sin(a) * r;
    }
    return arr;
  }, [fire.pos.x, fire.pos.z, fire.radius]);

  useFrame((_, dt) => {
    if (!ref.current) return;
    const pos = ref.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < COUNT; i++) {
      arr[i * 3 + 1] += (15 + (i % 5) * 4) * dt;
      arr[i * 3] += Math.sin(arr[i * 3 + 1] * 0.05 + i) * 0.05;
      if (arr[i * 3 + 1] > 80) {
        arr[i * 3 + 1] = 0;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * fire.radius * 0.9;
        arr[i * 3] = fire.pos.x + Math.cos(a) * r;
        arr[i * 3 + 2] = fire.pos.z + Math.sin(a) * r;
      }
    }
    pos.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#fb923c" size={1.2} transparent opacity={0.9} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}


function Ground({ size }: { size: number }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[size * 1.6, size * 1.6]} />
        <meshStandardMaterial color="#0a1020" roughness={0.95} />
      </mesh>
      {/* faint grid lines */}
      <gridHelper
        args={[size * 1.6, 60, "#1c2540", "#1c2540"]}
        position={[0, 0.02, 0]}
      />
    </>
  );
}

function CampusOverlay({
  bounds,
}: {
  bounds: { x: number; z: number; w: number; d: number };
}) {
  const cx = bounds.x + bounds.w / 2;
  const cz = bounds.z + bounds.d / 2;
  return (
    <group>
      <mesh position={[cx, 0.06, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[bounds.w, bounds.d]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.06} side={THREE.DoubleSide} />
      </mesh>
      {/* dashed border */}
      <mesh position={[cx, 0.07, cz]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[Math.max(bounds.w, bounds.d) * 0.49, Math.max(bounds.w, bounds.d) * 0.5, 4]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.4} />
      </mesh>
    </group>
  );
}

/* ------------------------- TRAFFIC LIGHTS ------------------------- */

function TrafficLights({
  city,
  signalTiming,
}: {
  city: CityModel;
  signalTiming: number;
}) {
  // Subset of intersections — every other one — to keep performance reasonable
  const sample = useMemo(
    () => city.intersections.filter((_, i) => i % 4 === 0),
    [city.intersections],
  );
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const colorObj = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime() * (1 / signalTiming);
    sample.forEach((i, idx) => {
      const phase = (t * 0.5 + idx * 0.3) % 1;
      const isGreen = phase < 0.5;
      const isYellow = phase >= 0.45 && phase < 0.55;
      colorObj.set(isYellow ? "#facc15" : isGreen ? "#22c55e" : "#ef4444");
      dummy.position.set(i.pos.x + 4, 5, i.pos.z + 4);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(idx, dummy.matrix);
      meshRef.current!.setColorAt(idx, colorObj);
    });
    meshRef.current.count = sample.length;
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, sample.length]}>
      <sphereGeometry args={[0.6, 8, 8]} />
      <meshBasicMaterial />
    </instancedMesh>
  );
}

/* ------------------------- HELICOPTER ------------------------- */

function Helicopter({ target }: { target: Vec2 }) {
  const ref = useRef<THREE.Group>(null);
  const rotorRef = useRef<THREE.Mesh>(null);
  const tailRotorRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.SpotLight>(null);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const orbitR = 80;
    const speed = 0.4;
    const x = target.x + Math.cos(t * speed) * orbitR;
    const z = target.z + Math.sin(t * speed) * orbitR;
    const y = 70 + Math.sin(t * 1.2) * 3;
    ref.current.position.set(x, y, z);
    // face direction of motion
    const yaw = Math.atan2(
      Math.cos(t * speed),
      -Math.sin(t * speed),
    );
    ref.current.rotation.y = yaw;

    if (rotorRef.current) rotorRef.current.rotation.y = t * 30;
    if (tailRotorRef.current) tailRotorRef.current.rotation.x = t * 40;

    if (lightRef.current) {
      lightRef.current.target.position.set(target.x, 0, target.z);
      lightRef.current.target.updateMatrixWorld();
    }
  });

  return (
    <group ref={ref}>
      {/* Body */}
      <mesh castShadow>
        <capsuleGeometry args={[1.6, 4, 6, 12]} />
        <meshStandardMaterial color="#1f2937" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Cockpit glass */}
      <mesh position={[0, 0.4, 2.6]}>
        <sphereGeometry args={[1.4, 12, 12]} />
        <meshStandardMaterial
          color="#0ea5e9"
          metalness={0.7}
          roughness={0.15}
          transparent
          opacity={0.6}
          emissive="#0ea5e9"
          emissiveIntensity={0.3}
        />
      </mesh>
      {/* Tail boom */}
      <mesh position={[0, 0, -3]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 4, 8]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      {/* Tail fin */}
      <mesh position={[0, 0.6, -5]}>
        <boxGeometry args={[0.2, 1.4, 1.2]} />
        <meshStandardMaterial color="#374151" />
      </mesh>
      {/* Skids */}
      <mesh position={[0, -1.6, 0]}>
        <boxGeometry args={[3.2, 0.1, 4]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      {/* Main rotor */}
      <group position={[0, 1.4, 0]}>
        <mesh ref={rotorRef}>
          <boxGeometry args={[12, 0.08, 0.4]} />
          <meshStandardMaterial color="#0f172a" transparent opacity={0.7} />
        </mesh>
      </group>
      {/* Tail rotor */}
      <group position={[0.5, 0.6, -5.2]}>
        <mesh ref={tailRotorRef}>
          <boxGeometry args={[0.05, 0.08, 1.6]} />
          <meshStandardMaterial color="#0f172a" transparent opacity={0.7} />
        </mesh>
      </group>
      {/* Beacon */}
      <mesh position={[0, -1.7, 0]}>
        <sphereGeometry args={[0.18, 8, 8]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>
      {/* Search light cone */}
      <spotLight
        ref={lightRef}
        position={[0, -1, 1]}
        color="#fef9c3"
        intensity={3}
        angle={0.3}
        penumbra={0.4}
        distance={120}
        castShadow={false}
      />
    </group>
  );
}

/* ------------------------- CAMERA RIG (smooth fly-to + cinematic flythroughs) ------------------------- */

type Keyframe = { pos: THREE.Vector3; look: THREE.Vector3; duration: number };

// Smooth easeInOutCubic
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function buildFlythroughKeyframes(
  kind: NonNullable<FlythroughKind>,
  citySize: number,
  focus: Vec2,
): Keyframe[] {
  const c = citySize;
  if (kind === "arrival") {
    // High wide arc, swooping down toward city center
    return [
      { pos: new THREE.Vector3(c * 1.3, c * 1.1, c * 1.3), look: new THREE.Vector3(0, 0, 0), duration: 0 },
      { pos: new THREE.Vector3(c * 0.9, c * 0.7, c * 0.4), look: new THREE.Vector3(0, 30, 0), duration: 4 },
      { pos: new THREE.Vector3(c * 0.4, c * 0.35, -c * 0.2), look: new THREE.Vector3(0, 20, 0), duration: 4.5 },
      { pos: new THREE.Vector3(0, c * 0.55, c * 0.6), look: new THREE.Vector3(0, 0, 0), duration: 4 },
    ];
  }
  if (kind === "overview") {
    // Slow orbit around the center
    const r = c * 0.85;
    const h = c * 0.65;
    const ring: Keyframe[] = [];
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ring.push({
        pos: new THREE.Vector3(Math.cos(a) * r, h, Math.sin(a) * r),
        look: new THREE.Vector3(0, 20, 0),
        duration: i === 0 ? 0 : 3.2,
      });
    }
    return ring;
  }
  // crisis close-up: dive from sky down to street level circling the focus
  const fx = focus.x;
  const fz = focus.z;
  return [
    { pos: new THREE.Vector3(fx + 220, 280, fz + 220), look: new THREE.Vector3(fx, 0, fz), duration: 0 },
    { pos: new THREE.Vector3(fx + 140, 160, fz + 140), look: new THREE.Vector3(fx, 10, fz), duration: 3.0 },
    { pos: new THREE.Vector3(fx - 90, 70, fz + 110), look: new THREE.Vector3(fx, 5, fz), duration: 3.5 },
    { pos: new THREE.Vector3(fx - 50, 28, fz - 60), look: new THREE.Vector3(fx, 4, fz), duration: 3.0 },
    { pos: new THREE.Vector3(fx + 80, 45, fz - 90), look: new THREE.Vector3(fx, 6, fz), duration: 3.2 },
  ];
}

function CameraRig({
  flyTo,
  flythrough,
  citySize,
}: {
  flyTo: Props["flyTo"];
  flythrough: Props["flythrough"];
  citySize: number;
}) {
  const { camera } = useThree();
  const targetRef = useRef<THREE.Vector3 | null>(null);
  const cameraTargetRef = useRef<THREE.Vector3 | null>(null);

  // Cinematic keyframe playback
  const flyKeyframesRef = useRef<Keyframe[] | null>(null);
  const flyStartTimeRef = useRef<number>(0);
  const flyIndexRef = useRef<number>(0);
  const flyLookRef = useRef<THREE.Vector3>(new THREE.Vector3());

  useEffect(() => {
    if (!flyTo) return;
    // Cancel any in-flight cinematic on direct fly-to
    flyKeyframesRef.current = null;
    const preset = flyTo.preset ?? "tactical";
    const lookAt = new THREE.Vector3(flyTo.x, 0, flyTo.z);
    let cam: THREE.Vector3;
    if (preset === "overview") {
      cam = new THREE.Vector3(citySize * 0.7, citySize * 0.7, citySize * 0.7);
      lookAt.set(0, 0, 0);
    } else if (preset === "street") {
      cam = new THREE.Vector3(flyTo.x + 50, 35, flyTo.z + 50);
    } else {
      cam = new THREE.Vector3(flyTo.x + 180, 220, flyTo.z + 180);
    }
    targetRef.current = lookAt;
    cameraTargetRef.current = cam;
  }, [flyTo, citySize]);

  useEffect(() => {
    if (!flythrough || !flythrough.kind) return;
    const focus = flythrough.focus ?? { x: 0, z: 0 };
    flyKeyframesRef.current = buildFlythroughKeyframes(flythrough.kind, citySize, focus);
    flyStartTimeRef.current = performance.now() / 1000;
    flyIndexRef.current = 0;
    // Cancel direct flyTo so they don't fight
    cameraTargetRef.current = null;
    targetRef.current = null;
  }, [flythrough, citySize]);

  useFrame(() => {
    // Cinematic playback wins
    const kf = flyKeyframesRef.current;
    if (kf && kf.length > 1) {
      const now = performance.now() / 1000;
      const elapsed = now - flyStartTimeRef.current;
      // Find current segment
      let acc = 0;
      let segIdx = 0;
      for (let i = 1; i < kf.length; i++) {
        if (elapsed < acc + kf[i].duration) {
          segIdx = i;
          break;
        }
        acc += kf[i].duration;
        segIdx = i;
      }
      const seg = kf[segIdx];
      const prev = kf[segIdx - 1] ?? kf[0];
      const localT = Math.max(0, Math.min(1, (elapsed - acc) / Math.max(0.001, seg.duration)));
      const eased = easeInOutCubic(localT);
      camera.position.lerpVectors(prev.pos, seg.pos, eased);
      flyLookRef.current.lerpVectors(prev.look, seg.look, eased);
      camera.lookAt(flyLookRef.current);

      // End of sequence
      const totalDur = kf.reduce((s, k) => s + k.duration, 0);
      if (elapsed > totalDur) {
        flyKeyframesRef.current = null;
      }
      return;
    }

    if (!cameraTargetRef.current || !targetRef.current) return;
    camera.position.lerp(cameraTargetRef.current, 0.04);
    const dist = camera.position.distanceTo(cameraTargetRef.current);
    if (dist < 4) {
      cameraTargetRef.current = null;
      targetRef.current = null;
    }
  });

  return null;
}

/* ------------------------- ADAPTIVE QUALITY (FPS scaler) ------------------------- */

function AdaptiveQuality({
  onChange,
}: {
  onChange?: (tier: "high" | "medium" | "low") => void;
}) {
  const { gl } = useThree();
  const samplesRef = useRef<number[]>([]);
  const tierRef = useRef<"high" | "medium" | "low">("high");
  const lastChangeRef = useRef<number>(0);

  useFrame((_, dt) => {
    const fps = 1 / Math.max(0.001, dt);
    const buf = samplesRef.current;
    buf.push(fps);
    if (buf.length > 60) buf.shift();
    if (buf.length < 30) return;
    const now = performance.now();
    if (now - lastChangeRef.current < 2500) return;
    const avg = buf.reduce((s, x) => s + x, 0) / buf.length;

    let next: "high" | "medium" | "low" = tierRef.current;
    if (avg < 28 && tierRef.current !== "low") next = "low";
    else if (avg < 45 && tierRef.current === "high") next = "medium";
    else if (avg > 55 && tierRef.current === "low") next = "medium";
    else if (avg > 58 && tierRef.current === "medium") next = "high";

    if (next !== tierRef.current) {
      tierRef.current = next;
      lastChangeRef.current = now;
      // Apply DPR change
      const dpr = next === "high" ? Math.min(window.devicePixelRatio, 1.5) : next === "medium" ? 1 : 0.75;
      gl.setPixelRatio(dpr);
      onChange?.(next);
    }
  });
  return null;
}

/* ------------------------- VOLUMETRIC SMOKE ------------------------- */

function VolumetricSmoke({ center, radius }: { center: Vec2; radius: number }) {
  const COUNT = 38;
  const refs = useRef<THREE.Mesh[]>([]);
  const seeds = useMemo(() => {
    return Array.from({ length: COUNT }, (_, i) => ({
      a: Math.random() * Math.PI * 2,
      r: Math.random() * radius * 0.85,
      ySpeed: 4 + Math.random() * 6,
      scale: 8 + Math.random() * 14,
      phase: Math.random() * Math.PI * 2,
      yMax: 60 + Math.random() * 40,
    }));
  }, [radius]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    refs.current.forEach((m, i) => {
      if (!m) return;
      const s = seeds[i];
      const y = ((t * s.ySpeed + s.phase * 5) % s.yMax);
      m.position.y = 6 + y;
      const drift = Math.sin(t * 0.3 + s.phase) * (radius * 0.15);
      m.position.x = center.x + Math.cos(s.a) * s.r + drift;
      m.position.z = center.z + Math.sin(s.a) * s.r;
      const lifeT = y / s.yMax; // 0..1
      const scale = s.scale * (1 + lifeT * 1.6);
      m.scale.setScalar(scale);
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.55 * (1 - lifeT) * (lifeT < 0.1 ? lifeT / 0.1 : 1);
    });
  });

  return (
    <group>
      {seeds.map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) refs.current[i] = el;
          }}
        >
          <sphereGeometry args={[1, 8, 6]} />
          <meshBasicMaterial color="#1a0e08" transparent opacity={0.5} depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------- LIGHTNING FLASHES ------------------------- */

function LightningFlash({
  active,
  color = "#cfe2ff",
  intervalRange = [3, 7],
}: {
  active: boolean;
  color?: string;
  intervalRange?: [number, number];
}) {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const sheetRef = useRef<THREE.Mesh>(null);
  const nextStrikeRef = useRef<number>(0);
  const flashTRef = useRef<number>(-1);

  useFrame(({ clock }) => {
    if (!active) {
      if (lightRef.current) lightRef.current.intensity = 0;
      if (sheetRef.current) (sheetRef.current.material as THREE.MeshBasicMaterial).opacity = 0;
      return;
    }
    const now = clock.getElapsedTime();
    if (now > nextStrikeRef.current) {
      flashTRef.current = now;
      nextStrikeRef.current =
        now + intervalRange[0] + Math.random() * (intervalRange[1] - intervalRange[0]);
    }
    const dt = now - flashTRef.current;
    // Strike: short bright burst, then quick re-flash, then decay
    let intensity = 0;
    if (dt >= 0 && dt < 0.08) intensity = 4.5;
    else if (dt >= 0.08 && dt < 0.16) intensity = 1.2;
    else if (dt >= 0.16 && dt < 0.26) intensity = 3.0;
    else if (dt >= 0.26 && dt < 0.6) intensity = 1.4 * Math.max(0, 1 - (dt - 0.26) / 0.34);

    if (lightRef.current) lightRef.current.intensity = intensity;
    if (sheetRef.current) {
      (sheetRef.current.material as THREE.MeshBasicMaterial).opacity = Math.min(0.55, intensity * 0.12);
    }
  });

  return (
    <group>
      <directionalLight ref={lightRef} position={[200, 800, -200]} color={color} intensity={0} />
      {/* Sky sheet that brightens with the strike */}
      <mesh ref={sheetRef} position={[0, 900, 0]} frustumCulled={false}>
        <planeGeometry args={[6000, 6000]} />
        <meshBasicMaterial color={color} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}



function CrisisCameraFX({ snapshot }: { snapshot: SimSnapshot }) {
  const { camera } = useThree();
  const base = useRef({ x: 0, y: 0, z: 0 });
  useEffect(() => {
    base.current = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  }, [camera]);
  useFrame(({ clock }) => {
    if (snapshot.crisis === "none") return;
    const t = clock.getElapsedTime();
    const intensity =
      snapshot.crisis === "fire" ? 0.4 : snapshot.crisis === "surge" ? 0.25 : 0.15;
    camera.position.x += Math.sin(t * 25) * intensity * 0.05;
    camera.position.y += Math.cos(t * 23) * intensity * 0.05;
  });
  return null;
}

/* ------------------------- POLICE + AMBULANCE ESCORT ------------------------- */

function EmergencyEscort({
  fire,
  stations,
  playSec,
}: {
  fire: NonNullable<SimSnapshot["fire"]>;
  stations: Building[];
  playSec: number;
}) {
  // For each station, dispatch an ambulance + police following the fire truck path
  const paths = useMemo(() => {
    return stations.slice(0, 2).map((s, i) => {
      const via: Vec2 = { x: fire.pos.x, z: s.pos.z };
      return { station: s.pos, via, fire: fire.pos, phase: i * 0.5 };
    });
  }, [stations, fire.pos.x, fire.pos.z]);

  return (
    <group>
      {paths.map((p, i) => (
        <EscortVehicle key={`amb-${i}`} kind="ambulance" path={p} playSec={playSec} fireRadius={fire.radius} delay={2 + i * 0.4} />
      ))}
      {paths.map((p, i) => (
        <EscortVehicle key={`pol-${i}`} kind="police" path={p} playSec={playSec} fireRadius={fire.radius} delay={0.4 + i * 0.4} />
      ))}
    </group>
  );
}

function EscortVehicle({
  kind,
  path,
  playSec,
  fireRadius,
  delay,
}: {
  kind: "ambulance" | "police";
  path: { station: Vec2; via: Vec2; fire: Vec2; phase: number };
  playSec: number;
  fireRadius: number;
  delay: number;
}) {
  const ref = useRef<THREE.Group>(null);
  const beaconA = useRef<THREE.Mesh>(null);
  const beaconB = useRef<THREE.Mesh>(null);
  const DRIVE = 14;

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    const local = Math.max(0, playSec - path.phase - delay);
    const ratio = Math.min(1, local / DRIVE);
    const seg1Len = Math.abs(path.via.x - path.station.x) + Math.abs(path.via.z - path.station.z);
    const dx = path.fire.x - path.via.x;
    const dz = path.fire.z - path.via.z;
    const segLen2Full = Math.max(1, Math.sqrt(dx * dx + dz * dz));
    const parkDist = Math.max(8, fireRadius * 0.95);
    const parkRatio = Math.max(0, 1 - parkDist / segLen2Full);
    const seg2Len = segLen2Full * parkRatio;
    const total = seg1Len + seg2Len;
    const traveled = ratio * total;
    let x: number;
    let z: number;
    let yaw: number;
    if (traveled < seg1Len) {
      const r = traveled / Math.max(1, seg1Len);
      x = path.station.x + (path.via.x - path.station.x) * r;
      z = path.station.z + (path.via.z - path.station.z) * r;
      yaw = Math.atan2(path.via.z - path.station.z, path.via.x - path.station.x);
    } else {
      const r = (traveled - seg1Len) / Math.max(1, seg2Len);
      const px = path.via.x + dx * parkRatio;
      const pz = path.via.z + dz * parkRatio;
      x = path.via.x + (px - path.via.x) * r;
      z = path.via.z + (pz - path.via.z) * r;
      yaw = Math.atan2(dz, dx);
    }
    ref.current.position.set(x, 1.2, z);
    ref.current.rotation.y = -yaw;
    // alternating beacons
    const flash = Math.sin(t * 18) > 0;
    if (beaconA.current && beaconB.current) {
      (beaconA.current.material as THREE.MeshBasicMaterial).opacity = flash ? 1 : 0.2;
      (beaconB.current.material as THREE.MeshBasicMaterial).opacity = flash ? 0.2 : 1;
    }
  });

  const isAmb = kind === "ambulance";
  const bodyColor = isAmb ? "#f8fafc" : "#0f172a";
  const trimColor = isAmb ? "#dc2626" : "#1e40af";
  return (
    <group ref={ref}>
      {/* Cab */}
      <mesh castShadow position={[1.0, 0, 0]}>
        <boxGeometry args={[1.8, 1.6, 1.8]} />
        <meshStandardMaterial color={bodyColor} metalness={0.5} roughness={0.35} />
      </mesh>
      <mesh position={[1.7, 0.4, 0]}>
        <boxGeometry args={[0.4, 1.0, 1.55]} />
        <meshStandardMaterial color="#0ea5e9" metalness={0.6} roughness={0.2} emissive="#0ea5e9" emissiveIntensity={0.2} />
      </mesh>
      {/* Body */}
      <mesh castShadow position={[-1.0, 0.1, 0]}>
        <boxGeometry args={[2.6, 1.8, 1.8]} />
        <meshStandardMaterial color={bodyColor} metalness={0.5} roughness={0.35} />
      </mesh>
      {/* Trim stripe */}
      <mesh position={[-0.2, -0.2, 0.91]}>
        <planeGeometry args={[3.6, 0.45]} />
        <meshBasicMaterial color={trimColor} />
      </mesh>
      <mesh position={[-0.2, -0.2, -0.91]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[3.6, 0.45]} />
        <meshBasicMaterial color={trimColor} />
      </mesh>
      {/* Cross / star symbol */}
      {isAmb && (
        <mesh position={[-1.0, 0.4, 0.92]}>
          <planeGeometry args={[0.7, 0.7]} />
          <meshBasicMaterial color="#dc2626" />
        </mesh>
      )}
      {/* Beacon bar */}
      <mesh position={[1.0, 1.05, 0]}>
        <boxGeometry args={[1.2, 0.25, 1.5]} />
        <meshStandardMaterial color="#1f2937" />
      </mesh>
      <mesh ref={beaconA} position={[1.0, 1.25, 0.45]}>
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshBasicMaterial color={isAmb ? "#ef4444" : "#3b82f6"} transparent opacity={1} />
      </mesh>
      <mesh ref={beaconB} position={[1.0, 1.25, -0.45]}>
        <sphereGeometry args={[0.22, 8, 8]} />
        <meshBasicMaterial color={isAmb ? "#3b82f6" : "#ef4444"} transparent opacity={1} />
      </mesh>
      <pointLight position={[1.0, 1.5, 0]} color={isAmb ? "#ef4444" : "#3b82f6"} intensity={1.4} distance={20} />
      {/* Wheels */}
      {[
        [1.6, -0.7, 1.0],
        [1.6, -0.7, -1.0],
        [-1.6, -0.7, 1.0],
        [-1.6, -0.7, -1.0],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.42, 0.42, 0.4, 10]} />
          <meshStandardMaterial color="#1f2937" />
        </mesh>
      ))}
    </group>
  );
}

/* ===================================== SKY DOME ===================================== */

/**
 * Procedural sky dome — vertical gradient (zenith → horizon) on a back-faced
 * sphere, plus a sun or moon disc. Cheaper than @react-three/sky and more
 * controllable for our crisis tinting.
 */
function SkyDome({
  hour,
  crisis,
}: {
  hour: number;
  crisis: SimSnapshot["crisis"];
}) {
  const isNight = hour < 6.5 || hour > 19;
  const isDawnDusk = (hour >= 5.5 && hour < 7.5) || (hour >= 18 && hour < 20);

  // Pick gradient stops based on time + crisis
  const { top, bottom, sun } = useMemo(() => {
    let top = "#1b3a72";
    let bottom = "#9bb6d4";
    let sun = "#ffe9b3";
    if (isNight) {
      top = "#030616";
      bottom = "#0b1a36";
      sun = "#dde6f5"; // moon
    } else if (isDawnDusk) {
      top = "#2a2858";
      bottom = "#ffb27a";
      sun = "#ffd28a";
    }
    if (crisis === "fire") {
      top = isNight ? "#1a0606" : "#3a1208";
      bottom = "#a83a18";
      sun = "#ff8a4a";
    } else if (crisis === "flood") {
      top = isNight ? "#04070f" : "#162236";
      bottom = "#3a4a66";
      sun = "#aac4d6";
    }
    return { top, bottom, sun };
  }, [isNight, isDawnDusk, crisis]);

  // Gradient shader: lerp top→bottom by world Y on the dome.
  const skyMat = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(top) },
        bottomColor: { value: new THREE.Color(bottom) },
        offset: { value: 0.0 },
        exponent: { value: 0.7 },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPos;
        void main() {
          float h = normalize(vWorldPos + vec3(0.0, offset, 0.0)).y;
          float t = pow(max(h, 0.0), exponent);
          gl_FragColor = vec4(mix(bottomColor, topColor, t), 1.0);
        }
      `,
    });
    return mat;
  }, []);

  // Update colors live without rebuilding the material
  useEffect(() => {
    (skyMat.uniforms.topColor.value as THREE.Color).set(top);
    (skyMat.uniforms.bottomColor.value as THREE.Color).set(bottom);
  }, [top, bottom, skyMat]);

  // Sun/moon position — slow arc across the sky based on hour
  const sunPos = useMemo<[number, number, number]>(() => {
    const t = ((hour - 6) / 12) * Math.PI; // 0 at sunrise, π at sunset
    const r = 2200;
    const x = Math.cos(t) * r;
    const y = Math.max(60, Math.sin(t) * r * 0.6);
    const z = -r * 0.3;
    return [x, y, z];
  }, [hour]);

  return (
    <group>
      {/* gradient dome — large enough to sit beyond the fog far plane */}
      <mesh frustumCulled={false}>
        <sphereGeometry args={[3000, 24, 16]} />
        <primitive object={skyMat} attach="material" />
      </mesh>
      {/* sun / moon disc */}
      <mesh position={sunPos}>
        <sphereGeometry args={[isNight ? 70 : 90, 16, 12]} />
        <meshBasicMaterial color={sun} toneMapped={false} />
      </mesh>
      {/* soft halo */}
      <mesh position={sunPos}>
        <sphereGeometry args={[isNight ? 140 : 220, 16, 12]} />
        <meshBasicMaterial color={sun} transparent opacity={0.15} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ===================================== SCENE ===================================== */

export function CityScene(props: Props) {
  const {
    city,
    snapshot,
    closedRoadIds,
    onToggleRoad,
    hoveredRoadId,
    setHoveredRoadId,
    crisisPlaySeconds,
    flyTo,
    flythrough,
    onQualityChange,
  } = props;
  const [quality, setQuality] = useState<"high" | "medium" | "low">("high");
  const isNight = snapshot.hour < 6.5 || snapshot.hour > 19;
  const signalTiming = 1;

  // (sky/fog colors are computed below per-frame)

  // Fog tint matches the horizon for a seamless blend with the sky dome.
  let fogColor = isNight ? "#0b1a36" : "#9bb6d4";
  if (snapshot.crisis === "fire") fogColor = "#a83a18";
  else if (snapshot.crisis === "flood") fogColor = "#3a4a66";

  return (
    <Canvas
      shadows={quality !== "low"}
      dpr={quality === "high" ? [1, 1.5] : quality === "medium" ? [1, 1] : [0.75, 1]}
      camera={{ position: [620, 520, 620], fov: 45, near: 1, far: 6500 }}
      gl={{
        antialias: quality !== "low",
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
        powerPreference: "high-performance",
      }}
    >
      <fog attach="fog" args={[fogColor, 1200, 3200]} />

      {/* Procedural gradient sky + sun/moon */}
      <SkyDome hour={snapshot.hour} crisis={snapshot.crisis} />

      {/* Stars at night — sit inside the sky dome */}
      {isNight && quality !== "low" && (
        <Stars
          radius={2400}
          depth={600}
          count={quality === "high" ? 1400 : 700}
          factor={6}
          fade
          speed={0.4}
        />
      )}

      <ambientLight intensity={isNight ? 0.28 : 0.55} />
      <hemisphereLight args={["#7090b0", "#0a0e1a", isNight ? 0.3 : 0.55]} />
      <directionalLight
        position={[480, 780, 320]}
        intensity={isNight ? 0.35 : 0.95}
        color={snapshot.crisis === "fire" ? "#ffb18a" : isNight ? "#94a3b8" : "#ffffff"}
        castShadow={quality === "high"}
        shadow-mapSize-width={quality === "high" ? 1024 : 512}
        shadow-mapSize-height={quality === "high" ? 1024 : 512}
        shadow-camera-near={100}
        shadow-camera-far={2000}
        shadow-camera-left={-700}
        shadow-camera-right={700}
        shadow-camera-top={700}
        shadow-camera-bottom={-700}
      />

      <Ground size={city.size} />
      <CampusOverlay bounds={city.campusBounds} />
      <Parks city={city} />
      <Roads
        city={city}
        snapshot={snapshot}
        closedRoadIds={closedRoadIds}
        onToggleRoad={onToggleRoad}
        hoveredRoadId={hoveredRoadId}
        setHoveredRoadId={setHoveredRoadId}
      />
      {quality !== "low" && <Trees city={city} />}
      <Streetlights city={city} hour={snapshot.hour} />
      <BuildingsLayer city={city} snapshot={snapshot} playSec={crisisPlaySeconds} />
      <Vehicles city={city} snapshot={snapshot} />
      {quality === "high" && <Pedestrians city={city} snapshot={snapshot} />}
      <TrafficLights city={city} signalTiming={signalTiming} />

      {/* Crisis layers */}
      {snapshot.fire && <Helicopter target={snapshot.fire.pos} />}
      {snapshot.fire && (
        <>
          <FireSystem
            fire={snapshot.fire}
            buildings={city.buildings}
            playSec={crisisPlaySeconds}
          />
          <EmberSparks fire={snapshot.fire} />
          {quality !== "low" && (
            <VolumetricSmoke
              center={snapshot.fire.pos}
              radius={snapshot.fire.radius}
            />
          )}
          <FireTrucks
            fire={snapshot.fire}
            stations={city.buildings.filter((b) => b.kind === "firestation")}
            playSec={crisisPlaySeconds}
          />
          <EmergencyEscort
            fire={snapshot.fire}
            stations={city.buildings.filter((b) => b.kind === "firestation")}
            playSec={crisisPlaySeconds}
          />
          <IgnitionHeatmap
            fire={snapshot.fire}
            buildings={city.buildings}
            playSec={crisisPlaySeconds}
          />
          {/* Orange ember-flash sky pulses during fire */}
          <LightningFlash active color="#ff9466" intervalRange={[5, 11]} />
        </>
      )}
      {snapshot.flood && (
        <>
          <FloodSystem flood={snapshot.flood} />
          <RainParticles center={snapshot.flood.pos} radius={snapshot.flood.radius * 1.4} />
          <FloodRipples center={snapshot.flood.pos} radius={snapshot.flood.radius} />
          <FloodDebris flood={snapshot.flood} />
          <RescueBoats flood={snapshot.flood} />
          {/* Storm lightning during the flood */}
          <LightningFlash active color="#cfe2ff" intervalRange={[3, 7]} />
        </>
      )}
      {snapshot.surge && (
        <SurgeSystem surge={snapshot.surge} routes={snapshot.evacuationRoutes} />
      )}
      {snapshot.crisis !== "none" && (
        <EvacuationArrows routes={snapshot.evacuationRoutes} />
      )}

      <CrisisCameraFX snapshot={snapshot} />
      <CameraRig flyTo={flyTo} flythrough={flythrough ?? null} citySize={city.size} />
      <AdaptiveQuality
        onChange={(t) => {
          setQuality(t);
          onQualityChange?.(t);
        }}
      />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={50}
        maxDistance={1800}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 0, 0]}
      />

      {/* Cinematic post-processing — single composer, capped passes for perf */}
      <EffectComposer multisampling={0} enabled={quality !== "low"}>
        <Bloom
          intensity={
            snapshot.crisis === "fire"
              ? 1.6
              : isNight
              ? 1.15
              : 0.7
          }
          luminanceThreshold={isNight ? 0.35 : 0.55}
          luminanceSmoothing={0.22}
          mipmapBlur
        />
        <BrightnessContrast brightness={0.0} contrast={0.1} />
        <Vignette eskil={false} offset={0.2} darkness={0.88} />
      </EffectComposer>
    </Canvas>
  );
}
