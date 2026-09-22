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

// Vessel proportions, tuned to loosely match a Pfaudler-style glass-lined
// reactor: dished bottom, cylindrical body, domed top head, external
// support legs, top-mounted motor drive.
const VESSEL_RADIUS = 1.2;
const VESSEL_HEIGHT = 2.4;
const LEG_HEIGHT = 0.9;

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
  const jacketMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const glowRef = useRef<THREE.PointLight>(null);
  const agitatorRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const particleMaterialRef = useRef<THREE.PointsMaterial>(null);

  const coldColor = useMemo(() => new THREE.Color(0x1e6fff), []);
  const hotColor = useMemo(() => new THREE.Color(0xff2a1e), []);
  const lerped = useMemo(() => new THREE.Color(), []);
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
      particleRadius[i] = Math.sqrt(Math.random()) * (VESSEL_RADIUS * 0.85);
      particleAngle[i] = Math.random() * Math.PI * 2;
      particleHeight[i] = (Math.random() - 0.5) * (VESSEL_HEIGHT * 0.85);
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
      materialRef.current.color.copy(lerped);
      materialRef.current.emissive.copy(lerped);
      materialRef.current.emissiveIntensity = 0.15 + 0.6 * t;
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
      jacketLerped.copy(coldColor).lerp(hotColor, jt);
      jacketMaterialRef.current.color.lerp(jacketLerped, 0.1);
      jacketMaterialRef.current.emissive.lerp(jacketLerped, 0.05);
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

  // Positions for 4 support legs, splayed outward like the reference diagram.
  const legPositions = useMemo(() => {
    const legs: [number, number, number][] = [];
    const legRadius = VESSEL_RADIUS * 0.75;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      legs.push([legRadius * Math.cos(angle), -VESSEL_HEIGHT / 2 - LEG_HEIGHT / 2, legRadius * Math.sin(angle)]);
    }
    return legs;
  }, []);

  // Positions for small top-head nozzles, scattered like the reference image.
  const nozzlePositions = useMemo(() => {
    const nozzles: [number, number][] = [];
    const count = 6;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      nozzles.push([Math.cos(angle) * VESSEL_RADIUS * 0.55, Math.sin(angle) * VESSEL_RADIUS * 0.55]);
    }
    return nozzles;
  }, []);

  return (
    <group position={[0, LEG_HEIGHT / 2, 0]}>
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 5, 3]} intensity={0.8} castShadow />
      <pointLight ref={glowRef} position={[0, 0, 0]} distance={4} intensity={1} />

      {/* Support legs — angled, planted on the ground, matching the
          reference diagram's "legs designed for wind/seismic conditions". */}
      {legPositions.map((pos, i) => (
        <mesh key={i} position={pos}>
          <cylinderGeometry args={[0.05, 0.07, LEG_HEIGHT, 8]} />
          <meshStandardMaterial color={0x4a4f57} metalness={0.7} roughness={0.4} />
        </mesh>
      ))}

      {/* Main cylindrical vessel body — glossy, glass-lined look via
          clearcoat rather than a flat tinted color. */}
      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[VESSEL_RADIUS, VESSEL_RADIUS, VESSEL_HEIGHT, 48, 1, false]} />
        <meshPhysicalMaterial
          ref={materialRef}
          roughness={0.12}
          metalness={0.05}
          clearcoat={1}
          clearcoatRoughness={0.08}
          transparent
          opacity={0.72}
          clippingPlanes={clippingPlanes}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Dished bottom head, per reference: a rounded dish rather than a
          plain hemisphere, achieved with a squashed sphere. */}
      <mesh position={[0, -VESSEL_HEIGHT / 2, 0]} rotation={[Math.PI, 0, 0]} scale={[1, 0.55, 1]}>
        <sphereGeometry args={[VESSEL_RADIUS, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial color={0x9aa0a8} roughness={0.35} metalness={0.5} clearcoat={0.6} />
      </mesh>

      {/* Domed top head. */}
      <mesh position={[0, VESSEL_HEIGHT / 2, 0]} scale={[1, 0.65, 1]}>
        <sphereGeometry args={[VESSEL_RADIUS, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshPhysicalMaterial color={0x9aa0a8} roughness={0.35} metalness={0.5} clearcoat={0.6} />
      </mesh>

      {/* Manway with sight glass — the larger offset port on the top head
          in the reference image. */}
      <group position={[VESSEL_RADIUS * 0.45, VESSEL_HEIGHT / 2 + 0.15, 0]}>
        <mesh>
          <cylinderGeometry args={[0.22, 0.22, 0.18, 24]} />
          <meshStandardMaterial color={0x8a8f97} metalness={0.6} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <cylinderGeometry args={[0.17, 0.17, 0.03, 24]} />
          <meshPhysicalMaterial color={0xbfe0ff} transmission={0.9} roughness={0.05} thickness={0.2} />
        </mesh>
      </group>

      {/* Smaller top head nozzles, scattered around the manway. */}
      {nozzlePositions.map(([x, z], i) => (
        <mesh key={i} position={[x, VESSEL_HEIGHT / 2 + 0.1, z]}>
          <cylinderGeometry args={[0.06, 0.06, 0.22, 12]} />
          <meshStandardMaterial color={0x71717a} metalness={0.7} roughness={0.35} />
        </mesh>
      ))}

      {/* Top-mounted motor drive assembly, standing on a short mounting
          plate, per the "Proven, rugged mixer drive" callout. */}
      <group position={[0, VESSEL_HEIGHT / 2 + 0.55, 0]}>
        <mesh position={[0, -0.15, 0]}>
          <cylinderGeometry args={[0.35, 0.35, 0.08, 24]} />
          <meshStandardMaterial color={0x4a4f57} metalness={0.6} roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.1, 0]}>
          <boxGeometry args={[0.5, 0.5, 0.5]} />
          <meshStandardMaterial color={0x5b6270} metalness={0.5} roughness={0.45} />
        </mesh>
        <mesh position={[0, 0.42, 0]}>
          <cylinderGeometry args={[0.16, 0.16, 0.12, 16]} />
          <meshStandardMaterial color={0x2b2f36} metalness={0.7} roughness={0.3} />
        </mesh>
      </group>

      {/* Fluid + suspended particle field. */}
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

      {/* Agitator shaft running from the drive through the top head into
          the vessel, with an anchor-style impeller near the bottom rather
          than plain crossed blades, closer to the "Cryo-Lock impeller"
          shape in the reference diagram. */}
      <group ref={agitatorRef} position={[0, VESSEL_HEIGHT / 2, 0]}>
        <mesh>
          <cylinderGeometry args={[0.045, 0.045, VESSEL_HEIGHT + 0.9, 12]} />
          <meshStandardMaterial color={0x333333} metalness={0.7} roughness={0.25} />
        </mesh>

        {/* Anchor-style impeller near the bottom: two curved arms formed
            from bent box segments, wider than the old straight blades so
            they actually read against the fluid color. */}
        <group position={[0, -VESSEL_HEIGHT * 0.85, 0]}>
          <mesh rotation={[0, 0, 0]}>
            <boxGeometry args={[VESSEL_RADIUS * 1.5, 0.1, 0.18]} />
            <meshStandardMaterial color={0xd0d3d8} metalness={0.75} roughness={0.25} />
          </mesh>
          <mesh rotation={[0, Math.PI / 2, 0]}>
            <boxGeometry args={[VESSEL_RADIUS * 1.5, 0.1, 0.18]} />
            <meshStandardMaterial color={0xd0d3d8} metalness={0.75} roughness={0.25} />
          </mesh>
          {/* Curved lower scoop hinting at an anchor impeller's bottom sweep */}
          <mesh position={[0, -0.15, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[VESSEL_RADIUS * 0.7, 0.06, 8, 24, Math.PI]} />
            <meshStandardMaterial color={0xd0d3d8} metalness={0.75} roughness={0.25} />
          </mesh>
        </group>
      </group>

      {/* Single wall-mounted baffle — per the reference's "superior fin
          baffle", a long flat plate running most of the vessel height,
          standing off the inner wall, rather than crossed agitator blades. */}
      <mesh position={[0, 0, VESSEL_RADIUS * 0.92]}>
        <boxGeometry args={[0.12, VESSEL_HEIGHT * 0.85, 0.05]} />
        <meshStandardMaterial color={0xb7bcc4} metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Cooling jacket — wraps the lower ~2/3 of the vessel, tinted by Tc,
          independent of the reactor's own temperature. */}
      <group position={[0, -VESSEL_HEIGHT * 0.08, 0]}>
        <mesh>
          <cylinderGeometry args={[VESSEL_RADIUS * 1.18, VESSEL_RADIUS * 1.18, VESSEL_HEIGHT * 0.7, 48, 1, true]} />
          <meshPhysicalMaterial
            ref={jacketMaterialRef}
            color={0x1e6fff}
            transparent
            opacity={0.3}
            roughness={0.2}
            metalness={0.1}
            transmission={0.3}
            clippingPlanes={clippingPlanes}
            side={THREE.DoubleSide}
          />
        </mesh>

        {/* Jacket inlet/outlet, nudged to actually intersect the jacket
            wall rather than float outside it. */}
        <mesh position={[VESSEL_RADIUS * 1.05, VESSEL_HEIGHT * 0.2, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.07, 0.3, 12]} />
          <meshStandardMaterial color={0x71717a} metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[-VESSEL_RADIUS * 1.05, -VESSEL_HEIGHT * 0.2, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.07, 0.07, 0.3, 12]} />
          <meshStandardMaterial color={0x71717a} metalness={0.8} roughness={0.3} />
        </mesh>
      </group>
    </group>
  );
}