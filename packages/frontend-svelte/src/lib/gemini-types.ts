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
// Tool Names - 5 collaborative tools
// ============================================================================

export type ToolName =
  | 'create_room'    // Place a room at position
  | 'update_room'    // Move/resize/rename a room
  | 'delete_room'    // Remove a room
  | 'add_opening'    // Door/window between rooms
  | 'ask_user';      // Ask clarifying question

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
