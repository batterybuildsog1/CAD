'use client';

/**
 * CadLabCanvas
 *
 * Minimal React Three Fiber viewer for the experimental Cad3DModel.
 * This is NOT wired into the main workspace; it is only used by the
 * /cad-lab page for visual experiments.
 */

import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { useMemo } from 'react';

import type { Cad3DModel, CadElement, RoomElement, StudElement } from './model';
import { isRoomElement, isStudElement } from './model';

interface CadLabCanvasProps {
  model: Cad3DModel;
}

function Rooms({ elements }: { elements: CadElement[] }) {
  const meshes = useMemo(() => {
    return elements
      .filter(isRoomElement)
      .map((room) => {
        // Simple box approximation from bounding box of footprint
        const xs = room.footprint.map((p) => p[0]);
        const ys = room.footprint.map((p) => p[1]);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);

        const width = maxX - minX;
        const depth = maxY - minY;
        const height = room.height;

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;

        const geometry = new THREE.BoxGeometry(width, height, depth);

        return {
          id: room.id,
          name: room.name,
          geometry,
          position: [centerX, height / 2, centerY] as [number, number, number],
          color: 0x4ade80, // green-ish for now
        };
      });
  }, [elements]);

  return (
    <>
      {meshes.map((m) => (
        <mesh key={m.id} position={m.position} geometry={m.geometry}>
          <meshStandardMaterial color={m.color} opacity={0.5} transparent />
        </mesh>
      ))}
    </>
  );
}

function Studs({ elements }: { elements: CadElement[] }) {
  const meshes = useMemo(() => {
    return elements
      .filter(isStudElement)
      .map((stud) => {
        const { section, length, transform } = stud;
        const geometry = new THREE.BoxGeometry(section.width, length, section.depth);
        return {
          id: stud.id,
          geometry,
          position: transform.position as [number, number, number],
          rotation: transform.rotation as [number, number, number],
          color: 0x8b4513, // wood-like
        };
      });
  }, [elements]);

  return (
    <>
      {meshes.map((m) => (
        <mesh key={m.id} position={m.position} rotation={m.rotation} geometry={m.geometry}>
          <meshStandardMaterial color={m.color} />
        </mesh>
      ))}
    </>
  );
}

export function CadLabCanvas({ model }: CadLabCanvasProps) {
  return (
    <div className="w-full h-full bg-slate-900">
      <Canvas camera={{ position: [25, 20, 25], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[20, 30, 10]} intensity={1.0} />
        <Grid
          infiniteGrid
          fadeDistance={100}
          sectionColor="#4b5563"
          cellColor="#1f2937"
        />
        <OrbitControls makeDefault />

        <Rooms elements={model.elements} />
        <Studs elements={model.elements} />
      </Canvas>
    </div>
  );
}

export default CadLabCanvas;


