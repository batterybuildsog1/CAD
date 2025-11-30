/**
 * Observable State for Gemini CAD
 *
 * Core principle: Gemini must SEE what it creates, VERIFY accuracy, and ITERATE.
 *
 * This module provides:
 * 1. ObservableState - full state returned after every operation
 * 2. Direction helpers - NORTH/SOUTH/EAST/WEST instead of confusing X/Y
 * 3. Constraint checking - what's satisfied, violated, or warning
 * 4. Room adjacency calculation - "Kitchen is NORTH of Dining"
 */

import type {
  ProjectId,
  BuildingId,
  LevelId,
  WallId,
  RoomId,
  OpeningId,
  RoomType,
  OpeningType,
  Point2D,
  UnitSystem,
} from './gemini-types';

// ============================================================================
// Direction System (LLM-Friendly)
// ============================================================================

/**
 * Cardinal directions - much clearer for LLMs than X/Y/Z axes
 *
 * Convention:
 * - NORTH = toward street (front of house, +Y direction)
 * - SOUTH = toward backyard (-Y direction)
 * - EAST = right side when facing north (+X direction)
 * - WEST = left side when facing north (-X direction)
 */
export type CardinalDirection = 'NORTH' | 'SOUTH' | 'EAST' | 'WEST';

/**
 * Convert a vector (dx, dy) to a cardinal direction
 * Returns the dominant direction of the vector
 */
export function vectorToCardinal(dx: number, dy: number): CardinalDirection {
  // If Y component is larger, it's primarily N/S
  if (Math.abs(dy) >= Math.abs(dx)) {
    return dy >= 0 ? 'NORTH' : 'SOUTH';
  }
  // Otherwise it's primarily E/W
  return dx >= 0 ? 'EAST' : 'WEST';
}

/**
 * Get the direction from point A to point B
 */
export function getDirection(from: Point2D, to: Point2D): CardinalDirection {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  return vectorToCardinal(dx, dy);
}

/**
 * Get the opposite direction
 */
export function oppositeDirection(dir: CardinalDirection): CardinalDirection {
  const opposites: Record<CardinalDirection, CardinalDirection> = {
    NORTH: 'SOUTH',
    SOUTH: 'NORTH',
    EAST: 'WEST',
    WEST: 'EAST',
  };
  return opposites[dir];
}

/**
 * Describe a position relative to a reference point using cardinal directions
 */
export function describeRelativePosition(
  reference: Point2D,
  target: Point2D
): string {
  const dx = target[0] - reference[0];
  const dy = target[1] - reference[1];

  // Calculate distance
  const distance = Math.sqrt(dx * dx + dy * dy);
  if (distance < 0.1) return 'at the same location';

  const direction = vectorToCardinal(dx, dy);

  // Check if it's more diagonal
  const ratio = Math.min(Math.abs(dx), Math.abs(dy)) / Math.max(Math.abs(dx), Math.abs(dy));
  if (ratio > 0.5 && ratio < 2) {
    // Diagonal - include both directions
    const nsDir = dy >= 0 ? 'NORTH' : 'SOUTH';
    const ewDir = dx >= 0 ? 'EAST' : 'WEST';
    return `${nsDir}-${ewDir}`;
  }

  return direction;
}

// ============================================================================
// Room Summary Types
// ============================================================================

export interface RoomSummary {
  id: RoomId;
  name: string;
  type: RoomType;
  /** Room center position */
  center: Point2D;
  /** Room dimensions: width (E-W) x depth (N-S) */
  dimensions: { width: number; depth: number };
  /** Room area in square feet */
  area: number;
  /** Bounding box for collision detection */
  bounds: BoundingBox2D;
}

export interface WallSummary {
  id: WallId;
  /** Start point */
  start: Point2D;
  /** End point */
  end: Point2D;
  /** Wall length */
  length: number;
  /** Wall direction (which way it faces) */
  facing: CardinalDirection;
  /** Is this a load-bearing/structural wall? */
  isStructural: boolean;
  /** Is this an exterior wall? */
  isExterior: boolean;
  /** Wall height */
  height: number;
}

export interface OpeningSummary {
  id: OpeningId;
  type: OpeningType;
  /** Wall this opening is in */
  wallId: WallId;
  /** Position along wall (0-1 normalized) */
  position: number;
  /** Opening dimensions */
  dimensions: { width: number; height: number };
  /** Sill height (for windows) */
  sillHeight: number;
}

// ============================================================================
// Layout and Spatial Types
// ============================================================================

export interface BoundingBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LayoutSummary {
  /** Total floor area in square feet */
  totalArea: number;
  /** Overall bounding box dimensions */
  boundingBox: { width: number; depth: number };
  /** Room adjacency descriptions (human-readable) */
  roomAdjacencies: string[];
  /** Circulation descriptions */
  circulation: string[];
}

// ============================================================================
// Action Result Types
// ============================================================================

export interface LastAction {
  /** What tool/skill was called */
  tool: string;
  /** Parameters that were passed */
  params: Record<string, unknown>;
  /** Success or error */
  result: 'success' | 'error';
  /** Human-readable message */
  message: string;
  /** What was created (if success) */
  created?: {
    type: string;
    id: string;
    dimensions?: string;
  };
}

// ============================================================================
// Constraint Types
// ============================================================================

export interface ConstraintStatus {
  /** Constraints that are satisfied */
  satisfied: string[];
  /** Constraints that are violated (errors) */
  violated: string[];
  /** Constraints that are concerning but not errors */
  warnings: string[];
}

// ============================================================================
// Full Observable State
// ============================================================================

/**
 * The complete observable state returned after EVERY operation.
 *
 * This is what Gemini sees after each tool call, allowing it to:
 * 1. See what exists now
 * 2. Understand spatial relationships
 * 3. Know what just happened
 * 4. Check if constraints are met
 */
export interface ObservableState {
  /** What exists in the floorplan right now */
  floorplan: {
    rooms: RoomSummary[];
    walls: WallSummary[];
    openings: OpeningSummary[];
  };

  /** Spatial relationships (LLM-friendly) */
  layout: LayoutSummary;

  /** What just happened */
  lastAction: LastAction;

  /** Constraint status */
  constraints: ConstraintStatus;

  /** Project context */
  context: {
    projectId: ProjectId | null;
    buildingId: BuildingId | null;
    levelId: LevelId | null;
    units: UnitSystem;
  };
}

// ============================================================================
// Room Adjacency Calculator
// ============================================================================

/**
 * Check if two bounding boxes are adjacent (touching or overlapping slightly)
 */
function boxesAdjacent(a: BoundingBox2D, b: BoundingBox2D, tolerance = 1): boolean {
  // Check if they overlap or are within tolerance
  const xOverlap = a.maxX >= b.minX - tolerance && a.minX <= b.maxX + tolerance;
  const yOverlap = a.maxY >= b.minY - tolerance && a.minY <= b.maxY + tolerance;
  return xOverlap && yOverlap;
}

/**
 * Calculate room adjacencies and return human-readable descriptions
 */
export function calculateRoomAdjacencies(rooms: RoomSummary[]): string[] {
  const adjacencies: string[] = [];

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const roomA = rooms[i];
      const roomB = rooms[j];

      if (boxesAdjacent(roomA.bounds, roomB.bounds)) {
        // Determine relative direction: "B is DIRECTION of A" (B is in that direction from A)
        const direction = getDirection(roomA.center, roomB.center);
        adjacencies.push(`${roomB.name} is ${direction} of ${roomA.name}`);
      }
    }
  }

  return adjacencies;
}

// ============================================================================
// Constraint Checkers
// ============================================================================

// Re-export room size options from space-budget for convenient access
export {
  type RoomSizeOption,
  BEDROOM_SIZES,
  PRIMARY_BEDROOM_SIZES,
  KITCHEN_SIZES,
  LIVING_SIZES,
  DINING_SIZES,
  BATHROOM_SIZES,
  PRIMARY_BATHROOM_SIZES,
  CLOSET_SIZES,
  OFFICE_SIZES,
  FAMILY_SIZES,
  GARAGE_SIZES,
  UTILITY_SIZES,
  PANTRY_SIZES,
  FOYER_SIZES,
  MUDROOM_SIZES,
  HALLWAY_SIZES,
  getSizeOptionsForType,
  findSizeOptionForArea,
  findNextSizeUp,
  EXPANSION_PRIORITY,
  calculateSpaceBudget,
  calculateCirculationMetrics,
  generateAllocationExplanation,
} from './space-budget';

/** Minimum room sizes by type (in square feet) - from IRC
 *
 * Synced with RoomType from gemini-types.ts
 */
const MIN_ROOM_SIZES: Partial<Record<RoomType, number>> = {
  // Core living spaces
  living: 70,
  kitchen: 50,
  dining: 100,     // 10x10 min for formal dining
  family: 150,     // Similar to living room

  // Private spaces
  bedroom: 70,
  bathroom: 35,
  closet: 16,      // 4x4 min walk-in
  office: 64,      // 8x8 min for home office

  // Service spaces
  garage: 200,     // Single car minimum
  utility: 35,     // Mechanical room
  laundry: 35,     // 5x7 min
  pantry: 16,      // 4x4 min

  // Entry/circulation
  hallway: 0,      // Width requirement, not area
  circulation: 0,  // Width requirement, not area
  mudroom: 36,     // 6x6 min
  foyer: 36,       // 6x6 min

  // Outdoor spaces
  patio: 64,       // 8x8 min
  deck: 64,        // 8x8 min

  // Catch-all
  other: 0,
};

/** Typical room sizes for reference
 *
 * Synced with RoomType from gemini-types.ts
 */
const TYPICAL_ROOM_SIZES: Partial<Record<RoomType, { min: number; max: number }>> = {
  // Core living spaces
  living: { min: 150, max: 400 },
  kitchen: { min: 100, max: 200 },
  dining: { min: 120, max: 200 },
  family: { min: 200, max: 400 },

  // Private spaces
  bedroom: { min: 100, max: 200 },
  bathroom: { min: 40, max: 100 },
  closet: { min: 16, max: 80 },
  office: { min: 100, max: 200 },

  // Service spaces
  garage: { min: 240, max: 600 },
  utility: { min: 35, max: 100 },
  laundry: { min: 35, max: 80 },
  pantry: { min: 16, max: 50 },

  // Entry/circulation
  hallway: { min: 20, max: 60 },
  circulation: { min: 20, max: 100 },
  mudroom: { min: 36, max: 80 },
  foyer: { min: 36, max: 150 },

  // Outdoor spaces
  patio: { min: 64, max: 400 },
  deck: { min: 64, max: 300 },
};

/**
 * Check all constraints and return status
 */
export function checkConstraints(state: Partial<ObservableState>): ConstraintStatus {
  const satisfied: string[] = [];
  const violated: string[] = [];
  const warnings: string[] = [];

  const rooms = state.floorplan?.rooms || [];
  const walls = state.floorplan?.walls || [];

  // Check room sizes
  for (const room of rooms) {
    const minSize = MIN_ROOM_SIZES[room.type];
    const typicalSize = TYPICAL_ROOM_SIZES[room.type];

    if (minSize !== undefined && room.area < minSize) {
      violated.push(`${room.name} (${room.area.toFixed(0)} sq ft) is below minimum ${minSize} sq ft for ${room.type}`);
    } else if (typicalSize && room.area < typicalSize.min) {
      warnings.push(`${room.name} (${room.area.toFixed(0)} sq ft) is smaller than typical ${typicalSize.min}-${typicalSize.max} sq ft`);
    } else if (room.area > 0) {
      satisfied.push(`${room.name} size OK (${room.area.toFixed(0)} sq ft)`);
    }
  }

  // Check wall connections (walls should connect at endpoints)
  if (walls.length > 0) {
    // Simple check: count walls that share endpoints
    let connectedWalls = 0;
    for (let i = 0; i < walls.length; i++) {
      for (let j = i + 1; j < walls.length; j++) {
        if (wallsConnect(walls[i], walls[j])) {
          connectedWalls++;
        }
      }
    }
    if (connectedWalls > 0) {
      satisfied.push(`${connectedWalls} wall connections found`);
    }
  }

  // Check for rooms
  if (rooms.length === 0 && walls.length > 0) {
    warnings.push('Walls exist but no rooms defined - consider adding rooms');
  }

  // Check total area
  const totalArea = state.layout?.totalArea || 0;
  if (totalArea > 0) {
    satisfied.push(`Total floor area: ${totalArea.toFixed(0)} sq ft`);
  }

  // Check room adjacencies (Layer 3 constraint validation)
  if (rooms.length >= 2) {
    const adjacencyWarnings = validateRoomAdjacencies(rooms);
    warnings.push(...adjacencyWarnings);

    // Add satisfied message if no adjacency warnings
    if (adjacencyWarnings.length === 0 && rooms.length >= 3) {
      satisfied.push('Room adjacencies follow production home guidelines');
    }
  }

  return { satisfied, violated, warnings };
}

/**
 * Check if two walls connect at their endpoints
 */
function wallsConnect(a: WallSummary, b: WallSummary, tolerance = 0.5): boolean {
  const points = [a.start, a.end, b.start, b.end];
  const pairs = [
    [a.start, b.start],
    [a.start, b.end],
    [a.end, b.start],
    [a.end, b.end],
  ];

  for (const [p1, p2] of pairs) {
    const dist = Math.sqrt((p1[0] - p2[0]) ** 2 + (p1[1] - p2[1]) ** 2);
    if (dist < tolerance) return true;
  }
  return false;
}

/**
 * Adjacency rules based on production home design principles.
 * Defines what room types should be near or avoid each other.
 *
 * Synced with RoomType from gemini-types.ts and TYPE_ADJACENCY_RULES from cad-skills.ts
 */
const ADJACENCY_EXPECTATIONS: Record<RoomType, { shouldBeNear: RoomType[]; shouldAvoid: RoomType[] }> = {
  // Core living spaces
  kitchen: { shouldBeNear: ['living', 'dining', 'pantry', 'family'], shouldAvoid: ['bedroom'] },
  living: { shouldBeNear: ['kitchen', 'dining', 'foyer', 'circulation'], shouldAvoid: [] },
  dining: { shouldBeNear: ['kitchen', 'living'], shouldAvoid: ['bedroom', 'garage'] },
  family: { shouldBeNear: ['kitchen', 'living'], shouldAvoid: ['garage'] },

  // Private spaces
  bedroom: { shouldBeNear: ['bathroom', 'hallway', 'closet', 'circulation'], shouldAvoid: ['kitchen', 'garage'] },
  bathroom: { shouldBeNear: ['bedroom', 'hallway', 'closet'], shouldAvoid: [] },
  closet: { shouldBeNear: ['bedroom', 'hallway', 'foyer'], shouldAvoid: ['kitchen', 'garage'] },
  office: { shouldBeNear: ['foyer', 'hallway', 'living'], shouldAvoid: ['kitchen', 'garage'] },

  // Service spaces
  garage: { shouldBeNear: ['utility', 'mudroom', 'laundry'], shouldAvoid: ['bedroom', 'living'] },
  utility: { shouldBeNear: ['garage', 'kitchen', 'laundry'], shouldAvoid: ['living'] },
  laundry: { shouldBeNear: ['utility', 'garage', 'mudroom', 'bathroom'], shouldAvoid: ['living', 'dining'] },
  pantry: { shouldBeNear: ['kitchen'], shouldAvoid: ['bedroom', 'bathroom'] },

  // Entry/circulation spaces
  hallway: { shouldBeNear: ['bedroom', 'bathroom', 'closet'], shouldAvoid: [] },
  circulation: { shouldBeNear: ['living', 'foyer'], shouldAvoid: [] },
  mudroom: { shouldBeNear: ['garage', 'foyer', 'laundry'], shouldAvoid: ['bedroom', 'living'] },
  foyer: { shouldBeNear: ['living', 'dining', 'office', 'closet'], shouldAvoid: ['bedroom', 'garage'] },

  // Outdoor spaces
  patio: { shouldBeNear: ['living', 'kitchen', 'dining', 'family'], shouldAvoid: [] },
  deck: { shouldBeNear: ['living', 'bedroom', 'family'], shouldAvoid: [] },

  // Vertical circulation (stairs)
  stair: { shouldBeNear: ['foyer', 'hallway', 'landing'], shouldAvoid: [] },
  landing: { shouldBeNear: ['stair', 'hallway', 'bedroom'], shouldAvoid: [] },

  // Open floor plan (combined living/kitchen/dining)
  great_room: { shouldBeNear: ['foyer', 'pantry', 'mudroom'], shouldAvoid: ['garage'] },

  // Catch-all
  other: { shouldBeNear: ['living', 'kitchen'], shouldAvoid: [] },
};

/**
 * Validate room adjacencies based on production home design principles.
 * Returns warnings for adjacency violations (not errors - layout can still work).
 *
 * Production home adjacency rules:
 * - Kitchen MUST be adjacent to living/dining
 * - Primary bath SHOULD be adjacent to primary bedroom
 * - Entry SHOULD NOT face bathroom directly
 * - Bedrooms SHOULD be near hallway, away from kitchen
 * - Garage SHOULD be near utility, away from bedrooms
 */
export function validateRoomAdjacencies(rooms: RoomSummary[]): string[] {
  const warnings: string[] = [];
  if (rooms.length < 2) return warnings;

  // Build adjacency map: which rooms are adjacent to which
  const adjacencyMap = new Map<string, Set<string>>();
  for (const room of rooms) {
    adjacencyMap.set(room.name, new Set());
  }

  // Check all pairs for adjacency
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (boxesAdjacent(rooms[i].bounds, rooms[j].bounds, 2)) {
        adjacencyMap.get(rooms[i].name)?.add(rooms[j].name);
        adjacencyMap.get(rooms[j].name)?.add(rooms[i].name);
      }
    }
  }

  // Check expected adjacencies
  for (const room of rooms) {
    const expectations = ADJACENCY_EXPECTATIONS[room.type];
    if (!expectations) continue;

    const adjacentNames = adjacencyMap.get(room.name) || new Set();
    const adjacentRooms = rooms.filter(r => adjacentNames.has(r.name));
    const adjacentTypes = new Set(adjacentRooms.map(r => r.type));

    // Check "should be near" - warn if none of the expected types are adjacent
    if (expectations.shouldBeNear.length > 0 && rooms.length >= 3) {
      const hasExpectedNearby = expectations.shouldBeNear.some(t => adjacentTypes.has(t));
      if (!hasExpectedNearby && adjacentNames.size > 0) {
        // Room has adjacencies but not the expected ones
        const expectedStr = expectations.shouldBeNear.join(' or ');
        warnings.push(`${room.name} (${room.type}) not adjacent to ${expectedStr}`);
      }
    }

    // Check "should avoid" - warn if any avoided types are adjacent
    for (const avoidType of expectations.shouldAvoid) {
      if (adjacentTypes.has(avoidType)) {
        const avoidedRoom = adjacentRooms.find(r => r.type === avoidType);
        if (avoidedRoom) {
          warnings.push(`${room.name} is adjacent to ${avoidedRoom.name} (${avoidType}) - typically avoided`);
        }
      }
    }
  }

  // Specific production home checks
  const kitchen = rooms.find(r => r.type === 'kitchen');
  const living = rooms.find(r => r.type === 'living');
  const entry = rooms.find(r => r.type === 'circulation' && r.name.toLowerCase().includes('entry') || r.name.toLowerCase().includes('foyer'));
  const bathrooms = rooms.filter(r => r.type === 'bathroom');

  // Kitchen should be near living
  if (kitchen && living && !boxesAdjacent(kitchen.bounds, living.bounds, 2)) {
    warnings.push('Kitchen not adjacent to Living - should be connected for open plan');
  }

  // Entry should not directly face bathroom
  if (entry) {
    for (const bath of bathrooms) {
      if (boxesAdjacent(entry.bounds, bath.bounds, 1)) {
        // Check if bathroom is directly north of entry (directly visible from front door)
        const direction = getDirection(entry.center, bath.center);
        if (direction === 'SOUTH') { // Bathroom is toward backyard from entry is fine
          continue;
        }
        warnings.push(`${bath.name} directly adjacent to entry - consider relocating for privacy`);
      }
    }
  }

  // Primary bedroom should have adjacent bathroom
  const primaryBedroom = rooms.find(r => r.type === 'bedroom' &&
    (r.name.toLowerCase().includes('primary') || r.name.toLowerCase().includes('master')));
  if (primaryBedroom && bathrooms.length > 0) {
    const hasAdjacentBath = bathrooms.some(b => boxesAdjacent(primaryBedroom.bounds, b.bounds, 2));
    if (!hasAdjacentBath) {
      warnings.push('Primary bedroom has no adjacent bathroom - consider adding ensuite');
    }
  }

  return warnings;
}

// ============================================================================
// State Builder
// ============================================================================

/**
 * Create an empty/initial observable state
 */
export function createEmptyState(): ObservableState {
  return {
    floorplan: {
      rooms: [],
      walls: [],
      openings: [],
    },
    layout: {
      totalArea: 0,
      boundingBox: { width: 0, depth: 0 },
      roomAdjacencies: [],
      circulation: [],
    },
    lastAction: {
      tool: 'none',
      params: {},
      result: 'success',
      message: 'No actions yet',
    },
    constraints: {
      satisfied: [],
      violated: [],
      warnings: [],
    },
    context: {
      projectId: null,
      buildingId: null,
      levelId: null,
      units: 'imperial',
    },
  };
}

/**
 * Calculate bounding box from points
 */
export function calculateBounds(points: Point2D[]): BoundingBox2D {
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Calculate area of a polygon using shoelace formula
 */
export function calculatePolygonArea(points: Point2D[]): number {
  if (points.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }

  return Math.abs(area / 2);
}

/**
 * Calculate center of a polygon
 */
export function calculateCenter(points: Point2D[]): Point2D {
  if (points.length === 0) return [0, 0];

  let sumX = 0, sumY = 0;
  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
  }

  return [sumX / points.length, sumY / points.length];
}

/**
 * Create a RoomSummary from room data
 */
export function createRoomSummary(
  id: RoomId,
  name: string,
  type: RoomType,
  points: Point2D[]
): RoomSummary {
  const bounds = calculateBounds(points);
  const center = calculateCenter(points);
  const area = calculatePolygonArea(points);

  return {
    id,
    name,
    type,
    center,
    dimensions: {
      width: bounds.maxX - bounds.minX,
      depth: bounds.maxY - bounds.minY,
    },
    area,
    bounds,
  };
}

/**
 * Create a WallSummary from wall data
 */
export function createWallSummary(
  id: WallId,
  start: Point2D,
  end: Point2D,
  height: number,
  isStructural = false,
  isExterior = false
): WallSummary {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.sqrt(dx * dx + dy * dy);

  // Wall faces perpendicular to its direction
  // A wall running E-W faces N or S
  // A wall running N-S faces E or W
  let facing: CardinalDirection;
  if (Math.abs(dx) > Math.abs(dy)) {
    // Wall runs mostly E-W, faces N or S
    facing = 'NORTH'; // Default to facing north (toward street)
  } else {
    // Wall runs mostly N-S, faces E or W
    facing = 'EAST';
  }

  return {
    id,
    start,
    end,
    length,
    facing,
    isStructural,
    isExterior,
    height,
  };
}

// ============================================================================
// State Update Functions
// ============================================================================

/**
 * Update state after a successful room creation
 */
export function addRoomToState(
  state: ObservableState,
  id: RoomId,
  name: string,
  type: RoomType,
  points: Point2D[]
): ObservableState {
  const room = createRoomSummary(id, name, type, points);
  const rooms = [...state.floorplan.rooms, room];

  // Recalculate adjacencies
  const roomAdjacencies = calculateRoomAdjacencies(rooms);

  // Recalculate total area
  const totalArea = rooms.reduce((sum, r) => sum + r.area, 0);

  // Recalculate bounding box
  const allPoints = rooms.flatMap(r => [
    [r.bounds.minX, r.bounds.minY] as Point2D,
    [r.bounds.maxX, r.bounds.maxY] as Point2D,
  ]);
  const overallBounds = calculateBounds(allPoints);

  return {
    ...state,
    floorplan: {
      ...state.floorplan,
      rooms,
    },
    layout: {
      ...state.layout,
      totalArea,
      boundingBox: {
        width: overallBounds.maxX - overallBounds.minX,
        depth: overallBounds.maxY - overallBounds.minY,
      },
      roomAdjacencies,
    },
    lastAction: {
      tool: 'create_room',
      params: { name, type, points },
      result: 'success',
      message: `Created ${type} "${name}" (${room.area.toFixed(0)} sq ft)`,
      created: {
        type: 'room',
        id,
        dimensions: `${room.dimensions.width.toFixed(1)}' x ${room.dimensions.depth.toFixed(1)}'`,
      },
    },
    constraints: checkConstraints({
      floorplan: { rooms, walls: state.floorplan.walls, openings: state.floorplan.openings },
      layout: state.layout,
    }),
  };
}

/**
 * Update state after a successful wall creation
 */
export function addWallToState(
  state: ObservableState,
  id: WallId,
  start: Point2D,
  end: Point2D,
  height: number,
  isStructural = false,
  isExterior = false
): ObservableState {
  const wall = createWallSummary(id, start, end, height, isStructural, isExterior);
  const walls = [...state.floorplan.walls, wall];

  return {
    ...state,
    floorplan: {
      ...state.floorplan,
      walls,
    },
    lastAction: {
      tool: 'create_wall',
      params: { start, end, height },
      result: 'success',
      message: `Created wall from ${formatPoint(start)} to ${formatPoint(end)} (${wall.length.toFixed(1)}' long)`,
      created: {
        type: 'wall',
        id,
        dimensions: `${wall.length.toFixed(1)}' x ${height}'`,
      },
    },
    constraints: checkConstraints({
      floorplan: { rooms: state.floorplan.rooms, walls, openings: state.floorplan.openings },
      layout: state.layout,
    }),
  };
}

/**
 * Update state after an error
 */
export function setErrorState(
  state: ObservableState,
  tool: string,
  params: Record<string, unknown>,
  errorMessage: string,
  suggestions: string[] = []
): ObservableState {
  return {
    ...state,
    lastAction: {
      tool,
      params,
      result: 'error',
      message: errorMessage,
    },
    constraints: {
      ...state.constraints,
      violated: [
        ...state.constraints.violated,
        `Error in ${tool}: ${errorMessage}`,
        ...suggestions.map(s => `Suggestion: ${s}`),
      ],
    },
  };
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format a point as a readable string
 */
function formatPoint(p: Point2D): string {
  return `(${p[0].toFixed(1)}', ${p[1].toFixed(1)}')`;
}

/**
 * Format the observable state as a string for Gemini to read
 */
export function formatStateForLLM(state: ObservableState): string {
  const lines: string[] = [];

  // Last action
  lines.push('=== LAST ACTION ===');
  lines.push(`Tool: ${state.lastAction.tool}`);
  lines.push(`Result: ${state.lastAction.result}`);
  lines.push(`Message: ${state.lastAction.message}`);
  if (state.lastAction.created) {
    lines.push(`Created: ${state.lastAction.created.type} (${state.lastAction.created.id})`);
    if (state.lastAction.created.dimensions) {
      lines.push(`Dimensions: ${state.lastAction.created.dimensions}`);
    }
  }

  // Current state summary
  lines.push('');
  lines.push('=== CURRENT FLOORPLAN ===');
  lines.push(`Rooms: ${state.floorplan.rooms.length}`);
  lines.push(`Walls: ${state.floorplan.walls.length}`);
  lines.push(`Openings: ${state.floorplan.openings.length}`);
  lines.push(`Total Area: ${state.layout.totalArea.toFixed(0)} sq ft`);
  if (state.layout.boundingBox.width > 0) {
    lines.push(`Bounding Box: ${state.layout.boundingBox.width.toFixed(0)}' (E-W) x ${state.layout.boundingBox.depth.toFixed(0)}' (N-S)`);
  }

  // Room details
  if (state.floorplan.rooms.length > 0) {
    lines.push('');
    lines.push('Rooms:');
    for (const room of state.floorplan.rooms) {
      lines.push(`  - ${room.name} (${room.type}): ${room.area.toFixed(0)} sq ft at ${formatPoint(room.center)}`);
    }
  }

  // Room adjacencies
  if (state.layout.roomAdjacencies.length > 0) {
    lines.push('');
    lines.push('Adjacencies:');
    for (const adj of state.layout.roomAdjacencies) {
      lines.push(`  - ${adj}`);
    }
  }

  // Constraints
  lines.push('');
  lines.push('=== CONSTRAINTS ===');
  if (state.constraints.violated.length > 0) {
    lines.push('VIOLATIONS:');
    for (const v of state.constraints.violated) {
      lines.push(`  [X] ${v}`);
    }
  }
  if (state.constraints.warnings.length > 0) {
    lines.push('WARNINGS:');
    for (const w of state.constraints.warnings) {
      lines.push(`  [!] ${w}`);
    }
  }
  if (state.constraints.satisfied.length > 0) {
    lines.push('SATISFIED:');
    for (const s of state.constraints.satisfied) {
      lines.push(`  [OK] ${s}`);
    }
  }

  return lines.join('\n');
}
