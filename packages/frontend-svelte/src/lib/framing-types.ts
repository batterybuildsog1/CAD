/**
 * TypeScript types for wall framing calculations and rendering
 *
 * Defines lumber sizes, member types, and framing layouts for
 * generating accurate construction documents from CAD models.
 */

// ============================================================================
// Lumber Types
// ============================================================================

/** Standard lumber nominal sizes */
export type LumberSize = '2x4' | '2x6' | '2x8' | '2x10' | '2x12' | '4x4' | '4x6' | 'custom';

/** Framing materials with structural properties */
export type FramingMaterial = 'SPF' | 'DF' | 'SYP' | 'LVL' | 'PSL' | 'steel';

/** Header types for openings */
export type HeaderType = '2x4' | '2x6' | '2x8' | '2x10' | '2x12' | 'LVL' | 'steel_flitch';

// ============================================================================
// Framing Member Types
// ============================================================================

/** All possible framing member types in a wall assembly */
export type FramingMemberType =
  | 'bottom_plate'
  | 'top_plate'
  | 'double_top_plate'
  | 'stud'
  | 'king_stud'
  | 'jack_stud'
  | 'cripple_stud'
  | 'corner_stud'
  | 'header'
  | 'sill'
  | 'fire_blocking'
  | 'mid_height_blocking';

// ============================================================================
// Framing Member Interface
// ============================================================================

/** Individual framing member with position and properties */
export interface FramingMember {
  id: string;
  type: FramingMemberType;
  lumberSize: LumberSize;
  material: FramingMaterial;
  /** Position as [x_along_wall, y_into_room, z_vertical] in inches */
  position: [number, number, number];
  /** Length in inches */
  length: number;
  /** Rotation in degrees (optional, defaults to 0) */
  rotation?: number;
  /** Parent wall ID */
  wallId: string;
  /** Associated opening ID (for king studs, jack studs, headers, sills) */
  openingId?: string;
}

// ============================================================================
// Framing Layout Interface
// ============================================================================

/** Complete framing layout for a single wall */
export interface FramingLayout {
  id: string;
  wallId: string;
  members: FramingMember[];
  /** Stud spacing in inches on-center (typically 16 or 24) */
  studSpacing: number;
  doubleTopPlate: boolean;
  lumberSize: LumberSize;
  /** Total board feet of lumber */
  totalBoardFeet: number;
  /** Total number of studs */
  studCount: number;
}

// ============================================================================
// Configuration Interfaces
// ============================================================================

/** Wall framing configuration settings */
export interface WallFramingConfig {
  /** Stud spacing in inches on-center (16 or 24) */
  studSpacing: number;
  lumberSize: LumberSize;
  doubleTopPlate: boolean;
  isLoadBearing: boolean;
  fireBlockingRequired: boolean;
}

/** Rough opening computed from an Opening */
export interface RoughOpening {
  openingId: string;
  /** Width in inches */
  width: number;
  /** Height in inches */
  height: number;
  /** Position along wall as fraction (0.0 to 1.0) */
  positionAlongWall: number;
  /** Number of jack studs on each side */
  jackStudCount: number;
  /** Header depth in inches */
  headerDepth: number;
  headerType: HeaderType;
  /** True for windows, false for doors */
  requiresSill: boolean;
}

// ============================================================================
// Extended Wall Interface
// ============================================================================

/** Wall summary extended with framing information */
export interface WallWithFraming {
  id: string;
  start: [number, number];
  end: [number, number];
  thickness: number;
  height: number;
  framingConfig: WallFramingConfig;
  /** Framing layout (populated after framing calculation) */
  framingLayout?: FramingLayout;
  openings: RoughOpening[];
}

// ============================================================================
// Wall Decision Types (for AI-driven wall placement)
// ============================================================================

/** Wall types between rooms */
export type WallType = 'full' | 'none' | 'half' | 'column' | 'cased_opening';

/** Reason for wall decision */
export type WallReason = 'privacy' | 'open_concept' | 'exterior' | 'user_specified';

/** AI decision about wall between two rooms */
export interface WallDecision {
  room1Id: string;
  room2Id: string;
  wallType: WallType;
  reason: WallReason;
}

// ============================================================================
// Room Type Rules
// ============================================================================

/** Room types that require privacy (full walls) */
export const PRIVACY_ROOMS = [
  'bedroom',
  'bathroom',
  'closet',
  'office',
  'garage',
  'utility',
  'laundry'
] as const;

/** Open concept room pairs (no wall between) */
export const OPEN_CONCEPT_PAIRS: [string, string][] = [
  ['kitchen', 'dining'],
  ['kitchen', 'living'],
  ['dining', 'living'],
  ['kitchen', 'great_room'],
  ['living', 'great_room'],
  ['dining', 'great_room'],
];

/**
 * Determine if a wall should exist between two rooms based on their types
 *
 * @param room1Type - Type of the first room
 * @param room2Type - Type of the second room (null for exterior boundary)
 * @returns WallDecision with wallType and reason
 */
export function shouldHaveWall(room1Type: string, room2Type: string | null): WallDecision {
  // Exterior boundary -> always wall
  if (!room2Type) {
    return { room1Id: '', room2Id: '', wallType: 'full', reason: 'exterior' };
  }

  // Privacy rooms -> always wall
  if (
    PRIVACY_ROOMS.includes(room1Type as typeof PRIVACY_ROOMS[number]) ||
    PRIVACY_ROOMS.includes(room2Type as typeof PRIVACY_ROOMS[number])
  ) {
    return { room1Id: '', room2Id: '', wallType: 'full', reason: 'privacy' };
  }

  // Open concept pairs -> no wall
  const isOpenConcept = OPEN_CONCEPT_PAIRS.some(
    ([a, b]) => (room1Type === a && room2Type === b) || (room1Type === b && room2Type === a)
  );
  if (isOpenConcept) {
    return { room1Id: '', room2Id: '', wallType: 'none', reason: 'open_concept' };
  }

  // Default: wall
  return { room1Id: '', room2Id: '', wallType: 'full', reason: 'privacy' };
}

// ============================================================================
// Lumber Dimensions (Actual vs Nominal)
// ============================================================================

/**
 * Actual lumber dimensions in inches [thickness, width]
 * Nominal sizes differ from actual dimensions after drying and planing
 */
export const LUMBER_DIMENSIONS: Record<LumberSize, [number, number]> = {
  '2x4': [1.5, 3.5],
  '2x6': [1.5, 5.5],
  '2x8': [1.5, 7.25],
  '2x10': [1.5, 9.25],
  '2x12': [1.5, 11.25],
  '4x4': [3.5, 3.5],
  '4x6': [3.5, 5.5],
  'custom': [0, 0],
};

// ============================================================================
// Rendering Colors
// ============================================================================

/** Colors for 3D rendering of framing members (hex values) */
export const FRAMING_COLORS: Record<FramingMemberType, number> = {
  'bottom_plate': 0xD4A574,
  'top_plate': 0xD4A574,
  'double_top_plate': 0xC4956A,
  'stud': 0xE8C9A0,
  'king_stud': 0xB8956A,
  'jack_stud': 0xA8856A,
  'cripple_stud': 0xD8B994,
  'corner_stud': 0xC8A584,
  'header': 0x8B7355,
  'sill': 0xD4A574,
  'fire_blocking': 0xF08080,
  'mid_height_blocking': 0xD4A574,
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get actual dimensions for a lumber size
 * @param size - Nominal lumber size
 * @returns [thickness, width] in inches
 */
export function getLumberDimensions(size: LumberSize): [number, number] {
  return LUMBER_DIMENSIONS[size];
}

/**
 * Calculate board feet for a piece of lumber
 * Board feet = (thickness * width * length) / 144
 *
 * @param size - Lumber size
 * @param length - Length in inches
 * @returns Board feet
 */
export function calculateBoardFeet(size: LumberSize, length: number): number {
  const [thickness, width] = LUMBER_DIMENSIONS[size];
  return (thickness * width * length) / 144;
}

/**
 * Get rendering color for a framing member type
 * @param type - Framing member type
 * @returns Hex color value for Three.js
 */
export function getFramingColor(type: FramingMemberType): number {
  return FRAMING_COLORS[type];
}

/**
 * Create default wall framing configuration
 * @param isLoadBearing - Whether the wall is load-bearing
 * @returns Default WallFramingConfig
 */
export function createDefaultFramingConfig(isLoadBearing: boolean = true): WallFramingConfig {
  return {
    studSpacing: 16,
    lumberSize: '2x4',
    doubleTopPlate: isLoadBearing,
    isLoadBearing,
    fireBlockingRequired: false,
  };
}
