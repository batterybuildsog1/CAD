/**
 * CAD Skills - High-level architectural operations for Gemini
 *
 * Skills encapsulate architectural knowledge so Gemini doesn't have to
 * figure out low-level geometry. Each skill:
 * - Takes intuitive parameters
 * - Returns predictable results
 * - Handles the details internally
 *
 * ## Dependency Validation
 *
 * Skills BYPASS the `preValidateToolCall` dependency checks that raw tools use.
 * This is intentional because:
 *
 * 1. Skills internally generate valid tool sequences (e.g., `skill_create_house_shell`
 *    emits: create_project → add_building → add_level → set_level_footprint_rect)
 *
 * 2. Skills are trusted to encapsulate correct ordering - that's their purpose
 *
 * 3. The Rust/WASM geometry engine provides a final safety net, rejecting
 *    any invalid sequences with structured errors
 *
 * If you need to share dependency rules between raw tools and skills, extract
 * the `dependencyRules` map from `GeminiCADClient.preValidateToolCall` into
 * a shared module (`gemini-dependencies.ts`).
 *
 * @see docs/architecture.md for phase implementation details
 * @see docs/GEMINI_INTEGRATION.md for tool dependency documentation
 */

import type { ToolCall, Point2D, RoomType } from './gemini-types';
import type {
  ObservableState,
  RoomSummary,
  CardinalDirection,
} from './observable-state';
import {
  calculateSpaceBudget,
  generateAllocationExplanation,
  findSizeOptionForArea,
  type SpaceBudget,
  type AllocationPlan,
  type RoomSizeOption,
} from './space-budget';
import {
  createHallwayPolygon,
  suggestHallwayShape,
  type HallwayShape,
  type HallwayConfig,
  HALLWAY_WIDTHS,
  DEFAULT_HALLWAY_WIDTH,
} from './hallway-generator';

// ============================================================================
// Standard Wall Assemblies
// ============================================================================

/**
 * Standard wall assembly definitions with real thicknesses.
 * These are pre-calculated so Gemini doesn't need to think about layers.
 *
 * All measurements in inches.
 */
export const WALL_ASSEMBLIES = {
  // 2x6 exterior with stucco (DEFAULT for residential)
  '2x6_stucco': {
    name: '2x6 Stucco Exterior',
    studs: 5.5,           // 2x6 actual dimension
    interiorFinish: 0.5,  // 1/2" drywall
    exteriorSheathing: 0.4375, // 7/16" plywood
    exteriorFinish: 1.25, // stucco
    totalThickness: 7.6875, // ~7.7" → round to 8" for calculations
    roundedFeet: 8 / 12,  // 0.667'
  },
  // 2x6 exterior with siding
  '2x6_siding': {
    name: '2x6 Lap Siding Exterior',
    studs: 5.5,
    interiorFinish: 0.5,
    exteriorSheathing: 0.4375,
    exteriorFinish: 0.75, // lap siding
    totalThickness: 7.1875,
    roundedFeet: 7.5 / 12, // 0.625'
  },
  // 2x4 exterior with stucco
  '2x4_stucco': {
    name: '2x4 Stucco Exterior',
    studs: 3.5,           // 2x4 actual dimension
    interiorFinish: 0.5,
    exteriorSheathing: 0.4375,
    exteriorFinish: 1.25,
    totalThickness: 5.6875,
    roundedFeet: 6 / 12,  // 0.5'
  },
  // 2x4 exterior with siding
  '2x4_siding': {
    name: '2x4 Lap Siding Exterior',
    studs: 3.5,
    interiorFinish: 0.5,
    exteriorSheathing: 0.4375,
    exteriorFinish: 0.75,
    totalThickness: 5.1875,
    roundedFeet: 5.5 / 12, // ~0.46'
  },
  // Interior wall (2x4)
  'interior': {
    name: '2x4 Interior',
    studs: 3.5,
    interiorFinish: 0.5,  // drywall both sides
    exteriorSheathing: 0,
    exteriorFinish: 0.5,  // drywall on other side
    totalThickness: 4.5,
    roundedFeet: 4.5 / 12, // 0.375'
  },
} as const;

export type WallAssemblyType = keyof typeof WALL_ASSEMBLIES;

/**
 * Default wall assembly for exterior walls.
 * 2x6 with stucco is standard for affordable production homes.
 */
export const DEFAULT_EXTERIOR_WALL: WallAssemblyType = '2x6_stucco';
export const DEFAULT_INTERIOR_WALL: WallAssemblyType = 'interior';

/**
 * Get wall thickness in feet for a given assembly type.
 */
export function getWallThickness(type: WallAssemblyType = DEFAULT_EXTERIOR_WALL): number {
  return WALL_ASSEMBLIES[type].roundedFeet;
}

/**
 * Calculate exterior footprint from interior dimensions.
 * Adds wall thickness to each side.
 */
export function interiorToExterior(
  interiorWidth: number,
  interiorDepth: number,
  wallType: WallAssemblyType = DEFAULT_EXTERIOR_WALL
): { width: number; depth: number } {
  const wallThickness = getWallThickness(wallType);
  return {
    width: interiorWidth + (2 * wallThickness),
    depth: interiorDepth + (2 * wallThickness),
  };
}

/**
 * Calculate interior dimensions from exterior footprint.
 * Subtracts wall thickness from each side.
 */
export function exteriorToInterior(
  exteriorWidth: number,
  exteriorDepth: number,
  wallType: WallAssemblyType = DEFAULT_EXTERIOR_WALL
): { width: number; depth: number } {
  const wallThickness = getWallThickness(wallType);
  return {
    width: exteriorWidth - (2 * wallThickness),
    depth: exteriorDepth - (2 * wallThickness),
  };
}

// ============================================================================
// Types
// ============================================================================

/**
 * Position can be:
 * - Absolute: [x, y] coordinates
 * - Relative: NORTH/SOUTH/EAST/WEST of another room
 * - Auto: System places optimally
 */
export type PositionSpec =
  | { type: 'absolute'; x: number; y: number }
  | { type: 'relative'; direction: CardinalDirection; relativeTo: string; gap?: number }
  | { type: 'auto' };

/**
 * Room placement request - what Gemini asks for
 */
export interface RoomRequest {
  name: string;
  type: RoomType;
  width: number;
  depth: number;
  position: PositionSpec;
}

/**
 * Result of a skill execution
 */
export interface SkillResult {
  success: boolean;
  toolCalls: ToolCall[];
  message: string;
  data?: unknown;
  error?: string;
}

/**
 * Adjacency requirement for layout planning
 */
export interface AdjacencyRequirement {
  room1: string;
  room2: string;
  preferred: CardinalDirection | 'any';
  required: boolean;
}

/**
 * Layout result with planned positions
 */
export interface LayoutPlan {
  rooms: Array<{
    name: string;
    type: RoomType;
    position: [number, number];
    dimensions: [number, number];
  }>;
  conflicts: string[];
  warnings: string[];
}

// ============================================================================
// Production Home Templates & Adjacency Rules
// ============================================================================

/**
 * Room type adjacency rules - what rooms should be near/avoid each other.
 * Based on production home design principles for affordable housing.
 *
 * Synced with RoomType from gemini-types.ts
 */
export const TYPE_ADJACENCY_RULES: Record<RoomType, { near: RoomType[]; avoid: RoomType[] }> = {
  // Core living spaces
  kitchen: { near: ['living', 'dining', 'pantry', 'family'], avoid: ['bedroom', 'garage'] },
  living: { near: ['kitchen', 'dining', 'foyer', 'circulation'], avoid: [] },
  dining: { near: ['kitchen', 'living'], avoid: ['bedroom', 'garage'] },
  family: { near: ['kitchen', 'living'], avoid: ['garage'] },

  // Private spaces
  bedroom: { near: ['hallway', 'bathroom', 'closet', 'circulation'], avoid: ['kitchen', 'garage'] },
  bathroom: { near: ['bedroom', 'hallway', 'closet', 'circulation'], avoid: [] },
  closet: { near: ['bedroom', 'hallway', 'foyer'], avoid: ['kitchen', 'garage'] },
  office: { near: ['foyer', 'hallway', 'living'], avoid: ['kitchen', 'garage'] },

  // Service spaces
  garage: { near: ['utility', 'mudroom', 'laundry'], avoid: ['bedroom', 'kitchen', 'living'] },
  utility: { near: ['garage', 'kitchen', 'laundry'], avoid: ['bedroom', 'living'] },
  laundry: { near: ['utility', 'garage', 'mudroom', 'bathroom'], avoid: ['living', 'dining'] },
  pantry: { near: ['kitchen'], avoid: ['bedroom', 'bathroom'] },

  // Entry/circulation spaces
  hallway: { near: ['bedroom', 'bathroom', 'living', 'closet'], avoid: [] },
  circulation: { near: ['living', 'kitchen', 'foyer'], avoid: [] },
  mudroom: { near: ['garage', 'foyer', 'laundry'], avoid: ['bedroom', 'living'] },
  foyer: { near: ['living', 'dining', 'office', 'closet'], avoid: ['bedroom', 'garage'] },

  // Outdoor spaces
  patio: { near: ['living', 'kitchen', 'dining', 'family'], avoid: [] },
  deck: { near: ['living', 'bedroom', 'family'], avoid: [] },

  // Vertical circulation (stairs)
  stair: { near: ['foyer', 'hallway', 'landing'], avoid: [] },
  landing: { near: ['stair', 'hallway', 'bedroom'], avoid: [] },

  // Open floor plan (combined living/kitchen/dining)
  great_room: { near: ['foyer', 'pantry', 'mudroom'], avoid: ['garage'] },

  // Catch-all
  other: { near: ['living', 'kitchen'], avoid: [] },
};

/**
 * Home template tiers with adjacency requirements for coherent layouts.
 *
 * Templates based on affordable production homes ($200K-$450K):
 * - Starter: 1,000-1,500 sqft (2-3 bed, 1-2 bath)
 * - Family: 1,800-2,500 sqft (3-4 bed, 2-2.5 bath)
 * - Executive: 2,500-4,500 sqft (4-5 bed, 3+ bath)
 */
export type HomeTemplate = 'starter' | 'family' | 'executive';

export interface TemplateZone {
  name: string;
  direction: CardinalDirection;
  roomTypes: RoomType[];
}

export interface HomeTemplateConfig {
  name: HomeTemplate;
  sqftRange: { min: number; max: number };
  priceRange: string;
  zones: TemplateZone[];
  adjacencies: AdjacencyRequirement[];
  description: string;
}

export const STANDARD_HOME_TEMPLATES: Record<HomeTemplate, HomeTemplateConfig> = {
  starter: {
    name: 'starter',
    sqftRange: { min: 1000, max: 1500 },
    priceRange: '$200K-$300K',
    description: '2-3 bedroom starter home with open concept living',
    zones: [
      { name: 'Entry', direction: 'NORTH', roomTypes: ['circulation'] },
      { name: 'Public', direction: 'NORTH', roomTypes: ['living', 'kitchen', 'other'] },
      { name: 'Private', direction: 'SOUTH', roomTypes: ['bedroom', 'bathroom', 'hallway'] },
      { name: 'Service', direction: 'WEST', roomTypes: ['garage', 'utility'] },
    ],
    adjacencies: [
      { room1: 'Entry', room2: 'Living', preferred: 'SOUTH', required: true },
      { room1: 'Kitchen', room2: 'Living', preferred: 'any', required: true },
      { room1: 'Primary Bedroom', room2: 'Primary Bath', preferred: 'any', required: true },
      { room1: 'Hallway', room2: 'Bedroom 2', preferred: 'any', required: true },
      { room1: 'Hallway', room2: 'Hall Bath', preferred: 'any', required: true },
    ],
  },
  family: {
    name: 'family',
    sqftRange: { min: 1800, max: 2500 },
    priceRange: '$280K-$380K',
    description: '3-4 bedroom family home with dedicated dining and family room',
    zones: [
      { name: 'Entry', direction: 'NORTH', roomTypes: ['circulation'] },
      { name: 'Formal', direction: 'NORTH', roomTypes: ['living', 'other'] },
      { name: 'Kitchen Zone', direction: 'EAST', roomTypes: ['kitchen', 'other'] },
      { name: 'Private', direction: 'SOUTH', roomTypes: ['bedroom', 'bathroom', 'hallway'] },
      { name: 'Service', direction: 'WEST', roomTypes: ['garage', 'utility'] },
    ],
    adjacencies: [
      { room1: 'Foyer', room2: 'Living', preferred: 'SOUTH', required: true },
      { room1: 'Kitchen', room2: 'Family Room', preferred: 'EAST', required: true },
      { room1: 'Garage', room2: 'Mudroom', preferred: 'EAST', required: true },
      { room1: 'Mudroom', room2: 'Kitchen', preferred: 'EAST', required: false },
      { room1: 'Primary Suite', room2: 'Primary Bath', preferred: 'any', required: true },
      { room1: 'Primary Suite', room2: 'Walk-in Closet', preferred: 'any', required: false },
    ],
  },
  executive: {
    name: 'executive',
    sqftRange: { min: 2500, max: 4500 },
    priceRange: '$350K-$450K',
    description: '4-5 bedroom executive home with formal spaces and primary suite',
    zones: [
      { name: 'Grand Entry', direction: 'NORTH', roomTypes: ['circulation', 'living', 'other'] },
      { name: 'Family Zone', direction: 'EAST', roomTypes: ['living', 'kitchen', 'other'] },
      { name: 'Primary Suite', direction: 'SOUTH', roomTypes: ['bedroom', 'bathroom'] },
      { name: 'Guest/Kids Wing', direction: 'WEST', roomTypes: ['bedroom', 'bathroom', 'hallway'] },
      { name: 'Service', direction: 'WEST', roomTypes: ['garage', 'utility'] },
    ],
    adjacencies: [
      { room1: 'Foyer', room2: 'Formal Living', preferred: 'EAST', required: true },
      { room1: 'Foyer', room2: 'Formal Dining', preferred: 'WEST', required: true },
      { room1: 'Kitchen', room2: 'Great Room', preferred: 'SOUTH', required: true },
      { room1: 'Kitchen', room2: 'Breakfast Nook', preferred: 'EAST', required: false },
      { room1: 'Office', room2: 'Foyer', preferred: 'any', required: false },
      { room1: 'Primary Suite', room2: 'Primary Bath', preferred: 'SOUTH', required: true },
      { room1: 'Primary Suite', room2: 'Walk-in Closet', preferred: 'EAST', required: true },
    ],
  },
};

/**
 * Infer adjacency requirements based on room type when creating with position='auto'.
 * Returns adjacencies to existing rooms that should be satisfied.
 */
export function inferAdjacencyForRoomType(
  newRoomType: RoomType,
  newRoomName: string,
  currentState: ObservableState
): AdjacencyRequirement[] {
  const rules = TYPE_ADJACENCY_RULES[newRoomType];
  if (!rules) return [];

  const inferred: AdjacencyRequirement[] = [];
  const existingRooms = currentState.floorplan.rooms;

  // Find rooms that this new room should be near
  for (const nearType of rules.near) {
    const nearbyRoom = existingRooms.find(r => r.type === nearType);
    if (nearbyRoom) {
      inferred.push({
        room1: newRoomName,
        room2: nearbyRoom.name,
        preferred: 'any',
        required: true,
      });
      break; // Only need one adjacency for auto-placement
    }
  }

  // If bedroom, prefer to be near hallway
  if (newRoomType === 'bedroom') {
    const hallway = existingRooms.find(r => r.type === 'hallway' || r.type === 'circulation');
    if (hallway) {
      inferred.push({
        room1: newRoomName,
        room2: hallway.name,
        preferred: 'any',
        required: true,
      });
    }
  }

  // If bathroom, prefer to be near bedrooms
  if (newRoomType === 'bathroom') {
    const bedroom = existingRooms.find(r => r.type === 'bedroom');
    if (bedroom) {
      inferred.push({
        room1: newRoomName,
        room2: bedroom.name,
        preferred: 'any',
        required: true,
      });
    }
  }

  return inferred;
}

// ============================================================================
// Room Overlap Detection & Smart Placement
// ============================================================================

/**
 * Check if proposed room bounds would overlap with existing rooms.
 * Uses AABB (Axis-Aligned Bounding Box) collision detection.
 *
 * @param newBounds - { minX, minY, maxX, maxY } of proposed room
 * @param existingRooms - Current rooms from ObservableState
 * @param tolerance - Minimum gap required (0 = touching OK, >0 = requires gap)
 * @returns { overlaps: boolean, conflictingRoom?: string }
 */
function checkOverlap(
  newBounds: { minX: number; minY: number; maxX: number; maxY: number },
  existingRooms: RoomSummary[],
  tolerance: number = 0
): { overlaps: boolean; conflictingRoom?: string } {
  for (const room of existingRooms) {
    const ex = room.bounds;
    // AABB overlap test with tolerance
    const overlaps = !(
      newBounds.maxX + tolerance <= ex.minX ||
      newBounds.minX - tolerance >= ex.maxX ||
      newBounds.maxY + tolerance <= ex.minY ||
      newBounds.minY - tolerance >= ex.maxY
    );
    if (overlaps) {
      return { overlaps: true, conflictingRoom: room.name };
    }
  }
  return { overlaps: false };
}

/**
 * Find a valid non-overlapping position for a room.
 * Tries multiple positions around existing rooms, picking the best one.
 *
 * @param width - Room width
 * @param depth - Room depth
 * @param existingRooms - Current rooms
 * @param footprint - Building footprint bounds (optional)
 * @param preferredDirection - Preferred direction to try first
 * @returns { position: [x, y] | null, strategy: string }
 */
function findValidPlacement(
  width: number,
  depth: number,
  existingRooms: RoomSummary[],
  footprint?: { width: number; depth: number },
  preferredDirection?: CardinalDirection
): { position: Point2D | null; strategy: string } {
  // If no existing rooms, place at origin
  if (existingRooms.length === 0) {
    return { position: [0, 0], strategy: 'origin' };
  }

  const candidates: Array<{ pos: Point2D; score: number; strategy: string }> = [];
  const gap = 0.5; // Small gap between rooms

  // Calculate building center for scoring
  const allBounds = existingRooms.map(r => r.bounds);
  const centerX = (Math.min(...allBounds.map(b => b.minX)) + Math.max(...allBounds.map(b => b.maxX))) / 2;
  const centerY = (Math.min(...allBounds.map(b => b.minY)) + Math.max(...allBounds.map(b => b.maxY))) / 2;

  // Try positions adjacent to each existing room
  for (const room of existingRooms) {
    const directions: Array<{ dir: CardinalDirection; pos: Point2D }> = [
      { dir: 'EAST', pos: [room.bounds.maxX + gap, room.bounds.minY] },
      { dir: 'WEST', pos: [room.bounds.minX - width - gap, room.bounds.minY] },
      { dir: 'NORTH', pos: [room.bounds.minX, room.bounds.maxY + gap] },
      { dir: 'SOUTH', pos: [room.bounds.minX, room.bounds.minY - depth - gap] },
    ];

    // Prioritize preferred direction
    if (preferredDirection) {
      directions.sort((a, b) => (a.dir === preferredDirection ? -1 : b.dir === preferredDirection ? 1 : 0));
    }

    for (const { dir, pos } of directions) {
      const bounds = {
        minX: pos[0],
        minY: pos[1],
        maxX: pos[0] + width,
        maxY: pos[1] + depth,
      };

      // Check overlap
      const { overlaps } = checkOverlap(bounds, existingRooms, gap);
      if (overlaps) continue;

      // Check footprint bounds if provided
      if (footprint) {
        if (bounds.maxX > footprint.width || bounds.maxY > footprint.depth ||
            bounds.minX < 0 || bounds.minY < 0) {
          continue;
        }
      }

      // Score by distance to center (closer = better)
      const dist = Math.sqrt((pos[0] + width / 2 - centerX) ** 2 + (pos[1] + depth / 2 - centerY) ** 2);
      candidates.push({ pos, score: dist, strategy: `${dir} of ${room.name}` });
    }
  }

  if (candidates.length === 0) {
    return { position: null, strategy: 'no valid position found' };
  }

  // Return position closest to center
  candidates.sort((a, b) => a.score - b.score);
  return { position: candidates[0].pos, strategy: candidates[0].strategy };
}

/**
 * Select appropriate home template based on total square footage.
 */
export function selectTemplateBySquareFootage(totalSqft: number): HomeTemplate {
  if (totalSqft <= 1500) return 'starter';
  if (totalSqft <= 2500) return 'family';
  return 'executive';
}

// ============================================================================
// Room Placement Skills
// ============================================================================

/**
 * Create a rectangular room at a specified position.
 *
 * This is a compound skill that:
 * 1. Calculates corner points from width/depth/position
 * 2. Generates the create_room tool call
 * 3. Returns points in counter-clockwise order
 *
 * @param levelId - The level to place the room on
 * @param name - Room name (e.g., "Master Bedroom")
 * @param roomType - Room type for code compliance
 * @param width - Room width (E-W direction)
 * @param depth - Room depth (N-S direction)
 * @param position - Where to place the room
 * @param currentState - Current observable state (for relative positioning)
 */
export function createRectangularRoom(
  levelId: string,
  name: string,
  roomType: RoomType,
  width: number,
  depth: number,
  position: PositionSpec,
  currentState?: ObservableState
): SkillResult {
  // Validate dimensions
  if (width <= 0 || depth <= 0) {
    return {
      success: false,
      toolCalls: [],
      message: 'Invalid dimensions',
      error: `Width and depth must be positive. Got width=${width}, depth=${depth}`,
    };
  }

  // Calculate origin based on position type
  let origin: [number, number];

  switch (position.type) {
    case 'absolute':
      origin = [position.x, position.y];
      break;

    case 'relative':
      if (!currentState) {
        return {
          success: false,
          toolCalls: [],
          message: 'Cannot use relative position without current state',
          error: 'Provide currentState for relative positioning',
        };
      }

      const targetRoom = currentState.floorplan.rooms.find(
        (r) => r.name === position.relativeTo
      );

      if (!targetRoom) {
        return {
          success: false,
          toolCalls: [],
          message: `Room "${position.relativeTo}" not found`,
          error: `Cannot position relative to non-existent room. Available rooms: ${currentState.floorplan.rooms.map((r) => r.name).join(', ') || 'none'}`,
        };
      }

      const gap = position.gap ?? 0;
      const targetBounds = targetRoom.bounds;

      // Position based on direction
      switch (position.direction) {
        case 'NORTH':
          origin = [targetBounds.minX, targetBounds.maxY + gap];
          break;
        case 'SOUTH':
          origin = [targetBounds.minX, targetBounds.minY - depth - gap];
          break;
        case 'EAST':
          origin = [targetBounds.maxX + gap, targetBounds.minY];
          break;
        case 'WEST':
          origin = [targetBounds.minX - width - gap, targetBounds.minY];
          break;
      }

      // Validate relative positioning doesn't overlap with third rooms
      {
        const bounds = {
          minX: origin[0],
          minY: origin[1],
          maxX: origin[0] + width,
          maxY: origin[1] + depth,
        };
        const { overlaps, conflictingRoom } = checkOverlap(bounds, currentState.floorplan.rooms, 0.5);
        if (overlaps) {
          return {
            success: false,
            toolCalls: [],
            message: `Cannot place "${name}" ${position.direction} of "${position.relativeTo}" - would overlap with "${conflictingRoom}"`,
            error: `Room overlap detected. Try a different direction or adjust room sizes.`,
          };
        }
      }
      break;

    case 'auto': {
      if (!currentState) {
        origin = [0, 0];
        break;
      }

      // If no existing rooms, place at origin
      if (currentState.floorplan.rooms.length === 0) {
        origin = [0, 0];
        break;
      }

      // First, try adjacency-based placement via layoutFloor
      const inferredAdj = inferAdjacencyForRoomType(roomType, name, currentState);
      if (inferredAdj.length > 0) {
        const plan = layoutFloor(
          [{ name, type: roomType, width, depth }],
          inferredAdj,
          undefined // No bounding box constraint for single room
        );

        if (plan.conflicts.length === 0 && plan.rooms.length > 0) {
          const planned = plan.rooms[0];
          origin = planned.position;

          // Validate the planned position doesn't overlap
          const bounds = {
            minX: origin[0],
            minY: origin[1],
            maxX: origin[0] + width,
            maxY: origin[1] + depth,
          };
          const { overlaps } = checkOverlap(bounds, currentState.floorplan.rooms, 0.5);
          if (!overlaps) {
            console.log(`[createRectangularRoom] Auto-placed "${name}" using layoutFloor adjacency`);
            break; // Use the planned position
          }
        }
      }

      // Fallback: Use smart placement finder
      // Use layout bounding box as footprint constraint if available
      const footprintConstraint = currentState.layout.boundingBox.width > 0
        ? {
            width: currentState.layout.boundingBox.width,
            depth: currentState.layout.boundingBox.depth,
          }
        : undefined;

      const { position: foundPosition, strategy } = findValidPlacement(
        width,
        depth,
        currentState.floorplan.rooms,
        footprintConstraint
      );

      if (foundPosition) {
        origin = foundPosition;
        console.log(`[createRectangularRoom] Auto-placed "${name}" using strategy: ${strategy}`);
      } else {
        return {
          success: false,
          toolCalls: [],
          message: `Cannot auto-place "${name}" - no valid position found that doesn't overlap existing rooms`,
          error: `All candidate positions overlap. Try specifying position manually with position_type='relative' or 'absolute'.`,
        };
      }
      break;
    }
  }

  // Final validation before creating room (catches edge cases from absolute positioning)
  if (currentState) {
    const finalBounds = {
      minX: origin[0],
      minY: origin[1],
      maxX: origin[0] + width,
      maxY: origin[1] + depth,
    };
    const { overlaps, conflictingRoom } = checkOverlap(finalBounds, currentState.floorplan.rooms, 0);
    if (overlaps) {
      return {
        success: false,
        toolCalls: [],
        message: `Cannot create "${name}" at [${origin[0]}, ${origin[1]}] - overlaps with "${conflictingRoom}"`,
        error: `Position validation failed. The calculated position overlaps an existing room.`,
      };
    }
  }

  // Calculate corner points (counter-clockwise from bottom-left)
  const points: Point2D[] = [
    [origin[0], origin[1]],                    // SW corner
    [origin[0] + width, origin[1]],            // SE corner
    [origin[0] + width, origin[1] + depth],    // NE corner
    [origin[0], origin[1] + depth],            // NW corner
  ];

  // Generate tool call
  const toolCall: ToolCall = {
    name: 'create_room',
    args: {
      level_id: levelId,
      room_type: roomType,
      name: name,
      points: points,
    },
  };

  return {
    success: true,
    toolCalls: [toolCall],
    message: `Create ${name} (${roomType}): ${width}' x ${depth}' = ${width * depth} sq ft`,
    data: { points, area: width * depth },
  };
}

/**
 * Create a hallway connecting two rooms.
 *
 * This skill:
 * 1. Finds the connection point between rooms
 * 2. Creates a rectangular hallway space
 * 3. Handles turns if needed
 *
 * @param levelId - The level to place hallway on
 * @param fromRoom - Name of starting room
 * @param toRoom - Name of ending room
 * @param width - Hallway width (min 3' for code, typical 3.5-4')
 * @param currentState - Current observable state with room info
 */
export function createHallway(
  levelId: string,
  fromRoom: string,
  toRoom: string,
  width: number,
  currentState: ObservableState
): SkillResult {
  // Validate width
  if (width < 3) {
    return {
      success: false,
      toolCalls: [],
      message: 'Hallway too narrow',
      error: `Hallway width must be at least 3' for code compliance. Got ${width}'`,
    };
  }

  // Find rooms
  const room1 = currentState.floorplan.rooms.find((r) => r.name === fromRoom);
  const room2 = currentState.floorplan.rooms.find((r) => r.name === toRoom);

  if (!room1 || !room2) {
    const missing = !room1 ? fromRoom : toRoom;
    return {
      success: false,
      toolCalls: [],
      message: `Room "${missing}" not found`,
      error: `Cannot connect non-existent room. Available: ${currentState.floorplan.rooms.map((r) => r.name).join(', ') || 'none'}`,
    };
  }

  // Determine connection direction
  const dx = room2.center[0] - room1.center[0];
  const dy = room2.center[1] - room1.center[1];

  // Simple case: rooms are aligned horizontally or vertically
  const isHorizontal = Math.abs(dx) > Math.abs(dy);

  let points: Point2D[];
  let length: number;

  if (isHorizontal) {
    // Horizontal hallway (E-W)
    const startX = dx > 0 ? room1.bounds.maxX : room1.bounds.minX;
    const endX = dx > 0 ? room2.bounds.minX : room2.bounds.maxX;
    const y = Math.max(room1.bounds.minY, room2.bounds.minY);

    length = Math.abs(endX - startX);
    const minX = Math.min(startX, endX);

    points = [
      [minX, y],
      [minX + length, y],
      [minX + length, y + width],
      [minX, y + width],
    ];
  } else {
    // Vertical hallway (N-S)
    const startY = dy > 0 ? room1.bounds.maxY : room1.bounds.minY;
    const endY = dy > 0 ? room2.bounds.minY : room2.bounds.maxY;
    const x = Math.max(room1.bounds.minX, room2.bounds.minX);

    length = Math.abs(endY - startY);
    const minY = Math.min(startY, endY);

    points = [
      [x, minY],
      [x + width, minY],
      [x + width, minY + length],
      [x, minY + length],
    ];
  }

  // Check if hallway has meaningful length
  if (length < 1) {
    return {
      success: false,
      toolCalls: [],
      message: 'Rooms too close for hallway',
      error: 'Rooms appear to be adjacent. Consider opening connection directly.',
    };
  }

  const hallwayName = `Hallway (${fromRoom} to ${toRoom})`;

  const toolCall: ToolCall = {
    name: 'create_room',
    args: {
      level_id: levelId,
      room_type: 'hallway',
      name: hallwayName,
      points: points,
    },
  };

  return {
    success: true,
    toolCalls: [toolCall],
    message: `Create hallway ${width}' wide x ${length.toFixed(1)}' long connecting ${fromRoom} to ${toRoom}`,
    data: { points, length, width },
  };
}

// ============================================================================
// Layout Planning Skills
// ============================================================================

/**
 * Plan a floor layout based on room list and adjacency requirements.
 *
 * This is an advisory skill that:
 * 1. Analyzes room sizes and adjacency requirements
 * 2. Proposes optimal positions
 * 3. Identifies conflicts
 * 4. Returns planned positions (not actual tool calls)
 *
 * The caller should then use createRectangularRoom with the planned positions.
 *
 * @param rooms - List of rooms to place
 * @param adjacencies - Required/preferred adjacency relationships
 * @param boundingBox - Optional constraint on total footprint
 */
export function layoutFloor(
  rooms: Array<{ name: string; type: RoomType; width: number; depth: number }>,
  adjacencies: AdjacencyRequirement[],
  boundingBox?: { width: number; depth: number }
): LayoutPlan {
  const conflicts: string[] = [];
  const warnings: string[] = [];
  const placedRooms: LayoutPlan['rooms'] = [];

  // Sort rooms by adjacency requirements (rooms with more requirements first)
  const roomPriority = new Map<string, number>();
  rooms.forEach((r) => roomPriority.set(r.name, 0));
  adjacencies.forEach((adj) => {
    if (adj.required) {
      roomPriority.set(adj.room1, (roomPriority.get(adj.room1) || 0) + 2);
      roomPriority.set(adj.room2, (roomPriority.get(adj.room2) || 0) + 2);
    } else {
      roomPriority.set(adj.room1, (roomPriority.get(adj.room1) || 0) + 1);
      roomPriority.set(adj.room2, (roomPriority.get(adj.room2) || 0) + 1);
    }
  });

  const sortedRooms = [...rooms].sort(
    (a, b) => (roomPriority.get(b.name) || 0) - (roomPriority.get(a.name) || 0)
  );

  // Place first room at origin
  if (sortedRooms.length > 0) {
    const first = sortedRooms[0];
    placedRooms.push({
      name: first.name,
      type: first.type,
      position: [0, 0],
      dimensions: [first.width, first.depth],
    });
  }

  // Place remaining rooms based on adjacency requirements
  for (let i = 1; i < sortedRooms.length; i++) {
    const room = sortedRooms[i];

    // Find adjacency requirements for this room
    const relevantAdj = adjacencies.filter(
      (adj) =>
        (adj.room1 === room.name || adj.room2 === room.name) &&
        placedRooms.some(
          (p) => p.name === adj.room1 || p.name === adj.room2
        )
    );

    let placed = false;

    for (const adj of relevantAdj) {
      const otherName = adj.room1 === room.name ? adj.room2 : adj.room1;
      const other = placedRooms.find((p) => p.name === otherName);

      if (!other) continue;

      // Calculate position based on preferred direction
      let position: [number, number];
      const direction =
        adj.preferred === 'any'
          ? 'EAST' // Default to east if no preference
          : adj.preferred;

      switch (direction) {
        case 'NORTH':
          position = [other.position[0], other.position[1] + other.dimensions[1]];
          break;
        case 'SOUTH':
          position = [other.position[0], other.position[1] - room.depth];
          break;
        case 'EAST':
          position = [other.position[0] + other.dimensions[0], other.position[1]];
          break;
        case 'WEST':
          position = [other.position[0] - room.width, other.position[1]];
          break;
      }

      // Check for overlap with existing rooms
      const wouldOverlap = placedRooms.some((existing) => {
        const exMinX = existing.position[0];
        const exMaxX = existing.position[0] + existing.dimensions[0];
        const exMinY = existing.position[1];
        const exMaxY = existing.position[1] + existing.dimensions[1];

        const newMinX = position[0];
        const newMaxX = position[0] + room.width;
        const newMinY = position[1];
        const newMaxY = position[1] + room.depth;

        return !(newMaxX <= exMinX || newMinX >= exMaxX || newMaxY <= exMinY || newMinY >= exMaxY);
      });

      if (!wouldOverlap) {
        placedRooms.push({
          name: room.name,
          type: room.type,
          position: position,
          dimensions: [room.width, room.depth],
        });
        placed = true;
        break;
      }
    }

    // If no adjacency-based position worked, find first non-overlapping position
    if (!placed) {
      // Try positions to the east of existing rooms
      let x = 0;
      for (const existing of placedRooms) {
        const potentialX = existing.position[0] + existing.dimensions[0];
        if (potentialX > x) x = potentialX;
      }

      placedRooms.push({
        name: room.name,
        type: room.type,
        position: [x, 0],
        dimensions: [room.width, room.depth],
      });

      if (relevantAdj.length > 0) {
        warnings.push(
          `${room.name}: Placed without satisfying adjacency requirements`
        );
      }
    }
  }

  // Check bounding box constraint
  if (boundingBox) {
    let maxX = 0,
      maxY = 0;
    for (const room of placedRooms) {
      const roomMaxX = room.position[0] + room.dimensions[0];
      const roomMaxY = room.position[1] + room.dimensions[1];
      if (roomMaxX > maxX) maxX = roomMaxX;
      if (roomMaxY > maxY) maxY = roomMaxY;
    }

    if (maxX > boundingBox.width) {
      conflicts.push(
        `Layout exceeds width: ${maxX.toFixed(1)}' vs ${boundingBox.width}' allowed`
      );
    }
    if (maxY > boundingBox.depth) {
      conflicts.push(
        `Layout exceeds depth: ${maxY.toFixed(1)}' vs ${boundingBox.depth}' allowed`
      );
    }
  }

  // Verify required adjacencies are satisfied
  for (const adj of adjacencies) {
    if (!adj.required) continue;

    const room1 = placedRooms.find((p) => p.name === adj.room1);
    const room2 = placedRooms.find((p) => p.name === adj.room2);

    if (!room1 || !room2) continue;

    // Check if rooms are actually adjacent (share an edge)
    const r1MinX = room1.position[0];
    const r1MaxX = room1.position[0] + room1.dimensions[0];
    const r1MinY = room1.position[1];
    const r1MaxY = room1.position[1] + room1.dimensions[1];

    const r2MinX = room2.position[0];
    const r2MaxX = room2.position[0] + room2.dimensions[0];
    const r2MinY = room2.position[1];
    const r2MaxY = room2.position[1] + room2.dimensions[1];

    const sharesEdge =
      (r1MaxX === r2MinX || r1MinX === r2MaxX) && !(r1MaxY <= r2MinY || r1MinY >= r2MaxY) ||
      (r1MaxY === r2MinY || r1MinY === r2MaxY) && !(r1MaxX <= r2MinX || r1MinX >= r2MaxX);

    if (!sharesEdge) {
      conflicts.push(
        `Required adjacency not satisfied: ${adj.room1} and ${adj.room2} are not adjacent`
      );
    }
  }

  return {
    rooms: placedRooms,
    conflicts,
    warnings,
  };
}

// ============================================================================
// Specialized Room Skills (Phase C)
// ============================================================================

/**
 * Kitchen layout styles with built-in dimensions
 */
export type KitchenStyle = 'L-shape' | 'galley' | 'U-shape' | 'single-wall';

/**
 * Kitchen configuration based on style
 */
const KITCHEN_CONFIGS: Record<KitchenStyle, { minWidth: number; minDepth: number; hasIsland: boolean }> = {
  'L-shape': { minWidth: 12, minDepth: 10, hasIsland: true },
  'galley': { minWidth: 8, minDepth: 12, hasIsland: false },
  'U-shape': { minWidth: 14, minDepth: 10, hasIsland: true },
  'single-wall': { minWidth: 12, minDepth: 8, hasIsland: false },
};

/**
 * Bathroom types with fixture requirements
 */
export type BathroomType = 'full' | 'half' | 'master' | 'three-quarter';

const BATHROOM_CONFIGS: Record<BathroomType, { minArea: number; fixtures: string[]; minWidth: number; minDepth: number }> = {
  'full': { minArea: 40, fixtures: ['toilet', 'sink', 'tub/shower'], minWidth: 5, minDepth: 8 },
  'half': { minArea: 18, fixtures: ['toilet', 'sink'], minWidth: 3, minDepth: 6 },
  'master': { minArea: 70, fixtures: ['toilet', 'dual-sink', 'shower', 'tub'], minWidth: 8, minDepth: 10 },
  'three-quarter': { minArea: 35, fixtures: ['toilet', 'sink', 'shower'], minWidth: 5, minDepth: 7 },
};

/**
 * Closet types with dimension requirements
 */
export type ClosetType = 'walk-in' | 'reach-in' | 'linen' | 'coat';

const CLOSET_CONFIGS: Record<ClosetType, { minWidth: number; minDepth: number; description: string }> = {
  'walk-in': { minWidth: 6, minDepth: 6, description: 'Walk-in closet with hanging rods on multiple walls' },
  'reach-in': { minWidth: 2, minDepth: 4, description: 'Standard reach-in closet with single rod' },
  'linen': { minWidth: 2, minDepth: 3, description: 'Linen closet for towels and sheets' },
  'coat': { minWidth: 2, minDepth: 4, description: 'Entry coat closet' },
};

/**
 * Create a bedroom with appropriate dimensions and optional closet.
 *
 * Encapsulates bedroom design knowledge:
 * - Minimum 70 sq ft for code (IRC)
 * - Typical 100-150 sq ft for secondary bedrooms
 * - Master bedrooms 150-300 sq ft
 * - Ensures room for bed + circulation
 * - Optional auto-closet: walk-in for master, reach-in for secondary
 */
export function createBedroom(
  levelId: string,
  name: string,
  isMaster: boolean,
  minArea: number | undefined,
  position: PositionSpec,
  currentState?: ObservableState,
  includeCloset: boolean = false
): SkillResult {
  // Calculate dimensions based on bedroom type
  const targetArea = minArea || (isMaster ? 180 : 120);

  // Bedrooms should be roughly rectangular, slightly longer than wide
  // Golden ratio approximation: depth = width * 1.2
  const width = Math.ceil(Math.sqrt(targetArea / 1.2));
  const depth = Math.ceil(targetArea / width);

  // Validate minimum dimensions
  const actualArea = width * depth;
  if (actualArea < 70) {
    return {
      success: false,
      toolCalls: [],
      message: 'Bedroom too small for code compliance',
      error: `Bedroom area ${actualArea} sq ft is below IRC minimum of 70 sq ft`,
    };
  }

  // Create the bedroom first
  const bedroomResult = createRectangularRoom(
    levelId,
    name,
    'bedroom',
    width,
    depth,
    position,
    currentState
  );

  // If not including closet or bedroom creation failed, return bedroom result
  if (!includeCloset || !bedroomResult.success) {
    return bedroomResult;
  }

  // Auto-create closet adjacent to bedroom
  const closetType: ClosetType = isMaster ? 'walk-in' : 'reach-in';
  const closetName = `${name} Closet`;
  const closetConfig = CLOSET_CONFIGS[closetType];

  // Position closet to the WEST of the bedroom (typical layout)
  const closetPosition: PositionSpec = {
    type: 'relative',
    direction: 'WEST',
    relativeTo: name,
    gap: 0, // Closet shares wall with bedroom
  };

  // We need to simulate the bedroom existing for relative positioning
  // Build a mock state with the bedroom that was just created
  const bedroomData = bedroomResult.data as { points: Point2D[]; area: number } | undefined;
  const bedroomPoints = bedroomData?.points;

  let mockStateWithBedroom: ObservableState | undefined = currentState;

  if (bedroomPoints && bedroomPoints.length >= 4) {
    // Calculate bedroom bounds from points
    const xs = bedroomPoints.map(p => p[0]);
    const ys = bedroomPoints.map(p => p[1]);
    const bedroomBounds = {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };

    // Create mock state with the new bedroom included
    const newBedroomEntry: RoomSummary = {
      id: `temp-${name}` as `room-${string}`, // Temporary ID for positioning
      name: name,
      type: 'bedroom',
      bounds: bedroomBounds,
      center: [(bedroomBounds.minX + bedroomBounds.maxX) / 2, (bedroomBounds.minY + bedroomBounds.maxY) / 2],
      dimensions: { width, depth },
      area: actualArea,
    };

    mockStateWithBedroom = currentState
      ? {
          ...currentState,
          floorplan: {
            ...currentState.floorplan,
            rooms: [...currentState.floorplan.rooms, newBedroomEntry],
          },
        }
      : undefined; // If no current state, we can't create a valid one - let closet use 'auto' positioning
  }

  // Create closet positioned relative to bedroom
  const closetResult = createCloset(
    levelId,
    closetName,
    closetType,
    closetPosition,
    mockStateWithBedroom
  );

  // Combine tool calls from both operations
  const combinedToolCalls = [...bedroomResult.toolCalls, ...closetResult.toolCalls];

  // Build combined result
  const closetData = closetResult.data as { area?: number } | undefined;
  const closetArea = closetData?.area ?? (closetConfig.minWidth * closetConfig.minDepth);

  return {
    success: bedroomResult.success && closetResult.success,
    toolCalls: combinedToolCalls,
    message: closetResult.success
      ? `Create ${name} (${width}'×${depth}' = ${actualArea} sq ft) with ${closetType} closet (${closetArea} sq ft)`
      : `Create ${name} (${width}'×${depth}' = ${actualArea} sq ft) - closet creation failed: ${closetResult.error}`,
    data: {
      bedroom: bedroomResult.data,
      closet: closetResult.success ? closetResult.data : null,
      totalArea: actualArea + (closetResult.success ? closetArea : 0),
    },
    error: closetResult.success ? undefined : closetResult.error,
  };
}

/**
 * Create a kitchen with style-appropriate layout.
 *
 * Encapsulates kitchen design knowledge:
 * - L-shape: corner counters, island space
 * - Galley: parallel counters, efficient for small spaces
 * - U-shape: three walls of counters, maximum storage
 * - Work triangle: sink ↔ stove ↔ fridge < 26' total
 */
export function createKitchen(
  levelId: string,
  name: string,
  style: KitchenStyle,
  hasIsland: boolean,
  position: PositionSpec,
  currentState?: ObservableState
): SkillResult {
  const config = KITCHEN_CONFIGS[style];

  // Adjust for island
  let width = config.minWidth;
  let depth = config.minDepth;

  if (hasIsland && !config.hasIsland) {
    // Need extra space for island
    width += 4; // Island is typically 4' wide
    depth += 4; // Need 4' clearance around island
  }

  const area = width * depth;
  const description = hasIsland
    ? `${style} kitchen with island`
    : `${style} kitchen`;

  const result = createRectangularRoom(
    levelId,
    name,
    'kitchen',
    width,
    depth,
    position,
    currentState
  );

  if (result.success) {
    result.message = `Create ${description}: ${width}' x ${depth}' = ${area} sq ft`;
    result.data = {
      ...result.data as object,
      style,
      hasIsland,
      counterLength: style === 'L-shape' ? width + depth - 2 :
                     style === 'U-shape' ? width * 2 + depth - 4 :
                     style === 'galley' ? depth * 2 : width,
    };
  }

  return result;
}

/**
 * Create a bathroom with appropriate fixtures.
 *
 * Encapsulates bathroom design knowledge:
 * - Full bath: 40+ sq ft, toilet + sink + tub/shower
 * - Half bath: 18+ sq ft, toilet + sink
 * - Master bath: 70+ sq ft, dual sinks + shower + tub
 * - Door swing clearance
 * - Fixture spacing per IRC
 */
export function createBathroom(
  levelId: string,
  name: string,
  bathroomType: BathroomType,
  position: PositionSpec,
  currentState?: ObservableState
): SkillResult {
  const config = BATHROOM_CONFIGS[bathroomType];

  const result = createRectangularRoom(
    levelId,
    name,
    'bathroom',
    config.minWidth,
    config.minDepth,
    position,
    currentState
  );

  if (result.success) {
    const area = config.minWidth * config.minDepth;
    result.message = `Create ${bathroomType} bathroom: ${config.minWidth}' x ${config.minDepth}' = ${area} sq ft`;
    result.data = {
      ...result.data as object,
      bathroomType,
      fixtures: config.fixtures,
    };
  }

  return result;
}

/**
 * Create an entry/foyer with connections to main areas.
 *
 * Encapsulates entry design knowledge:
 * - Front door faces NORTH (street)
 * - Minimum 4' wide for circulation
 * - Direct access to: stairs, kitchen, main living
 * - Coat closet space consideration
 */
export function createEntry(
  levelId: string,
  name: string,
  width: number,
  depth: number,
  position: PositionSpec,
  currentState?: ObservableState
): SkillResult {
  // Validate minimum entry dimensions
  if (width < 4) {
    return {
      success: false,
      toolCalls: [],
      message: 'Entry too narrow',
      error: `Entry width ${width}' is below recommended minimum of 4'`,
    };
  }

  if (depth < 4) {
    return {
      success: false,
      toolCalls: [],
      message: 'Entry too shallow',
      error: `Entry depth ${depth}' is below recommended minimum of 4'`,
    };
  }

  const result = createRectangularRoom(
    levelId,
    name,
    'circulation',
    width,
    depth,
    position,
    currentState
  );

  if (result.success) {
    result.message = `Create entry/foyer: ${width}' x ${depth}' = ${width * depth} sq ft`;
  }

  return result;
}

/**
 * Create a closet with appropriate dimensions based on type.
 *
 * Encapsulates closet design knowledge:
 * - Walk-in: 6x6 min (36 sq ft) for master, 5x5 for standard
 * - Reach-in: 2x4 min (8 sq ft) - standard bedroom closet
 * - Linen: 2x3 min (6 sq ft) - bathroom/hallway storage
 * - Coat: 2x4 min (8 sq ft) - entry closet
 *
 * Calculates rod length based on closet type:
 * - Walk-in: perimeter minus door width (assumes 3' door)
 * - Reach-in/Coat: width of closet
 * - Linen: no rod (shelving only)
 */
export function createCloset(
  levelId: string,
  name: string,
  closetType: ClosetType,
  position: PositionSpec,
  currentState?: ObservableState
): SkillResult {
  const config = CLOSET_CONFIGS[closetType];

  // Validate closet type
  if (!config) {
    return {
      success: false,
      toolCalls: [],
      message: `Unknown closet type: ${closetType}`,
      error: `Valid closet types are: walk-in, reach-in, linen, coat`,
    };
  }

  const width = config.minWidth;
  const depth = config.minDepth;
  const area = width * depth;

  // Validate minimum area requirements
  if (closetType === 'walk-in' && area < 36) {
    return {
      success: false,
      toolCalls: [],
      message: 'Walk-in closet too small',
      error: `Walk-in closet requires minimum 36 sq ft. Got ${area} sq ft`,
    };
  }

  const result = createRectangularRoom(
    levelId,
    name,
    'closet',
    width,
    depth,
    position,
    currentState
  );

  if (result.success) {
    // Calculate rod length based on closet type
    let rodLength: number;
    const doorWidth = 3; // Assume standard 3' door

    if (closetType === 'walk-in') {
      // Walk-in: rods on multiple walls, perimeter minus door
      const perimeter = 2 * (width + depth);
      rodLength = perimeter - doorWidth;
    } else if (closetType === 'linen') {
      // Linen closets have shelving, not rods
      rodLength = 0;
    } else {
      // Reach-in and coat: single rod along width
      rodLength = width;
    }

    result.message = `Create ${closetType} closet: ${width}' x ${depth}' = ${area} sq ft`;
    result.data = {
      ...result.data as object,
      closetType,
      description: config.description,
      rodLength,
      hasRod: rodLength > 0,
      shelvingType: closetType === 'linen' ? 'full-depth shelving' : 'standard shelf above rod',
    };
  }

  return result;
}

/**
 * Garage configuration based on car count
 */
const GARAGE_CONFIGS: Record<number, { width: number; depth: number; doorWidth: number }> = {
  1: { width: 12, depth: 20, doorWidth: 9 },    // Single car - minimum code
  2: { width: 20, depth: 20, doorWidth: 16 },   // Double car - standard
  3: { width: 30, depth: 20, doorWidth: 24 },   // Triple car - tandem option
  4: { width: 40, depth: 22, doorWidth: 32 },   // Four car - oversize
};

/**
 * Create a garage with appropriate sizing based on car count.
 *
 * Encapsulates garage design knowledge:
 * - 1 car: 12x20 (240 sq ft) - minimum code compliant
 * - 2 car: 20x20 (400 sq ft) - standard residential
 * - 3 car: 30x20 (600 sq ft) - tandem or side-by-side
 * - 4 car: 40x22 (880 sq ft) - oversize/collector
 * - Workshop adds 6' depth for workbench/storage
 * - Door width calculated per car count
 */
export function createGarage(
  levelId: string,
  name: string,
  carCount: number,
  hasWorkshop: boolean,
  position: PositionSpec,
  currentState?: ObservableState
): SkillResult {
  // Validate car count
  if (carCount < 1 || carCount > 4) {
    return {
      success: false,
      toolCalls: [],
      message: 'Invalid car count',
      error: `Car count must be between 1 and 4. Got ${carCount}`,
    };
  }

  const config = GARAGE_CONFIGS[carCount];

  // Adjust for workshop
  let width = config.width;
  let depth = config.depth;

  if (hasWorkshop) {
    depth += 6; // Add 6' for workshop/workbench area
  }

  const area = width * depth;
  const description = hasWorkshop
    ? `${carCount}-car garage with workshop`
    : `${carCount}-car garage`;

  const result = createRectangularRoom(
    levelId,
    name,
    'garage',
    width,
    depth,
    position,
    currentState
  );

  if (result.success) {
    result.message = `Create ${description}: ${width}' x ${depth}' = ${area} sq ft`;
    result.data = {
      ...result.data as object,
      carCount,
      hasWorkshop,
      doorWidth: config.doorWidth,
      workshopDepth: hasWorkshop ? 6 : 0,
      baseWidth: config.width,
      baseDepth: config.depth,
    };
  }

  return result;
}

/**
 * Outdoor space types with configurations
 */
export type OutdoorSpaceType = 'patio' | 'deck' | 'porch' | 'balcony';

const OUTDOOR_CONFIGS: Record<OutdoorSpaceType, {
  minWidth: number;
  minDepth: number;
  defaultCovered: boolean;
  roomType: RoomType;
  material: string;
}> = {
  'patio': { minWidth: 10, minDepth: 10, defaultCovered: false, roomType: 'patio', material: 'concrete/pavers' },
  'deck': { minWidth: 12, minDepth: 12, defaultCovered: false, roomType: 'deck', material: 'composite/wood' },
  'porch': { minWidth: 6, minDepth: 10, defaultCovered: true, roomType: 'patio', material: 'concrete' },
  'balcony': { minWidth: 4, minDepth: 8, defaultCovered: false, roomType: 'deck', material: 'composite' },
};

/**
 * Create an outdoor space (patio, deck, porch, or balcony).
 *
 * Encapsulates outdoor space design knowledge:
 * - Patio: 10x10 min (100 sq ft) - ground level concrete/pavers
 * - Deck: 12x12 min (144 sq ft) - elevated wood/composite
 * - Porch: 6x10 min (60 sq ft) - covered entry area
 * - Balcony: 4x8 min (32 sq ft) - upper level outdoor space
 *
 * @param levelId - The level to place the outdoor space on
 * @param name - Space name (e.g., "Back Patio", "Front Porch")
 * @param spaceType - Type of outdoor space
 * @param width - Width in feet (validated against minimums)
 * @param depth - Depth in feet (validated against minimums)
 * @param isCovered - Whether the space has a roof/cover
 * @param position - Where to place the space
 * @param currentState - Current observable state (for relative positioning)
 */
export function createOutdoorSpace(
  levelId: string,
  name: string,
  spaceType: OutdoorSpaceType,
  width: number,
  depth: number,
  isCovered: boolean,
  position: PositionSpec,
  currentState?: ObservableState
): SkillResult {
  const config = OUTDOOR_CONFIGS[spaceType];

  // Validate minimum dimensions
  if (width < config.minWidth) {
    return {
      success: false,
      toolCalls: [],
      message: `${spaceType} too narrow`,
      error: `${spaceType} width ${width}' is below minimum of ${config.minWidth}'`,
    };
  }

  if (depth < config.minDepth) {
    return {
      success: false,
      toolCalls: [],
      message: `${spaceType} too shallow`,
      error: `${spaceType} depth ${depth}' is below minimum of ${config.minDepth}'`,
    };
  }

  const result = createRectangularRoom(
    levelId,
    name,
    config.roomType,
    width,
    depth,
    position,
    currentState
  );

  if (result.success) {
    const area = width * depth;
    const coveredDesc = isCovered ? 'covered ' : '';
    result.message = `Create ${coveredDesc}${spaceType}: ${width}' x ${depth}' = ${area} sq ft`;
    result.data = {
      ...result.data as object,
      spaceType,
      isCovered,
      material: config.material,
    };
  }

  return result;
}

// ============================================================================
// Structural Skills (Phase C)
// ============================================================================

/**
 * Validate structural spans and suggest load-bearing wall placements.
 *
 * For residential construction:
 * - Wood frame: 20-25' max span without intermediate support
 * - Steel beam: 30-40' spans possible
 * - Load-bearing walls must run perpendicular to floor joists
 */
export function validateStructuralSpans(
  currentState: ObservableState,
  maxSpan: number = 25
): { valid: boolean; violations: string[]; suggestions: string[] } {
  const violations: string[] = [];
  const suggestions: string[] = [];

  // Check each room's dimensions
  for (const room of currentState.floorplan.rooms) {
    if (room.dimensions.width > maxSpan) {
      violations.push(
        `${room.name} width (${room.dimensions.width.toFixed(1)}') exceeds ${maxSpan}' max span`
      );
      suggestions.push(
        `Add E-W load-bearing wall in ${room.name} at ${(room.bounds.minX + maxSpan / 2).toFixed(1)}'`
      );
    }
    if (room.dimensions.depth > maxSpan) {
      violations.push(
        `${room.name} depth (${room.dimensions.depth.toFixed(1)}') exceeds ${maxSpan}' max span`
      );
      suggestions.push(
        `Add N-S load-bearing wall in ${room.name} at ${(room.bounds.minY + maxSpan / 2).toFixed(1)}'`
      );
    }
  }

  // Check overall building dimensions
  if (currentState.layout.boundingBox.width > maxSpan) {
    violations.push(
      `Building width (${currentState.layout.boundingBox.width.toFixed(1)}') exceeds ${maxSpan}' max span`
    );
    suggestions.push(
      `Add N-S structural wall to divide building into ${maxSpan}' or smaller bays`
    );
  }

  return {
    valid: violations.length === 0,
    violations,
    suggestions,
  };
}

/**
 * Create a load-bearing wall placement suggestion.
 *
 * Load-bearing walls:
 * - Support roof/floor loads above
 * - Run perpendicular to floor joists
 * - Typically at perimeter + every 20-25'
 */
export function suggestLoadBearingWall(
  currentState: ObservableState,
  direction: 'NS' | 'EW',
  position: number,
  maxSpan: number = 25
): SkillResult {
  // Calculate wall start and end based on building bounds
  const bounds = currentState.layout.boundingBox;
  const rooms = currentState.floorplan.rooms;

  if (rooms.length === 0) {
    return {
      success: false,
      toolCalls: [],
      message: 'No rooms to span',
      error: 'Create rooms first, then add structural walls',
    };
  }

  // Find overall room bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const room of rooms) {
    minX = Math.min(minX, room.bounds.minX);
    minY = Math.min(minY, room.bounds.minY);
    maxX = Math.max(maxX, room.bounds.maxX);
    maxY = Math.max(maxY, room.bounds.maxY);
  }

  let start: Point2D, end: Point2D;

  if (direction === 'NS') {
    // North-South wall (runs vertically)
    start = [position, minY];
    end = [position, maxY];
  } else {
    // East-West wall (runs horizontally)
    start = [minX, position];
    end = [maxX, position];
  }

  const length = direction === 'NS' ? maxY - minY : maxX - minX;

  return {
    success: true,
    toolCalls: [], // Advisory - actual wall creation needs assembly ID
    message: `Suggested load-bearing wall: ${direction} at ${position}', ${length.toFixed(1)}' long`,
    data: {
      direction,
      position,
      start,
      end,
      length,
      purpose: 'Structural support for spans exceeding ' + maxSpan + "'",
    },
  };
}

// ============================================================================
// Compound Skills (Phase C)
// ============================================================================

/**
 * Create a complete house shell with project, building, level, and footprint.
 *
 * This compound skill handles the boilerplate setup:
 * 1. Creates project with specified units and code
 * 2. Creates building
 * 3. Creates level(s)
 * 4. Sets footprint (auto-adds wall thickness)
 *
 * After this, Gemini can focus on room layout.
 *
 * @param interiorWidth - Interior width in feet (wall thickness added automatically)
 * @param interiorDepth - Interior depth in feet (wall thickness added automatically)
 * @param wallType - Wall assembly type (defaults to 2x6 stucco)
 */
export function createHouseShell(
  projectName: string,
  buildingName: string,
  units: 'imperial' | 'metric',
  codeRegion: string,
  interiorWidth: number,
  interiorDepth: number,
  stories: number = 1,
  floorToFloor: number = 9,
  wallType: WallAssemblyType = DEFAULT_EXTERIOR_WALL
): SkillResult {
  const toolCalls: ToolCall[] = [];

  // Calculate exterior footprint from interior dimensions + wall thickness
  const exterior = interiorToExterior(interiorWidth, interiorDepth, wallType);
  const wallThickness = getWallThickness(wallType);
  const wallAssembly = WALL_ASSEMBLIES[wallType];

  // 1. Create project
  toolCalls.push({
    name: 'create_project',
    args: {
      name: projectName,
      units,
      code_region: codeRegion,
    },
  });

  // 2. Add building (will use project ID from step 1)
  toolCalls.push({
    name: 'add_building',
    args: {
      project_id: '${project_id}', // Placeholder - executor must resolve
      name: buildingName,
    },
  });

  // 3. Add level(s)
  for (let i = 0; i < stories; i++) {
    const levelName = stories === 1 ? 'Ground Floor' :
                      i === 0 ? 'Ground Floor' :
                      i === 1 ? 'Second Floor' :
                      `Level ${i + 1}`;
    const elevation = i * floorToFloor;

    toolCalls.push({
      name: 'add_level',
      args: {
        building_id: '${building_id}', // Placeholder
        name: levelName,
        elevation,
        floor_to_floor: floorToFloor,
      },
    });
  }

  // 4. Set footprint for ground floor (using exterior dimensions)
  toolCalls.push({
    name: 'set_level_footprint_rect',
    args: {
      level_id: '${level_id}', // Placeholder
      width: exterior.width,
      depth: exterior.depth,
    },
  });

  const interiorArea = interiorWidth * interiorDepth * stories;
  const exteriorArea = exterior.width * exterior.depth * stories;

  return {
    success: true,
    toolCalls,
    message: `Create ${stories}-story house shell: ${interiorWidth}'×${interiorDepth}' interior (${exterior.width.toFixed(1)}'×${exterior.depth.toFixed(1)}' exterior with ${wallAssembly.name}) = ${interiorArea} sq ft interior`,
    data: {
      interior: { width: interiorWidth, depth: interiorDepth },
      exterior: { width: exterior.width, depth: exterior.depth },
      wallType,
      wallThickness,
      wallAssemblyName: wallAssembly.name,
      stories,
      interiorArea,
      exteriorArea,
      floorToFloor,
    },
  };
}

// ============================================================================
// Skill Declarations for Gemini
// ============================================================================

/**
 * Skill function declarations for the Gemini function calling API.
 * These provide higher-level operations than the base CAD tools.
 */
import { Type, type FunctionDeclaration } from '@google/genai';

export const SKILL_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  // ==========================================================================
  // Phase B: Basic Skills
  // ==========================================================================
  {
    name: 'skill_create_rectangular_room',
    description: `Create a rectangular room at a specified position.

Takes intuitive width/depth and position (absolute, relative to another room, or auto-placed).
Automatically calculates polygon points.

Use this instead of create_room when you want a simple rectangle.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID to place room on' },
        name: { type: Type.STRING, description: 'Room name (e.g., "Master Bedroom")' },
        room_type: {
          type: Type.STRING,
          description: 'Room type: living, kitchen, bedroom, bathroom, garage, utility, hallway, other',
        },
        width: { type: Type.NUMBER, description: 'Room width in feet (E-W direction)' },
        depth: { type: Type.NUMBER, description: 'Room depth in feet (N-S direction)' },
        position_type: {
          type: Type.STRING,
          description: '"absolute", "relative", or "auto"',
        },
        position_x: {
          type: Type.NUMBER,
          description: 'X coordinate (for absolute positioning)',
        },
        position_y: {
          type: Type.NUMBER,
          description: 'Y coordinate (for absolute positioning)',
        },
        relative_to: {
          type: Type.STRING,
          description: 'Room name to position relative to (for relative positioning)',
        },
        direction: {
          type: Type.STRING,
          description: 'NORTH, SOUTH, EAST, or WEST of relative room',
        },
        gap: {
          type: Type.NUMBER,
          description: 'Gap between rooms in feet (for relative positioning, default 0)',
        },
      },
      required: ['level_id', 'name', 'room_type', 'width', 'depth', 'position_type'],
    },
  },
  {
    name: 'skill_create_hallway',
    description: `Create a hallway connecting two existing rooms.

Automatically calculates the path between rooms and creates appropriate hallway geometry.
Minimum width is 3 feet for code compliance.

Use this to create circulation paths between rooms.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        from_room: { type: Type.STRING, description: 'Name of starting room' },
        to_room: { type: Type.STRING, description: 'Name of ending room' },
        width: { type: Type.NUMBER, description: 'Hallway width in feet (min 3, typical 3.5-4)' },
      },
      required: ['level_id', 'from_room', 'to_room', 'width'],
    },
  },
  {
    name: 'skill_plan_layout',
    description: `Plan floor layout based on room list and adjacency requirements.

This is an ADVISORY skill - it returns planned positions but doesn't create rooms.
Use the returned positions with skill_create_rectangular_room to actually place rooms.

Useful for planning before building.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        rooms: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: 'Room name' },
              type: { type: Type.STRING, description: 'Room type' },
              width: { type: Type.NUMBER, description: 'Width in feet' },
              depth: { type: Type.NUMBER, description: 'Depth in feet' },
            },
            required: ['name', 'type', 'width', 'depth'],
          },
          description: 'List of rooms to place',
        },
        adjacencies: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              room1: { type: Type.STRING, description: 'First room name' },
              room2: { type: Type.STRING, description: 'Second room name' },
              preferred: {
                type: Type.STRING,
                description: 'Preferred direction: NORTH, SOUTH, EAST, WEST, or any',
              },
              required: { type: Type.BOOLEAN, description: 'Is this adjacency required?' },
            },
            required: ['room1', 'room2', 'preferred', 'required'],
          },
          description: 'Adjacency requirements between rooms',
        },
        max_width: { type: Type.NUMBER, description: 'Maximum total width (optional)' },
        max_depth: { type: Type.NUMBER, description: 'Maximum total depth (optional)' },
      },
      required: ['rooms', 'adjacencies'],
    },
  },

  // ==========================================================================
  // Phase C: Specialized Room Skills
  // ==========================================================================
  {
    name: 'skill_create_bedroom',
    description: `Create a bedroom with appropriate dimensions based on type, with optional auto-closet.

Encapsulates bedroom design knowledge:
- Master bedroom: 150-300 sq ft (default 180) + walk-in closet (36 sq ft)
- Secondary bedroom: 100-150 sq ft (default 120) + reach-in closet (8 sq ft)
- Minimum 70 sq ft for IRC code compliance
- Automatically calculates optimal width/depth ratio

Set include_closet=true to auto-create an appropriate closet adjacent to the bedroom:
- Master bedrooms get a walk-in closet (6'×6')
- Secondary bedrooms get a reach-in closet (2'×4')

Use this instead of skill_create_rectangular_room for bedrooms.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        name: { type: Type.STRING, description: 'Bedroom name (e.g., "Master Bedroom", "Bedroom 2")' },
        is_master: { type: Type.BOOLEAN, description: 'Is this a master bedroom? Affects default size and closet type.' },
        min_area: { type: Type.NUMBER, description: 'Minimum area in sq ft (optional, has defaults)' },
        include_closet: { type: Type.BOOLEAN, description: 'Auto-create closet adjacent to bedroom? Master gets walk-in, secondary gets reach-in. Default: false' },
        position_type: { type: Type.STRING, description: '"absolute", "relative", or "auto"' },
        position_x: { type: Type.NUMBER, description: 'X coordinate (for absolute)' },
        position_y: { type: Type.NUMBER, description: 'Y coordinate (for absolute)' },
        relative_to: { type: Type.STRING, description: 'Room name (for relative)' },
        direction: { type: Type.STRING, description: 'NORTH/SOUTH/EAST/WEST (for relative)' },
      },
      required: ['level_id', 'name', 'is_master', 'position_type'],
    },
  },
  {
    name: 'skill_create_kitchen',
    description: `Create a kitchen with style-appropriate layout.

Kitchen styles and their characteristics:
- L-shape: 12x10 min, corner counters, good for islands
- Galley: 8x12 min, parallel counters, efficient for small spaces
- U-shape: 14x10 min, three walls of counters, maximum storage
- Single-wall: 12x8 min, all appliances on one wall

Encapsulates work triangle principle: sink ↔ stove ↔ fridge < 26' total.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        name: { type: Type.STRING, description: 'Kitchen name' },
        style: { type: Type.STRING, description: 'L-shape, galley, U-shape, or single-wall' },
        has_island: { type: Type.BOOLEAN, description: 'Include kitchen island?' },
        position_type: { type: Type.STRING, description: '"absolute", "relative", or "auto"' },
        position_x: { type: Type.NUMBER, description: 'X coordinate (for absolute)' },
        position_y: { type: Type.NUMBER, description: 'Y coordinate (for absolute)' },
        relative_to: { type: Type.STRING, description: 'Room name (for relative)' },
        direction: { type: Type.STRING, description: 'NORTH/SOUTH/EAST/WEST (for relative)' },
      },
      required: ['level_id', 'name', 'style', 'has_island', 'position_type'],
    },
  },
  {
    name: 'skill_create_bathroom',
    description: `Create a bathroom with appropriate fixtures based on type.

Bathroom types:
- full: 5x8 (40 sq ft), toilet + sink + tub/shower
- half: 3x6 (18 sq ft), toilet + sink only (powder room)
- master: 8x10 (80 sq ft), dual sinks + shower + tub
- three-quarter: 5x7 (35 sq ft), toilet + sink + shower (no tub)

Handles fixture spacing per IRC code.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        name: { type: Type.STRING, description: 'Bathroom name' },
        bathroom_type: { type: Type.STRING, description: 'full, half, master, or three-quarter' },
        position_type: { type: Type.STRING, description: '"absolute", "relative", or "auto"' },
        position_x: { type: Type.NUMBER, description: 'X coordinate (for absolute)' },
        position_y: { type: Type.NUMBER, description: 'Y coordinate (for absolute)' },
        relative_to: { type: Type.STRING, description: 'Room name (for relative)' },
        direction: { type: Type.STRING, description: 'NORTH/SOUTH/EAST/WEST (for relative)' },
      },
      required: ['level_id', 'name', 'bathroom_type', 'position_type'],
    },
  },
  {
    name: 'skill_create_entry',
    description: `Create an entry/foyer for the home.

Entry design principles:
- Front door faces NORTH (toward street)
- Minimum 4' x 4' for circulation
- Should provide access to: stairs, kitchen, main living
- Consider coat closet space`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        name: { type: Type.STRING, description: 'Entry name (e.g., "Foyer", "Entry")' },
        width: { type: Type.NUMBER, description: 'Width in feet (min 4)' },
        depth: { type: Type.NUMBER, description: 'Depth in feet (min 4)' },
        position_type: { type: Type.STRING, description: '"absolute", "relative", or "auto"' },
        position_x: { type: Type.NUMBER, description: 'X coordinate (for absolute)' },
        position_y: { type: Type.NUMBER, description: 'Y coordinate (for absolute)' },
        relative_to: { type: Type.STRING, description: 'Room name (for relative)' },
        direction: { type: Type.STRING, description: 'NORTH/SOUTH/EAST/WEST (for relative)' },
      },
      required: ['level_id', 'name', 'width', 'depth', 'position_type'],
    },
  },
  {
    name: 'skill_create_closet',
    description: `Create a closet with appropriate dimensions based on type.

Closet types and sizing:
- walk-in: 6x6 (36 sq ft) - hanging rods on multiple walls, master bedroom closet
- reach-in: 2x4 (8 sq ft) - standard bedroom closet with single rod
- linen: 2x3 (6 sq ft) - bathroom/hallway storage for towels and sheets
- coat: 2x4 (8 sq ft) - entry/foyer coat closet

Returns enriched data including:
- Rod length calculation (perimeter minus door for walk-in, width for reach-in/coat)
- Shelving type (full-depth for linen, standard shelf above rod for others)

Use this instead of skill_create_rectangular_room for closets.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        name: { type: Type.STRING, description: 'Closet name (e.g., "Master Closet", "Hall Linen Closet")' },
        closet_type: { type: Type.STRING, description: 'walk-in, reach-in, linen, or coat' },
        position_type: { type: Type.STRING, description: '"absolute", "relative", or "auto"' },
        position_x: { type: Type.NUMBER, description: 'X coordinate (for absolute)' },
        position_y: { type: Type.NUMBER, description: 'Y coordinate (for absolute)' },
        relative_to: { type: Type.STRING, description: 'Room name (for relative)' },
        direction: { type: Type.STRING, description: 'NORTH/SOUTH/EAST/WEST (for relative)' },
      },
      required: ['level_id', 'name', 'closet_type', 'position_type'],
    },
  },
  {
    name: 'skill_create_garage',
    description: `Create a garage with appropriate sizing based on car count.

Garage sizing by car count:
- 1 car: 12x20 (240 sq ft) - minimum code compliant, 9' door
- 2 car: 20x20 (400 sq ft) - standard residential, 16' door
- 3 car: 30x20 (600 sq ft) - tandem or side-by-side, 24' door
- 4 car: 40x22 (880 sq ft) - oversize/collector, 32' door

Workshop option adds 6' depth for workbench/storage area.

Returns enriched data including door width calculation and workshop dimensions.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        name: { type: Type.STRING, description: 'Garage name (e.g., "Garage", "2-Car Garage")' },
        car_count: { type: Type.NUMBER, description: 'Number of cars (1-4)' },
        has_workshop: { type: Type.BOOLEAN, description: 'Include workshop area? Adds 6\' depth.' },
        position_type: { type: Type.STRING, description: '"absolute", "relative", or "auto"' },
        position_x: { type: Type.NUMBER, description: 'X coordinate (for absolute)' },
        position_y: { type: Type.NUMBER, description: 'Y coordinate (for absolute)' },
        relative_to: { type: Type.STRING, description: 'Room name (for relative)' },
        direction: { type: Type.STRING, description: 'NORTH/SOUTH/EAST/WEST (for relative)' },
      },
      required: ['level_id', 'name', 'car_count', 'position_type'],
    },
  },
  {
    name: 'skill_create_outdoor_space',
    description: `Create an outdoor space (patio, deck, porch, or balcony).

Outdoor space types and their characteristics:
- patio: 10x10 min (100 sq ft) - ground level concrete/pavers
- deck: 12x12 min (144 sq ft) - elevated wood/composite decking
- porch: 6x10 min (60 sq ft) - covered entry area, concrete
- balcony: 4x8 min (32 sq ft) - upper level outdoor space

Default covered settings:
- porch: covered by default (entry protection)
- patio, deck, balcony: uncovered by default

Returns enriched data with space type, covered flag, and material suggestions.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        name: { type: Type.STRING, description: 'Space name (e.g., "Back Patio", "Front Porch")' },
        space_type: { type: Type.STRING, description: 'Type: "patio", "deck", "porch", or "balcony"' },
        width: { type: Type.NUMBER, description: 'Width in feet (validated against type minimums)' },
        depth: { type: Type.NUMBER, description: 'Depth in feet (validated against type minimums)' },
        is_covered: { type: Type.BOOLEAN, description: 'Has roof/cover? Defaults based on space_type (porch=true, others=false)' },
        position_type: { type: Type.STRING, description: '"absolute", "relative", or "auto"' },
        position_x: { type: Type.NUMBER, description: 'X coordinate (for absolute)' },
        position_y: { type: Type.NUMBER, description: 'Y coordinate (for absolute)' },
        relative_to: { type: Type.STRING, description: 'Room name (for relative)' },
        direction: { type: Type.STRING, description: 'NORTH/SOUTH/EAST/WEST (for relative)' },
      },
      required: ['level_id', 'name', 'space_type', 'width', 'depth', 'position_type'],
    },
  },

  // ==========================================================================
  // Phase C: Structural Skills
  // ==========================================================================
  {
    name: 'skill_validate_spans',
    description: `Validate structural spans and get suggestions for load-bearing walls.

For wood-frame residential construction:
- Maximum span without intermediate support: 20-25'
- Returns violations if any room or building dimension exceeds max span
- Suggests load-bearing wall placements to resolve violations

Use this after laying out rooms to check structural feasibility.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        max_span: { type: Type.NUMBER, description: 'Maximum span in feet (default 25 for wood frame)' },
      },
      required: [],
    },
  },
  {
    name: 'skill_suggest_structural_wall',
    description: `Get a suggestion for load-bearing wall placement.

Returns advisory information about where to place a structural wall.
Does not create the wall - use create_wall after creating a wall assembly.

Direction:
- NS = North-South wall (runs vertically, divides E-W spans)
- EW = East-West wall (runs horizontally, divides N-S spans)`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        direction: { type: Type.STRING, description: 'NS or EW' },
        position: { type: Type.NUMBER, description: 'Position along perpendicular axis' },
        max_span: { type: Type.NUMBER, description: 'Maximum span being addressed (default 25)' },
      },
      required: ['direction', 'position'],
    },
  },

  // ==========================================================================
  // Phase C: Compound Skills
  // ==========================================================================
  {
    name: 'skill_create_house_shell',
    description: `Create complete house shell: project, building, level(s), and footprint.

This handles all the boilerplate setup in one skill:
1. Creates project with units and building code
2. Creates building
3. Creates level(s) with floor-to-floor heights
4. Sets rectangular footprint (auto-adds wall thickness)

IMPORTANT: Provide INTERIOR dimensions. Wall thickness (8" for 2x6 stucco) is added automatically.
Example: interior_width=20, interior_depth=20 → exterior footprint ~21.4' x 21.4'

After this, focus on room layout using other skills.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        project_name: { type: Type.STRING, description: 'Project name (e.g., "Smith Residence")' },
        building_name: { type: Type.STRING, description: 'Building name (e.g., "Main House")' },
        units: { type: Type.STRING, description: 'imperial or metric' },
        code_region: { type: Type.STRING, description: 'Building code (e.g., US_IRC_2021)' },
        interior_width: { type: Type.NUMBER, description: 'INTERIOR width (E-W) in feet. Wall thickness added automatically.' },
        interior_depth: { type: Type.NUMBER, description: 'INTERIOR depth (N-S) in feet. Wall thickness added automatically.' },
        stories: { type: Type.NUMBER, description: 'Number of stories (default 1)' },
        floor_to_floor: { type: Type.NUMBER, description: 'Floor-to-floor height (default 9 for residential)' },
        wall_type: { type: Type.STRING, description: 'Wall assembly: "2x6_stucco" (default), "2x6_siding", "2x4_stucco", "2x4_siding"' },
      },
      required: ['project_name', 'building_name', 'units', 'code_region', 'interior_width', 'interior_depth'],
    },
  },

  // ==========================================================================
  // Spatial Layout Skills
  // ==========================================================================
  {
    name: 'skill_apply_home_template',
    description: `Apply a production home template for coherent spatial layout.

Templates based on affordable production homes ($200K-$450K):
- starter: 1,000-1,500 sqft (2-3 bed, 1-2 bath) - open concept, compact
- family: 1,800-2,500 sqft (3-4 bed, 2-2.5 bath) - formal entry, family room
- executive: 2,500-4,500 sqft (4-5 bed, 3+ bath) - primary suite, wings

Returns a layout plan with:
- Room positions respecting zone organization (Public/Private/Service)
- Adjacency requirements (Kitchen→Living, Primary→Bath)
- Cardinal directions for each zone (Entry=NORTH, Private=SOUTH)

FOR MULTI-ROOM HOUSES:
1. FIRST call skill_apply_home_template to get layout plan
2. THEN create rooms using the planned positions
3. System auto-validates adjacencies after each room

This ensures rooms form a coherent house instead of scattered rectangles.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        template: {
          type: Type.STRING,
          description: 'Template tier: "starter", "family", or "executive"',
        },
        footprint_width: {
          type: Type.NUMBER,
          description: 'Total building width (E-W) in feet',
        },
        footprint_depth: {
          type: Type.NUMBER,
          description: 'Total building depth (N-S) in feet',
        },
        rooms: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: 'Room name' },
              type: { type: Type.STRING, description: 'Room type: living, kitchen, bedroom, bathroom, etc.' },
              width: { type: Type.NUMBER, description: 'Room width in feet' },
              depth: { type: Type.NUMBER, description: 'Room depth in feet' },
            },
            required: ['name', 'type', 'width', 'depth'],
          },
          description: 'List of rooms to position',
        },
      },
      required: ['template', 'footprint_width', 'footprint_depth', 'rooms'],
    },
  },
];

// ============================================================================
// Skill Executor
// ============================================================================

/**
 * Execute a skill call and return the result.
 *
 * Skills may generate multiple tool calls that need to be executed
 * in sequence by the CAD tool executor.
 */
export function executeSkill(
  skillName: string,
  args: Record<string, unknown>,
  currentState?: ObservableState
): SkillResult {
  switch (skillName) {
    case 'skill_create_rectangular_room': {
      // Parse position
      let position: PositionSpec;
      const posType = args.position_type as string;

      if (posType === 'absolute') {
        position = {
          type: 'absolute',
          x: args.position_x as number,
          y: args.position_y as number,
        };
      } else if (posType === 'relative') {
        position = {
          type: 'relative',
          direction: args.direction as CardinalDirection,
          relativeTo: args.relative_to as string,
          gap: args.gap as number | undefined,
        };
      } else {
        position = { type: 'auto' };
      }

      return createRectangularRoom(
        args.level_id as string,
        args.name as string,
        args.room_type as RoomType,
        args.width as number,
        args.depth as number,
        position,
        currentState
      );
    }

    case 'skill_create_hallway': {
      if (!currentState) {
        return {
          success: false,
          toolCalls: [],
          message: 'Current state required for hallway creation',
          error: 'Cannot create hallway without knowing existing room positions',
        };
      }

      return createHallway(
        args.level_id as string,
        args.from_room as string,
        args.to_room as string,
        args.width as number,
        currentState
      );
    }

    case 'skill_plan_layout': {
      const rooms = args.rooms as Array<{
        name: string;
        type: RoomType;
        width: number;
        depth: number;
      }>;
      const adjacencies = args.adjacencies as AdjacencyRequirement[];
      const boundingBox =
        args.max_width && args.max_depth
          ? { width: args.max_width as number, depth: args.max_depth as number }
          : undefined;

      const plan = layoutFloor(rooms, adjacencies, boundingBox);

      return {
        success: plan.conflicts.length === 0,
        toolCalls: [], // Advisory only - doesn't generate tool calls
        message:
          plan.conflicts.length === 0
            ? `Layout planned: ${plan.rooms.length} rooms positioned`
            : `Layout has conflicts: ${plan.conflicts.join(', ')}`,
        data: plan,
        error: plan.conflicts.length > 0 ? plan.conflicts.join('; ') : undefined,
      };
    }

    // ========================================================================
    // Phase C: Specialized Room Skills
    // ========================================================================
    case 'skill_create_bedroom': {
      const position = parsePosition(args);
      return createBedroom(
        args.level_id as string,
        args.name as string,
        args.is_master as boolean,
        args.min_area as number | undefined,
        position,
        currentState,
        (args.include_closet as boolean) ?? false
      );
    }

    case 'skill_create_kitchen': {
      const position = parsePosition(args);
      return createKitchen(
        args.level_id as string,
        args.name as string,
        args.style as KitchenStyle,
        args.has_island as boolean,
        position,
        currentState
      );
    }

    case 'skill_create_bathroom': {
      const position = parsePosition(args);
      return createBathroom(
        args.level_id as string,
        args.name as string,
        args.bathroom_type as BathroomType,
        position,
        currentState
      );
    }

    case 'skill_create_entry': {
      const position = parsePosition(args);
      return createEntry(
        args.level_id as string,
        args.name as string,
        args.width as number,
        args.depth as number,
        position,
        currentState
      );
    }

    case 'skill_create_closet': {
      const position = parsePosition(args);
      return createCloset(
        args.level_id as string,
        args.name as string,
        args.closet_type as ClosetType,
        position,
        currentState
      );
    }

    case 'skill_create_garage': {
      const position = parsePosition(args);
      return createGarage(
        args.level_id as string,
        args.name as string,
        args.car_count as number,
        (args.has_workshop as boolean) ?? false,
        position,
        currentState
      );
    }

    case 'skill_create_outdoor_space': {
      const position = parsePosition(args);
      const spaceType = args.space_type as OutdoorSpaceType;
      // Default is_covered based on space_type (porch=true, others=false)
      const isCovered = args.is_covered !== undefined
        ? (args.is_covered as boolean)
        : OUTDOOR_CONFIGS[spaceType]?.defaultCovered ?? false;
      return createOutdoorSpace(
        args.level_id as string,
        args.name as string,
        spaceType,
        args.width as number,
        args.depth as number,
        isCovered,
        position,
        currentState
      );
    }

    // ========================================================================
    // Phase C: Structural Skills
    // ========================================================================
    case 'skill_validate_spans': {
      if (!currentState) {
        return {
          success: false,
          toolCalls: [],
          message: 'Current state required for span validation',
          error: 'Cannot validate spans without room data',
        };
      }

      const maxSpan = (args.max_span as number) || 25;
      const result = validateStructuralSpans(currentState, maxSpan);

      return {
        success: result.valid,
        toolCalls: [],
        message: result.valid
          ? `All spans within ${maxSpan}' limit`
          : `Span violations: ${result.violations.join('; ')}`,
        data: result,
        error: result.valid ? undefined : result.violations.join('; '),
      };
    }

    case 'skill_suggest_structural_wall': {
      if (!currentState) {
        return {
          success: false,
          toolCalls: [],
          message: 'Current state required for wall suggestion',
          error: 'Cannot suggest wall placement without room data',
        };
      }

      return suggestLoadBearingWall(
        currentState,
        args.direction as 'NS' | 'EW',
        args.position as number,
        (args.max_span as number) || 25
      );
    }

    // ========================================================================
    // Phase C: Compound Skills
    // ========================================================================
    case 'skill_create_house_shell': {
      return createHouseShell(
        args.project_name as string,
        args.building_name as string,
        args.units as 'imperial' | 'metric',
        args.code_region as string,
        args.interior_width as number,
        args.interior_depth as number,
        (args.stories as number) || 1,
        (args.floor_to_floor as number) || 9,
        (args.wall_type as WallAssemblyType) || DEFAULT_EXTERIOR_WALL
      );
    }

    // ========================================================================
    // Spatial Layout Skills
    // ========================================================================
    case 'skill_apply_home_template': {
      const templateName = args.template as HomeTemplate;
      const template = STANDARD_HOME_TEMPLATES[templateName];

      if (!template) {
        return {
          success: false,
          toolCalls: [],
          message: `Unknown template: ${templateName}`,
          error: `Template "${templateName}" not found. Available: starter, family, executive`,
        };
      }

      const footprintWidth = args.footprint_width as number;
      const footprintDepth = args.footprint_depth as number;
      const rooms = args.rooms as Array<{
        name: string;
        type: RoomType;
        width: number;
        depth: number;
      }>;

      // Build adjacencies from template + inferred type rules
      const adjacencies: AdjacencyRequirement[] = [...template.adjacencies];

      // Add inferred adjacencies based on room types
      for (const room of rooms) {
        const typeRules = TYPE_ADJACENCY_RULES[room.type];
        if (typeRules) {
          for (const nearType of typeRules.near) {
            const nearRoom = rooms.find(r => r.type === nearType && r.name !== room.name);
            if (nearRoom) {
              // Check if adjacency already exists
              const exists = adjacencies.some(
                adj => (adj.room1 === room.name && adj.room2 === nearRoom.name) ||
                       (adj.room1 === nearRoom.name && adj.room2 === room.name)
              );
              if (!exists) {
                adjacencies.push({
                  room1: room.name,
                  room2: nearRoom.name,
                  preferred: 'any',
                  required: false,
                });
              }
            }
          }
        }
      }

      // Use layoutFloor to plan positions
      const plan = layoutFloor(rooms, adjacencies, { width: footprintWidth, depth: footprintDepth });

      return {
        success: plan.conflicts.length === 0,
        toolCalls: [], // Advisory - returns plan, doesn't create rooms
        message: plan.conflicts.length === 0
          ? `Template "${templateName}" applied: ${plan.rooms.length} rooms positioned. Use these positions with skill_create_rectangular_room.`
          : `Layout conflicts: ${plan.conflicts.join('; ')}`,
        data: {
          template: templateName,
          templateDescription: template.description,
          zones: template.zones,
          plan: plan,
          usageInstructions: 'Create each room using skill_create_rectangular_room with position_type="absolute" and the position_x/position_y from plan.rooms',
        },
        error: plan.conflicts.length > 0 ? plan.conflicts.join('; ') : undefined,
      };
    }

    // ========================================================================
    // Phase D: Space Allocation Skills
    // ========================================================================
    case 'skill_allocate_excess_space': {
      const footprintArea = args.footprint_area as number;
      const rooms = args.rooms as Array<{
        name: string;
        type: RoomType;
        current_sqft: number;
      }>;

      if (!footprintArea || footprintArea <= 0) {
        return {
          success: false,
          toolCalls: [],
          message: 'Invalid footprint area',
          error: 'footprint_area must be a positive number',
        };
      }

      if (!rooms || rooms.length === 0) {
        return {
          success: false,
          toolCalls: [],
          message: 'No rooms provided',
          error: 'rooms array must contain at least one room',
        };
      }

      // Convert to space-budget format
      const roomsForBudget = rooms.map(r => ({
        name: r.name,
        type: r.type,
        currentSqft: r.current_sqft,
      }));

      const budget = calculateSpaceBudget(footprintArea, roomsForBudget);
      const explanation = generateAllocationExplanation(budget.allocationPlan);

      return {
        success: true,
        toolCalls: [], // Advisory - returns allocation plan
        message: explanation,
        data: {
          footprintArea: budget.footprintArea,
          minimumRequired: budget.minimumRequired,
          excessSpace: budget.excessSpace,
          excessPercentage: budget.excessPercentage,
          expansions: budget.allocationPlan.expansions.map(e => ({
            roomName: e.roomName,
            roomType: e.roomType,
            fromDimensions: `${e.fromSize.width}'x${e.fromSize.depth}'`,
            toDimensions: `${e.toSize.width}'x${e.toSize.depth}'`,
            fromSqft: e.fromSize.area,
            toSqft: e.toSize.area,
            addedSqft: e.addedSqft,
            reason: e.reason,
          })),
          totalAllocated: budget.allocationPlan.totalAllocated,
          leftoverSqft: budget.allocationPlan.leftoverSqft,
          suggestions: budget.allocationPlan.suggestions.map(s => ({
            type: s.type,
            description: s.description,
            sqftImpact: s.sqftImpact,
            costImpact: s.costImpact,
            suggestedDimensions: s.suggestedSize
              ? `${s.suggestedSize.width}'x${s.suggestedSize.depth}'`
              : undefined,
          })),
        },
      };
    }

    case 'skill_create_shaped_hallway': {
      if (!currentState) {
        return {
          success: false,
          toolCalls: [],
          message: 'Current state required for hallway creation',
          error: 'Cannot create hallway without knowing existing room positions',
        };
      }

      const shape = (args.shape as HallwayShape) || 'straight';
      const width = (args.width as number) || DEFAULT_HALLWAY_WIDTH;
      const fromPoint = args.from_point as Point2D;
      const toPoint = args.to_point as Point2D;
      const turnDirection = args.turn_direction as 'left' | 'right' | undefined;
      const branchDirection = args.branch_direction as CardinalDirection | undefined;
      const branchLength = args.branch_length as number | undefined;

      if (!fromPoint || !toPoint) {
        return {
          success: false,
          toolCalls: [],
          message: 'Missing hallway endpoints',
          error: 'from_point and to_point are required',
        };
      }

      const config: HallwayConfig = {
        shape,
        width,
        fromPoint,
        toPoint,
        turnDirection,
        branchDirection,
        branchLength,
      };

      const result = createHallwayPolygon(config);

      if (result.polygon.length === 0) {
        return {
          success: false,
          toolCalls: [],
          message: 'Failed to create hallway',
          error: result.description,
        };
      }

      const hallwayName = args.name as string || `${shape} Hallway`;

      const toolCall: ToolCall = {
        name: 'create_room',
        args: {
          level_id: args.level_id as string,
          room_type: 'hallway',
          name: hallwayName,
          points: result.polygon,
        },
      };

      return {
        success: true,
        toolCalls: [toolCall],
        message: result.description,
        data: {
          polygon: result.polygon,
          area: result.area,
          length: result.length,
          shape,
          width,
        },
      };
    }

    default:
      return {
        success: false,
        toolCalls: [],
        message: `Unknown skill: ${skillName}`,
        error: `Skill "${skillName}" not found. Available skills: skill_create_rectangular_room, skill_create_hallway, skill_create_shaped_hallway, skill_allocate_excess_space, skill_plan_layout, skill_create_bedroom, skill_create_kitchen, skill_create_bathroom, skill_create_entry, skill_create_closet, skill_create_garage, skill_create_outdoor_space, skill_validate_spans, skill_suggest_structural_wall, skill_create_house_shell, skill_apply_home_template`,
      };
  }
}

// Helper function to parse position arguments
function parsePosition(args: Record<string, unknown>): PositionSpec {
  const posType = args.position_type as string;

  if (posType === 'absolute') {
    return {
      type: 'absolute',
      x: args.position_x as number,
      y: args.position_y as number,
    };
  } else if (posType === 'relative') {
    return {
      type: 'relative',
      direction: args.direction as CardinalDirection,
      relativeTo: args.relative_to as string,
      gap: args.gap as number | undefined,
    };
  }
  return { type: 'auto' };
}
