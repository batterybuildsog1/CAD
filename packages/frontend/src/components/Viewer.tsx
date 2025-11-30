"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";

export default function Viewer() {
  return (
    <div className="w-full h-screen bg-slate-900">
      <Canvas camera={{ position: [10, 10, 10], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <pointLight position={[10, 10, 10]} />
        <Grid
          infiniteGrid
          fadeDistance={75}
          sectionColor="#4b5563"
          cellColor="#1f2937"
        />
        <OrbitControls makeDefault />
      </Canvas>
    </div>
  );
}
