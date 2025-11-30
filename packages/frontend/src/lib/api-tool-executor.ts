/**
 * HTTP-based CAD Tool Executor
 *
 * Translates Gemini tool calls to HTTP requests against the geometry server.
 * Implements the CADToolExecutor interface from gemini-cad.ts
 *
 * @see docs/GEMINI_INTEGRATION.md
 */

import type {
  CADToolExecutor,
  ObservableState,
  ValidationStatus,
  EntityCounts,
} from './gemini-cad';
import type { ToolCall, ToolName } from './gemini-types';

// ============================================================================
// Configuration
// ============================================================================

const GEOMETRY_SERVER_URL = process.env.GEOMETRY_SERVER_URL || 'http://localhost:3001';

// ============================================================================
// API Client
// ============================================================================

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  events_generated?: number;
}

/**
 * Make an HTTP request to the geometry server
 */
async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${GEOMETRY_SERVER_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        error: `HTTP ${response.status}: ${errorText}`,
      };
    }

    const data = await response.json();
    return {
      success: true,
      data: data as T,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// Tool Call Mapping
// ============================================================================

/**
 * Map a tool call to its corresponding API request.
 * Note: Skills (skill_*) are handled by gemini-cad.ts, not this executor.
 * The Partial type allows us to only define handlers for base CAD tools.
 */
type ToolHandler = (args: Record<string, unknown>) => Promise<ApiResponse>;

const toolHandlers: Partial<Record<ToolName, ToolHandler>> = {
  // Project Tools
  create_project: async (args) =>
    apiRequest('POST', '/api/v1/projects', {
      name: args.name,
      units: args.units,
      code_region: args.code_region,
    }),

  get_project_name: async (args) =>
    apiRequest('GET', `/api/v1/projects/${args.project_id}`),

  list_project_ids: async () =>
    apiRequest('GET', '/api/v1/projects'),

  // Building Tools
  add_building: async (args) =>
    apiRequest('POST', `/api/v1/projects/${args.project_id}/buildings`, {
      name: args.name,
    }),

  get_building_name: async (args) =>
    apiRequest('GET', `/api/v1/buildings/${args.building_id}`),

  get_building_levels: async (args) =>
    apiRequest('GET', `/api/v1/buildings/${args.building_id}/levels`),

  remove_building: async (args) =>
    apiRequest('DELETE', `/api/v1/buildings/${args.building_id}`),

  // Level Tools
  add_level: async (args) =>
    apiRequest('POST', `/api/v1/buildings/${args.building_id}/levels`, {
      name: args.name,
      elevation: args.elevation,
      floor_to_floor: args.floor_to_floor,
    }),

  get_level_name: async (args) =>
    apiRequest('GET', `/api/v1/levels/${args.level_id}`),

  get_level_elevation: async (args) =>
    apiRequest('GET', `/api/v1/levels/${args.level_id}`),

  get_level_height: async (args) =>
    apiRequest('GET', `/api/v1/levels/${args.level_id}`),

  remove_level: async (args) =>
    apiRequest('DELETE', `/api/v1/levels/${args.level_id}`),

  // Footprint Tools
  set_level_footprint: async (args) =>
    apiRequest('POST', `/api/v1/levels/${args.level_id}/footprint`, {
      points: args.points,
    }),

  set_level_footprint_rect: async (args) =>
    apiRequest('POST', `/api/v1/levels/${args.level_id}/footprint`, {
      width: args.width,
      depth: args.depth,
    }),

  get_footprint_area: async (args) =>
    apiRequest('GET', `/api/v1/levels/${args.level_id}/footprint/area`),

  get_footprint_perimeter: async (args) =>
    apiRequest('GET', `/api/v1/levels/${args.level_id}/footprint/perimeter`),

  offset_footprint: async (args) =>
    apiRequest('POST', `/api/v1/footprints/${args.footprint_id}/offset`, {
      distance: args.distance,
    }),

  // Grid Tools
  create_grid: async (args) =>
    apiRequest('POST', `/api/v1/buildings/${args.building_id}/grid`),

  add_grid_axis: async (args) =>
    apiRequest('POST', `/api/v1/buildings/${args.building_id}/grid/axis`, {
      name: args.name,
      direction: args.direction,
      offset: args.offset,
    }),

  // Wall Tools
  create_wall_assembly: async (args) =>
    apiRequest('POST', '/api/v1/wall-assemblies', {
      name: args.name,
    }),

  create_wall: async (args) =>
    apiRequest('POST', `/api/v1/levels/${args.level_id}/walls`, {
      assembly_id: args.assembly_id,
      start: args.start,
      end: args.end,
      height: args.height,
    }),

  get_wall_assembly: async (args) =>
    apiRequest('GET', `/api/v1/walls/${args.wall_id}/assembly`),

  // Room Tools
  create_room: async (args) =>
    apiRequest('POST', `/api/v1/levels/${args.level_id}/rooms`, {
      room_type: args.room_type,
      name: args.name,
      points: args.points,
    }),

  // Opening Tools
  add_opening: async (args) =>
    apiRequest('POST', `/api/v1/walls/${args.wall_id}/openings`, {
      opening_type: args.opening_type,
      position: args.position,
      width: args.width,
      height: args.height,
      sill_height: args.sill_height,
    }),

  // Query Tools
  get_building_stats: async (args) =>
    apiRequest('GET', `/api/v1/buildings/${args.building_id}/stats`),

  get_event_count: async (args) =>
    apiRequest('GET', `/api/v1/projects/${args.project_id}/events/count`),
};

// ============================================================================
// HTTP Tool Executor Implementation
// ============================================================================

/**
 * Create an HTTP-based tool executor that calls the geometry server.
 *
 * @param serverUrl - Override the geometry server URL (optional)
 * @returns CADToolExecutor implementation
 */
export function createHttpToolExecutor(serverUrl?: string): CADToolExecutor {
  // Track state locally for observable state pattern
  const entityCounts: EntityCounts = {
    projects: 0,
    buildings: 0,
    levels: 0,
    walls: 0,
    rooms: 0,
    openings: 0,
    footprints: 0,
    grids: 0,
    wallAssemblies: 0,
  };

  const validationStatus: ValidationStatus = {
    geometryValid: true,
    warnings: [],
    errors: [],
  };

  // Entity count updates per tool
  const entityUpdates: Partial<Record<ToolName, keyof EntityCounts>> = {
    create_project: 'projects',
    add_building: 'buildings',
    add_level: 'levels',
    create_wall: 'walls',
    create_room: 'rooms',
    add_opening: 'openings',
    set_level_footprint: 'footprints',
    set_level_footprint_rect: 'footprints',
    create_grid: 'grids',
    create_wall_assembly: 'wallAssemblies',
  };

  return {
    async execute(toolCall: ToolCall): Promise<{ success: boolean; data?: unknown; error?: string }> {
      const handler = toolHandlers[toolCall.name];

      if (!handler) {
        return {
          success: false,
          error: `Unknown tool: ${toolCall.name}`,
        };
      }

      const result = await handler(toolCall.args);

      // Update entity counts on success
      if (result.success) {
        const entityKey = entityUpdates[toolCall.name];
        if (entityKey) {
          entityCounts[entityKey]++;
        }
      } else {
        // Track errors in validation status
        validationStatus.errors.push(result.error || 'Unknown error');
      }

      return result;
    },

    getState(): ObservableState {
      return {
        timestamp: new Date().toISOString(),
        entities: { ...entityCounts },
        lastOperation: null, // Set by GeminiCADClient
        validationStatus: { ...validationStatus },
        projectBounds: null, // Could be fetched from server
      };
    },

    validate(): ValidationStatus {
      return { ...validationStatus };
    },
  };
}

/**
 * Create a fallback mock executor for when the geometry server is unavailable.
 * Useful for development and testing.
 */
export function createFallbackExecutor(): CADToolExecutor {
  let idCounter = 0;
  const entityCounts: EntityCounts = {
    projects: 0,
    buildings: 0,
    levels: 0,
    walls: 0,
    rooms: 0,
    openings: 0,
    footprints: 0,
    grids: 0,
    wallAssemblies: 0,
  };

  const entityUpdates: Partial<Record<ToolName, keyof EntityCounts>> = {
    create_project: 'projects',
    add_building: 'buildings',
    add_level: 'levels',
    create_wall: 'walls',
    create_room: 'rooms',
    add_opening: 'openings',
    set_level_footprint: 'footprints',
    set_level_footprint_rect: 'footprints',
    create_grid: 'grids',
    create_wall_assembly: 'wallAssemblies',
  };

  return {
    async execute(toolCall: ToolCall) {
      idCounter++;
      const id = `mock_${toolCall.name}_${idCounter}`;

      const entityKey = entityUpdates[toolCall.name];
      if (entityKey) {
        entityCounts[entityKey]++;
      }

      // Simulate realistic responses
      const mockResponses: Partial<Record<ToolName, unknown>> = {
        get_building_stats: { total_area: 1200, level_count: 2 },
        get_footprint_area: 600,
        get_footprint_perimeter: 100,
        list_project_ids: ['project_1'],
        get_building_levels: ['level_1', 'level_2'],
      };

      return {
        success: true,
        data: mockResponses[toolCall.name] ?? id,
      };
    },

    getState(): ObservableState {
      return {
        timestamp: new Date().toISOString(),
        entities: { ...entityCounts },
        lastOperation: null,
        validationStatus: { geometryValid: true, warnings: [], errors: [] },
        projectBounds: null,
      };
    },

    validate(): ValidationStatus {
      return { geometryValid: true, warnings: [], errors: [] };
    },
  };
}
