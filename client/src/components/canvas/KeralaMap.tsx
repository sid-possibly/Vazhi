import { useEffect, useState, useRef, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Edges, Html } from '@react-three/drei';
import { io } from 'socket.io-client';

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
      targetCameraPos.set(
        zoomTarget.x + Math.sin(time * 0.15) * 5,
        zoomTarget.y - 5,
        zoomTarget.z + 15
      );
      targetLookAt.copy(zoomTarget);
    } else {
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
  const [liveBuses, setLiveBuses] = useState<Record<string, any>>({});
  const [hoveredBus, setHoveredBus] = useState<string | null>(null); // Added state here
  
  const groupRef = useRef<THREE.Group>(null);
  const center = [76.5, 10.5]; 
  const scale = 12;

  useEffect(() => {
    const socket = io('http://localhost:4000');
    socket.on('connect', () => console.log('✅ Vazhi Intelligence: Link Established'));
    socket.on('transit_update', (data) => {
      setLiveBuses(prev => ({ ...prev, [data.vehicleId]: data }));
    });
    return () => { socket.disconnect(); };
  }, []);

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
          setZoomTarget(null);
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
                if (zoomTarget) setZoomTarget(centerPoint);
              }}
              onDoubleClick={(centerPoint) => {
                setActiveDistrict(districtName);
                setZoomTarget(centerPoint);
              }}
            />
          );
        })}

        {/* TRANSIT DATA LAYER - Traveller HUD Mode */}
        {Object.values(liveBuses).map((bus: any) => {
          const isZoomed = zoomTarget !== null;
          const isHovered = hoveredBus === bus.vehicleId;
          const x = (bus.lon - center[0]) * scale;
          const y = (bus.lat - center[1]) * scale;
          
          return (
            <group 
              key={bus.vehicleId} 
              position={[x, y, 1.2]}
              onPointerOver={(e) => { e.stopPropagation(); setHoveredBus(bus.vehicleId); }}
              onPointerOut={() => setHoveredBus(null)}
            >
              <mesh>
                <sphereGeometry args={[isZoomed ? 0.05 : 0.08, 16, 16]} />
                <meshBasicMaterial color={isHovered ? "#5ffcf4" : "#ef4444"} toneMapped={false} />
              </mesh>

              <Html distanceFactor={isZoomed ? 6 : 12} center position={[0, 0, 0.5]}>
                <div className={`flex flex-col items-center transition-all duration-300 ${isZoomed ? 'scale-100' : 'scale-75 opacity-90'}`}>
                  {/* ID Tag */}
                  <div className={`px-2 py-0.5 rounded border transition-colors ${isHovered ? 'bg-cyan-500 border-white text-black' : 'bg-slate-950/90 border-red-500/50 text-red-400'}`}>
                    <span className="font-mono text-[10px] font-bold">{bus.vehicleId}</span>
                  </div>

                  {/* Expanded Traveller Info (Only on Zoom/Hover) */}
                  {(isZoomed || isHovered) && (
                    <div className="mt-1 bg-slate-900/95 border border-teal-400/30 px-2 py-1 rounded backdrop-blur-md shadow-xl min-w-[80px]">
                      <div className="text-white text-[8px] leading-tight flex flex-col items-center">
                        <span className="text-teal-300 uppercase font-black tracking-tight text-center">
                          {bus.stopName || 'Stationary'}
                        </span>
                        <span className="text-[7px] text-slate-400 mt-1 uppercase">
                          Speed: {bus.speed} km/h
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </Html>
            </group>
          );
        })}
      </group>
    </>
  );
}

// 4. Individual District Mesh Component (Unchanged)
function DistrictMesh({ feature, districtName, isActive, onClick, onDoubleClick }: DistrictMeshProps) {
  const [hovered, setHovered] = useState(false);
  const meshGroupRef = useRef<THREE.Group>(null);
  const center = [76.5, 10.5]; 
  const scale = 12;

  // 1. OSM Texture Loader with CORS fix
  const osmTexture = useMemo(() => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous'); // Critical for loading external tiles
    
    // Fetching the standard OSM tile
    const tex = loader.load(
      'https://tile.openstreetmap.org/10/760/480.png',
      undefined,
      undefined,
      (err) => console.error("OSM Tile failed:", err)
    );
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }, []);

  // 2. Extrude Geometry with selective UV mapping
  const districtGeometries = useMemo<THREE.ExtrudeGeometry[]>(() => {
    try {
      const { geometry } = feature;
      const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      
      return polygons.map((polygon: any) => {
        const shape = new THREE.Shape();
        const exterior = polygon[0];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

        exterior.forEach(([lon, lat]: [number, number], i: number) => {
          const x = (lon - center[0]) * scale;
          const y = (lat - center[1]) * scale;
          if (i === 0) shape.moveTo(x, y);
          else shape.lineTo(x, y);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
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

        const geo = new THREE.ExtrudeGeometry(shape, {
          depth: 0.8,
          bevelEnabled: true,
          bevelThickness: 0.02,
          bevelSize: 0.02,
        });

        // REFINED UV LOGIC: Only project the map on the Top Face
        const pos = geo.attributes.position;
        const uvs = new Float32Array(pos.count * 2);
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          const y = pos.getY(i);
          const z = pos.getZ(i);
          
          if (z > 0.75) { // If it's a vertex on the top surface
            uvs[i * 2] = (x - minX) / (maxX - minX);
            uvs[i * 2 + 1] = (y - minY) / (maxY - minY);
          } else { // Vertex is on the sides or bottom
            uvs[i * 2] = 0;
            uvs[i * 2 + 1] = 0;
          }
        }
        geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
        return geo;
      });
    } catch (e) { return []; }
  }, [feature]);

  const tooltipPosition = useMemo(() => {
    if (!districtGeometries.length) return new THREE.Vector3(0, 0, 0);
    districtGeometries[0].computeBoundingBox();
    const bbox = districtGeometries[0].boundingBox;
    return bbox ? new THREE.Vector3().addVectors(bbox.min, bbox.max).multiplyScalar(0.5).setZ(1.2) : new THREE.Vector3(0,0,0);
  }, [districtGeometries]);

  useFrame(() => {
    if (!meshGroupRef.current) return;
    const targetZ = isActive ? 1.5 : hovered ? 0.4 : 0;
    meshGroupRef.current.position.z = THREE.MathUtils.lerp(meshGroupRef.current.position.z, targetZ, 0.1);
  });

  return (
    <group 
      ref={meshGroupRef}
      onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
      onPointerOut={() => setHovered(false)}
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
    >
      {districtGeometries.map((geo, i) => (
        <mesh key={i} geometry={geo}>
          {/* Top Texture Material */}
          <meshStandardMaterial 
            attach="material-0" 
            map={osmTexture} 
            color={isActive ? "#ffffff" : hovered ? "#b2fefb" : "#334155"} 
            roughness={0.6}
          />
          {/* Side Surface Material (Solid Dark Blue/Grey) */}
          <meshStandardMaterial 
            attach="material-1" 
            color="#0f172a" 
            metalness={0.8}
            roughness={0.2}
          />
          
          <Edges threshold={20}>
            <meshBasicMaterial color={isActive ? "#5ffcf4" : hovered ? "#38bdf8" : "#1e293b"} toneMapped={false} />
          </Edges>
        </mesh>
      ))}

      {(hovered || isActive) && (
        <Html position={tooltipPosition} center style={{ pointerEvents: 'none' }} zIndexRange={[100, 0]}>
          <div className="pointer-events-none bg-[#020617]/90 backdrop-blur-md border border-sky-500/50 px-3 py-1.5 rounded flex items-center gap-2 shadow-[0_0_15px_rgba(56,189,248,0.4)]">
            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-white animate-pulse' : 'bg-sky-400'}`} />
            <span className="text-white text-xs font-bold uppercase tracking-widest whitespace-nowrap">
              {districtName}
            </span>
          </div>
        </Html>
      )}
    </group>
  );
}