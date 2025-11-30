/**
 * WASM-based CAD Tool Executor
 *
 * Executes Gemini tool calls directly in the browser via WASM.
 * Implements the same CADToolExecutor interface as api-tool-executor.ts.
 *
 * Benefits:
 * - Zero latency (no HTTP roundtrips)
 * - Works offline
 * - Direct memory access for geometry
 *
 * @see docs/GEMINI_INTEGRATION.md
 *
 * Setup Requirements:
 * - Add "geometry-wasm": "file:../geometry-wasm/pkg" to frontend/package.json dependencies
 * - Or configure tsconfig paths: "@geometry-wasm": ["../geometry-wasm/pkg"]
 * - Run `npm install` from monorepo root after adding dependency
 */

import type {
  CADToolExecutor,
  ObservableState,
  ValidationStatus,
  EntityCounts,
} from './gemini-cad';
import type { ToolCall, ToolName } from './gemini-types';
// Import from the geometry-wasm package (workspace dependency)
// The package exports init() as default and WasmStore class
import init, { WasmStore } from 'geometry-wasm';

// ============================================================================
// WASM Initialization
// ============================================================================

let wasmInitialized = false;
let wasmStore: WasmStore | null = null;
let initPromise: Promise<WasmStore> | null = null;

/**
 * Initialize the WASM module and create a store singleton.
 * Safe to call multiple times - will return cached store.
 *
 * @returns Promise<WasmStore> - the initialized WasmStore instance
 */
export async function getWasmStore(): Promise<WasmStore> {
  // Return existing store if already initialized
  if (wasmInitialized && wasmStore) {
    return wasmStore;
  }

  // If initialization is in progress, wait for it
  if (initPromise) {
    return initPromise;
  }

  // Start initialization
  initPromise = (async () => {
    try {
      // Initialize the WASM module
      await init();
      wasmStore = new WasmStore();
      wasmInitialized = true;
      return wasmStore;
    } catch (error) {
      initPromise = null;
      throw new Error(`Failed to initialize WASM: ${error}`);
    }
  })();

  return initPromise;
}

/**
 * Reset the WASM store (useful for testing or starting fresh).
 * Creates a new store instance, freeing the old one.
 */
export async function resetWasmStore(): Promise<WasmStore> {
  if (wasmStore) {
    wasmStore.free();
    wasmStore = null;
  }

  if (!wasmInitialized) {
    await init();
    wasmInitialized = true;
  }

  wasmStore = new WasmStore();
  return wasmStore;
}

// Re-export WasmStore type for convenience
export type { WasmStore };

// ============================================================================
// Tool Handlers
// ============================================================================

type ToolHandler = (
  store: WasmStore,
  args: Record<string, unknown>
) => { success: boolean; data?: unknown; error?: string };

const toolHandlers: Partial<Record<ToolName, ToolHandler>> = {
  create_project: (store, args) => {
    try {
      const id = store.create_project(args.name as string);
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  add_building: (store, args) => {
    try {
      const id = store.add_building(
        args.project_id as string,
        args.name as string
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  add_level: (store, args) => {
    try {
      const id = store.add_level(
        args.building_id as string,
        args.name as string,
        args.elevation as number,
        args.floor_to_floor as number
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  set_level_footprint: (store, args) => {
    try {
      const id = store.set_level_footprint(
        args.level_id as string,
        args.points as number[][]
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  set_level_footprint_rect: (store, args) => {
    try {
      const id = store.set_level_footprint_rect(
        args.level_id as string,
        args.width as number,
        args.depth as number
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  create_wall_assembly: (store, args) => {
    try {
      const id = store.create_wall_assembly(args.name as string);
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  create_wall: (store, args) => {
    try {
      const id = store.create_wall(
        args.level_id as string,
        args.assembly_id as string,
        args.start as number[],
        args.end as number[],
        args.height as number
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  create_room: (store, args) => {
    try {
      const id = store.create_room(
        args.level_id as string,
        args.room_type as string,
        args.name as string,
        args.points as number[][]
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ============ QUERY TOOLS ============

  get_project_name: (store, args) => {
    try {
      const name = store.get_project_name(args.project_id as string);
      return { success: true, data: name };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  list_project_ids: (store, _args) => {
    try {
      const ids = store.list_project_ids();
      return { success: true, data: Array.from(ids) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_building_name: (store, args) => {
    try {
      const name = store.get_building_name(args.building_id as string);
      return { success: true, data: name };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_building_levels: (store, args) => {
    try {
      const levels = store.get_building_levels(args.building_id as string);
      return { success: true, data: Array.from(levels) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_building_stats: (store, args) => {
    try {
      const stats = store.get_building_stats(args.building_id as string);
      return { success: true, data: stats };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_level_name: (store, args) => {
    try {
      const name = store.get_level_name(args.level_id as string);
      return { success: true, data: name };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_level_elevation: (store, args) => {
    try {
      const elevation = store.get_level_elevation(args.level_id as string);
      return { success: true, data: elevation };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_level_height: (store, args) => {
    try {
      const height = store.get_level_height(args.level_id as string);
      return { success: true, data: height };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_footprint_area: (store, args) => {
    try {
      const area = store.get_footprint_area(args.level_id as string);
      return { success: true, data: area };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_footprint_perimeter: (store, args) => {
    try {
      const perimeter = store.get_footprint_perimeter(args.level_id as string);
      return { success: true, data: perimeter };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_wall_assembly: (store, args) => {
    try {
      const assemblyId = store.get_wall_assembly(args.wall_id as string);
      return { success: true, data: assemblyId };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_event_count: (store, args) => {
    try {
      const count = store.get_event_count(args.project_id as string);
      return { success: true, data: count };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_wall_openings: (store, args) => {
    try {
      const openings = store.get_wall_openings(args.wall_id as string);
      return { success: true, data: Array.from(openings) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ============ DELETE TOOLS ============

  remove_building: (store, args) => {
    try {
      store.remove_building(args.building_id as string);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  remove_level: (store, args) => {
    try {
      store.remove_level(args.level_id as string);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  remove_wall: (store, args) => {
    try {
      store.remove_wall(args.wall_id as string);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  remove_opening: (store, args) => {
    try {
      store.remove_opening(args.opening_id as string);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  offset_footprint: (store, args) => {
    try {
      store.offset_footprint(args.footprint_id as string, args.distance as number);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ============ GRID TOOLS ============

  create_grid: (store, args) => {
    try {
      store.create_grid(args.building_id as string);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  add_grid_axis: (store, args) => {
    try {
      store.add_grid_axis(
        args.building_id as string,
        args.name as string,
        args.direction as string,
        args.offset as number
      );
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // ============ OPENING TOOLS ============

  add_opening: (store, args) => {
    try {
      const id = store.add_opening(
        args.wall_id as string,
        args.opening_type as string,
        args.position as number,
        args.width as number,
        args.height as number,
        args.sill_height as number
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};

// ============================================================================
// WASM Tool Executor Implementation
// ============================================================================

/**
 * Create a WASM-based tool executor.
 * Uses the WASM module for all geometry operations.
 *
 * @returns Promise<CADToolExecutor> - resolves once WASM is initialized
 */
export async function createWasmToolExecutor(): Promise<CADToolExecutor> {
  // Initialize WASM and get the store
  const store = await getWasmStore();

  // Track validation state locally
  const validationStatus: ValidationStatus = {
    geometryValid: true,
    warnings: [],
    errors: [],
  };

  return {
    async execute(toolCall: ToolCall): Promise<{ success: boolean; data?: unknown; error?: string }> {
      const handler = toolHandlers[toolCall.name];

      if (!handler) {
        // Tool not supported in WASM - this is expected for skill_ prefixed tools
        return {
          success: false,
          error: `Tool not supported in WASM executor: ${toolCall.name}`,
        };
      }

      const result = handler(store, toolCall.args);

      // Track errors in validation status
      if (!result.success && result.error) {
        validationStatus.errors.push(result.error);
      }

      return result;
    },

    getState(): ObservableState {
      // Get entity counts from WASM store
      const wasmState = store.get_state() as {
        projects?: number;
        buildings?: number;
        levels?: number;
        walls?: number;
        rooms?: number;
        footprints?: number;
        wall_assemblies?: number;
        openings?: number;
        grids?: number;
      } | null;

      const entities: EntityCounts = {
        projects: wasmState?.projects ?? 0,
        buildings: wasmState?.buildings ?? 0,
        levels: wasmState?.levels ?? 0,
        walls: wasmState?.walls ?? 0,
        rooms: wasmState?.rooms ?? 0,
        openings: wasmState?.openings ?? 0,
        footprints: wasmState?.footprints ?? 0,
        grids: wasmState?.grids ?? 0,
        wallAssemblies: wasmState?.wall_assemblies ?? 0,
      };

      return {
        timestamp: new Date().toISOString(),
        entities,
        lastOperation: null, // Set by GeminiCADClient
        validationStatus: { ...validationStatus },
        projectBounds: null, // Could be computed from geometry
      };
    },

    validate(): ValidationStatus {
      return { ...validationStatus };
    },
  };
}
