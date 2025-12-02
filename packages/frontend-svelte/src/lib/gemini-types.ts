/**
 * TypeScript types for Gemini CAD tool parameters and responses
 * Ported from React version for Svelte 5
 */

// ============================================================================
// ID Types
// ============================================================================

export type ProjectId = string;
export type BuildingId = string;
export type LevelId = string;
export type FootprintId = string;
export type WallAssemblyId = string;
export type WallId = string;
export type RoomId = string;
export type OpeningId = string;

// ============================================================================
// Enum Types
// ============================================================================

export type UnitSystem = 'imperial' | 'metric';

export type CodeRegion =
  | 'US_IRC_2021'
  | 'US_IRC_2018'
  | 'US_IBC_2021'
  | 'US_IBC_2018';

export type GridDirection = 'horizontal' | 'vertical';

export type RoomType =
  | 'living'
  | 'kitchen'
  | 'bedroom'
  | 'bathroom'
  | 'closet'
  | 'hallway'
  | 'utility'
  | 'garage'
  | 'dining'
  | 'family'
  | 'office'
  | 'laundry'
  | 'pantry'
  | 'mudroom'
  | 'foyer'
  | 'patio'
  | 'deck'
  | 'circulation'
  | 'stair'
  | 'landing'
  | 'great_room'
  | 'other';

export type OpeningType = 'window' | 'door';

export type ViewMode =
  | 'floorplan_2d'
  | 'viewer3d_solid'
  | 'viewer3d_shell'
  | 'viewer3d_combined'
  | 'viewer3d_cad';

// ============================================================================
// Geometry Types
// ============================================================================

export type Point2D = [number, number];

export interface Point2DObject {
  x: number;
  y: number;
}

export type Polygon2D = Point2D[];

// ============================================================================
// Tool Names - 9 collaborative tools (5 room + 4 wall)
// ============================================================================

export type ToolName =
  | 'create_room'           // Place a room at position
  | 'update_room'           // Move/resize/rename a room
  | 'delete_room'           // Remove a room
  | 'add_opening'           // Door/window between rooms
  | 'ask_user'              // Ask clarifying question
  | 'create_wall'           // Create a wall segment between two points
  | 'auto_generate_walls'   // Auto-generate walls based on room types
  | 'set_room_openness'     // Set wall type between adjacent rooms
  | 'generate_framing';     // Generate structural framing for walls

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}

// ============================================================================
// Response Types
// ============================================================================

export interface BuildingStats {
  total_area: number;
  level_count: number;
}

export interface ToolSuccessResponse<T = unknown> {
  success: true;
  data: T;
}

export interface ToolErrorResponse {
  success: false;
  error: string;
}

export type ToolResponse<T = unknown> = ToolSuccessResponse<T> | ToolErrorResponse;

// ============================================================================
// FloorplanProgram - Structured House Requirements (Intake Form)
// ============================================================================

/**
 * A room requirement in the floorplan program.
 * Describes what the user wants, not exact dimensions.
 */
export interface RoomRequirement {
  type: RoomType;
  name?: string;                      // Custom name (e.g., "Jack's Room")
  quantity?: number;                  // Default 1
  minArea?: number;                   // Minimum square feet
  maxArea?: number;                   // Maximum square feet
  adjacentTo?: RoomType[];            // Preferred adjacencies
  mustHaveHallwayAccess?: boolean;    // Default true for secondary bedrooms
  features?: string[];                // e.g., ["ensuite", "walk-in closet"]
}

/**
 * FloorplanProgram - Structured input from intake form.
 * This is passed to the LLM as context before design begins.
 */
export interface FloorplanProgram {
  // Basic requirements (from intake form)
  stories: 1 | 2 | 3;
  totalAreaTarget: number;            // Target gross square footage
  totalAreaTolerance?: number;        // +/- percentage (default 10)

  // Room program (auto-generated from intake form selections)
  rooms: RoomRequirement[];

  // Special requests (freeform text from user)
  specialRequests?: string;

  // Circulation preferences
  circulation?: {
    preferHallwayAccess?: boolean;    // Default true - bedrooms via hallway
    allowBedroomToLiving?: boolean;   // Default false (soft warning)
    entryType?: 'foyer' | 'mudroom' | 'direct';
  };

  // Style hints (informational, doesn't affect circulation rules)
  style?: 'open_concept' | 'traditional' | 'hybrid';
}
