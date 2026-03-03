import { useEffect, useState, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';

export default function KeralaMap() {
  const [districts, setDistricts] = useState<any[]>([]);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    fetch('/data/kerala_districts.json')
      .then(res => res.json())
      .then(data => setDistricts(data.features))
      .catch(err => console.error("Error loading map data:", err));
  }, []);

  // Cinematic Entrance Animation Loop
  useFrame((state) => {
    if (!groupRef.current) return;

    // 1. Position: Add the X-axis line to slide the entire map to the right (Try changing 4 to whatever looks best)
    groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, 4, 0.02); 
    groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, 0, 0.02);
    groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, 0, 0.02);

    // 2. Rotation: Change -0.3 to a positive number (like 0.3) to spin the bottom tip to the right
    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, -Math.PI / 2, 0.02);
    groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, 0.3, 0.02); 

    // 3. The "Breathing" Effect
    if (groupRef.current.position.y > -0.5) {
      groupRef.current.position.y += Math.sin(state.clock.elapsedTime * 2) * 0.002;
    }
  });

  return (
    <group 
      ref={groupRef} 
      position={[0, -40, -20]} // Starts hidden deep down
      rotation={[-Math.PI, 0, -1]} // Starts tilted
    >
      {districts.map((feature, index) => (
        <DistrictMesh key={index} feature={feature} />
      ))}
    </group>
  );
}

function DistrictMesh({ feature }: { feature: any }) {
  const shape = new THREE.Shape();
  const center = [76.5, 10.5];
  const scale = 12;

  try {
    const geometry = feature.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

    polygons.forEach((polygon: any) => {
      const ring = polygon[0];
      ring.forEach(([lon, lat]: [number, number], i: number) => {
        const x = (lon - center[0]) * scale; 
        const y = (lat - center[1]) * scale;
        
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      });
    });
  } catch (error) {
    return null; // Safely ignore broken geometry
  }

  return (
    <mesh>
      <extrudeGeometry args={[shape, { depth: 0.8, bevelEnabled: false }]} />
      <meshToonMaterial color="#0d9488" /> 
      <Edges 
        linewidth={1} 
        threshold={15} 
        color="#042f2e" 
      />
    </mesh>
  );
}