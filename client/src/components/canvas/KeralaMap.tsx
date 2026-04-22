import { useEffect, useState, useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Edges, Html } from '@react-three/drei';

// 1. Core Interfaces
interface GeoJSONFeature {
  type: string;
  geometry: {
    type: 'Polygon' | 'MultiPolygon';
    coordinates: any[];
  };
  properties: {
    name?: string;
    DISTRICT?: string;
    Name?: string;
    district?: string;
    [key: string]: any;
  };
}

interface DistrictMeshProps {
  feature: GeoJSONFeature;
  districtName: string;
  isActive: boolean;
  onClick: (centerPoint: THREE.Vector3) => void;
  onDoubleClick: (centerPoint: THREE.Vector3) => void;
}

// 2. Cinematic Camera Rig
function CameraRig({ zoomTarget }: { zoomTarget: THREE.Vector3 | null }) {
  const { camera, controls } = useThree();
  
  const defaultPos = useMemo(() => new THREE.Vector3(0, -10, 45), []);
  const defaultTarget = useMemo(() => new THREE.Vector3(0, 0, 0), []);

  useFrame((state) => {
    const targetCameraPos = new THREE.Vector3();
    const targetLookAt = new THREE.Vector3();
    const time = state.clock.elapsedTime;

    if (zoomTarget) {
      // THE FIX: Less extreme Y-drop so the map stays centered in the frame
      targetCameraPos.set(
        zoomTarget.x + Math.sin(time * 0.15) * 5, // Gentle drone pan
        zoomTarget.y - 5,                         // Perfect isometric swoop height
        zoomTarget.z + 15                         // Push in tight
      );
      targetLookAt.copy(zoomTarget);
    } else {
      // THE WIDE SHOT
      targetCameraPos.set(
        defaultPos.x + Math.sin(time * 0.1) * 2,
        defaultPos.y + Math.cos(time * 0.1) * 1,
        defaultPos.z
      );
      targetLookAt.copy(defaultTarget);
    }

    camera.position.lerp(targetCameraPos, 0.015);

    if (controls) {
      const orbitControls = controls as any;
      orbitControls.target.lerp(targetLookAt, 0.03);
      orbitControls.update();
    }
  });

  return null;
}

// 3. Main Map Component
export default function KeralaMap() {
  const [districts, setDistricts] = useState<GeoJSONFeature[]>([]);
  const [activeDistrict, setActiveDistrict] = useState<string | null>(null);
  const [zoomTarget, setZoomTarget] = useState<THREE.Vector3 | null>(null);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    fetch('/data/kerala_districts.json')
      .then((res) => res.json())
      .then((data) => setDistricts(data.features))
      .catch((err) => console.error("Vazhi Map Engine Error:", err));
  }, []);

  useFrame((state) => {
    if (!groupRef.current) return;
    groupRef.current.position.x = THREE.MathUtils.lerp(groupRef.current.position.x, -3, 0.03);
    groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, 0, 0.02);
    groupRef.current.position.z = THREE.MathUtils.lerp(groupRef.current.position.z, -7, 0.02);
    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, -Math.PI / 3, 0.02);
    groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, 0.5, 0.02);

    if (groupRef.current.position.y > -0.5) {
      groupRef.current.position.y += Math.sin(state.clock.elapsedTime * 1.5) * 0.003;
    }
  });

  return (
    <>
      <CameraRig zoomTarget={zoomTarget} />

      <group 
        ref={groupRef} 
        position={[0, -40, -20]} 
        rotation={[-Math.PI, 0, -1]}
        onPointerMissed={() => {
          setActiveDistrict(null);
          setZoomTarget(null); // Clicking void resets everything
        }}
      >
        {districts.map((feature, index) => {
          const districtName = feature.properties?.name || feature.properties?.DISTRICT || feature.properties?.Name || `Unknown-${index}`;
          return (
            <DistrictMesh 
              key={districtName} 
              feature={feature} 
              districtName={districtName}
              isActive={activeDistrict === districtName}
              onClick={(centerPoint) => {
                setActiveDistrict(districtName);
                // Smart Pan: If already zoomed in, glide to the new district
                if (zoomTarget) setZoomTarget(centerPoint);
              }}
              onDoubleClick={(centerPoint) => {
                setActiveDistrict(districtName); // Ensure it highlights on double-click too
                setZoomTarget(centerPoint);
              }}
            />
          );
        })}
      </group>
    </>
  );
}

// 4. Individual District Mesh Component
function DistrictMesh({ feature, districtName, isActive, onClick, onDoubleClick }: DistrictMeshProps) {
  const [hovered, setHovered] = useState(false);
  const meshGroupRef = useRef<THREE.Group>(null);

  const center = [76.5, 10.5]; 
  const scale = 12;

  const districtGeometries = useMemo<THREE.ExtrudeGeometry[]>(() => {
    try {
      const { geometry } = feature;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;

      return polygons.map((polygon: any) => {
        const shape = new THREE.Shape();
        const exterior = polygon[0];
        
        exterior.forEach(([lon, lat]: [number, number], i: number) => {
          const x = (lon - center[0]) * scale;
          const y = (lat - center[1]) * scale;
          if (i === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
        });

        if (polygon.length > 1) {
          for (let i = 1; i < polygon.length; i++) {
            const holePath = new THREE.Path();
            polygon[i].forEach(([lon, lat]: [number, number], j: number) => {
              const x = (lon - center[0]) * scale;
              const y = (lat - center[1]) * scale;
              if (j === 0) holePath.moveTo(x, y);
              else holePath.lineTo(x, y);
            });
            shape.holes.push(holePath);
          }
        }

        return new THREE.ExtrudeGeometry(shape, {
          depth: 0.8,
          bevelEnabled: true,
          bevelThickness: 0.05,
          bevelSize: 0.05,
          bevelSegments: 3
        });
      });
    } catch (e) {
      return [];
    }
  }, [feature]);

  const tooltipPosition = useMemo(() => {
    if (!districtGeometries.length) return new THREE.Vector3(0, 0, 0);
    districtGeometries[0].computeBoundingBox();
    const bbox = districtGeometries[0].boundingBox;
    if (!bbox) return new THREE.Vector3(0, 0, 0);
    return new THREE.Vector3().addVectors(bbox.min, bbox.max).multiplyScalar(0.5).setZ(1.5);
  }, [districtGeometries]);

  useFrame(() => {
    if (!meshGroupRef.current) return;
    const targetZ = isActive ? 1.5 : hovered ? 0.5 : 0;
    meshGroupRef.current.position.z = THREE.MathUtils.lerp(
      meshGroupRef.current.position.z, 
      targetZ, 
      0.15 
    );
  });

  return (
    <group 
      ref={meshGroupRef}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
      
      // THE FIX: Convert the local tooltip position to an absolute World Coordinate
      onClick={(e) => { 
        e.stopPropagation(); 
        if (meshGroupRef.current) {
          const worldCenter = meshGroupRef.current.localToWorld(tooltipPosition.clone());
          onClick(worldCenter);
        }
      }}
      onDoubleClick={(e) => { 
        e.stopPropagation(); 
        if (meshGroupRef.current) {
          const worldCenter = meshGroupRef.current.localToWorld(tooltipPosition.clone());
          onDoubleClick(worldCenter);
        }
      }}
      
      onPointerEnter={() => document.body.style.cursor = 'pointer'}
      onPointerLeave={() => document.body.style.cursor = 'auto'}
    >
      {districtGeometries.map((geo, i) => (
        <mesh key={i} geometry={geo}>
          {/* UPGRADED: Physical Material for that high-end "Glassmorphic Resin" look */}
          <meshPhysicalMaterial 
            color={isActive ? "#5ffcf4" : hovered ? "#14b8a6" : "#0d9488"} 
            emissive={isActive ? "#0d9488" : hovered ? "#0f766e" : "#042f2e"}
            emissiveIntensity={isActive ? 2 : hovered ? 1.5 : 1}
            roughness={isActive ? 0.1 : 0.3} // Smoother when clicked
            metalness={0.8}
            clearcoat={1.0} // Adds a highly polished "wet" layer on top of the metal
            clearcoatRoughness={0.1}
            transparent
            opacity={0.85}
          />
          {/* Edges adapt to hover/active state */}
          <Edges threshold={20}>
            <meshBasicMaterial 
              color={isActive ? "#ffffff" : hovered ? "#5ffcf4" : "#2dd4bf"} 
              toneMapped={false} 
            />
          </Edges>
        </mesh>
      ))}

      {(hovered || isActive) && (
        <Html 
          position={tooltipPosition} 
          center 
          style={{ pointerEvents: 'none' }} 
          zIndexRange={[100, 0]}
        >
          <div className="pointer-events-none bg-[#020617]/90 backdrop-blur-md border border-teal-500/50 px-3 py-1.5 rounded flex items-center gap-2 drop-shadow-[0_0_15px_rgba(45,212,191,0.5)] transform transition-transform scale-100 animate-in fade-in zoom-in duration-200">
            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-white animate-pulse' : 'bg-teal-400'}`} />
            <span className="text-white text-xs font-bold uppercase tracking-widest whitespace-nowrap">
              {districtName}
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}