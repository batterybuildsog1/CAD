/**
 * Hallway Generator
 *
 * Creates hallway polygons for various shapes:
 * - Straight: Simple linear connection
 * - L-Shaped: 90-degree turn
 * - T-Junction: Three-way intersection
 *
 * Width Standards (do NOT make wider unless user requests):
 * - Standard: 3' (36") - IRC minimum, code-compliant
 * - Comfortable: 3.5' (42") - Default for family homes
 * - Accessible: 4'+ (48"+) - Only if user requests or ADA required
 */

import type { Point2D } from './gemini-types';
import type { CardinalDirection } from './observable-state';

// ============================================================================
// Types
// ============================================================================

export type HallwayShape = 'straight' | 'L-shaped' | 'T-junction';

export interface HallwayConfig {
  /** Shape of the hallway */
  shape: HallwayShape;

  /** Width in feet (default 3.5') */
  width: number;

  /** Starting point [x, y] */
  fromPoint: Point2D;

  /** Ending point [x, y] - for straight and L-shaped */
  toPoint: Point2D;

  /** Turn direction for L-shaped hallways */
  turnDirection?: 'left' | 'right';

  /** Branch direction for T-junctions */
  branchDirection?: CardinalDirection;

  /** Branch length for T-junctions */
  branchLength?: number;
}

export interface HallwayResult {
  /** The hallway polygon points (closed polygon) */
  polygon: Point2D[];

  /** Area in square feet */
  area: number;

  /** Total length of hallway */
  length: number;

  /** Description of the hallway */
  description: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Standard hallway widths in feet */
export const HALLWAY_WIDTHS = {
  /** IRC minimum (36") */
  minimum: 3,

  /** Comfortable for family homes (42") */
  comfortable: 3.5,

  /** Wheelchair accessible (48") */
  accessible: 4,

  /** Wide/gallery (60") */
  gallery: 5,
};

/** Default width for new hallways */
export const DEFAULT_HALLWAY_WIDTH = HALLWAY_WIDTHS.comfortable;

// ============================================================================
// Main Generator Function
// ============================================================================

/**
 * Create a hallway polygon based on configuration
 */
export function createHallwayPolygon(config: HallwayConfig): HallwayResult {
  const width = config.width || DEFAULT_HALLWAY_WIDTH;

  switch (config.shape) {
    case 'straight':
      return createStraightHallway(config.fromPoint, config.toPoint, width);

    case 'L-shaped':
      return createLShapedHallway(
        config.fromPoint,
        config.toPoint,
        width,
        config.turnDirection || 'right'
      );

    case 'T-junction':
      return createTJunctionHallway(
        config.fromPoint,
        config.toPoint,
        width,
        config.branchDirection || 'EAST',
        config.branchLength || 7
      );

    default:
      return createStraightHallway(config.fromPoint, config.toPoint, width);
  }
}

// ============================================================================
// Straight Hallway
// ============================================================================

/**
 * Create a straight hallway between two points
 */
export function createStraightHallway(
  from: Point2D,
  to: Point2D,
  width: number = DEFAULT_HALLWAY_WIDTH
): HallwayResult {
  const halfWidth = width / 2;

  // Calculate direction vector
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length < 0.01) {
    // Degenerate case - points are the same
    return {
      polygon: [],
      area: 0,
      length: 0,
      description: 'Degenerate hallway (zero length)',
    };
  }

  // Normalize direction
  const nx = dx / length;
  const ny = dy / length;

  // Perpendicular vector (rotated 90 degrees)
  const px = -ny;
  const py = nx;

  // Create rectangle: 4 corners
  const p1: Point2D = [from[0] + px * halfWidth, from[1] + py * halfWidth];
  const p2: Point2D = [from[0] - px * halfWidth, from[1] - py * halfWidth];
  const p3: Point2D = [to[0] - px * halfWidth, to[1] - py * halfWidth];
  const p4: Point2D = [to[0] + px * halfWidth, to[1] + py * halfWidth];

  const polygon: Point2D[] = [p1, p2, p3, p4];
  const area = length * width;

  // Determine orientation for description
  const isHorizontal = Math.abs(dx) > Math.abs(dy);
  const orientation = isHorizontal ? 'E-W' : 'N-S';

  return {
    polygon,
    area,
    length,
    description: `Straight hallway ${width}'x${length.toFixed(1)}' (${orientation})`,
  };
}

// ============================================================================
// L-Shaped Hallway
// ============================================================================

/**
 * Create an L-shaped hallway with a 90-degree turn
 *
 * The hallway goes from `from` to an intermediate corner point,
 * then turns to reach `to`.
 */
export function createLShapedHallway(
  from: Point2D,
  to: Point2D,
  width: number = DEFAULT_HALLWAY_WIDTH,
  turnDirection: 'left' | 'right' = 'right'
): HallwayResult {
  const halfWidth = width / 2;

  // Calculate the corner point based on turn direction
  // For right turn: go horizontal first, then vertical
  // For left turn: go vertical first, then horizontal
  let corner: Point2D;

  const dx = to[0] - from[0];
  const dy = to[1] - from[1];

  if (turnDirection === 'right') {
    // Go horizontal first (X direction), then vertical (Y direction)
    corner = [to[0], from[1]];
  } else {
    // Go vertical first (Y direction), then horizontal (X direction)
    corner = [from[0], to[1]];
  }

  // Create the L-shape as a polygon
  // This is more complex - we create an 8-point polygon that forms the L

  // Segment 1: from -> corner
  const seg1Dx = corner[0] - from[0];
  const seg1Dy = corner[1] - from[1];
  const seg1Len = Math.sqrt(seg1Dx * seg1Dx + seg1Dy * seg1Dy);

  // Segment 2: corner -> to
  const seg2Dx = to[0] - corner[0];
  const seg2Dy = to[1] - corner[1];
  const seg2Len = Math.sqrt(seg2Dx * seg2Dx + seg2Dy * seg2Dy);

  if (seg1Len < 0.01 || seg2Len < 0.01) {
    // Degenerate - just make a straight hallway
    return createStraightHallway(from, to, width);
  }

  // Build the L-shaped polygon
  // We need to handle the corner carefully to avoid overlap

  let polygon: Point2D[];

  if (turnDirection === 'right') {
    // Horizontal first, then vertical
    // Starting from 'from', going clockwise around the L
    polygon = [
      // Bottom-left of horizontal segment (start)
      [from[0], from[1] - halfWidth],
      // Bottom-right of horizontal segment (before corner)
      [corner[0] + halfWidth, corner[1] - halfWidth],
      // Bottom-right of vertical segment (at corner, extended)
      [corner[0] + halfWidth, to[1] - (to[1] > corner[1] ? -halfWidth : halfWidth)],
      // Outer corner of vertical segment (end)
      [to[0] + halfWidth, to[1] + (to[1] > corner[1] ? halfWidth : -halfWidth)],
      // Inner corner of vertical segment (end)
      [to[0] - halfWidth, to[1] + (to[1] > corner[1] ? halfWidth : -halfWidth)],
      // Inner vertical at corner
      [corner[0] - halfWidth, to[1] > corner[1] ? corner[1] + halfWidth : corner[1] - halfWidth],
      // Inner horizontal at corner
      [corner[0] - halfWidth, corner[1] + halfWidth],
      // Top-left of horizontal segment (start)
      [from[0], from[1] + halfWidth],
    ];
  } else {
    // Vertical first, then horizontal
    polygon = [
      // Left of vertical segment (start)
      [from[0] - halfWidth, from[1]],
      // Left at corner
      [corner[0] - halfWidth, corner[1] - (to[0] > corner[0] ? -halfWidth : halfWidth)],
      // Bottom of horizontal segment (at corner)
      [corner[0] + (to[0] > corner[0] ? halfWidth : -halfWidth), corner[1] - halfWidth],
      // Bottom-right of horizontal (end)
      [to[0] + (to[0] > corner[0] ? halfWidth : -halfWidth), to[1] - halfWidth],
      // Top-right of horizontal (end)
      [to[0] + (to[0] > corner[0] ? halfWidth : -halfWidth), to[1] + halfWidth],
      // Top at corner
      [corner[0] + (to[0] > corner[0] ? halfWidth : -halfWidth), corner[1] + halfWidth],
      // Right at corner going back
      [corner[0] + halfWidth, corner[1] + halfWidth],
      // Right of vertical (start)
      [from[0] + halfWidth, from[1]],
    ];
  }

  // Simplify: use a cleaner approach with two rectangles merged
  // For L-shaped, create two rectangles and compute their union

  // Simpler approach: create the L as a simple 6-point polygon
  const isHorizontalFirst = turnDirection === 'right';

  if (isHorizontalFirst) {
    // Horizontal segment then vertical
    const goingRight = to[0] > from[0];
    const goingUp = to[1] > corner[1];

    polygon = [
      // Start outer
      [from[0], from[1] + halfWidth],
      // To corner outer
      [corner[0] + (goingUp ? halfWidth : -halfWidth), corner[1] + halfWidth],
      // Corner to end outer
      [corner[0] + (goingUp ? halfWidth : -halfWidth), to[1] + (goingUp ? halfWidth : -halfWidth)],
      // End inner
      [corner[0] - (goingUp ? halfWidth : -halfWidth), to[1] + (goingUp ? halfWidth : -halfWidth)],
      // Corner inner
      [corner[0] - (goingUp ? halfWidth : -halfWidth), corner[1] - halfWidth],
      // Start inner
      [from[0], from[1] - halfWidth],
    ];
  } else {
    // Vertical segment then horizontal
    const goingRight = to[0] > corner[0];
    const goingUp = corner[1] > from[1];

    polygon = [
      // Start outer
      [from[0] + halfWidth, from[1]],
      // To corner outer
      [corner[0] + halfWidth, corner[1] + (goingRight ? halfWidth : -halfWidth)],
      // Corner to end outer
      [to[0] + (goingRight ? halfWidth : -halfWidth), corner[1] + (goingRight ? halfWidth : -halfWidth)],
      // End inner
      [to[0] + (goingRight ? halfWidth : -halfWidth), corner[1] - (goingRight ? halfWidth : -halfWidth)],
      // Corner inner
      [corner[0] - halfWidth, corner[1] - (goingRight ? halfWidth : -halfWidth)],
      // Start inner
      [from[0] - halfWidth, from[1]],
    ];
  }

  const totalLength = seg1Len + seg2Len;
  const area = totalLength * width; // Approximate (ignores corner overlap)

  return {
    polygon,
    area,
    length: totalLength,
    description: `L-shaped hallway ${width}'W, ${seg1Len.toFixed(1)}' + ${seg2Len.toFixed(1)}' (${turnDirection} turn)`,
  };
}

// ============================================================================
// T-Junction Hallway
// ============================================================================

/**
 * Create a T-junction hallway (three-way intersection)
 *
 * Main corridor from `from` to `to`, with a branch extending in `branchDirection`
 */
export function createTJunctionHallway(
  from: Point2D,
  to: Point2D,
  width: number = DEFAULT_HALLWAY_WIDTH,
  branchDirection: CardinalDirection = 'EAST',
  branchLength: number = 7
): HallwayResult {
  const halfWidth = width / 2;

  // Calculate main corridor
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const mainLength = Math.sqrt(dx * dx + dy * dy);

  if (mainLength < 0.01) {
    return {
      polygon: [],
      area: 0,
      length: 0,
      description: 'Degenerate T-junction (zero length main corridor)',
    };
  }

  // Find midpoint for the branch
  const midX = (from[0] + to[0]) / 2;
  const midY = (from[1] + to[1]) / 2;

  // Determine if main corridor is primarily horizontal or vertical
  const mainIsHorizontal = Math.abs(dx) > Math.abs(dy);

  // Calculate branch endpoint based on direction
  let branchEnd: Point2D;
  switch (branchDirection) {
    case 'NORTH':
      branchEnd = [midX, midY + branchLength];
      break;
    case 'SOUTH':
      branchEnd = [midX, midY - branchLength];
      break;
    case 'EAST':
      branchEnd = [midX + branchLength, midY];
      break;
    case 'WEST':
      branchEnd = [midX - branchLength, midY];
      break;
  }

  // Build the T-shape polygon
  // This is an 8-point polygon for a proper T

  let polygon: Point2D[];

  if (mainIsHorizontal) {
    // Main corridor runs E-W
    const branchIsNorth = branchDirection === 'NORTH';
    const branchIsVertical = branchDirection === 'NORTH' || branchDirection === 'SOUTH';

    if (branchIsVertical) {
      if (branchIsNorth) {
        polygon = [
          // Bottom-left of main
          [from[0], from[1] - halfWidth],
          // Bottom-right of main
          [to[0], to[1] - halfWidth],
          // Top-right of main
          [to[0], to[1] + halfWidth],
          // Right side of branch start
          [midX + halfWidth, midY + halfWidth],
          // Right side of branch end
          [midX + halfWidth, branchEnd[1]],
          // Left side of branch end
          [midX - halfWidth, branchEnd[1]],
          // Left side of branch start
          [midX - halfWidth, midY + halfWidth],
          // Top-left of main
          [from[0], from[1] + halfWidth],
        ];
      } else {
        // Branch goes SOUTH
        polygon = [
          // Top-left of main
          [from[0], from[1] + halfWidth],
          // Top-right of main
          [to[0], to[1] + halfWidth],
          // Bottom-right of main
          [to[0], to[1] - halfWidth],
          // Right side of branch start
          [midX + halfWidth, midY - halfWidth],
          // Right side of branch end
          [midX + halfWidth, branchEnd[1]],
          // Left side of branch end
          [midX - halfWidth, branchEnd[1]],
          // Left side of branch start
          [midX - halfWidth, midY - halfWidth],
          // Bottom-left of main
          [from[0], from[1] - halfWidth],
        ];
      }
    } else {
      // Branch goes EAST or WEST - unusual for horizontal main, but handle it
      polygon = createStraightHallway(from, to, width).polygon;
    }
  } else {
    // Main corridor runs N-S
    const branchIsEast = branchDirection === 'EAST';
    const branchIsHorizontal = branchDirection === 'EAST' || branchDirection === 'WEST';

    if (branchIsHorizontal) {
      if (branchIsEast) {
        polygon = [
          // Left-bottom of main
          [from[0] - halfWidth, from[1]],
          // Left-top of main
          [to[0] - halfWidth, to[1]],
          // Right-top of main
          [to[0] + halfWidth, to[1]],
          // Top of branch start
          [midX + halfWidth, midY + halfWidth],
          // Top of branch end
          [branchEnd[0], midY + halfWidth],
          // Bottom of branch end
          [branchEnd[0], midY - halfWidth],
          // Bottom of branch start
          [midX + halfWidth, midY - halfWidth],
          // Right-bottom of main
          [from[0] + halfWidth, from[1]],
        ];
      } else {
        // Branch goes WEST
        polygon = [
          // Right-bottom of main
          [from[0] + halfWidth, from[1]],
          // Right-top of main
          [to[0] + halfWidth, to[1]],
          // Left-top of main
          [to[0] - halfWidth, to[1]],
          // Top of branch start
          [midX - halfWidth, midY + halfWidth],
          // Top of branch end
          [branchEnd[0], midY + halfWidth],
          // Bottom of branch end
          [branchEnd[0], midY - halfWidth],
          // Bottom of branch start
          [midX - halfWidth, midY - halfWidth],
          // Left-bottom of main
          [from[0] - halfWidth, from[1]],
        ];
      }
    } else {
      // Branch goes N or S - unusual for vertical main, but handle it
      polygon = createStraightHallway(from, to, width).polygon;
    }
  }

  const totalLength = mainLength + branchLength;
  const area = mainLength * width + branchLength * width; // T-shape area

  return {
    polygon,
    area,
    length: totalLength,
    description: `T-junction hallway ${width}'W, main ${mainLength.toFixed(1)}', branch ${branchLength}' ${branchDirection}`,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Calculate the area of a polygon using the shoelace formula
 */
export function calculatePolygonArea(polygon: Point2D[]): number {
  if (polygon.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    area += polygon[i][0] * polygon[j][1];
    area -= polygon[j][0] * polygon[i][1];
  }

  return Math.abs(area / 2);
}

/**
 * Calculate the center of a polygon
 */
export function calculatePolygonCenter(polygon: Point2D[]): Point2D {
  if (polygon.length === 0) return [0, 0];

  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of polygon) {
    sumX += x;
    sumY += y;
  }

  return [sumX / polygon.length, sumY / polygon.length];
}

/**
 * Get the bounding box of a polygon
 */
export function getPolygonBounds(polygon: Point2D[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (polygon.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const [x, y] of polygon) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return { minX, minY, maxX, maxY };
}

/**
 * Suggest the best hallway shape based on start/end points and room layout
 */
export function suggestHallwayShape(
  from: Point2D,
  to: Point2D,
  needsBranch: boolean = false
): { shape: HallwayShape; turnDirection?: 'left' | 'right'; branchDirection?: CardinalDirection } {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];

  // If aligned (mostly horizontal or vertical), use straight
  const ratio = Math.min(Math.abs(dx), Math.abs(dy)) / Math.max(Math.abs(dx), Math.abs(dy));

  if (ratio < 0.2) {
    // Mostly aligned - straight hallway
    if (needsBranch) {
      // Suggest T-junction with branch perpendicular to main direction
      const branchDirection: CardinalDirection = Math.abs(dx) > Math.abs(dy)
        ? (dy > 0 ? 'SOUTH' : 'NORTH')  // Horizontal main, branch N/S
        : (dx > 0 ? 'WEST' : 'EAST');   // Vertical main, branch E/W

      return { shape: 'T-junction', branchDirection };
    }
    return { shape: 'straight' };
  }

  // Not aligned - need an L-shape
  // Determine turn direction based on which way to go
  const turnDirection: 'left' | 'right' = (dx > 0 && dy > 0) || (dx < 0 && dy < 0)
    ? 'right'
    : 'left';

  return { shape: 'L-shaped', turnDirection };
}
