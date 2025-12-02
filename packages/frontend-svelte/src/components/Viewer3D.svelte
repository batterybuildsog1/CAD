<script lang="ts">
  /**
   * Viewer3D.svelte - Three.js 3D CAD Viewer using Threlte
   * Ported from React Three Fiber to Svelte 5 + Threlte
   */
  import { Canvas, T, useTask } from '@threlte/core';
  import { OrbitControls, Grid } from '@threlte/extras';
  import { onDestroy, onMount } from 'svelte';
  import {
    BufferGeometry,
    Box3,
    Vector3,
    PerspectiveCamera
  } from 'three';
  import { wasmManager } from '$lib/wasm-store.svelte';
  import {
    WasmGeometryLoader,
    type WasmMesh,
    type WasmStoreExtended,
    type CombinedRenderResult,
    type FramingRenderItem
  } from '$lib/wasm-loader';
  import { FRAMING_COLORS, type FramingMemberType } from '$lib/framing-types';

  // Props
  interface Props {
    levelIds?: string[];
    showGrid?: boolean;
    backgroundColor?: string;
    renderMode?: 'solid' | 'shell' | 'combined' | 'walls' | 'framing';
    wallThickness?: number;
    selectedLevelIds?: string[];
    onLevelClick?: (levelId: string) => void;
    onStoreReady?: () => void;
  }

  let {
    levelIds = [],
    showGrid = true,
    backgroundColor = '#f3f4f6',
    renderMode = 'solid',
    wallThickness = 0.667,
    selectedLevelIds = [],
    onLevelClick,
    onStoreReady
  }: Props = $props();

  // Color palettes
  const ROOM_COLORS = [
    0x3b5249, 0x3d4a5c, 0x4a4359, 0x4a4a38, 0x45424a, 0x3d3d3d
  ];
  const LEVEL_COLORS = [
    0xe5e7eb, 0x9ca3af, 0xcbd5e1, 0xa1a1aa
  ];

  // Mesh data structure
  interface LevelMeshData {
    levelId: string;
    geometry: BufferGeometry;
    color: number;
  }

  // Reactive state
  let meshes = $state<LevelMeshData[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let camera = $state<PerspectiveCamera | undefined>(undefined);

  // Track geometries for cleanup
  let geometries: BufferGeometry[] = [];

  // Initialize WASM on mount
  onMount(async () => {
    try {
      await wasmManager.init();
      loading = false;
      onStoreReady?.();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load WASM';
      loading = false;
    }
  });

  // Cleanup on destroy
  onDestroy(() => {
    geometries.forEach(g => g.dispose());
    WasmGeometryLoader.clearCache();
  });

  // Wall color constant
  const WALL_COLOR = 0x8B7355;  // Brown for walls

  /**
   * Render walls for a level
   */
  function renderWalls(
    store: WasmStoreExtended,
    levelId: string,
    newMeshes: LevelMeshData[]
  ): void {
    if (!store.render_walls) {
      console.warn('[Viewer3D] render_walls not available');
      return;
    }

    try {
      const wallMeshes = store.render_walls(levelId);
      if (!wallMeshes?.length) {
        console.warn(`[Viewer3D] No wall meshes returned for level ${levelId}`);
        return;
      }

      wallMeshes.forEach((wasmMesh: WasmMesh, idx: number) => {
        const geometry = WasmGeometryLoader.load(wasmMesh);
        geometries.push(geometry);
        newMeshes.push({
          levelId: `${levelId}_wall_${idx}`,
          geometry,
          color: WALL_COLOR
        });
      });

      console.log(`[Viewer3D] Rendered ${wallMeshes.length} walls for level ${levelId}`);
    } catch (e) {
      console.warn('[Viewer3D] Wall rendering failed:', e);
    }
  }

  /**
   * Render framing members for all walls on a level
   */
  function renderFraming(
    store: WasmStoreExtended,
    levelId: string,
    newMeshes: LevelMeshData[]
  ): void {
    if (!store.render_wall_framing || !store.get_level_walls) {
      console.warn('[Viewer3D] render_wall_framing or get_level_walls not available');
      return;
    }

    try {
      // Get all walls on level
      const wallIds = store.get_level_walls(levelId);
      if (!wallIds?.length) {
        console.warn(`[Viewer3D] No walls found for level ${levelId}`);
        return;
      }

      let totalFramingMembers = 0;

      wallIds.forEach((wallId: string) => {
        const framingData = store.render_wall_framing!(wallId);
        if (!framingData?.length) return;

        framingData.forEach((item: FramingRenderItem, idx: number) => {
          const geometry = WasmGeometryLoader.load(item.mesh);
          const memberType = item.memberType as FramingMemberType;
          const color = FRAMING_COLORS[memberType] || 0xD4A574;

          geometries.push(geometry);
          newMeshes.push({
            levelId: `${levelId}_framing_${wallId}_${idx}`,
            geometry,
            color
          });
          totalFramingMembers++;
        });
      });

      console.log(`[Viewer3D] Rendered ${totalFramingMembers} framing members for level ${levelId}`);
    } catch (e) {
      console.warn('[Viewer3D] Framing rendering failed:', e);
    }
  }

  // Render meshes when levelIds or renderMode changes
  $effect(() => {
    if (!wasmManager.store || levelIds.length === 0) {
      meshes = [];
      return;
    }

    const newMeshes: LevelMeshData[] = [];
    const store = wasmManager.store as unknown as WasmStoreExtended;
    const levelsSnapshot = Array.isArray(levelIds) ? [...levelIds] : levelIds;
    console.log('[Viewer3D] Rendering levels:', levelsSnapshot, 'mode:', renderMode);

    for (let i = 0; i < levelIds.length; i++) {
      const levelId = levelIds[i];

      try {
        // Handle walls-only mode
        if (renderMode === 'walls') {
          renderWalls(store, levelId, newMeshes);
          continue;
        }

        // Handle framing mode (walls + framing members)
        if (renderMode === 'framing') {
          renderWalls(store, levelId, newMeshes);  // Render walls as context
          renderFraming(store, levelId, newMeshes);  // Overlay framing
          continue;
        }

        if (renderMode === 'shell') {
          if (!store.render_level_shell) {
            console.error(`[Viewer3D] render_level_shell not available for ${levelId}`);
            continue;
          }
          const wasmMesh = store.render_level_shell(levelId, wallThickness);
          const geometry = WasmGeometryLoader.load(wasmMesh);
          geometries.push(geometry);
          newMeshes.push({
            levelId,
            geometry,
            color: LEVEL_COLORS[i % LEVEL_COLORS.length]
          });
          continue;
        }

        if (renderMode === 'combined') {
          if (!store.render_level_combined) {
            throw new Error(`[Viewer3D] render_level_combined not implemented in WASM`);
          }

          const combined = store.render_level_combined(levelId, wallThickness);
          console.log(`[Viewer3D] render_level_combined returned:`, combined);

          if (!combined) {
            throw new Error(`[Viewer3D] render_level_combined(${levelId}) returned null/undefined`);
          }

          if (!combined.shell) {
            throw new Error(`[Viewer3D] render_level_combined(${levelId}) missing 'shell' property. Got keys: ${Object.keys(combined).join(', ')}`);
          }

          const shellGeometry = WasmGeometryLoader.load(combined.shell);
          geometries.push(shellGeometry);
          newMeshes.push({
            levelId,
            geometry: shellGeometry,
            color: LEVEL_COLORS[i % LEVEL_COLORS.length]
          });

          if (!combined.rooms) {
            throw new Error(`[Viewer3D] render_level_combined(${levelId}) missing 'rooms' property`);
          }

          combined.rooms.forEach((roomMesh, roomIndex) => {
            const roomGeometry = WasmGeometryLoader.load(roomMesh);
            geometries.push(roomGeometry);
            newMeshes.push({
              levelId: `${levelId}_room_${roomIndex}`,
              geometry: roomGeometry,
              color: ROOM_COLORS[roomIndex % ROOM_COLORS.length]
            });
          });
          continue;
        }

        // Solid mode (default)
        const wasmMesh = store.render_level(levelId);
        const geometry = WasmGeometryLoader.load(wasmMesh);
        geometries.push(geometry);
        newMeshes.push({
          levelId,
          geometry,
          color: LEVEL_COLORS[i % LEVEL_COLORS.length]
        });
      } catch (e) {
        console.error(`[Viewer3D] Failed to render level ${levelId}:`, e);
      }
    }

    meshes = newMeshes;
  });

  // Auto-fit camera to content
  $effect(() => {
    if (camera && meshes.length > 0) {
      const box = new Box3();
      meshes.forEach(({ geometry }) => {
        geometry.computeBoundingBox();
        if (geometry.boundingBox) {
          box.union(geometry.boundingBox);
        }
      });

      const center = new Vector3();
      const size = new Vector3();
      box.getCenter(center);
      box.getSize(size);

      const maxDim = Math.max(size.x, size.y, size.z);
      const distance = maxDim * 2;
      camera.position.set(center.x + distance, distance, center.z + distance);
      camera.lookAt(center);
    }
  });

  function handleMeshClick(levelId: string) {
    onLevelClick?.(levelId);
  }

  function isSelected(levelId: string): boolean {
    return selectedLevelIds.includes(levelId);
  }
</script>

<div class="relative w-full h-full" style="background-color: {backgroundColor}">
  {#if loading}
    <div class="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
      <div class="text-white text-sm">Loading WASM module...</div>
    </div>
  {/if}

  {#if error}
    <div class="absolute inset-0 flex items-center justify-center bg-gray-900 text-red-400">
      Error: {error}
    </div>
  {:else}
    <Canvas>
      <!-- Camera -->
      <T.PerspectiveCamera
        makeDefault
        position={[20, 20, 20]}
        fov={50}
        bind:ref={camera}
      >
        <OrbitControls />
      </T.PerspectiveCamera>

      <!-- Background color -->
      <T.Color attach="background" args={[backgroundColor]} />

      <!-- Lighting - Professional CAD setup -->
      <T.AmbientLight intensity={0.6} color="#ffffff" />
      <T.DirectionalLight
        position={[20, 40, 20]}
        intensity={1.0}
        color="#ffffff"
        castShadow
      />
      <T.PointLight position={[-15, 25, -15]} intensity={0.4} color="#ffffff" />

      <!-- Grid -->
      {#if showGrid}
        <Grid
          infiniteGrid
          fadeDistance={100}
          sectionColor="#d1d5db"
          cellColor="#e5e7eb"
        />
      {/if}

      <!-- Ground plane -->
      <T.Mesh rotation.x={-Math.PI / 2} position.y={-0.01} receiveShadow>
        <T.PlaneGeometry args={[500, 500]} />
        <T.MeshStandardMaterial color="#e5e7eb" roughness={0.9} metalness={0} />
      </T.Mesh>

      <!-- Render all level meshes -->
      {#each meshes as { levelId, geometry, color }}
        <T.Mesh
          {geometry}
          castShadow
          receiveShadow
          onclick={() => handleMeshClick(levelId)}
        >
          <T.MeshStandardMaterial
            color={isSelected(levelId) ? 0xfbbf24 : color}
            roughness={0.85}
            metalness={0.05}
            side={2}
          />
        </T.Mesh>
      {/each}
    </Canvas>
  {/if}
</div>
