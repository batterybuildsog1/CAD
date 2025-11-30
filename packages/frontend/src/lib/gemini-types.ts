/**
 * TypeScript types for Gemini CAD tool parameters and responses
 * Generated from Rhai API: packages/geometry-core/src/rhai_api/mod.rs
 */

// ============================================================================
// ID Types (opaque handles returned by creation functions)
// ============================================================================

/** Unique identifier for a project */
export type ProjectId = string;

/** Unique identifier for a building within a project */
export type BuildingId = string;

/** Unique identifier for a level within a building */
export type LevelId = string;

/** Unique identifier for a footprint */
export type FootprintId = string;

/** Unique identifier for a wall assembly (template) */
export type WallAssemblyId = string;

/** Unique identifier for a wall instance */
export type WallId = string;

/** Unique identifier for a room */
export type RoomId = string;

/** Unique identifier for an opening (door/window) */
export type OpeningId = string;

// ============================================================================
// Enum Types
// ============================================================================

/** Unit system for measurements */
export type UnitSystem = 'imperial' | 'metric';

/** Building code region identifier */
export type CodeRegion =
  | 'US_IRC_2021'
  | 'US_IRC_2018'
  | 'US_IBC_2021'
  | 'US_IBC_2018';

/** Grid axis direction */
export type GridDirection = 'horizontal' | 'vertical';

/** Room type classification
 *
 * Synced with Rust: geometry-core/src/domain/room.rs
 * Uses snake_case strings that match Rust's serde(rename_all = "snake_case")
 */
export type RoomType =
  | 'living'       // Living room (Rust: LivingRoom)
  | 'kitchen'      // Kitchen
  | 'bedroom'      // Bedroom
  | 'bathroom'     // Bathroom
  | 'closet'       // Walk-in closets, coat closets
  | 'hallway'      // Hallways, corridors
  | 'utility'      // Mechanical, utility rooms
  | 'garage'       // Garage
  | 'dining'       // Formal dining room (Rust: DiningRoom)
  | 'family'       // Family room (Rust: FamilyRoom)
  | 'office'       // Home office, study
  | 'laundry'      // Laundry room
  | 'pantry'       // Kitchen pantry
  | 'mudroom'      // Entry mudroom
  | 'foyer'        // Formal entry, foyer
  | 'patio'        // Outdoor patio (not roofed)
  | 'deck'         // Outdoor deck (may be covered)
  | 'circulation'  // Generic circulation (entry, landing)
  | 'stair'        // Stairway (vertical circulation)
  | 'landing'      // Stair landing
  | 'great_room'   // Open floor plan (living/kitchen/dining combined)
  | 'other';       // Custom/other room types

/** Opening type (doors and windows) */
export type OpeningType = 'window' | 'door';

// ============================================================================
// Geometry Types
// ============================================================================

/** 2D point as [x, y] array */
export type Point2D = [number, number];

/** 2D point as object with x, y properties */
export interface Point2DObject {
  x: number;
  y: number;
}

/** Polygon as array of points (minimum 3 points) */
export type Polygon2D = Point2D[];

// ============================================================================
// Tool Parameter Types
// ============================================================================

// ----- Project Parameters -----

export interface CreateProjectParams {
  name: string;
  units: UnitSystem;
  code_region: CodeRegion;
}

export interface GetProjectNameParams {
  project_id: ProjectId;
}

// No params for list_project_ids

// ----- Building Parameters -----

export interface AddBuildingParams {
  project_id: ProjectId;
  name: string;
}

export interface GetBuildingNameParams {
  building_id: BuildingId;
}

export interface GetBuildingLevelsParams {
  building_id: BuildingId;
}

export interface RemoveBuildingParams {
  building_id: BuildingId;
}

// ----- Level Parameters -----

export interface AddLevelParams {
  building_id: BuildingId;
  name: string;
  elevation: number;
  floor_to_floor: number;
}

export interface GetLevelNameParams {
  level_id: LevelId;
}

export interface GetLevelElevationParams {
  level_id: LevelId;
}

export interface GetLevelHeightParams {
  level_id: LevelId;
}

export interface RemoveLevelParams {
  level_id: LevelId;
}

// ----- Footprint Parameters -----

export interface SetLevelFootprintParams {
  level_id: LevelId;
  points: Polygon2D;
}

export interface SetLevelFootprintRectParams {
  level_id: LevelId;
  width: number;
  depth: number;
}

export interface GetFootprintAreaParams {
  level_id: LevelId;
}

export interface GetFootprintPerimeterParams {
  level_id: LevelId;
}

export interface OffsetFootprintParams {
  footprint_id: FootprintId;
  distance: number;
}

// ----- Grid Parameters -----

export interface CreateGridParams {
  building_id: BuildingId;
}

export interface AddGridAxisParams {
  building_id: BuildingId;
  name: string;
  direction: GridDirection;
  offset: number;
}

// ----- Wall Parameters -----

export interface CreateWallAssemblyParams {
  name: string;
}

export interface CreateWallParams {
  level_id: LevelId;
  assembly_id: WallAssemblyId;
  start: Point2D;
  end: Point2D;
  height: number;
}

export interface GetWallAssemblyParams {
  wall_id: WallId;
}

// ----- Room Parameters -----

export interface CreateRoomParams {
  level_id: LevelId;
  room_type: RoomType;
  name: string;
  points: Polygon2D;
}

// ----- Opening Parameters -----

export interface AddOpeningParams {
  wall_id: WallId;
  opening_type: OpeningType;
  position: number;
  width: number;
  height: number;
  sill_height: number;
}

// ----- Query Parameters -----

export interface GetBuildingStatsParams {
  building_id: BuildingId;
}

export interface GetEventCountParams {
  project_id: ProjectId;
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
// Tool Call Types (for Gemini function calling)
// ============================================================================

export type ToolName =
  // Project
  | 'create_project'
  | 'get_project_name'
  | 'list_project_ids'
  // Building
  | 'add_building'
  | 'get_building_name'
  | 'get_building_levels'
  | 'remove_building'
  // Level
  | 'add_level'
  | 'get_level_name'
  | 'get_level_elevation'
  | 'get_level_height'
  | 'remove_level'
  // Footprint
  | 'set_level_footprint'
  | 'set_level_footprint_rect'
  | 'get_footprint_area'
  | 'get_footprint_perimeter'
  | 'offset_footprint'
  // Grid
  | 'create_grid'
  | 'add_grid_axis'
  // Wall
  | 'create_wall_assembly'
  | 'create_wall'
  | 'get_wall_assembly'
  | 'remove_wall'
  | 'get_wall_openings'
  // Room
  | 'create_room'
  // Opening
  | 'add_opening'
  | 'remove_opening'
  // Query
  | 'get_building_stats'
  | 'get_event_count'
  // Base Skills
  | 'skill_create_rectangular_room'
  | 'skill_create_hallway'
  | 'skill_plan_layout'
  | 'skill_create_bedroom'
  | 'skill_create_kitchen'
  | 'skill_create_bathroom'
  | 'skill_create_entry'
  | 'skill_validate_structural_spans'
  | 'skill_suggest_load_bearing_wall'
  | 'skill_create_house_shell'
  | 'skill_create_house_shell';

export interface ToolCall {
  name: ToolName;
  args: Record<string, unknown>;
}
