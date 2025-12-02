/**
 * WASM Loader - Ported from React for Svelte 5
 * Handles loading and initialization of the geometry-wasm module
 */

import {
  BufferGeometry,
  BufferAttribute,
  MeshStandardMaterial,
  DoubleSide,
  type Material
} from 'three';

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
  if (wasmStore) return wasmStore;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    // Dynamic import of the WASM module
    const wasm = await import('../../../geometry-wasm/pkg/geometry_wasm') as unknown as WasmModule;

    // Initialize the WASM module
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
 */
export async function resetWasmStore(): Promise<WasmStore> {
  if (wasmStore) {
    wasmStore.free();
  }
  wasmStore = null;
  initPromise = null;
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
  free(): void;
}

/**
 * Combined rendering result with shell and room meshes
 */
export interface CombinedRenderResult {
  shell: WasmMesh;
  rooms: WasmMesh[];
}

/**
 * Framing render result with mesh and member type
 */
export interface FramingRenderItem {
  mesh: WasmMesh;
  memberType: string;
}

/**
 * Cost estimate returned from WASM
 */
export interface CostEstimate {
  id: string;
  level_id: string;
  line_items: CostLineItem[];
  subtotals: Record<string, number>;
  labor_total: number;
  material_total: number;
  grand_total: number;
  created_at: string;
  notes?: string;
}

export interface CostLineItem {
  id: string;
  category: string;
  description: string;
  material_type?: string;
  labor_type?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  total: number;
  notes?: string;
}

export interface UnitPrice {
  material_type: string;
  unit: string;
  price: number;
  description?: string;
  supplier?: string;
  last_updated?: string;
}

export interface LaborRate {
  labor_type: string;
  unit: string;
  rate: number;
  description?: string;
}

export interface PriceTable {
  material_prices: Record<string, UnitPrice>;
  labor_rates: Record<string, LaborRate>;
}

/**
 * Extended WasmStore interface with rendering methods.
 */
export interface WasmStoreExtended {
  render_level(level_id: string): WasmMesh;
  render_level_shell(level_id: string, wall_thickness: number): WasmMesh;
  render_rooms(level_id: string): WasmMesh[];
  render_level_combined(level_id: string, wall_thickness: number): CombinedRenderResult;
  // Wall and framing rendering methods
  render_walls?(level_id: string): WasmMesh[];
  render_wall_framing?(wall_id: string): FramingRenderItem[];
  // Query methods for state derivation
  get_level_rooms?(level_id: string): unknown;
  get_level_walls?(level_id: string): string[];
  get_observable_state?(level_id: string): unknown;
  get_mutation_count?(): number;
  // Cost estimation methods
  generate_cost_estimate?(level_id: string): CostEstimate;
  set_material_price?(material_type: string, unit: string, price: number): void;
  set_labor_rate?(labor_type: string, unit: string, rate: number): void;
  get_price_table?(): PriceTable;
  import_price_table?(table: PriceTable): void;
  get_material_types?(): string[];
  get_labor_types?(): string[];
  get_pricing_units?(): string[];
}

/**
 * Geometry loader with material caching for performance
 */
const materialCache = new Map<number, MeshStandardMaterial>();

export class WasmGeometryLoader {
  /**
   * Convert a WasmMesh to a THREE.BufferGeometry
   */
  static load(wasmMesh: WasmMesh): BufferGeometry {
    const geometry = new BufferGeometry();

    geometry.setAttribute(
      'position',
      new BufferAttribute(wasmMesh.positions, 3)
    );

    geometry.setAttribute(
      'normal',
      new BufferAttribute(wasmMesh.normals, 3)
    );

    geometry.setIndex(new BufferAttribute(wasmMesh.indices, 1));

    // Cleanup WASM memory
    wasmMesh.free();

    return geometry;
  }

  /**
   * Get cached material for a color - prevents memory leaks from duplicate materials
   */
  static getCachedMaterial(color: number = 0xe2e8f0): MeshStandardMaterial {
    if (!materialCache.has(color)) {
      materialCache.set(color, new MeshStandardMaterial({
        color,
        roughness: 0.85,
        metalness: 0.05,
        side: DoubleSide
      }));
    }
    return materialCache.get(color)!;
  }

  /**
   * Create a new material (for cases where caching isn't desired)
   */
  static createMaterial(color: number = 0xe2e8f0): Material {
    return new MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.05,
      side: DoubleSide
    });
  }

  /**
   * Clear material cache (call on cleanup)
   */
  static clearCache(): void {
    materialCache.forEach(m => m.dispose());
    materialCache.clear();
  }
}
