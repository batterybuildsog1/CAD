"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";

export default function Viewer() {
  return (
    <div className="w-full h-screen bg-gray-900">
      <Canvas camera={{ position: [10, 10, 10], fov: 50 }}>
        <ambientLight intensity={0.5} />
        <pointLight position={[10, 10, 10]} />
        <Grid infiniteGrid fadeDistance={50} sectionColor="#4a4a4a" cellColor="#2a2a2a" />
        <OrbitControls makeDefault />
        
        {/* Test Cube */}
        <mesh position={[0, 0.5, 0]}>
          <boxGeometry />
          <meshStandardMaterial color="orange" />
        </mesh>
      </Canvas>
    </div>
  );
}
