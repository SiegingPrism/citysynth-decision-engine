import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { CityModel, SimSnapshot, Vec2 } from "@/lib/simulation";

type Props = {
  city: CityModel;
  snapshot: SimSnapshot;
  closedRoadIds: string[];
  onToggleRoad: (roadId: string) => void;
  hoveredRoadId: string | null;
  setHoveredRoadId: (id: string | null) => void;
};

const buildingColor = (kind: string, hour: number) => {
  const night = hour < 6 || hour > 19;
  switch (kind) {
    case "lecture": return new THREE.Color("#5cc8ff");
    case "library": return new THREE.Color("#a78bfa");
    case "cafeteria": return new THREE.Color("#fbbf24");
    case "campus": return new THREE.Color("#34d399");
    case "parking": return new THREE.Color("#64748b");
    case "residential": return new THREE.Color(night ? "#fde68a" : "#94a3b8");
    default: return new THREE.Color(night ? "#cbd5e1" : "#475569");
  }
};

function Buildings({ city, hour }: { city: CityModel; hour: number }) {
  const meshes = useMemo(() => {
    return city.buildings.map((b) => {
      const color = buildingColor(b.kind, hour);
      return (
        <mesh
          key={b.id}
          position={[b.pos.x, b.h / 2, b.pos.z]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[b.w, b.h, b.d]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={
              b.kind === "office" || b.kind === "residential"
                ? hour < 6 || hour > 19
                  ? 0.45
                  : 0.05
                : 0.2
            }
            metalness={0.3}
            roughness={0.6}
          />
        </mesh>
      );
    });
  }, [city, Math.floor(hour)]);
  return <>{meshes}</>;
}

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
    <>
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

        const color = closed
          ? new THREE.Color("#ef4444")
          : new THREE.Color().setHSL(
              (1 - util) * 0.33, // green->red
              0.85,
              0.5,
            );

        return (
          <mesh
            key={road.id}
            position={[cx, 0.1, cz]}
            rotation={[-Math.PI / 2, 0, -angle]}
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
            <planeGeometry args={[len, hovered ? 6 : 4]} />
            <meshBasicMaterial
              color={color}
              transparent
              opacity={closed ? 0.95 : 0.55 + util * 0.4}
            />
          </mesh>
        );
      })}
    </>
  );
}

function Hotspots({ snapshot }: { snapshot: SimSnapshot }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    ref.current.children.forEach((c, i) => {
      const scale = 1 + Math.sin(t * 2 + i) * 0.08;
      c.scale.set(scale, 1, scale);
    });
  });
  return (
    <group ref={ref}>
      {snapshot.hotspots.map((h) => (
        <mesh key={h.id} position={[h.pos.x, 0.3, h.pos.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[h.radius * 0.5, h.radius, 48]} />
          <meshBasicMaterial
            color={new THREE.Color().setHSL(0.0 + (1 - h.intensity) * 0.15, 0.9, 0.55)}
            transparent
            opacity={0.35 + h.intensity * 0.4}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}

function RiskZones({ snapshot }: { snapshot: SimSnapshot }) {
  return (
    <>
      {snapshot.riskZones.map((rz, i) => {
        const color = snapshot.crisis === "fire"
          ? "#f97316"
          : snapshot.crisis === "flood"
          ? "#3b82f6"
          : "#a855f7";
        return (
          <mesh key={i} position={[rz.pos.x, 0.4, rz.pos.z]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[rz.radius, 64]} />
            <meshBasicMaterial color={color} transparent opacity={0.18 + rz.level * 0.25} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
      {snapshot.evacuationRoutes.map((ev, i) => {
        const points = [
          new THREE.Vector3(ev.a.x, 0.6, ev.a.z),
          new THREE.Vector3(ev.b.x, 0.6, ev.b.z),
        ];
        const geom = new THREE.BufferGeometry().setFromPoints(points);
        return (
          <line key={`ev-${i}`}>
            <primitive object={geom} attach="geometry" />
            <lineBasicMaterial color="#34d399" linewidth={3} />
          </line>
        );
      })}
    </>
  );
}

function CampusOverlay({ bounds }: { bounds: { x: number; z: number; w: number; d: number } }) {
  const cx = bounds.x + bounds.w / 2;
  const cz = bounds.z + bounds.d / 2;
  return (
    <mesh position={[cx, 0.05, cz]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[bounds.w, bounds.d]} />
      <meshBasicMaterial color="#22d3ee" transparent opacity={0.05} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Vehicles({ city, snapshot }: { city: CityModel; snapshot: SimSnapshot }) {
  // Lightweight animated dots flowing along non-closed roads, density = util
  const data = useMemo(() => {
    const items: Array<{ road: typeof city.roads[number]; offset: number; speed: number }> = [];
    for (const road of city.roads) {
      const util = snapshot.roadFlow[road.id] ?? 0;
      if (util >= 1) continue;
      const count = Math.max(0, Math.floor(util * 6));
      const speed = Math.max(0.05, 1 - util) * 0.5;
      for (let i = 0; i < count; i++) {
        items.push({ road, offset: i / count, speed });
      }
    }
    return items;
  }, [city, snapshot]);

  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.getElapsedTime();
    data.forEach((d, i) => {
      const p = (d.offset + t * d.speed) % 1;
      const x = d.road.a.x + (d.road.b.x - d.road.a.x) * p;
      const z = d.road.a.z + (d.road.b.z - d.road.a.z) * p;
      dummy.position.set(x, 1.5, z);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
    });
    ref.current.count = data.length;
    ref.current.instanceMatrix.needsUpdate = true;
  });

  if (data.length === 0) return null;

  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(1, data.length)]}>
      <boxGeometry args={[3, 1.5, 3]} />
      <meshStandardMaterial color="#fbbf24" emissive="#fbbf24" emissiveIntensity={0.6} />
    </instancedMesh>
  );
}

function Ground({ size }: { size: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[size * 1.4, size * 1.4]} />
      <meshStandardMaterial color="#0b1220" />
    </mesh>
  );
}

export function CityScene(props: Props) {
  const { city, snapshot, closedRoadIds, onToggleRoad, hoveredRoadId, setHoveredRoadId } = props;
  const isNight = snapshot.hour < 6 || snapshot.hour > 19;
  return (
    <Canvas
      shadows
      camera={{ position: [400, 350, 400], fov: 45, near: 1, far: 3000 }}
      gl={{ antialias: true }}
    >
      <color attach="background" args={[isNight ? "#070b18" : "#0e1525"]} />
      <fog attach="fog" args={[isNight ? "#070b18" : "#0e1525", 600, 1400]} />
      <ambientLight intensity={isNight ? 0.25 : 0.55} />
      <directionalLight
        position={[300, 500, 200]}
        intensity={isNight ? 0.4 : 1.0}
        color={isNight ? "#94a3b8" : "#ffffff"}
        castShadow
      />
      <Ground size={city.size} />
      <CampusOverlay bounds={city.campusBounds} />
      <Buildings city={city} hour={snapshot.hour} />
      <Roads
        city={city}
        snapshot={snapshot}
        closedRoadIds={closedRoadIds}
        onToggleRoad={onToggleRoad}
        hoveredRoadId={hoveredRoadId}
        setHoveredRoadId={setHoveredRoadId}
      />
      <Vehicles city={city} snapshot={snapshot} />
      <Hotspots snapshot={snapshot} />
      <RiskZones snapshot={snapshot} />
      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        minDistance={150}
        maxDistance={900}
        maxPolarAngle={Math.PI / 2.05}
      />
    </Canvas>
  );
}
