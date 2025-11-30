import * as THREE from 'three';

// Type-only import for the WASM module types
import type { WasmStore, WasmMesh as WasmMeshClass } from '../../../geometry-wasm/pkg/geometry_wasm';

// Re-export WasmStore type for consumers
export type { WasmStore };

/**
 * Interface describing the shape of the loaded WASM module
 */
interface WasmModule {
  default: (input?: unknown) => Promise<void>;
  init_panic_hook: () => void;
  WasmStore: new () => WasmStore;
  WasmMesh: typeof WasmMeshClass;
}

// Singleton state for WASM module
let wasmModule: WasmModule | null = null;
let wasmStore: WasmStore | null = null;
let initPromise: Promise<WasmStore> | null = null;

/**
 * Initialize the WASM module and return a singleton WasmStore.
 * Safe to call multiple times - will return the same store.
 */
export async function getWasmStore(): Promise<WasmStore> {
  // Return existing store if already initialized
  if (wasmStore) return wasmStore;

  // Return pending promise if initialization is in progress
  if (initPromise) return initPromise;

  // Start initialization
  initPromise = (async () => {
    // Dynamic import of the WASM module
    const wasm = await import('../../../geometry-wasm/pkg/geometry_wasm') as unknown as WasmModule;

    // Initialize the WASM module (calls __wbg_init internally)
    await wasm.default();

    // Set up panic hook for better error messages
    wasm.init_panic_hook();

    // Create and cache the store
    wasmModule = wasm;
    wasmStore = new wasm.WasmStore();

    return wasmStore;
  })();

  return initPromise;
}

/**
 * Check if WASM is already initialized without triggering initialization
 */
export function isWasmInitialized(): boolean {
  return wasmStore !== null;
}

/**
 * Reset the WASM store singleton (for testing or starting fresh).
 * Frees the existing store and creates a new one.
 *
 * @returns Promise<WasmStore> - the new store instance
 */
export async function resetWasmStore(): Promise<WasmStore> {
  // Free the existing store if it exists
  if (wasmStore) {
    wasmStore.free();
  }

  // Clear the singleton state so getWasmStore creates a new one
  wasmStore = null;
  initPromise = null;

  // Create and return a fresh store
  return getWasmStore();
}

/**
 * Get the raw WASM module (after initialization)
 */
export function getWasmModule(): WasmModule | null {
  return wasmModule;
}

// Interface matching the Rust WasmMesh struct
export interface WasmMesh {
    positions: Float32Array;
    normals: Float32Array;
    indices: Uint32Array;
    free(): void; // Wasm bindgen objects need to be freed
}

/**
 * Combined rendering result with shell and room meshes
 */
export interface CombinedRenderResult {
    shell: WasmMesh;
    rooms: WasmMesh[];
}

/**
 * Extended WasmStore interface with new rendering methods.
 * Note: The base WasmStore type comes from the WASM module.
 * These are additional methods that will be available after WASM rebuild.
 */
export interface WasmStoreExtended {
    // Existing method
    render_level(level_id: string): WasmMesh;

    // NEW: Hollow shell rendering (walls with interior cutout)
    render_level_shell?(level_id: string, wall_thickness: number): WasmMesh;

    // NEW: Room floor plates
    render_rooms?(level_id: string): WasmMesh[];

    // NEW: Combined rendering (shell + rooms)
    render_level_combined?(level_id: string, wall_thickness: number): CombinedRenderResult;
}

export class WasmGeometryLoader {
    /**
     * Convert a WasmMesh to a THREE.BufferGeometry
     */
    static load(wasmMesh: WasmMesh): THREE.BufferGeometry {
        const geometry = new THREE.BufferGeometry();

        // Set attributes
        geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(wasmMesh.positions, 3)
        );

        geometry.setAttribute(
            'normal',
            new THREE.BufferAttribute(wasmMesh.normals, 3)
        );

        // Set indices
        geometry.setIndex(new THREE.BufferAttribute(wasmMesh.indices, 1));

        // Cleanup WASM memory
        wasmMesh.free();

        return geometry;
    }

    /**
     * Create a material for the mesh
     */
    static createMaterial(color: number = 0xcccccc): THREE.Material {
        return new THREE.MeshStandardMaterial({
            color,
            roughness: 0.5,
            metalness: 0.1,
            side: THREE.DoubleSide, // Render both sides for walls
        });
    }
}
