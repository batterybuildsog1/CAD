/**
 * Gemini Tool Definitions for CAD Operations
 *
 * These tool schemas define the function calling interface between Gemini AI
 * and the Antigravity CAD geometry engine. Each tool maps to a Rhai API function.
 *
 * Source: packages/geometry-core/src/rhai_api/mod.rs
 */

import type { ToolName } from './gemini-types';

// ============================================================================
// Type Definitions for Gemini Tool Schema
// ============================================================================

interface JsonSchemaProperty {
  type: string;
  description: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  pattern?: string;
  items?: JsonSchemaProperty;
  minItems?: number;
  maxItems?: number;
}

interface JsonSchema {
  type: 'object';
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
}

interface GeminiTool {
  name: ToolName;
  description: string;
  parameters: JsonSchema;
}

// ============================================================================
// PROJECT TOOLS
// Tools for creating and managing CAD projects
// ============================================================================

const createProject: GeminiTool = {
  name: 'create_project',
  description: `Create a new CAD project with specified unit system and building code region.
This is the first step in any modeling session - all buildings, levels, and geometry must belong to a project.
Returns a ProjectId that is required for adding buildings.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Human-readable name for the project (e.g., "Smith Residence", "Office Tower Phase 1")',
      },
      units: {
        type: 'string',
        description: 'Unit system for all measurements in this project',
        enum: ['imperial', 'metric'],
      },
      code_region: {
        type: 'string',
        description: 'Building code jurisdiction that governs this project. IRC = International Residential Code, IBC = International Building Code',
        enum: ['US_IRC_2021', 'US_IRC_2018', 'US_IBC_2021', 'US_IBC_2018'],
      },
    },
    required: ['name', 'units', 'code_region'],
  },
};

const getProjectName: GeminiTool = {
  name: 'get_project_name',
  description: `Retrieve the name of an existing project by its ID.
Use this to verify project identity or display project information.`,
  parameters: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'The unique identifier of the project (returned from create_project)',
      },
    },
    required: ['project_id'],
  },
};

const listProjectIds: GeminiTool = {
  name: 'list_project_ids',
  description: `List all project IDs in the current session.
Returns an array of ProjectId strings. Use this to discover available projects.`,
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
};

// ============================================================================
// BUILDING TOOLS
// Tools for managing buildings within a project
// ============================================================================

const addBuilding: GeminiTool = {
  name: 'add_building',
  description: `Add a new building to an existing project.
Dependency: A project must exist first (use create_project).
A project can contain multiple buildings (e.g., main house + detached garage).
Returns a BuildingId required for adding levels.`,
  parameters: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'The project to add this building to (from create_project)',
      },
      name: {
        type: 'string',
        description: 'Human-readable name for the building (e.g., "Main House", "Garage", "Tower A")',
      },
    },
    required: ['project_id', 'name'],
  },
};

const getBuildingName: GeminiTool = {
  name: 'get_building_name',
  description: `Retrieve the name of an existing building by its ID.`,
  parameters: {
    type: 'object',
    properties: {
      building_id: {
        type: 'string',
        description: 'The unique identifier of the building',
      },
    },
    required: ['building_id'],
  },
};

const getBuildingLevels: GeminiTool = {
  name: 'get_building_levels',
  description: `Get all level IDs for a building.
Returns an array of LevelId strings in order of elevation.
Use this to iterate through floors or find specific levels.`,
  parameters: {
    type: 'object',
    properties: {
      building_id: {
        type: 'string',
        description: 'The building to query levels from',
      },
    },
    required: ['building_id'],
  },
};

const removeBuilding: GeminiTool = {
  name: 'remove_building',
  description: `Remove a building and all its contents (levels, walls, rooms, etc.) from the project.
WARNING: This is destructive and cannot be undone.`,
  parameters: {
    type: 'object',
    properties: {
      building_id: {
        type: 'string',
        description: 'The building to remove',
      },
    },
    required: ['building_id'],
  },
};

// ============================================================================
// LEVEL TOOLS
// Tools for managing floor levels within buildings
// ============================================================================

const addLevel: GeminiTool = {
  name: 'add_level',
  description: `Add a floor level to a building.
Dependency: A building must exist first (use add_building).
Levels represent horizontal slices of the building at specific elevations.
Returns a LevelId required for footprints, walls, and rooms.`,
  parameters: {
    type: 'object',
    properties: {
      building_id: {
        type: 'string',
        description: 'The building to add this level to',
      },
      name: {
        type: 'string',
        description: 'Human-readable name for the level (e.g., "Ground Floor", "Level 2", "Basement")',
      },
      elevation: {
        type: 'number',
        description: 'Height of the floor surface above project origin. Units depend on project settings (feet for imperial, meters for metric). Ground floor is typically 0.0',
      },
      floor_to_floor: {
        type: 'number',
        description: 'Distance from this floor to the next floor above. For residential (imperial): typically 9-10 feet. For commercial: typically 12-14 feet',
        minimum: 1,
        maximum: 100,
      },
    },
    required: ['building_id', 'name', 'elevation', 'floor_to_floor'],
  },
};

const getLevelName: GeminiTool = {
  name: 'get_level_name',
  description: `Retrieve the name of an existing level by its ID.`,
  parameters: {
    type: 'object',
    properties: {
      level_id: {
        type: 'string',
        description: 'The unique identifier of the level',
      },
    },
    required: ['level_id'],
  },
};

const getLevelElevation: GeminiTool = {
  name: 'get_level_elevation',
  description: `Get the elevation (height above origin) of a level.
Returns the elevation value in project units (feet or meters).`,
  parameters: {
    type: 'object',
    properties: {
      level_id: {
        type: 'string',
        description: 'The level to query',
      },
    },
    required: ['level_id'],
  },
};

const getLevelHeight: GeminiTool = {
  name: 'get_level_height',
  description: `Get the floor-to-floor height of a level.
Returns the height value in project units (feet or meters).`,
  parameters: {
    type: 'object',
    properties: {
      level_id: {
        type: 'string',
        description: 'The level to query',
      },
    },
    required: ['level_id'],
  },
};

const removeLevel: GeminiTool = {
  name: 'remove_level',
  description: `Remove a level and all its contents (footprint, walls, rooms) from the building.
WARNING: This is destructive and cannot be undone.`,
  parameters: {
    type: 'object',
    properties: {
      level_id: {
        type: 'string',
        description: 'The level to remove',
      },
    },
    required: ['level_id'],
  },
};

// ============================================================================
// FOOTPRINT TOOLS
// Tools for defining building floor plate geometry
// ============================================================================

const setLevelFootprint: GeminiTool = {
  name: 'set_level_footprint',
  description: `Set the floor plate boundary for a level using a custom polygon.
Dependency: A level must exist first (use add_level).
The polygon defines the outer boundary of the floor. Use this for non-rectangular shapes (L-shape, U-shape, etc.).
Points should be in clockwise or counter-clockwise order.
Returns a FootprintId for the created footprint.`,
  parameters: {
    type: 'object',
    properties: {
      level_id: {
        type: 'string',
        description: 'The level to set the footprint for',
      },
      points: {
        type: 'array',
        description: 'Array of [x, y] coordinate pairs defining the polygon vertices. Minimum 3 points required. Coordinates are in project units (feet or meters)',
        items: {
          type: 'array',
          description: '[x, y] coordinate pair',
          items: {
            type: 'number',
            description: 'Coordinate value in project units',
          },
          minItems: 2,
          maxItems: 2,
        },
        minItems: 3,
      },
    },
    required: ['level_id', 'points'],
  },
};

const setLevelFootprintRect: GeminiTool = {
  name: 'set_level_footprint_rect',
  description: `Set the floor plate boundary for a level as a simple rectangle.
Dependency: A level must exist first (use add_level).
Creates a rectangle centered at origin with specified width (X-axis) and depth (Y-axis).
Use this for simple rectangular floor plans.
Returns a FootprintId for the created footprint.`,
  parameters: {
    type: 'object',
    properties: {
      level_id: {
        type: 'string',
        description: 'The level to set the footprint for',
      },
      width: {
        type: 'number',
        description: 'Width of the rectangle along the X-axis in project units. Must be positive',
        exclusiveMinimum: 0,
      },
      depth: {
        type: 'number',
        description: 'Depth of the rectangle along the Y-axis in project units. Must be positive',
        exclusiveMinimum: 0,
      },
    },
    required: ['level_id', 'width', 'depth'],
  },
};

const getFootprintArea: GeminiTool = {
  name: 'get_footprint_area',
  description: `Calculate the area of a level's footprint.
Returns area in square project units (sq ft for imperial, sq m for metric).
Use this for gross floor area calculations.`,
  parameters: {
    type: 'object',
    properties: {
      level_id: {
        type: 'string',
        description: 'The level whose footprint area to calculate',
      },
    },
    required: ['level_id'],
  },
};

const getFootprintPerimeter: GeminiTool = {
  name: 'get_footprint_perimeter',
  description: `Calculate the perimeter of a level's footprint.
Returns perimeter length in project units (feet or meters).
Use this for exterior wall length calculations.`,
  parameters: {
    type: 'object',
    properties: {
      level_id: {
        type: 'string',
        description: 'The level whose footprint perimeter to calculate',
      },
    },
    required: ['level_id'],
  },
};

const offsetFootprint: GeminiTool = {
  name: 'offset_footprint',
  description: `Offset a footprint inward or outward by a specified distance.
Positive distance = outward expansion, Negative distance = inward contraction.
Useful for creating wall offsets, setbacks, or nested boundaries.`,
  parameters: {
    type: 'object',
    properties: {
      footprint_id: {
        type: 'string',
        description: 'The footprint to offset',
      },
      distance: {
        type: 'number',
        description: 'Offset distance in project units. Positive = expand outward, Negative = contract inward',
      },
    },
    required: ['footprint_id', 'distance'],
  },
};

// ============================================================================
// GRID TOOLS
// Tools for structural/planning grids
// ============================================================================

const createGrid: GeminiTool = {
  name: 'create_grid',
  description: `Initialize a structural/planning grid system for a building.
Dependency: A building must exist first (use add_building).
Grids help organize the layout with named reference lines (A, B, C or 1, 2, 3).
After creating the grid, use add_grid_axis to add individual grid lines.`,
  parameters: {
    type: 'object',
    properties: {
      building_id: {
        type: 'string',
        description: 'The building to create a grid for',
      },
    },
    required: ['building_id'],
  },
};

const addGridAxis: GeminiTool = {
  name: 'add_grid_axis',
  description: `Add a grid line to an existing grid system.
Dependency: A grid must exist first (use create_grid).
Grid axes are named reference lines used for structural and planning layout.
Convention: Horizontal axes (running left-right) are typically numbered (1, 2, 3).
Vertical axes (running up-down) are typically lettered (A, B, C).`,
  parameters: {
    type: 'object',
    properties: {
      building_id: {
        type: 'string',
        description: 'The building containing the grid',
      },
      name: {
        type: 'string',
        description: 'Name/label for this grid line (e.g., "A", "B", "1", "2")',
        pattern: '^[A-Za-z0-9]+$',
      },
      direction: {
        type: 'string',
        description: 'Orientation of the grid line. "horizontal" = runs along X-axis (left-right). "vertical" = runs along Y-axis (up-down)',
        enum: ['horizontal', 'vertical'],
      },
      offset: {
        type: 'number',
        description: 'Position of the grid line. For horizontal: Y-coordinate. For vertical: X-coordinate. In project units',
      },
    },
    required: ['building_id', 'name', 'direction', 'offset'],
  },
};

// ============================================================================
// WALL TOOLS
// Tools for creating walls and wall assemblies
// ============================================================================

const createWallAssembly: GeminiTool = {
  name: 'create_wall_assembly',
  description: `Create a wall assembly (wall type/template).
Wall assemblies define the layer composition of walls (e.g., "2x4 Wood Stud", "8-inch CMU").
Create assemblies first, then use them when creating wall instances.
Returns a WallAssemblyId for creating walls.`,
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Descriptive name for the wall assembly (e.g., "Exterior 2x6", "Interior Partition", "Foundation Wall")',
      },
    },
    required: ['name'],
  },
};

const createWall: GeminiTool = {
  name: 'create_wall',
  description: `Create a wall instance on a level.
Dependencies: A level and wall assembly must exist first.
Walls are defined by a start point, end point, and height.
The wall centerline runs from start to end.
Returns a WallId for adding openings (doors/windows).`,
  parameters: {
    type: 'object',
    properties: {
      level_id: {
        type: 'string',
        description: 'The level to place this wall on',
      },
      assembly_id: {
        type: 'string',
        description: 'The wall assembly (type) to use (from create_wall_assembly)',
      },
      start: {
        type: 'array',
        description: '[x, y] coordinate of wall start point in project units',
        items: {
          type: 'number',
          description: 'Coordinate value',
        },
        minItems: 2,
        maxItems: 2,
      },
      end: {
        type: 'array',
        description: '[x, y] coordinate of wall end point in project units',
        items: {
          type: 'number',
          description: 'Coordinate value',
        },
        minItems: 2,
        maxItems: 2,
      },
      height: {
        type: 'number',
        description: 'Wall height in project units. Typically matches or is slightly less than floor_to_floor height',
        exclusiveMinimum: 0,
        maximum: 100,
      },
    },
    required: ['level_id', 'assembly_id', 'start', 'end', 'height'],
  },
};

const getWallAssembly: GeminiTool = {
  name: 'get_wall_assembly',
  description: `Get the wall assembly ID used by a wall instance.
Returns the WallAssemblyId associated with the specified wall.`,
  parameters: {
    type: 'object',
    properties: {
      wall_id: {
        type: 'string',
        description: 'The wall to query',
      },
    },
    required: ['wall_id'],
  },
};

// ============================================================================
// ROOM TOOLS
// Tools for defining room spaces
// ============================================================================

const createRoom: GeminiTool = {
  name: 'create_room',
  description: `Create a room space on a level.
Dependency: A level must exist first (use add_level).
Rooms define named spaces with boundaries and type classification.
The polygon should represent the room's floor area boundary.
Returns a RoomId for the created room.`,
  parameters: {
    type: 'object',
    properties: {
      level_id: {
        type: 'string',
        description: 'The level to place this room on',
      },
      room_type: {
        type: 'string',
        description: 'Classification of the room for code analysis and space planning',
        enum: [
          'living',
          'kitchen',
          'bedroom',
          'bathroom',
          'garage',
          'utility',
          'circulation',
          'hallway',
          'other',
        ],
      },
      name: {
        type: 'string',
        description: 'Display name for the room (e.g., "Master Bedroom", "Kitchen", "Living Room")',
      },
      points: {
        type: 'array',
        description: 'Array of [x, y] coordinate pairs defining the room boundary polygon. Minimum 3 points required',
        items: {
          type: 'array',
          description: '[x, y] coordinate pair',
          items: {
            type: 'number',
            description: 'Coordinate value in project units',
          },
          minItems: 2,
          maxItems: 2,
        },
        minItems: 3,
      },
    },
    required: ['level_id', 'room_type', 'name', 'points'],
  },
};

// ============================================================================
// OPENING TOOLS
// Tools for doors and windows
// ============================================================================

const addOpening: GeminiTool = {
  name: 'add_opening',
  description: `Add a door or window opening to a wall.
Dependency: A wall must exist first (use create_wall).
Position is measured along the wall from its start point.
Returns an OpeningId for the created opening.`,
  parameters: {
    type: 'object',
    properties: {
      wall_id: {
        type: 'string',
        description: 'The wall to add this opening to',
      },
      opening_type: {
        type: 'string',
        description: 'Type of opening: "window" or "door"',
        enum: ['window', 'door'],
      },
      position: {
        type: 'number',
        description: 'Distance along wall from start point to center of opening, as a ratio (0.0 to 1.0). 0.5 = center of wall',
        minimum: 0,
        maximum: 1,
      },
      width: {
        type: 'number',
        description: 'Width of the opening in project units. Standard door: 3ft (36in). Standard window: 2-6ft',
        exclusiveMinimum: 0,
        maximum: 30,
      },
      height: {
        type: 'number',
        description: 'Height of the opening in project units. Standard door: 6.67-8ft. Standard window: 3-5ft',
        exclusiveMinimum: 0,
        maximum: 20,
      },
      sill_height: {
        type: 'number',
        description: 'Height from floor to bottom of opening. For doors: 0. For windows: typically 2-4ft',
        minimum: 0,
        maximum: 10,
      },
    },
    required: ['wall_id', 'opening_type', 'position', 'width', 'height', 'sill_height'],
  },
};

// ============================================================================
// QUERY TOOLS
// Tools for retrieving project information and statistics
// ============================================================================

const getBuildingStats: GeminiTool = {
  name: 'get_building_stats',
  description: `Get summary statistics for a building.
Returns an object with:
- total_area: Sum of all level footprint areas (gross floor area)
- level_count: Number of levels in the building
Use this for area calculations and project summaries.`,
  parameters: {
    type: 'object',
    properties: {
      building_id: {
        type: 'string',
        description: 'The building to get statistics for',
      },
    },
    required: ['building_id'],
  },
};

const getEventCount: GeminiTool = {
  name: 'get_event_count',
  description: `Get the number of events in the project's event log.
Events track all changes to the project for undo/redo and history.
Returns an integer count of events.`,
  parameters: {
    type: 'object',
    properties: {
      project_id: {
        type: 'string',
        description: 'The project to query',
      },
    },
    required: ['project_id'],
  },
};

// ============================================================================
// EXPORT: All Gemini CAD Tools
// ============================================================================

/**
 * Complete array of all Gemini CAD tool definitions.
 * Pass this to Gemini's function calling API.
 *
 * Total: 26 tools across 9 categories:
 * - Project (3): create_project, get_project_name, list_project_ids
 * - Building (4): add_building, get_building_name, get_building_levels, remove_building
 * - Level (5): add_level, get_level_name, get_level_elevation, get_level_height, remove_level
 * - Footprint (5): set_level_footprint, set_level_footprint_rect, get_footprint_area, get_footprint_perimeter, offset_footprint
 * - Grid (2): create_grid, add_grid_axis
 * - Wall (3): create_wall_assembly, create_wall, get_wall_assembly
 * - Room (1): create_room
 * - Opening (1): add_opening
 * - Query (2): get_building_stats, get_event_count
 */
export const GEMINI_CAD_TOOLS: GeminiTool[] = [
  // Project Tools
  createProject,
  getProjectName,
  listProjectIds,
  // Building Tools
  addBuilding,
  getBuildingName,
  getBuildingLevels,
  removeBuilding,
  // Level Tools
  addLevel,
  getLevelName,
  getLevelElevation,
  getLevelHeight,
  removeLevel,
  // Footprint Tools
  setLevelFootprint,
  setLevelFootprintRect,
  getFootprintArea,
  getFootprintPerimeter,
  offsetFootprint,
  // Grid Tools
  createGrid,
  addGridAxis,
  // Wall Tools
  createWallAssembly,
  createWall,
  getWallAssembly,
  // Room Tools
  createRoom,
  // Opening Tools
  addOpening,
  // Query Tools
  getBuildingStats,
  getEventCount,
];

/**
 * Tool lookup by name for quick access
 */
export const GEMINI_CAD_TOOLS_MAP: Record<ToolName, GeminiTool> = Object.fromEntries(
  GEMINI_CAD_TOOLS.map((tool) => [tool.name, tool])
) as Record<ToolName, GeminiTool>;

/**
 * Get tool definition by name
 */
export function getToolDefinition(name: ToolName): GeminiTool | undefined {
  return GEMINI_CAD_TOOLS_MAP[name];
}
