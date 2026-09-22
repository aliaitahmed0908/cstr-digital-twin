import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface ReactorMeshProps {
  getTemperature: () => number;
  getCoolingTemp?: () => number;
  coldTemp?: number;
  hotTemp?: number;
  jacketColdTemp?: number;
  jacketHotTemp?: number;
  cutawayEnabled?: boolean;
}

const PARTICLE_COUNT = 220;

// Aspect ratio kept between 1:1 and 1.5:1 (height:diameter) per spec.
const VESSEL_RADIUS = 1.1;
const VESSEL_HEIGHT = 2.6; // ~1.18:1 with diameter 2.2
const LUG_HEIGHT_FRACTION = 0.32; // where the side support lugs attach
const LEG_SPLAY_HEIGHT = 0.45; // was 1.0 — pulled in so legs read as short supports, not spears

// Exterior industrial color: dark royal blue, classic Pfaudler cladding.
const EXTERIOR_COLOR = 0x1a3d6b;
// Interior glass-lined color: deep cobalt/turquoise, high gloss.
const GLASS_BASE_COLOR = 0x0a3d5c;

export function ReactorMesh({
  getTemperature,
  getCoolingTemp,
  coldTemp = 300,
  hotTemp = 450,
  jacketColdTemp = 250,
  jacketHotTemp = 350,
  cutawayEnabled = false,
}: ReactorMeshProps) {
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const jacketMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const glowRef = useRef<THREE.PointLight>(null);
  const agitatorRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const particleMaterialRef = useRef<THREE.PointsMaterial>(null);

  const coldColor = useMemo(() => new THREE.Color(0x1e6fff), []);
  const hotColor = useMemo(() => new THREE.Color(0xff2a1e), []);
  const lerped = useMemo(() => new THREE.Color(), []);
  const jacketBaseColor = useMemo(() => new THREE.Color(EXTERIOR_COLOR), []);
  const jacketLerped = useMemo(() => new THREE.Color(), []);

  const cutawayPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), []);
  const clippingPlanes = useMemo(
    () => (cutawayEnabled ? [cutawayPlane] : []),
    [cutawayEnabled, cutawayPlane]
  );

  const particleRadius = useMemo(() => new Float32Array(PARTICLE_COUNT), []);
  const particleAngle = useMemo(() => new Float32Array(PARTICLE_COUNT), []);
  const particleHeight = useMemo(() => new Float32Array(PARTICLE_COUNT), []);
  const particleSpeedMul = useMemo(() => new Float32Array(PARTICLE_COUNT), []);
  const particlePositions = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), []);

  useMemo(() => {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particleRadius[i] = Math.sqrt(Math.random()) * (VESSEL_RADIUS * 0.82);
      particleAngle[i] = Math.random() * Math.PI * 2;
      particleHeight[i] = -VESSEL_HEIGHT * 0.32 + Math.random() * VESSEL_HEIGHT * 0.55;
      particleSpeedMul[i] = 0.6 + Math.random() * 0.8;
    }
  }, [particleRadius, particleAngle, particleHeight, particleSpeedMul]);

  const particleGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
    return geom;
  }, [particlePositions]);

  useFrame((_, delta) => {
    const T = getTemperature();
    const t = THREE.MathUtils.clamp((T - coldTemp) / (hotTemp - coldTemp), 0, 1);
    lerped.copy(coldColor).lerp(hotColor, t);

    if (materialRef.current) {
      materialRef.current.emissive.copy(lerped);
      materialRef.current.emissiveIntensity = 0.12 + 0.55 * t;
    }
    if (glowRef.current) {
      glowRef.current.color.copy(lerped);
      glowRef.current.intensity = 1 + 3 * t;
    }
    if (agitatorRef.current) {
      const baseSpeed = 1.2;
      const speed = baseSpeed + t * 4.5;
      agitatorRef.current.rotation.y += delta * speed;
    }

    if (jacketMaterialRef.current) {
      const Tc = getCoolingTemp ? getCoolingTemp() : jacketColdTemp;
      const jt = THREE.MathUtils.clamp(
        (Tc - jacketColdTemp) / (jacketHotTemp - jacketColdTemp),
        0,
        1
      );
      jacketLerped.copy(jacketBaseColor).lerp(hotColor, jt * 0.4);
      jacketMaterialRef.current.emissive.lerp(jacketLerped, 0.08);
    }

    const baseParticleSpeed = 0.5 + t * 3.5;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particleAngle[i] += delta * baseParticleSpeed * particleSpeedMul[i];
      const r = particleRadius[i];
      const a = particleAngle[i];
      const idx = i * 3;
      particlePositions[idx] = r * Math.cos(a);
      particlePositions[idx + 1] = particleHeight[i];
      particlePositions[idx + 2] = r * Math.sin(a);
    }
    particleGeometry.attributes.position.needsUpdate = true;

    if (particleMaterialRef.current) {
      particleMaterialRef.current.color.copy(lerped);
      particleMaterialRef.current.size = 0.035 + t * 0.03;
      particleMaterialRef.current.opacity = 0.5 + t * 0.4;
    }
  });

  const lugAnchors = useMemo(() => {
    const anchors: { bracket: [number, number, number]; angle: number }[] = [];
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const bx = VESSEL_RADIUS * Math.cos(angle);
      const bz = VESSEL_RADIUS * Math.sin(angle);
      const by = -VESSEL_HEIGHT / 2 + VESSEL_HEIGHT * LUG_HEIGHT_FRACTION;
      anchors.push({ bracket: [bx, by, bz], angle });
    }
    return anchors;
  }, []);

  const nozzlePositions = useMemo(() => {
    const nozzles: [number, number][] = [];
    const count = 6;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + 0.3;
      nozzles.push([Math.cos(angle) * VESSEL_RADIUS * 0.5, Math.sin(angle) * VESSEL_RADIUS * 0.5]);
    }
    return nozzles;
  }, []);

  const groundOffset = LEG_SPLAY_HEIGHT * 0.55;

  return (
    <group position={[0, groundOffset, 0]}>
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 5, 3]} intensity={0.85} castShadow />
      <pointLight ref={glowRef} position={[0, 0, 0]} distance={4.5} intensity={1} />

      {/* Side-mounted support lugs: bracket plate + angled pipe-leg down to
          the ground. LEG_SPLAY_HEIGHT now pulled in so these read as short,
          sturdy supports rather than long diagonal spears. */}
      {lugAnchors.map(({ bracket, angle }, i) => {
        const groundX = Math.cos(angle) * (VESSEL_RADIUS + LEG_SPLAY_HEIGHT * 0.5);
        const groundZ = Math.sin(angle) * (VESSEL_RADIUS + LEG_SPLAY_HEIGHT * 0.5);
        const groundY = -groundOffset;
        const mid: [number, number, number] = [
          (bracket[0] + groundX) / 2,
          (bracket[1] + groundY) / 2,
          (bracket[2] + groundZ) / 2,
        ];
        const dx = groundX - bracket[0];
        const dy = groundY - bracket[1];
        const dz = groundZ - bracket[2];
        const legLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const dir = new THREE.Vector3(dx, dy, dz).normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir
        );
        return (
          <group key={i}>
            <mesh position={bracket}>
              <boxGeometry args={[0.16, 0.22, 0.05]} />
              <meshStandardMaterial color={0x2b2f36} metalness={0.6} roughness={0.45} />
            </mesh>
            <mesh position={mid} quaternion={quaternion}>
              <cylinderGeometry args={[0.09, 0.1, legLength, 10]} />
              <meshStandardMaterial color={0x2b2f36} metalness={0.6} roughness={0.45} />
            </mesh>
            <mesh position={[groundX, groundY - 0.02, groundZ]}>
              <cylinderGeometry args={[0.14, 0.14, 0.04, 16]} />
              <meshStandardMaterial color={0x1c1f24} metalness={0.5} roughness={0.5} />
            </mesh>
          </group>
        );
      })}

      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[VESSEL_RADIUS, VESSEL_RADIUS, VESSEL_HEIGHT, 48, 1, false]} />
        <meshPhysicalMaterial
          ref={materialRef}
          color={GLASS_BASE_COLOR}
          roughness={0.06}
          metalness={0.05}
          clearcoat={1}
          clearcoatRoughness={0.05}
          transparent
          opacity={0.55}
          clippingPlanes={clippingPlanes}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh position={[0, -VESSEL_HEIGHT / 2, 0]} rotation={[Math.PI, 0, 0]} scale={[1, 0.5, 1]}>
        <sphereGeometry args={[VESSEL_RADIUS, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={EXTERIOR_COLOR} roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, -VESSEL_HEIGHT / 2 - 0.42, 0]}>
        <coneGeometry args={[VESSEL_RADIUS * 0.35, 0.5, 24]} />
        <meshStandardMaterial color={EXTERIOR_COLOR} roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, -VESSEL_HEIGHT / 2 - 0.72, 0]}>
        <boxGeometry args={[0.22, 0.16, 0.22]} />
        <meshStandardMaterial color={0x2b2f36} metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, -VESSEL_HEIGHT / 2 - 0.85, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.14, 12]} />
        <meshStandardMaterial color={0x71717a} metalness={0.7} roughness={0.35} />
      </mesh>

      <mesh position={[0, VESSEL_HEIGHT / 2, 0]} scale={[1, 0.55, 1]}>
        <sphereGeometry args={[VESSEL_RADIUS, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={EXTERIOR_COLOR} roughness={0.35} metalness={0.5} />
      </mesh>

      <group position={[-VESSEL_RADIUS * 0.55, VESSEL_HEIGHT / 2 + 0.08, 0.2]} rotation={[0, 0.3, 0]}>
        <mesh scale={[1.3, 1, 0.9]}>
          <cylinderGeometry args={[0.24, 0.24, 0.16, 24]} />
          <meshStandardMaterial color={0x2b2f36} metalness={0.65} roughness={0.4} />
        </mesh>
        <mesh position={[0.28, 0.1, 0]} rotation={[0, 0, 0.5]}>
          <cylinderGeometry args={[0.26, 0.26, 0.04, 24]} />
          <meshStandardMaterial color={0x3a3f47} metalness={0.7} roughness={0.3} />
        </mesh>
        <mesh position={[0.05, 0.1, 0.24]}>
          <boxGeometry args={[0.08, 0.08, 0.1]} />
          <meshStandardMaterial color={0x1c1f24} metalness={0.6} roughness={0.4} />
        </mesh>
      </group>

      {nozzlePositions.map(([x, z], i) => (
        <group key={i} position={[x, VESSEL_HEIGHT / 2 + 0.07, z]}>
          <mesh>
            <cylinderGeometry args={[0.07, 0.07, 0.2, 12]} />
            <meshStandardMaterial color={0x71717a} metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0.11, 0]}>
            <cylinderGeometry args={[0.075, 0.075, 0.02, 12]} />
            <meshStandardMaterial color={0x8a8f97} metalness={0.6} roughness={0.3} />
          </mesh>
        </group>
      ))}

      <group position={[0, VESSEL_HEIGHT / 2 + 0.68, 0]}>
        <mesh position={[0, -0.32, 0]}>
          <cylinderGeometry args={[0.22, 0.26, 0.22, 20]} />
          <meshStandardMaterial color={0x2b2f36} metalness={0.55} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.02, 0]}>
          <boxGeometry args={[0.42, 0.4, 0.42]} />
          <meshStandardMaterial color={0x35393f} metalness={0.5} roughness={0.55} />
        </mesh>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.17, 0.17, 0.55, 20]} />
          <meshStandardMaterial color={0x1e222a} metalness={0.55} roughness={0.5} />
        </mesh>
        <mesh position={[0, 0.72, 0]}>
          <cylinderGeometry args={[0.19, 0.17, 0.1, 20]} />
          <meshStandardMaterial color={0x111318} metalness={0.6} roughness={0.4} />
        </mesh>
      </group>

      <points ref={particlesRef} geometry={particleGeometry}>
        <pointsMaterial
          ref={particleMaterialRef}
          size={0.04}
          transparent
          opacity={0.6}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      <group ref={agitatorRef} position={[0, VESSEL_HEIGHT / 2, 0]}>
        <mesh>
          <cylinderGeometry args={[0.05, 0.05, VESSEL_HEIGHT * 1.05, 12]} />
          <meshStandardMaterial color={0x333333} metalness={0.75} roughness={0.2} />
        </mesh>

        <group position={[0, -VESSEL_HEIGHT * 0.78, 0]}>
          {[0, 1, 2].map((i) => (
            <group key={i} rotation={[0, (i / 3) * Math.PI * 2, 0]}>
              <mesh position={[VESSEL_RADIUS * 0.4, 0, 0]} rotation={[0.35, 0, 0.25]}>
                <boxGeometry args={[VESSEL_RADIUS * 0.75, 0.08, 0.22]} />
                <meshStandardMaterial color={0xd8dbe0} metalness={0.8} roughness={0.2} />
              </mesh>
            </group>
          ))}
          <mesh>
            <sphereGeometry args={[0.09, 12, 12]} />
            <meshStandardMaterial color={0xd8dbe0} metalness={0.8} roughness={0.2} />
          </mesh>
        </group>
      </group>

      <mesh position={[0, VESSEL_HEIGHT * 0.05, VESSEL_RADIUS * 0.88]}>
        <boxGeometry args={[0.14, VESSEL_HEIGHT * 0.75, 0.05]} />
        <meshStandardMaterial color={0xb7bcc4} metalness={0.6} roughness={0.3} />
      </mesh>

      <mesh position={[0, VESSEL_HEIGHT * 0.12, -VESSEL_RADIUS * 0.6]}>
        <cylinderGeometry args={[0.045, 0.045, VESSEL_HEIGHT * 0.68, 12]} />
        <meshStandardMaterial color={0x9aa0a8} metalness={0.65} roughness={0.3} />
      </mesh>

      <group position={[0, -VESSEL_HEIGHT * 0.12, 0]}>
        <mesh>
          <cylinderGeometry args={[VESSEL_RADIUS * 1.15, VESSEL_RADIUS * 1.15, VESSEL_HEIGHT * 0.76, 48, 1, true]} />
          <meshStandardMaterial
            ref={jacketMaterialRef}
            color={EXTERIOR_COLOR}
            metalness={0.35}
            roughness={0.55}
            clippingPlanes={clippingPlanes}
            side={THREE.DoubleSide}
          />
        </mesh>

        <mesh position={[VESSEL_RADIUS * 1.02, VESSEL_HEIGHT * 0.2, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.07, 0.3, 12]} />
          <meshStandardMaterial color={0x71717a} metalness={0.7} roughness={0.35} />
        </mesh>
        <mesh position={[-VESSEL_RADIUS * 1.02, -VESSEL_HEIGHT * 0.2, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.07, 0.3, 12]} />
          <meshStandardMaterial color={0x71717a} metalness={0.7} roughness={0.35} />
        </mesh>
      </group>
    </group>
  );
}