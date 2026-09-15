import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface ReactorMeshProps {
  getTemperature: () => number;
  coldTemp?: number;
  hotTemp?: number;
}

const PARTICLE_COUNT = 220;

export function ReactorMesh({
  getTemperature,
  coldTemp = 300,
  hotTemp = 450,
}: ReactorMeshProps) {
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const glowRef = useRef<THREE.PointLight>(null);
  const agitatorRef = useRef<THREE.Group>(null);
  const particlesRef = useRef<THREE.Points>(null);
  const particleMaterialRef = useRef<THREE.PointsMaterial>(null);

  const coldColor = useMemo(() => new THREE.Color(0x1e6fff), []);
  const hotColor = useMemo(() => new THREE.Color(0xff2a1e), []);
  const lerped = useMemo(() => new THREE.Color(), []);

  const particleRadius = useMemo(() => new Float32Array(PARTICLE_COUNT), []);
  const particleAngle = useMemo(() => new Float32Array(PARTICLE_COUNT), []);
  const particleHeight = useMemo(() => new Float32Array(PARTICLE_COUNT), []);
  const particleSpeedMul = useMemo(() => new Float32Array(PARTICLE_COUNT), []);
  const particlePositions = useMemo(() => new Float32Array(PARTICLE_COUNT * 3), []);

  useMemo(() => {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particleRadius[i] = Math.sqrt(Math.random()) * 1.05;
      particleAngle[i] = Math.random() * Math.PI * 2;
      particleHeight[i] = (Math.random() - 0.5) * 2.1;
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

  return (
    <group>
      <ambientLight intensity={0.4} />
      <directionalLight position={[3, 5, 3]} intensity={0.8} />
      <pointLight ref={glowRef} position={[0, 0, 0]} distance={4} intensity={1} />

      <mesh position={[0, 0, 0]} castShadow>
        <cylinderGeometry args={[1.2, 1.2, 2.4, 48, 1, false]} />
        <meshStandardMaterial
          ref={materialRef}
          roughness={0.35}
          metalness={0.15}
          transparent
          opacity={0.75}
        />
      </mesh>

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

      <mesh position={[0, 1.2, 0]}>
        <sphereGeometry args={[1.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={0x9aa0a8} roughness={0.65} metalness={0.15} />
      </mesh>
      <mesh position={[0, -1.2, 0]} rotation={[Math.PI, 0, 0]}>
        <sphereGeometry args={[1.2, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={0x9aa0a8} roughness={0.65} metalness={0.15} />
      </mesh>

      <group ref={agitatorRef} position={[0, 0.6, 0]}>
        <mesh>
          <cylinderGeometry args={[0.05, 0.05, 2.6, 12]} />
          <meshStandardMaterial color={0x333333} metalness={0.6} roughness={0.3} />
        </mesh>
        <mesh position={[0, -1.0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <boxGeometry args={[1.4, 0.08, 0.15]} />
          <meshStandardMaterial color={0x444444} metalness={0.6} roughness={0.3} />
        </mesh>
        <mesh position={[0, -0.6, 0]} rotation={[0, Math.PI / 2, Math.PI / 2]}>
          <boxGeometry args={[1.2, 0.08, 0.15]} />
          <meshStandardMaterial color={0x444444} metalness={0.6} roughness={0.3} />
        </mesh>
      </group>

      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[1.35, 1.35, 2.5, 48, 1, true]} />
        <meshStandardMaterial
          color={0x2244aa}
          wireframe
          transparent
          opacity={0.25}
        />
      </mesh>
    </group>
  );
}