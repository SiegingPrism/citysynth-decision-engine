import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { Building, CityModel, SimSnapshot, Vec2 } from "@/lib/simulation";

type Props = {
  city: CityModel;
  snapshot: SimSnapshot;
  closedRoadIds: string[];
  onToggleRoad: (roadId: string) => void;
  hoveredRoadId: string | null;
  setHoveredRoadId: (id: string | null) => void;
  /** seconds the crisis has been visually playing — drives ignition/collapse */
  crisisPlaySeconds: number;
};

/* ------------------------- realistic buildings ------------------------- */

const BUILDING_COLORS: Record<string, [string, string]> = {
  // [base/wall, accent/window glow]
  office:      ["#3a4a66", "#fde68a"],
  residential: ["#4a4458", "#fbbf24"],
  campus:      ["#3d5a55", "#5cc8ff"],
  cafeteria:   ["#7a5a3a", "#fbbf24"],
  lecture:     ["#3a5a78", "#5cc8ff"],
  library:     ["#4d3a78", "#a78bfa"],
  parking:     ["#2a3340", "#64748b"],
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
  const [base, glow] = BUILDING_COLORS[b.kind] ?? BUILDING_COLORS.office;
  const isNight = hour < 6.5 || hour > 19;
  const lightProb = isNight ? 0.7 : 0.15;

  const { stories, windowsPerFloor } = useMemo(() => {
    const stories = Math.max(2, Math.floor(b.h / 3.5));
    const windowsPerFloor = Math.max(2, Math.floor(b.w / 5));
    return { stories, windowsPerFloor };
  }, [b.h, b.w]);

  // pre-randomize lit windows per building (stable)
  const litMatrix = useMemo(() => {
    const seed = Math.abs(Math.floor(b.pos.x * 13 + b.pos.z * 7));
    const out: number[] = [];
    let s = seed;
    for (let i = 0; i < stories * windowsPerFloor * 4; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      out.push(s / 0xffffffff);
    }
    return out;
  }, [b.pos.x, b.pos.z, stories, windowsPerFloor]);

  if (state.collapsed) {
    // Rubble pile
    return (
      <group position={[b.pos.x, 0, b.pos.z]}>
        <mesh position={[0, b.h * 0.08, 0]} castShadow>
          <boxGeometry args={[b.w * 1.05, b.h * 0.16, b.d * 1.05]} />
          <meshStandardMaterial color="#1f1a17" roughness={0.95} />
        </mesh>
        {/* embers */}
        <pointLight position={[0, 4, 0]} color="#ff6a2a" intensity={0.6} distance={40} />
      </group>
    );
  }

  // Damage tilt + sink
  const tilt = state.damage * 0.18;
  const sink = state.damage * b.h * 0.15;
  const buildingY = Math.max(0, b.h / 2 - sink);
  const buildingHeight = b.h * (1 - state.damage * 0.12);

  // Color shift for fire damage (sooty)
  const sootMix = state.damage;
  const wallColor = new THREE.Color(base).lerp(new THREE.Color("#0d0807"), sootMix * 0.7);
  const emissiveOnFire = state.onFire
    ? new THREE.Color("#ff5a1f").multiplyScalar(0.6 + Math.sin(performance.now() * 0.01) * 0.25)
    : new THREE.Color("#000");

  // Tier the building: optional smaller upper section for tall offices
  const hasTier = b.h > 50 && (b.kind === "office" || b.kind === "campus" || b.kind === "lecture");
  const lowerH = hasTier ? buildingHeight * 0.6 : buildingHeight;
  const upperH = hasTier ? buildingHeight * 0.4 : 0;

  return (
    <group
      position={[b.pos.x, 0, b.pos.z]}
      rotation={[tilt * 0.5, 0, tilt]}
    >
      {/* ground footprint / podium */}
      <mesh position={[0, 0.4, 0]} receiveShadow>
        <boxGeometry args={[b.w * 1.08, 0.8, b.d * 1.08]} />
        <meshStandardMaterial color="#1a2230" roughness={0.9} />
      </mesh>

      {/* lower body */}
      <mesh
        position={[0, lowerH / 2 + 0.8, 0]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[b.w, lowerH, b.d]} />
        <meshStandardMaterial
          color={wallColor}
          roughness={0.7}
          metalness={0.25}
          emissive={emissiveOnFire}
          emissiveIntensity={state.onFire ? 0.8 : 0}
        />
      </mesh>

      {/* tiered upper */}
      {hasTier && (
        <mesh
          position={[0, lowerH + upperH / 2 + 0.8, 0]}
          castShadow
        >
          <boxGeometry args={[b.w * 0.7, upperH, b.d * 0.7]} />
          <meshStandardMaterial
            color={wallColor}
            roughness={0.6}
            metalness={0.3}
            emissive={emissiveOnFire}
            emissiveIntensity={state.onFire ? 0.7 : 0}
          />
        </mesh>
      )}

      {/* rooftop equipment */}
      <mesh position={[0, buildingHeight + 1 + 0.8, 0]}>
        <boxGeometry args={[b.w * 0.4, 1.2, b.d * 0.4]} />
        <meshStandardMaterial color="#2a3040" roughness={0.8} />
      </mesh>
      {hasTier && (
        <mesh position={[b.w * 0.18, lowerH + 1.5 + 0.8, 0]}>
          <boxGeometry args={[2, 3, 2]} />
          <meshStandardMaterial color="#3a4050" />
        </mesh>
      )}

      {/* WINDOW STRIPS (front + back) using emissive plane */}
      {!state.collapsed &&
        Array.from({ length: stories }).map((_, floor) => {
          const y = 1.6 + floor * (lowerH / stories);
          if (y > lowerH + 0.5) return null;
          const litFront = (litMatrix[floor * 4] ?? 0) < lightProb ? 0.9 : 0.05;
          const litBack = (litMatrix[floor * 4 + 1] ?? 0) < lightProb ? 0.9 : 0.05;
          const litLeft = (litMatrix[floor * 4 + 2] ?? 0) < lightProb ? 0.9 : 0.05;
          const litRight = (litMatrix[floor * 4 + 3] ?? 0) < lightProb ? 0.9 : 0.05;
          const winColor = new THREE.Color(glow);
          // dim windows when sooty
          const dim = 1 - sootMix * 0.85;
          return (
            <group key={floor}>
              {/* front */}
              <mesh position={[0, y, b.d / 2 + 0.05]}>
                <planeGeometry args={[b.w * 0.85, 1.4]} />
                <meshBasicMaterial color={winColor} transparent opacity={litFront * dim} />
              </mesh>
              {/* back */}
              <mesh position={[0, y, -b.d / 2 - 0.05]} rotation={[0, Math.PI, 0]}>
                <planeGeometry args={[b.w * 0.85, 1.4]} />
                <meshBasicMaterial color={winColor} transparent opacity={litBack * dim} />
              </mesh>
              {/* left */}
              <mesh position={[-b.w / 2 - 0.05, y, 0]} rotation={[0, -Math.PI / 2, 0]}>
                <planeGeometry args={[b.d * 0.85, 1.4]} />
                <meshBasicMaterial color={winColor} transparent opacity={litLeft * dim} />
              </mesh>
              {/* right */}
              <mesh position={[b.w / 2 + 0.05, y, 0]} rotation={[0, Math.PI / 2, 0]}>
                <planeGeometry args={[b.d * 0.85, 1.4]} />
                <meshBasicMaterial color={winColor} transparent opacity={litRight * dim} />
              </mesh>
            </group>
          );
        })}

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
    </group>
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

/* ------------------------------ trees / props ------------------------------ */

function Trees({ city }: { city: CityModel }) {
  const trees = useMemo(() => {
    const out: { x: number; z: number; s: number }[] = [];
    let s = 19;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    for (let i = 0; i < 240; i++) {
      const x = (rnd() - 0.5) * city.size;
      const z = (rnd() - 0.5) * city.size;
      // place near intersections (offset onto sidewalk corners)
      const nx = Math.round(x / 60) * 60 + (rnd() > 0.5 ? 7 : -7);
      const nz = Math.round(z / 60) * 60 + (rnd() > 0.5 ? 7 : -7);
      out.push({ x: nx, z: nz, s: 0.7 + rnd() * 0.5 });
    }
    return out;
  }, [city.size]);

  return (
    <group>
      {trees.map((t, i) => (
        <group key={i} position={[t.x, 0, t.z]} scale={[t.s, t.s, t.s]}>
          <mesh position={[0, 1.2, 0]}>
            <cylinderGeometry args={[0.25, 0.35, 2.4, 6]} />
            <meshStandardMaterial color="#3a2418" />
          </mesh>
          <mesh position={[0, 3.2, 0]} castShadow>
            <icosahedronGeometry args={[1.8, 0]} />
            <meshStandardMaterial color="#1f6e3a" roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------ vehicles ------------------------------ */

function Vehicles({ city, snapshot }: { city: CityModel; snapshot: SimSnapshot }) {
  const data = useMemo(() => {
    const items: Array<{ road: typeof city.roads[number]; offset: number; speed: number; color: number }> = [];
    for (const road of city.roads) {
      const util = snapshot.roadFlow[road.id] ?? 0;
      if (util >= 1) continue;
      const count = Math.max(0, Math.floor(util * 6));
      const speed = Math.max(0.04, 1 - util) * 0.5;
      for (let i = 0; i < count; i++) {
        items.push({ road, offset: i / count, speed, color: i % 4 });
      }
    }
    return items;
  }, [city, snapshot]);

  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const palette = useMemo(
    () => [
      new THREE.Color("#fde68a"),
      new THREE.Color("#5cc8ff"),
      new THREE.Color("#ff7a59"),
      new THREE.Color("#a78bfa"),
    ],
    [],
  );

  // Set per-instance colors once when data changes
  useEffect(() => {
    if (!ref.current) return;
    data.forEach((d, i) => {
      ref.current!.setColorAt(i, palette[d.color]);
    });
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [data, palette]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    data.forEach((d, i) => {
      const p = (d.offset + t * d.speed) % 1;
      const x = d.road.a.x + (d.road.b.x - d.road.a.x) * p;
      const z = d.road.a.z + (d.road.b.z - d.road.a.z) * p;
      const angle = Math.atan2(d.road.b.z - d.road.a.z, d.road.b.x - d.road.a.x);
      dummy.position.set(x, 1.0, z);
      dummy.rotation.y = -angle;
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
    });
    ref.current.count = data.length;
    ref.current.instanceMatrix.needsUpdate = true;
  });

  if (data.length === 0) return null;

  return (
    <instancedMesh
      ref={ref}
      args={[undefined, undefined, Math.max(1, data.length)]}
    >
      <boxGeometry args={[3.6, 1.6, 1.8]} />
      <meshStandardMaterial color="#ffffff" metalness={0.6} roughness={0.4} />
    </instancedMesh>
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

/* ----------------------------- ground & ambience ----------------------------- */

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

/* ----------------------------- camera shake on crisis ----------------------------- */

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
  } = props;
  const isNight = snapshot.hour < 6.5 || snapshot.hour > 19;

  // Sky color shifts with crisis
  let sky = isNight ? "#06080f" : "#0e1525";
  if (snapshot.crisis === "fire") sky = "#1a0a08";
  else if (snapshot.crisis === "flood") sky = "#0a1424";

  return (
    <Canvas
      shadows
      camera={{ position: [380, 320, 380], fov: 42, near: 1, far: 3000 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
    >
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[sky, 600, 1500]} />
      <ambientLight intensity={isNight ? 0.22 : 0.5} />
      <hemisphereLight args={["#5a7090", "#0a0e1a", isNight ? 0.25 : 0.45]} />
      <directionalLight
        position={[280, 480, 200]}
        intensity={isNight ? 0.35 : 0.95}
        color={snapshot.crisis === "fire" ? "#ffb18a" : isNight ? "#94a3b8" : "#ffffff"}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
      />

      <Ground size={city.size} />
      <CampusOverlay bounds={city.campusBounds} />
      <Roads
        city={city}
        snapshot={snapshot}
        closedRoadIds={closedRoadIds}
        onToggleRoad={onToggleRoad}
        hoveredRoadId={hoveredRoadId}
        setHoveredRoadId={setHoveredRoadId}
      />
      <Trees city={city} />
      <BuildingsLayer city={city} snapshot={snapshot} playSec={crisisPlaySeconds} />
      <Vehicles city={city} snapshot={snapshot} />

      {/* Crisis layers */}
      {snapshot.fire && (
        <FireSystem
          fire={snapshot.fire}
          buildings={city.buildings}
          playSec={crisisPlaySeconds}
        />
      )}
      {snapshot.flood && <FloodSystem flood={snapshot.flood} />}
      {snapshot.surge && (
        <SurgeSystem surge={snapshot.surge} routes={snapshot.evacuationRoutes} />
      )}
      {snapshot.crisis !== "none" && (
        <EvacuationArrows routes={snapshot.evacuationRoutes} />
      )}

      <CrisisCameraFX snapshot={snapshot} />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={120}
        maxDistance={900}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}
