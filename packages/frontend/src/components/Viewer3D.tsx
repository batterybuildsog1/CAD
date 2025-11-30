'use client';

import { useEffect, useState, useMemo, Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { getWasmStore, WasmGeometryLoader, type WasmStore, type WasmStoreExtended } from '@/lib/wasm-loader';

// ============================================================================
// Types
// ============================================================================

/** Render mode for the 3D viewer */
export type RenderMode = 'solid' | 'shell' | 'combined';

interface Viewer3DProps {
  /** Level IDs to render (if not provided, renders nothing until levels exist) */
  levelIds?: string[];
  /** Callback when WASM store is ready */
  onStoreReady?: (store: WasmStore) => void;
  /** Whether to show the grid */
  showGrid?: boolean;
  /** Background color */
  backgroundColor?: string;
  /** Render mode: 'solid' (default, backward compatible), 'shell' (hollow walls), 'combined' (shell + rooms) */
  renderMode?: RenderMode;
  /** Wall thickness in feet for shell/combined modes (default: 0.667 = 8 inches for 2x6 stucco assembly) */
  wallThickness?: number;
}

interface LevelMeshData {
  levelId: string;
  geometry: THREE.BufferGeometry;
  color: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Default wall thickness in feet (8 inches = 0.667 ft for 2x6 stucco assembly) */
const DEFAULT_WALL_THICKNESS = 0.667;

/** Color palette for room floor plates */
const ROOM_COLORS = [
  0x90EE90, // Light green - living
  0xFFB6C1, // Light pink - bedroom
  0x87CEEB, // Sky blue - bathroom
  0xFFDAB9, // Peach - kitchen
  0xDDA0DD, // Plum - dining
  0xF0E68C, // Khaki - utility
];

/** Colors for level shells/walls */
const LEVEL_COLORS = [0xcccccc, 0xaaaaff, 0xffaaaa, 0xaaffaa];

// ============================================================================
// LevelMesh Component - Renders a single level
// ============================================================================

function LevelMesh({ geometry, color }: { geometry: THREE.BufferGeometry; color: number }) {
  const material = useMemo(
    () => WasmGeometryLoader.createMaterial(color),
    [color]
  );

  return (
    <mesh geometry={geometry}>
      <primitive object={material} attach="material" />
    </mesh>
  );
}

// ============================================================================
// Scene Content - What goes inside Canvas
// ============================================================================

function SceneContent({
  levelMeshes,
  showGrid = true,
}: {
  levelMeshes: LevelMeshData[];
  showGrid?: boolean;
}) {
  const { camera } = useThree();

  // Auto-fit camera to content
  useEffect(() => {
    if (levelMeshes.length > 0) {
      // Compute bounding box of all meshes
      const box = new THREE.Box3();
      levelMeshes.forEach(({ geometry }) => {
        geometry.computeBoundingBox();
        if (geometry.boundingBox) {
          box.union(geometry.boundingBox);
        }
      });

      // Get center and size
      const center = new THREE.Vector3();
      const size = new THREE.Vector3();
      box.getCenter(center);
      box.getSize(size);

      // Position camera to see all content
      const maxDim = Math.max(size.x, size.y, size.z);
      const distance = maxDim * 2;
      camera.position.set(center.x + distance, distance, center.z + distance);
      camera.lookAt(center);
    }
  }, [levelMeshes, camera]);

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 10]} intensity={1} castShadow />
      <pointLight position={[-10, 10, -10]} intensity={0.5} />

      {showGrid && (
        <Grid
          infiniteGrid
          fadeDistance={100}
          sectionColor="#4a4a4a"
          cellColor="#2a2a2a"
        />
      )}

      <OrbitControls makeDefault />

      {/* Render all level meshes */}
      {levelMeshes.map(({ levelId, geometry, color }) => (
        <LevelMesh key={levelId} geometry={geometry} color={color} />
      ))}
    </>
  );
}

// ============================================================================
// Loading Indicator
// ============================================================================

function LoadingIndicator() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50">
      <div className="text-white text-sm">Loading WASM module...</div>
    </div>
  );
}

// ============================================================================
// Main Viewer3D Component
// ============================================================================

export function Viewer3D({
  levelIds = [],
  onStoreReady,
  showGrid = true,
  backgroundColor = '#0b1120',
  renderMode = 'solid',
  wallThickness = DEFAULT_WALL_THICKNESS,
}: Viewer3DProps) {
  const [store, setStore] = useState<WasmStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [levelMeshes, setLevelMeshes] = useState<LevelMeshData[]>([]);

  // Initialize WASM store on mount
  useEffect(() => {
    let mounted = true;

    async function initWasm() {
      try {
        const wasmStore = await getWasmStore();
        if (mounted) {
          setStore(wasmStore);
          setLoading(false);
          onStoreReady?.(wasmStore);
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : 'Failed to load WASM');
          setLoading(false);
        }
      }
    }

    initWasm();

    return () => {
      mounted = false;
    };
  }, [onStoreReady]);

  // Render levels when store is ready and levelIds change
  useEffect(() => {
    if (!store || levelIds.length === 0) {
      setLevelMeshes([]);
      return;
    }

    const newMeshes: LevelMeshData[] = [];
    const extendedStore = store as unknown as WasmStoreExtended;

    console.log('[Viewer3D] Rendering levels:', levelIds, 'mode:', renderMode);

    for (let i = 0; i < levelIds.length; i++) {
      const levelId = levelIds[i];

      if (renderMode === 'shell') {
        if (!extendedStore.render_level_shell) {
          console.error(
            `[Viewer3D] render_level_shell is not available on WasmStore; cannot render shell mode for level ${levelId}`
          );
          continue;
        }

        const wasmMesh = extendedStore.render_level_shell(levelId, wallThickness);
        const geometry = WasmGeometryLoader.load(wasmMesh);
        newMeshes.push({
          levelId,
          geometry,
          color: LEVEL_COLORS[i % LEVEL_COLORS.length],
        });
        continue;
      }

      if (renderMode === 'combined') {
        if (!extendedStore.render_level_combined) {
          console.error(
            `[Viewer3D] render_level_combined is not available on WasmStore; cannot render combined mode for level ${levelId}`
          );
          continue;
        }

        const combined = extendedStore.render_level_combined(levelId, wallThickness);

        // Require a valid shell; if missing, treat as a hard failure for this level.
        if (!combined.shell) {
          console.error(
            `[Viewer3D] Combined render for level ${levelId} did not return a shell mesh; skipping level`
          );
          continue;
        }

        const shellGeometry = WasmGeometryLoader.load(combined.shell);
        newMeshes.push({
          levelId,
          geometry: shellGeometry,
          color: LEVEL_COLORS[i % LEVEL_COLORS.length],
        });

        combined.rooms.forEach((roomMesh, roomIndex) => {
          const roomGeometry = WasmGeometryLoader.load(roomMesh);
          newMeshes.push({
            levelId: `${levelId}_room_${roomIndex}`,
            geometry: roomGeometry,
            color: ROOM_COLORS[roomIndex % ROOM_COLORS.length],
          });
        });

        continue;
      }

      // Solid mode (explicit) – no fallbacks from other modes
      const wasmMesh = store.render_level(levelId);
      const geometry = WasmGeometryLoader.load(wasmMesh);
      newMeshes.push({
        levelId,
        geometry,
        color: LEVEL_COLORS[i % LEVEL_COLORS.length],
      });
    }

    setLevelMeshes(newMeshes);

    // Cleanup geometries on unmount
    return () => {
      newMeshes.forEach(({ geometry }) => geometry.dispose());
    };
  }, [store, levelIds, renderMode, wallThickness]);

  if (error) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-900 text-red-400">
        Error: {error}
      </div>
    );
  }

  return (
    <div className="relative w-full h-full" style={{ backgroundColor }}>
      {loading && <LoadingIndicator />}
      <Canvas shadows>
        <PerspectiveCamera makeDefault position={[20, 20, 20]} fov={50} />
        <color attach="background" args={[backgroundColor]} />
        <Suspense fallback={null}>
          <SceneContent levelMeshes={levelMeshes} showGrid={showGrid} />
        </Suspense>
      </Canvas>
    </div>
  );
}

// ============================================================================
// Hook for imperative control
// ============================================================================

/**
 * Hook to get the WASM store for imperative use outside the Viewer3D component.
 * Useful for creating geometry programmatically.
 */
export function useWasmStore() {
  const [store, setStore] = useState<WasmStore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    getWasmStore()
      .then((s) => {
        if (mounted) {
          setStore(s);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (mounted) {
          setError(e);
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  return { store, loading, error };
}

export default Viewer3D;
