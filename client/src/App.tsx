import { useState } from 'react';
import LoadingScreen from './components/ui/LoadingScreen';
import IntelligencePanel from './components/ui/IntelligencePanel';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import KeralaMap from './components/canvas/KeralaMap';
import './App.css';

function App() {
  const [loading, setLoading] = useState(true);
  const [selectedDistrict, setSelectedDistrict] = useState<string | null>(null);

  return (
    <div className="w-full h-screen relative bg-[#020617] overflow-hidden">
      
      {/* Top Layer: Loading Screen (Z-100) */}
      {loading && <LoadingScreen onComplete={() => setLoading(false)} />}

      {/* Bottom Layer: Canvas (Always mounted to compile shaders early) */}
      <div className="canvas-container absolute inset-0 z-0">
        <Canvas 
          camera={{ position: [0, -10, 45], fov: 45 }} 
          style={{ width: '100vw', height: '100vh' }}
        >
          {/* The Void */}
          <color attach="background" args={['#020617']} />
          <fog attach="fog" args={['#020617', 20, 90]} />

          {/* Cinematic Grid Floor */}
          <gridHelper 
            args={[100, 50, '#1e293b', '#0f172a']} 
            position={[0, -2, 0]} 
            rotation={[0, 0, 0]} 
          />

          <ambientLight intensity={0.2} />
          <pointLight position={[10, 10, 10]} intensity={1.5} color="#2dd4bf" />

          <KeralaMap onDistrictSelect={setSelectedDistrict} />

          <OrbitControls 
            makeDefault // <-- THIS IS CRUCIAL
            enableDamping={true} 
            maxPolarAngle={Math.PI / 2.2} 
            minDistance={5} // <-- Lowered from 20 so we can zoom in tight
            maxDistance={80}
          />
        </Canvas>

        {/* Overlay UI Layer - Mounts only after loading completes */}
        {!loading && (
          <div className="absolute top-10 left-10 pointer-events-none z-10">
            <h1 className="text-white text-5xl font-black tracking-tighter uppercase leading-none">
              VAZHI <span className="text-blue-500 text-xl block mt-2">Live Intelligence</span>
            </h1>
          </div>
        )}

        {!loading && <IntelligencePanel districtName={selectedDistrict} />}
      </div>
    </div>
  );
}
export default App;
