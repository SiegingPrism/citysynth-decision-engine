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
  /** target the camera should fly to. Re-fires when reference changes. */
  flyTo: { x: number; z: number; preset?: "overview" | "tactical" | "street" } | null;
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
  firestation: ["#7a1f1f", "#fde68a"],
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

      {/* Fire-station signage: red roof beacon + bay doors */}
      {b.kind === "firestation" && !state.collapsed && (
        <>
          {/* Bright red roof */}
          <mesh position={[0, buildingHeight + 0.8 + 0.4, 0]}>
            <boxGeometry args={[b.w * 1.02, 0.8, b.d * 1.02]} />
            <meshStandardMaterial color="#dc2626" emissive="#7f1d1d" emissiveIntensity={0.4} />
          </mesh>
          {/* Rotating beacon */}
          <FireStationBeacon height={buildingHeight + 2.2} />
          {/* Bay doors (yellow stripes) */}
          <mesh position={[0, 3, b.d / 2 + 0.06]}>
            <planeGeometry args={[b.w * 0.7, 5]} />
            <meshBasicMaterial color="#fbbf24" />
          </mesh>
          {/* "FIRE" letter glow strip */}
          <mesh position={[0, buildingHeight - 1.5 + 0.8, b.d / 2 + 0.07]}>
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

/* ------------------------------ trees / props ------------------------------ */

function Trees({ city }: { city: CityModel }) {
  const trees = useMemo(() => {
    const out: { x: number; z: number; s: number }[] = [];
    let s = 19;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff;
    };
    const treeCount = Math.floor((city.size * city.size) / 1500);
    for (let i = 0; i < treeCount; i++) {
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

/* ------------------------- CAMERA RIG (smooth fly-to) ------------------------- */

function CameraRig({
  flyTo,
  citySize,
}: {
  flyTo: Props["flyTo"];
  citySize: number;
}) {
  const { camera } = useThree();
  const targetRef = useRef<THREE.Vector3 | null>(null);
  const cameraTargetRef = useRef<THREE.Vector3 | null>(null);

  useEffect(() => {
    if (!flyTo) return;
    const preset = flyTo.preset ?? "tactical";
    const lookAt = new THREE.Vector3(flyTo.x, 0, flyTo.z);
    let cam: THREE.Vector3;
    if (preset === "overview") {
      cam = new THREE.Vector3(citySize * 0.7, citySize * 0.7, citySize * 0.7);
      lookAt.set(0, 0, 0);
    } else if (preset === "street") {
      cam = new THREE.Vector3(flyTo.x + 50, 35, flyTo.z + 50);
    } else {
      // tactical
      cam = new THREE.Vector3(flyTo.x + 180, 220, flyTo.z + 180);
    }
    targetRef.current = lookAt;
    cameraTargetRef.current = cam;
  }, [flyTo, citySize]);

  useFrame(() => {
    if (!cameraTargetRef.current || !targetRef.current) return;
    camera.position.lerp(cameraTargetRef.current, 0.04);
    // we intentionally don't tween OrbitControls.target to avoid fighting the user.
    // Instead, we look at the target while close.
    const dist = camera.position.distanceTo(cameraTargetRef.current);
    if (dist < 4) {
      cameraTargetRef.current = null;
      targetRef.current = null;
    }
  });

  return null;
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
  } = props;
  const isNight = snapshot.hour < 6.5 || snapshot.hour > 19;
  const signalTiming = 1; // visual cycle speed only — sim uses controls.signalTiming for math

  // Sky color shifts with crisis
  let sky = isNight ? "#06080f" : "#0e1525";
  if (snapshot.crisis === "fire") sky = "#1a0a08";
  else if (snapshot.crisis === "flood") sky = "#0a1424";

  return (
    <Canvas
      shadows
      camera={{ position: [620, 520, 620], fov: 45, near: 1, far: 5000 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
    >
      <color attach="background" args={[sky]} />
      <fog attach="fog" args={[sky, 900, 2400]} />
      <ambientLight intensity={isNight ? 0.22 : 0.5} />
      <hemisphereLight args={["#5a7090", "#0a0e1a", isNight ? 0.25 : 0.45]} />
      <directionalLight
        position={[480, 780, 320]}
        intensity={isNight ? 0.35 : 0.95}
        color={snapshot.crisis === "fire" ? "#ffb18a" : isNight ? "#94a3b8" : "#ffffff"}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
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
          <FireTrucks
            fire={snapshot.fire}
            stations={city.buildings.filter((b) => b.kind === "firestation")}
            playSec={crisisPlaySeconds}
          />
        </>
      )}
      {snapshot.flood && (
        <>
          <FloodSystem flood={snapshot.flood} />
          <RainParticles center={snapshot.flood.pos} radius={snapshot.flood.radius * 1.4} />
          <FloodRipples center={snapshot.flood.pos} radius={snapshot.flood.radius} />
          <FloodDebris flood={snapshot.flood} />
          <RescueBoats flood={snapshot.flood} />
        </>
      )}
      {snapshot.surge && (
        <SurgeSystem surge={snapshot.surge} routes={snapshot.evacuationRoutes} />
      )}
      {snapshot.crisis !== "none" && (
        <EvacuationArrows routes={snapshot.evacuationRoutes} />
      )}

      <CrisisCameraFX snapshot={snapshot} />
      <CameraRig flyTo={flyTo} citySize={city.size} />

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={50}
        maxDistance={1800}
        maxPolarAngle={Math.PI / 2.05}
        target={[0, 0, 0]}
      />
    </Canvas>
  );
}
