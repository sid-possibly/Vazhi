import { useState } from 'react';
import LoadingScreen from './components/ui/LoadingScreen';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars, Sky } from '@react-three/drei';
import KeralaMap from './components/canvas/KeralaMap';
import './App.css';

function App() {
  const [loading, setLoading] = useState(true);

  return (
    <div className="w-full h-full">
      {loading ? (
        <LoadingScreen onComplete={() => setLoading(false)} />
      ) : (
        <div className="canvas-container">
          <Canvas 
            camera={{ position: [0, -10, 45], fov: 45 }} // Pulled back and angled perfectly
            style={{ width: '100vw', height: '100vh' }}
          >
            {/* The Void: Deep dark blue background with matching fog */}
            <color attach="background" args={['#020617']} />
            <fog attach="fog" args={['#020617', 30, 80]} />

            {/* Cinematic Lighting: Low ambient light + warm orange "sunlight" */}
            <ambientLight intensity={0.4} />
            <directionalLight position={[-10, 20, 10]} intensity={2} color="#fed7aa" />
            
            <Stars radius={100} depth={50} count={5000} factor={4} saturation={1} fade speed={1} />
            
            <KeralaMap />

            <OrbitControls 
              enableDamping={true} 
              maxPolarAngle={Math.PI / 2.2} // Prevents camera from going completely under the map
              minDistance={20}
              maxDistance={80}
            />
          </Canvas>

          {/* Overlay UI */}
          <div className="absolute top-10 left-10 pointer-events-none z-10">
            <h1 className="text-white text-5xl font-black tracking-tighter uppercase leading-none">
              VAZHI <span className="text-blue-500 text-xl block mt-2">Live Intelligence</span>
            </h1>
          </div>
        </div>
      )}
    </div>
  );
}
export default App;