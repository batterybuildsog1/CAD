/**
 * Spine Geometry - Geometric Realization of Hallway Networks
 *
 * Converts the abstract MST hallway network (centerlines) into ACTUAL POLYGON GEOMETRY
 * that can be rendered and validated.
 *
 * Core Problem: The MST produces centerlines (point-to-point). This module converts
 * these to actual rectangular hallway polygons with width.
 *
 * Key Algorithms:
 * 1. Perpendicular offset: Given a line from A to B, offset by W/2 on each side
 * 2. Line-rectangle intersection for junction merging
 * 3. Point-in-polygon test for overlap detection
 */

import type { Point2D } from './gemini-types';
import type { RoomBounds } from './circulation-spine';
import type { HallwayNetwork, HallwaySegment } from './hallway-mst';
import type { TrafficPath } from './traffic-paths';
import type { CorridorSpec } from './bedroom-cluster';

// ============================================================================
// Types
// ============================================================================

/**
 * A single hallway rectangle created from a centerline segment
 */
export interface HallwayPolygon {
  /** Unique identifier for this hallway */
  id: string;

  /** The 4 corners of the hallway rectangle (counter-clockwise) */
  vertices: [Point2D, Point2D, Point2D, Point2D];

  /** Width of the hallway in feet */
  width: number;

  /** Length of the hallway in feet */
  length: number;

  /** The centerline from which this polygon was generated */
  centerline: { start: Point2D; end: Point2D };

  /** Which rooms this hallway connects (room IDs) */
  connectsRooms: [string, string];
}

/**
 * Junction polygon where multiple hallways meet
 */
export interface JunctionPolygon {
  /** Unique identifier for this junction */
  id: string;

  /** Vertices defining the junction shape (4+ corners for complex junctions) */
  vertices: Point2D[];

  /** IDs of hallways connected to this junction */
  connectedHallways: string[];
}

/**
 * Traffic path for open floor plan areas (from traffic-paths.ts)
 * Re-declared here for type compatibility without circular imports
 */
export interface TrafficPathGeometry {
  /** Unique identifier */
  id: string;

  /** Type of traffic path */
  pathType: 'primary_circulation' | 'secondary_circulation' | 'kitchen_work_zone' | 'furniture_clearance' | 'entry_zone';

  /** The zone this path belongs to */
  parentZoneId: string;

  /** Polygon vertices */
  vertices: Point2D[];

  /** Area in square feet */
  area: number;

  /** Whether this blocks furniture placement */
  blocksFurniture: boolean;
}

/**
 * Complete spine geometry with hallways, junctions, and traffic paths
 */
export interface SpineGeometry {
  /** All hallway polygons */
  hallways: HallwayPolygon[];

  /** Junction polygons where hallways meet */
  junctions: JunctionPolygon[];

  /** Traffic paths for open floor plan areas (not walled) */
  trafficPaths: TrafficPathGeometry[];

  /** Total walled circulation area in square feet (hallways + junctions) */
  totalArea: number;

  /** Total traffic path area in square feet (overlays, not additional space) */
  trafficPathArea: number;

  /** Bounding box containing all geometry */
  boundingBox: { x: number; y: number; width: number; height: number };
}

/**
 * Validation result for geometry checks
 */
export interface ValidationResult {
  /** Whether all geometry is valid */
  valid: boolean;

  /** List of specific violations found */
  violations: string[];
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum hallway length in feet (shorter hallways are degenerate) */
const MIN_HALLWAY_LENGTH = 1.0;

/** Default junction size multiplier (relative to hallway width) */
const JUNCTION_SIZE_MULTIPLIER = 1.2;

/** Tolerance for floating point comparisons */
const EPSILON = 0.001;

// ============================================================================
// Core Geometry Functions
// ============================================================================

/**
 * Generate complete spine geometry from a hallway network.
 *
 * This is the main entry point that converts the abstract MST network
 * into renderable polygon geometry.
 *
 * @param network - The hallway network from MST computation
 * @param hallwayWidth - Width of hallways in feet (default 3.5')
 * @param trafficPaths - Optional traffic paths for open floor plan areas
 * @param bedroomCorridors - Optional bedroom corridors from cluster detection
 * @returns SpineGeometry with all hallway, junction, and traffic path polygons
 */
export function generateSpineGeometry(
  network: HallwayNetwork,
  hallwayWidth: number = 3.5,
  trafficPaths: TrafficPath[] = [],
  bedroomCorridors: CorridorSpec[] = []
): SpineGeometry {
  // Convert traffic paths to geometry format
  const trafficPathGeometry: TrafficPathGeometry[] = trafficPaths.map(tp => ({
    id: tp.id,
    pathType: tp.pathType,
    parentZoneId: tp.parentZoneId,
    vertices: tp.vertices,
    area: tp.area,
    blocksFurniture: tp.blocksFurniture,
  }));

  // Calculate total traffic path area
  const trafficPathArea = trafficPaths.reduce((sum, tp) => sum + tp.area, 0);

  // Edge case: empty network
  if (network.segments.length === 0) {
    return {
      hallways: [],
      junctions: [],
      trafficPaths: trafficPathGeometry,
      totalArea: 0,
      trafficPathArea,
      boundingBox: calculateTrafficPathBoundingBox(trafficPathGeometry),
    };
  }

  // Step 1: Convert each segment to a hallway polygon
  const hallways: HallwayPolygon[] = network.segments.map((segment, index) => {
    // Use segment's width if specified, otherwise use the provided default
    const width = segment.width || hallwayWidth;
    return centerlineToPolygon(
      segment.centerline[0],
      segment.centerline[segment.centerline.length - 1],
      width,
      `hallway-${index}`,
      segment.from.roomId,
      segment.to.roomId
    );
  });

  // Step 1B: Add bedroom corridor polygons
  // These are generated from bedroom cluster detection and provide
  // shared hallway access to multiple bedrooms
  for (const corridor of bedroomCorridors) {
    const corridorPolygon = corridorToHallwayPolygon(corridor, hallwayWidth);
    if (corridorPolygon) {
      hallways.push(corridorPolygon);
    }
  }

  // Step 2: Create junctions where hallways meet
  const junctions: JunctionPolygon[] = createJunctionsFromNetwork(
    network,
    hallways,
    hallwayWidth
  );

  // Step 3: Calculate total walled circulation area (hallways + junctions)
  const hallwayArea = hallways.reduce((sum, h) => sum + calculatePolygonArea(h.vertices), 0);
  const junctionArea = junctions.reduce((sum, j) => sum + calculatePolygonArea(j.vertices), 0);
  const totalArea = hallwayArea + junctionArea;

  // Step 4: Calculate bounding box (including traffic paths)
  const boundingBox = calculateBoundingBoxWithTrafficPaths(hallways, junctions, trafficPathGeometry);

  return {
    hallways,
    junctions,
    trafficPaths: trafficPathGeometry,
    totalArea,
    trafficPathArea,
    boundingBox,
  };
}

/**
 * Convert a centerline (two points) to a rectangular hallway polygon.
 *
 * The rectangle is created by offsetting perpendicular to the line direction
 * by half the width on each side.
 *
 * @param start - Start point of the centerline
 * @param end - End point of the centerline
 * @param width - Width of the hallway
 * @param id - Optional ID for the hallway (default: auto-generated)
 * @param fromRoom - ID of room at start point
 * @param toRoom - ID of room at end point
 * @returns HallwayPolygon with 4 vertices
 */
export function centerlineToPolygon(
  start: Point2D,
  end: Point2D,
  width: number,
  id?: string,
  fromRoom?: string,
  toRoom?: string
): HallwayPolygon {
  const halfWidth = width / 2;

  // Calculate direction vector
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.sqrt(dx * dx + dy * dy);

  // Handle degenerate case (very short hallway)
  if (length < EPSILON) {
    // Create a small square centered at start
    const p1: Point2D = [start[0] - halfWidth, start[1] - halfWidth];
    const p2: Point2D = [start[0] + halfWidth, start[1] - halfWidth];
    const p3: Point2D = [start[0] + halfWidth, start[1] + halfWidth];
    const p4: Point2D = [start[0] - halfWidth, start[1] + halfWidth];

    return {
      id: id || `hallway-${Date.now()}`,
      vertices: [p1, p2, p3, p4],
      width,
      length: 0,
      centerline: { start, end },
      connectsRooms: [fromRoom || '', toRoom || ''],
    };
  }

  // Normalize direction vector
  const nx = dx / length;
  const ny = dy / length;

  // Perpendicular vector (rotated 90 degrees counter-clockwise)
  // This gives us the direction to offset for the hallway edges
  const px = -ny;
  const py = nx;

  // Create the 4 corners of the rectangle
  // Counter-clockwise winding: start-left, end-left, end-right, start-right
  const p1: Point2D = [start[0] + px * halfWidth, start[1] + py * halfWidth];
  const p2: Point2D = [end[0] + px * halfWidth, end[1] + py * halfWidth];
  const p3: Point2D = [end[0] - px * halfWidth, end[1] - py * halfWidth];
  const p4: Point2D = [start[0] - px * halfWidth, start[1] - py * halfWidth];

  return {
    id: id || `hallway-${Date.now()}`,
    vertices: [p1, p2, p3, p4],
    width,
    length,
    centerline: { start, end },
    connectsRooms: [fromRoom || '', toRoom || ''],
  };
}

/**
 * Create a junction polygon where multiple hallways meet.
 *
 * Junctions are typically square or octagonal shapes at intersection points
 * that connect the ends of multiple hallway segments smoothly.
 *
 * @param junctionPoint - Center point of the junction
 * @param connectedHallways - Array of hallways meeting at this junction
 * @param junctionSize - Size of the junction (usually 1.2x hallway width)
 * @returns JunctionPolygon with appropriate vertices
 */
export function createJunctionPolygon(
  junctionPoint: Point2D,
  connectedHallways: HallwayPolygon[],
  junctionSize: number
): JunctionPolygon {
  const halfSize = junctionSize / 2;
  const numConnections = connectedHallways.length;

  // Generate junction ID from connected hallway IDs
  const id = `junction-${connectedHallways.map(h => h.id).join('-')}`;

  // For 2 or fewer connections, use a simple square junction
  if (numConnections <= 2) {
    const vertices: Point2D[] = [
      [junctionPoint[0] - halfSize, junctionPoint[1] - halfSize],
      [junctionPoint[0] + halfSize, junctionPoint[1] - halfSize],
      [junctionPoint[0] + halfSize, junctionPoint[1] + halfSize],
      [junctionPoint[0] - halfSize, junctionPoint[1] + halfSize],
    ];

    return {
      id,
      vertices,
      connectedHallways: connectedHallways.map(h => h.id),
    };
  }

  // For 3+ connections (T-junction or 4-way), calculate directions and create polygon
  // Get the approach directions of each connected hallway
  const directions: number[] = connectedHallways.map(hallway => {
    // Calculate direction from junction to hallway
    const center = getHallwayCenterPoint(hallway);
    const dx = center[0] - junctionPoint[0];
    const dy = center[1] - junctionPoint[1];
    return Math.atan2(dy, dx);
  });

  // Sort directions to create ordered vertices
  directions.sort((a, b) => a - b);

  // Create octagonal or polygonal junction based on number of connections
  const vertices: Point2D[] = [];
  const numVertices = numConnections * 2; // Two vertices per approach direction

  for (let i = 0; i < numVertices; i++) {
    const angle = (i * 2 * Math.PI) / numVertices - Math.PI / numVertices;
    const x = junctionPoint[0] + halfSize * Math.cos(angle);
    const y = junctionPoint[1] + halfSize * Math.sin(angle);
    vertices.push([x, y]);
  }

  return {
    id,
    vertices,
    connectedHallways: connectedHallways.map(h => h.id),
  };
}

/**
 * Check if a hallway polygon overlaps with a room.
 *
 * Uses separating axis theorem (SAT) for rectangle-rectangle intersection.
 *
 * @param hallway - The hallway polygon to check
 * @param room - The room bounds to check against
 * @returns true if the hallway overlaps with the room interior
 */
export function hallwayOverlapsRoom(
  hallway: HallwayPolygon,
  room: RoomBounds
): boolean {
  // Convert room bounds to polygon vertices
  const roomVertices: Point2D[] = [
    [room.x, room.y],
    [room.x + room.width, room.y],
    [room.x + room.width, room.y + room.depth],
    [room.x, room.y + room.depth],
  ];

  // Use SAT for convex polygon intersection
  return polygonsOverlap(hallway.vertices, roomVertices);
}

/**
 * Validate that all spine geometry is within the building footprint.
 *
 * Checks that no hallway or junction extends beyond the footprint boundaries.
 *
 * @param geometry - The spine geometry to validate
 * @param footprint - Building footprint dimensions
 * @returns ValidationResult with violations if any
 */
export function validateGeometryWithinFootprint(
  geometry: SpineGeometry,
  footprint: { width: number; depth: number }
): ValidationResult {
  const violations: string[] = [];

  // Check each hallway
  for (const hallway of geometry.hallways) {
    for (const vertex of hallway.vertices) {
      if (vertex[0] < 0) {
        violations.push(`Hallway ${hallway.id} extends ${Math.abs(vertex[0]).toFixed(2)}' west of footprint`);
      }
      if (vertex[0] > footprint.width) {
        violations.push(`Hallway ${hallway.id} extends ${(vertex[0] - footprint.width).toFixed(2)}' east of footprint`);
      }
      if (vertex[1] < 0) {
        violations.push(`Hallway ${hallway.id} extends ${Math.abs(vertex[1]).toFixed(2)}' south of footprint`);
      }
      if (vertex[1] > footprint.depth) {
        violations.push(`Hallway ${hallway.id} extends ${(vertex[1] - footprint.depth).toFixed(2)}' north of footprint`);
      }
    }
  }

  // Check each junction
  for (const junction of geometry.junctions) {
    for (const vertex of junction.vertices) {
      if (vertex[0] < 0 || vertex[0] > footprint.width ||
          vertex[1] < 0 || vertex[1] > footprint.depth) {
        violations.push(`Junction ${junction.id} extends beyond footprint`);
        break; // Only report once per junction
      }
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ============================================================================
// Geometry Math Helpers
// ============================================================================

/**
 * Calculate the area of a polygon using the shoelace formula.
 *
 * @param vertices - Polygon vertices in order (clockwise or counter-clockwise)
 * @returns Area in square units
 */
export function calculatePolygonArea(vertices: Point2D[]): number {
  if (vertices.length < 3) return 0;

  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    area += vertices[i][0] * vertices[j][1];
    area -= vertices[j][0] * vertices[i][1];
  }

  return Math.abs(area / 2);
}

/**
 * Check if a point is inside a polygon using ray casting algorithm.
 *
 * @param point - The point to test
 * @param polygon - Array of polygon vertices
 * @returns true if point is inside the polygon
 */
export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;

  let inside = false;
  const [x, y] = point;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    if (((yi > y) !== (yj > y)) &&
        (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Check if two convex polygons overlap using the Separating Axis Theorem.
 *
 * @param poly1 - First polygon vertices
 * @param poly2 - Second polygon vertices
 * @returns true if polygons overlap
 */
export function polygonsOverlap(poly1: Point2D[], poly2: Point2D[]): boolean {
  // Get all edges to test as separating axes
  const axes: Point2D[] = [];

  // Get axes from polygon 1
  for (let i = 0; i < poly1.length; i++) {
    const j = (i + 1) % poly1.length;
    const edge: Point2D = [poly1[j][0] - poly1[i][0], poly1[j][1] - poly1[i][1]];
    // Perpendicular axis
    axes.push([-edge[1], edge[0]]);
  }

  // Get axes from polygon 2
  for (let i = 0; i < poly2.length; i++) {
    const j = (i + 1) % poly2.length;
    const edge: Point2D = [poly2[j][0] - poly2[i][0], poly2[j][1] - poly2[i][1]];
    axes.push([-edge[1], edge[0]]);
  }

  // Test each axis
  for (const axis of axes) {
    const [min1, max1] = projectPolygon(poly1, axis);
    const [min2, max2] = projectPolygon(poly2, axis);

    // Check for gap between projections
    if (max1 < min2 || max2 < min1) {
      return false; // Separating axis found - polygons don't overlap
    }
  }

  return true; // No separating axis found - polygons overlap
}

/**
 * Project a polygon onto an axis and return min/max values.
 *
 * @param polygon - Polygon vertices
 * @param axis - Axis to project onto
 * @returns [min, max] projection values
 */
function projectPolygon(polygon: Point2D[], axis: Point2D): [number, number] {
  let min = dotProduct(polygon[0], axis);
  let max = min;

  for (let i = 1; i < polygon.length; i++) {
    const projection = dotProduct(polygon[i], axis);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }

  return [min, max];
}

/**
 * Calculate dot product of two 2D vectors.
 */
function dotProduct(v1: Point2D, v2: Point2D): number {
  return v1[0] * v2[0] + v1[1] * v2[1];
}

/**
 * Calculate the distance between two points.
 */
export function distance(p1: Point2D, p2: Point2D): number {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate the angle of a line segment from start to end (in radians).
 */
export function lineAngle(start: Point2D, end: Point2D): number {
  return Math.atan2(end[1] - start[1], end[0] - start[0]);
}

/**
 * Get the center point of a hallway polygon.
 */
function getHallwayCenterPoint(hallway: HallwayPolygon): Point2D {
  const sumX = hallway.vertices.reduce((s, v) => s + v[0], 0);
  const sumY = hallway.vertices.reduce((s, v) => s + v[1], 0);
  return [sumX / 4, sumY / 4];
}

// ============================================================================
// Junction Creation Helpers
// ============================================================================

/**
 * Create junctions from network data where multiple hallways meet.
 *
 * @param network - The hallway network
 * @param hallways - Already created hallway polygons
 * @param hallwayWidth - Width for sizing junctions
 * @returns Array of junction polygons
 */
function createJunctionsFromNetwork(
  network: HallwayNetwork,
  hallways: HallwayPolygon[],
  hallwayWidth: number
): JunctionPolygon[] {
  const junctions: JunctionPolygon[] = [];

  // Use the junction points identified in the network
  for (let i = 0; i < network.junctions.length; i++) {
    const junctionPoint = network.junctions[i];

    // Find all hallways that connect to this junction point
    const connectedHallways = hallways.filter(hallway => {
      const startDist = distance(hallway.centerline.start, junctionPoint);
      const endDist = distance(hallway.centerline.end, junctionPoint);
      return startDist < hallwayWidth * 2 || endDist < hallwayWidth * 2;
    });

    if (connectedHallways.length >= 2) {
      const junctionSize = hallwayWidth * JUNCTION_SIZE_MULTIPLIER;
      junctions.push(
        createJunctionPolygon(junctionPoint, connectedHallways, junctionSize)
      );
    }
  }

  return junctions;
}

/**
 * Convert a bedroom corridor specification to a hallway polygon.
 *
 * Bedroom corridors are generated by the bedroom-cluster module and represent
 * shared hallways that provide access to multiple bedrooms. This function
 * converts the corridor specification (centerline-based) to a renderable polygon.
 *
 * @param corridor - The corridor specification from bedroom cluster detection
 * @param defaultWidth - Default width if corridor doesn't specify one
 * @returns HallwayPolygon or null if corridor is too short
 */
function corridorToHallwayPolygon(
  corridor: CorridorSpec,
  defaultWidth: number
): HallwayPolygon | null {
  const width = corridor.width || defaultWidth;
  const length = corridor.length;

  // Skip degenerate corridors
  if (length < 0.5) return null;

  // Use the centerline-to-polygon conversion
  // Collect all room IDs that this corridor connects
  const connectedRoomIds = corridor.doors.map(d => d.roomId);

  // Create the polygon using the existing helper
  const polygon = centerlineToPolygon(
    corridor.startPoint,
    corridor.endPoint,
    width,
    corridor.id,
    connectedRoomIds[0] || 'corridor-start',
    connectedRoomIds[connectedRoomIds.length - 1] || 'corridor-end'
  );

  return polygon;
}

/**
 * Calculate the bounding box containing all geometry.
 */
function calculateBoundingBox(
  hallways: HallwayPolygon[],
  junctions: JunctionPolygon[]
): { x: number; y: number; width: number; height: number } {
  if (hallways.length === 0 && junctions.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // Check all hallway vertices
  for (const hallway of hallways) {
    for (const [x, y] of hallway.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  // Check all junction vertices
  for (const junction of junctions) {
    for (const [x, y] of junction.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Calculate the bounding box containing hallways, junctions, and traffic paths.
 */
function calculateBoundingBoxWithTrafficPaths(
  hallways: HallwayPolygon[],
  junctions: JunctionPolygon[],
  trafficPaths: TrafficPathGeometry[]
): { x: number; y: number; width: number; height: number } {
  if (hallways.length === 0 && junctions.length === 0 && trafficPaths.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  // Check all hallway vertices
  for (const hallway of hallways) {
    for (const [x, y] of hallway.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  // Check all junction vertices
  for (const junction of junctions) {
    for (const [x, y] of junction.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  // Check all traffic path vertices
  for (const trafficPath of trafficPaths) {
    for (const [x, y] of trafficPath.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Calculate the bounding box for traffic paths only (when no hallways/junctions).
 */
function calculateTrafficPathBoundingBox(
  trafficPaths: TrafficPathGeometry[]
): { x: number; y: number; width: number; height: number } {
  if (trafficPaths.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const trafficPath of trafficPaths) {
    for (const [x, y] of trafficPath.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// ============================================================================
// Advanced Geometry Operations
// ============================================================================

/**
 * Extend a hallway polygon at one or both ends.
 *
 * Useful for ensuring hallways connect properly to rooms or other hallways.
 *
 * @param hallway - The hallway to extend
 * @param startExtension - How much to extend at the start (negative to shrink)
 * @param endExtension - How much to extend at the end (negative to shrink)
 * @returns New hallway polygon with extended length
 */
export function extendHallway(
  hallway: HallwayPolygon,
  startExtension: number = 0,
  endExtension: number = 0
): HallwayPolygon {
  const { start, end } = hallway.centerline;

  // Calculate direction
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.sqrt(dx * dx + dy * dy);

  if (length < EPSILON) {
    return hallway; // Can't extend a zero-length hallway
  }

  // Normalize direction
  const nx = dx / length;
  const ny = dy / length;

  // Calculate new endpoints
  const newStart: Point2D = [
    start[0] - nx * startExtension,
    start[1] - ny * startExtension,
  ];
  const newEnd: Point2D = [
    end[0] + nx * endExtension,
    end[1] + ny * endExtension,
  ];

  // Create new polygon
  return centerlineToPolygon(
    newStart,
    newEnd,
    hallway.width,
    hallway.id,
    hallway.connectsRooms[0],
    hallway.connectsRooms[1]
  );
}

/**
 * Clip a hallway polygon to stay within a boundary rectangle.
 *
 * @param hallway - The hallway to clip
 * @param bounds - Boundary rectangle {x, y, width, height}
 * @returns Clipped hallway polygon (may have more than 4 vertices if clipped diagonally)
 */
export function clipHallwayToBounds(
  hallway: HallwayPolygon,
  bounds: { x: number; y: number; width: number; height: number }
): HallwayPolygon {
  // Use Sutherland-Hodgman algorithm for polygon clipping
  const boundaryPolygon: Point2D[] = [
    [bounds.x, bounds.y],
    [bounds.x + bounds.width, bounds.y],
    [bounds.x + bounds.width, bounds.y + bounds.height],
    [bounds.x, bounds.y + bounds.height],
  ];

  const clippedVertices = sutherlandHodgmanClip(hallway.vertices, boundaryPolygon);

  if (clippedVertices.length < 3) {
    // Hallway is completely outside bounds
    return {
      ...hallway,
      vertices: [[0, 0], [0, 0], [0, 0], [0, 0]],
      length: 0,
    };
  }

  // Ensure we have exactly 4 vertices (take first 4 if clipping created more)
  const finalVertices = clippedVertices.slice(0, 4);
  while (finalVertices.length < 4) {
    finalVertices.push(finalVertices[finalVertices.length - 1]);
  }

  return {
    ...hallway,
    vertices: finalVertices as [Point2D, Point2D, Point2D, Point2D],
    length: calculateClippedLength(finalVertices),
  };
}

/**
 * Sutherland-Hodgman polygon clipping algorithm.
 */
function sutherlandHodgmanClip(
  subjectPolygon: Point2D[],
  clipPolygon: Point2D[]
): Point2D[] {
  let outputList = [...subjectPolygon];

  for (let i = 0; i < clipPolygon.length; i++) {
    if (outputList.length === 0) break;

    const inputList = outputList;
    outputList = [];

    const edgeStart = clipPolygon[i];
    const edgeEnd = clipPolygon[(i + 1) % clipPolygon.length];

    for (let j = 0; j < inputList.length; j++) {
      const current = inputList[j];
      const previous = inputList[(j + inputList.length - 1) % inputList.length];

      const currentInside = isLeftOfLine(current, edgeStart, edgeEnd);
      const previousInside = isLeftOfLine(previous, edgeStart, edgeEnd);

      if (currentInside) {
        if (!previousInside) {
          const intersection = lineIntersection(previous, current, edgeStart, edgeEnd);
          if (intersection) outputList.push(intersection);
        }
        outputList.push(current);
      } else if (previousInside) {
        const intersection = lineIntersection(previous, current, edgeStart, edgeEnd);
        if (intersection) outputList.push(intersection);
      }
    }
  }

  return outputList;
}

/**
 * Check if a point is to the left of a line (or on it).
 */
function isLeftOfLine(point: Point2D, lineStart: Point2D, lineEnd: Point2D): boolean {
  return (lineEnd[0] - lineStart[0]) * (point[1] - lineStart[1]) -
         (lineEnd[1] - lineStart[1]) * (point[0] - lineStart[0]) >= 0;
}

/**
 * Find intersection point of two line segments.
 */
function lineIntersection(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  p4: Point2D
): Point2D | null {
  const d1x = p2[0] - p1[0];
  const d1y = p2[1] - p1[1];
  const d2x = p4[0] - p3[0];
  const d2y = p4[1] - p3[1];

  const cross = d1x * d2y - d1y * d2x;

  if (Math.abs(cross) < EPSILON) {
    return null; // Lines are parallel
  }

  const t = ((p3[0] - p1[0]) * d2y - (p3[1] - p1[1]) * d2x) / cross;

  return [
    p1[0] + t * d1x,
    p1[1] + t * d1y,
  ];
}

/**
 * Calculate the approximate length of a clipped polygon.
 */
function calculateClippedLength(vertices: Point2D[]): number {
  if (vertices.length < 2) return 0;

  // Find the two longest parallel edges (these are the length edges)
  let maxLength = 0;
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length;
    const edgeLength = distance(vertices[i], vertices[j]);
    maxLength = Math.max(maxLength, edgeLength);
  }

  return maxLength;
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Check if a hallway is too short to be useful.
 *
 * @param hallway - The hallway to check
 * @param minLength - Minimum acceptable length (default 3')
 * @returns true if hallway is too short
 */
export function isHallwayTooShort(
  hallway: HallwayPolygon,
  minLength: number = MIN_HALLWAY_LENGTH
): boolean {
  return hallway.length < minLength;
}

/**
 * Check if a hallway is at a non-orthogonal angle (45 degrees, etc.).
 *
 * @param hallway - The hallway to check
 * @param tolerance - Angle tolerance in radians (default ~5 degrees)
 * @returns true if hallway is diagonal (not axis-aligned)
 */
export function isHallwayDiagonal(
  hallway: HallwayPolygon,
  tolerance: number = 0.1
): boolean {
  const angle = lineAngle(hallway.centerline.start, hallway.centerline.end);
  const normalizedAngle = Math.abs(angle % (Math.PI / 2));

  // Check if close to 0, 90, 180, or 270 degrees
  const isAxisAligned = normalizedAngle < tolerance ||
                        normalizedAngle > (Math.PI / 2 - tolerance);

  return !isAxisAligned;
}

/**
 * Validate all hallways in a spine geometry.
 *
 * @param geometry - The spine geometry to validate
 * @param rooms - Array of rooms to check for overlaps
 * @param footprint - Building footprint for boundary checks
 * @returns Comprehensive validation result
 */
export function validateSpineGeometry(
  geometry: SpineGeometry,
  rooms: RoomBounds[],
  footprint: { width: number; depth: number }
): ValidationResult {
  const violations: string[] = [];

  // 1. Check footprint boundaries
  const boundaryResult = validateGeometryWithinFootprint(geometry, footprint);
  violations.push(...boundaryResult.violations);

  // 2. Check for room overlaps
  for (const hallway of geometry.hallways) {
    for (const room of rooms) {
      if (hallwayOverlapsRoom(hallway, room)) {
        violations.push(`Hallway ${hallway.id} overlaps with room "${room.name}"`);
      }
    }
  }

  // 3. Check for very short hallways (possible errors)
  for (const hallway of geometry.hallways) {
    if (isHallwayTooShort(hallway)) {
      violations.push(`Hallway ${hallway.id} is very short (${hallway.length.toFixed(1)}')`);
    }
  }

  // 4. Check for diagonal hallways (may need special handling)
  for (const hallway of geometry.hallways) {
    if (isHallwayDiagonal(hallway)) {
      // This is a warning, not necessarily an error
      violations.push(`Hallway ${hallway.id} is at a diagonal angle (may need review)`);
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert spine geometry to a flat array of all polygon vertices for rendering.
 *
 * @param geometry - The spine geometry
 * @returns Array of all polygons (hallways, junctions, and traffic paths)
 */
export function geometryToPolygons(
  geometry: SpineGeometry
): Array<{ id: string; type: 'hallway' | 'junction' | 'traffic_path'; vertices: Point2D[]; pathType?: string }> {
  const polygons: Array<{ id: string; type: 'hallway' | 'junction' | 'traffic_path'; vertices: Point2D[]; pathType?: string }> = [];

  for (const hallway of geometry.hallways) {
    polygons.push({
      id: hallway.id,
      type: 'hallway',
      vertices: [...hallway.vertices],
    });
  }

  for (const junction of geometry.junctions) {
    polygons.push({
      id: junction.id,
      type: 'junction',
      vertices: [...junction.vertices],
    });
  }

  for (const trafficPath of geometry.trafficPaths) {
    polygons.push({
      id: trafficPath.id,
      type: 'traffic_path',
      vertices: [...trafficPath.vertices],
      pathType: trafficPath.pathType,
    });
  }

  return polygons;
}

/**
 * Generate a human-readable summary of the spine geometry.
 *
 * @param geometry - The spine geometry to summarize
 * @returns Multi-line summary string
 */
export function getGeometrySummary(geometry: SpineGeometry): string {
  const lines: string[] = [
    'Spine Geometry Summary:',
    `  Hallways: ${geometry.hallways.length}`,
    `  Junctions: ${geometry.junctions.length}`,
    `  Traffic Paths: ${geometry.trafficPaths.length}`,
    `  Walled Circulation Area: ${geometry.totalArea.toFixed(1)} sq ft`,
    `  Traffic Path Area: ${geometry.trafficPathArea.toFixed(1)} sq ft`,
    `  Bounding Box: ${geometry.boundingBox.width.toFixed(1)}' x ${geometry.boundingBox.height.toFixed(1)}'`,
    '',
  ];

  if (geometry.hallways.length > 0) {
    lines.push('Hallway Details:');
    for (const hallway of geometry.hallways) {
      lines.push(
        `  - ${hallway.id}: ${hallway.length.toFixed(1)}' x ${hallway.width}' ` +
        `(${hallway.connectsRooms[0]} -> ${hallway.connectsRooms[1]})`
      );
    }
  }

  if (geometry.junctions.length > 0) {
    lines.push('');
    lines.push('Junction Details:');
    for (const junction of geometry.junctions) {
      lines.push(
        `  - ${junction.id}: ${junction.connectedHallways.length}-way intersection`
      );
    }
  }

  if (geometry.trafficPaths.length > 0) {
    lines.push('');
    lines.push('Traffic Path Details:');
    for (const trafficPath of geometry.trafficPaths) {
      const blockingLabel = trafficPath.blocksFurniture ? ' [blocks furniture]' : '';
      lines.push(
        `  - ${trafficPath.id}: ${trafficPath.pathType} (${trafficPath.area.toFixed(1)} sq ft)${blockingLabel}`
      );
    }
  }

  return lines.join('\n');
}
