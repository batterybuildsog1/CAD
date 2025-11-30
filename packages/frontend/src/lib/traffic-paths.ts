/**
 * Traffic Path System for Open Floor Plans
 *
 * In open floor plans (living/kitchen/dining combined), there's no walled
 * hallway between rooms, but there IS circulation space:
 * - Traffic lanes from front door through house
 * - Kitchen work triangle clearance
 * - Furniture clearance zones
 *
 * These "traffic paths" are NOT walled hallways but ARE circulation space
 * that counts toward the circulation budget and affects furniture placement.
 *
 * Key Distinction:
 * - Hallway: Walled corridor, subtracts from total footprint
 * - Traffic Path: Overlay zone within open room, affects usable furniture area
 */

import type { Point2D, RoomType } from './gemini-types';
import type { RoomBounds } from './circulation-spine';

// ============================================================================
// Types
// ============================================================================

/**
 * A traffic path within an open floor plan area
 */
export interface TrafficPath {
  /** Unique identifier */
  id: string;

  /** Type of traffic path */
  pathType: TrafficPathType;

  /** The open plan zone this path belongs to */
  parentZoneId: string;

  /** Polygon vertices defining the traffic path area */
  vertices: Point2D[];

  /** Typical width of the path in feet */
  width: number;

  /** Length of the path in feet */
  length: number;

  /** Area in square feet */
  area: number;

  /** Entry/exit points this path connects */
  connects: PathConnection[];

  /** Whether furniture placement should be blocked in this zone */
  blocksFurniture: boolean;

  /** Priority for path routing (higher = more important) */
  priority: 'primary' | 'secondary' | 'tertiary';
}

/**
 * Type of traffic path
 */
export type TrafficPathType =
  | 'primary_circulation'    // Main path through house (front to back)
  | 'secondary_circulation'  // Secondary paths (to bedrooms, etc.)
  | 'kitchen_work_zone'      // Work triangle and appliance clearance
  | 'furniture_clearance'    // Space around furniture for access
  | 'entry_zone';            // Front door landing/transition

/**
 * Connection point for a traffic path
 */
export interface PathConnection {
  /** Type of connection */
  type: 'door' | 'opening' | 'hallway_entrance' | 'room_boundary';

  /** Position of the connection */
  point: Point2D;

  /** ID of what this connects to */
  targetId: string;

  /** Importance of this connection */
  importance: 'primary' | 'secondary';
}

/**
 * A cluster of rooms forming an open floor plan
 */
export interface OpenPlanCluster {
  /** Unique identifier */
  id: string;

  /** Rooms in this open plan cluster */
  rooms: OpenPlanRoom[];

  /** Combined bounding box */
  combinedBounds: ClusterBounds;

  /** Entry points into/out of this cluster */
  entryPoints: PathConnection[];

  /** Total area of the cluster */
  totalArea: number;

  /** Traffic paths within this cluster */
  trafficPaths: TrafficPath[];
}

/**
 * A room within an open plan cluster
 */
export interface OpenPlanRoom {
  /** Room identifier */
  id: string;

  /** Room type */
  type: RoomType;

  /** Room bounds */
  bounds: RoomBounds;

  /** Functional zone within the open plan */
  zone: 'cooking' | 'eating' | 'living' | 'transition';
}

/**
 * Bounding box for a cluster
 */
interface ClusterBounds {
  x: number;
  y: number;
  width: number;
  depth: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Room types that can form open floor plans */
const OPEN_PLAN_TYPES: RoomType[] = [
  'living', 'kitchen', 'dining', 'family', 'great_room',
];

/** Standard traffic path width */
const DEFAULT_PATH_WIDTH = 3.5; // feet

/** Kitchen work zone depth (distance from cabinets) */
const KITCHEN_WORK_DEPTH = 4.0; // feet (42" minimum per NKBA)

/** Minimum furniture clearance width */
const FURNITURE_CLEARANCE = 3.0; // feet

/** Entry zone depth from door */
const ENTRY_ZONE_DEPTH = 4.0; // feet

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Detect open floor plan clusters in a set of rooms.
 *
 * An open plan cluster is formed when:
 * 1. Rooms are geometrically adjacent
 * 2. Room types are compatible (all public/living spaces)
 * 3. Connected via openings (not doors)
 *
 * @param rooms - All rooms in the floor plan
 * @returns Array of open plan clusters
 */
export function detectOpenPlanClusters(rooms: RoomBounds[]): OpenPlanCluster[] {
  // Filter to open plan compatible rooms
  const openRooms = rooms.filter(r => OPEN_PLAN_TYPES.includes(r.type));

  if (openRooms.length < 2) {
    return []; // Need at least 2 rooms for open plan
  }

  // Build adjacency graph
  const adjacencyGraph = buildOpenPlanAdjacencyGraph(openRooms);

  // Find connected components
  const clusterGroups = findConnectedComponents(openRooms, adjacencyGraph);

  // Convert to OpenPlanCluster
  const clusters: OpenPlanCluster[] = [];
  let clusterId = 0;

  for (const group of clusterGroups) {
    if (group.length < 2) continue; // Single room isn't a cluster

    const openPlanRooms: OpenPlanRoom[] = group.map(room => ({
      id: room.name,
      type: room.type,
      bounds: room,
      zone: inferZone(room.type),
    }));

    const combinedBounds = calculateBounds(group);
    const totalArea = group.reduce((sum, r) => sum + r.width * r.depth, 0);

    // Find entry points (connections to non-open-plan rooms)
    const entryPoints = findClusterEntryPoints(group, rooms);

    // Generate traffic paths for this cluster
    const trafficPaths = generateClusterTrafficPaths(
      openPlanRooms,
      combinedBounds,
      entryPoints
    );

    clusters.push({
      id: `open-plan-${clusterId++}`,
      rooms: openPlanRooms,
      combinedBounds,
      entryPoints,
      totalArea,
      trafficPaths,
    });
  }

  return clusters;
}

/**
 * Generate primary traffic path through an open plan cluster.
 *
 * The primary traffic path connects the main entry to the main exit,
 * typically front door → back of house or → private zone.
 *
 * @param cluster - Open plan cluster
 * @returns Primary traffic path
 */
export function generatePrimaryTrafficPath(
  cluster: OpenPlanCluster
): TrafficPath | null {
  const { combinedBounds, entryPoints, id } = cluster;

  // Find primary entry (main door, foyer connection)
  const primaryEntry = entryPoints.find(e => e.importance === 'primary');
  if (!primaryEntry) return null;

  // Find primary exit (bedroom hallway, back door)
  const primaryExit = entryPoints.find(e =>
    e.importance === 'secondary' && e.targetId !== primaryEntry.targetId
  );

  if (!primaryExit) {
    // No distinct exit, create path to opposite side of cluster
    const exitPoint: Point2D = [
      primaryEntry.point[0] > combinedBounds.x + combinedBounds.width / 2
        ? combinedBounds.x
        : combinedBounds.x + combinedBounds.width,
      combinedBounds.y + combinedBounds.depth / 2,
    ];

    return createTrafficPath(
      `${id}-primary`,
      'primary_circulation',
      id,
      primaryEntry.point,
      exitPoint,
      DEFAULT_PATH_WIDTH,
      [primaryEntry],
      'primary'
    );
  }

  return createTrafficPath(
    `${id}-primary`,
    'primary_circulation',
    id,
    primaryEntry.point,
    primaryExit.point,
    DEFAULT_PATH_WIDTH,
    [primaryEntry, primaryExit],
    'primary'
  );
}

/**
 * Generate kitchen work zone traffic path.
 *
 * The kitchen work zone includes:
 * - Work triangle clearance
 * - Appliance front clearance (42" minimum)
 * - Island circulation (if present)
 *
 * @param kitchen - Kitchen room bounds
 * @param hasIsland - Whether there's an island
 * @returns Kitchen work zone traffic path
 */
export function generateKitchenWorkZone(
  kitchen: RoomBounds,
  hasIsland: boolean = false
): TrafficPath {
  // Work zone is typically along the back wall (appliances)
  // with circulation in front

  const workZoneWidth = kitchen.width * 0.7; // 70% of kitchen width
  const workZoneDepth = hasIsland ? KITCHEN_WORK_DEPTH * 2 : KITCHEN_WORK_DEPTH;

  // Center the work zone
  const startX = kitchen.x + (kitchen.width - workZoneWidth) / 2;
  const startY = kitchen.y; // Against "back" wall

  const vertices: Point2D[] = [
    [startX, startY],
    [startX + workZoneWidth, startY],
    [startX + workZoneWidth, startY + workZoneDepth],
    [startX, startY + workZoneDepth],
  ];

  return {
    id: `${kitchen.name}-work-zone`,
    pathType: 'kitchen_work_zone',
    parentZoneId: kitchen.name,
    vertices,
    width: workZoneDepth,
    length: workZoneWidth,
    area: workZoneWidth * workZoneDepth,
    connects: [],
    blocksFurniture: true,
    priority: 'primary',
  };
}

/**
 * Generate entry zone traffic path.
 *
 * The entry zone is the landing area just inside a door,
 * where people pause to remove shoes, hang coats, etc.
 *
 * @param doorPosition - Position of the door
 * @param doorWidth - Width of the door
 * @param parentZoneId - ID of the room containing the entry
 * @returns Entry zone traffic path
 */
export function generateEntryZone(
  doorPosition: Point2D,
  doorWidth: number,
  parentZoneId: string
): TrafficPath {
  // Entry zone extends inward from door
  const zoneWidth = Math.max(doorWidth * 1.5, 4.0);
  const zoneDepth = ENTRY_ZONE_DEPTH;

  // Center on door
  const startX = doorPosition[0] - zoneWidth / 2;
  const startY = doorPosition[1];

  const vertices: Point2D[] = [
    [startX, startY],
    [startX + zoneWidth, startY],
    [startX + zoneWidth, startY + zoneDepth],
    [startX, startY + zoneDepth],
  ];

  return {
    id: `entry-zone-${parentZoneId}`,
    pathType: 'entry_zone',
    parentZoneId,
    vertices,
    width: zoneDepth,
    length: zoneWidth,
    area: zoneWidth * zoneDepth,
    connects: [{
      type: 'door',
      point: doorPosition,
      targetId: 'exterior',
      importance: 'primary',
    }],
    blocksFurniture: true,
    priority: 'primary',
  };
}

/**
 * Calculate total traffic path area for an open plan cluster.
 *
 * Note: Paths may overlap, so we use polygon union for accurate area.
 * For simplicity, this version uses bounding box intersection detection.
 *
 * @param paths - Array of traffic paths
 * @returns Total area accounting for overlaps
 */
export function calculateTrafficPathArea(paths: TrafficPath[]): number {
  if (paths.length === 0) return 0;

  // Simple approach: sum areas and estimate overlap reduction
  const totalNaive = paths.reduce((sum, p) => sum + p.area, 0);

  // Estimate overlap (conservative: assume 20% overlap for multiple paths)
  const overlapFactor = paths.length > 1 ? 0.8 : 1.0;

  return totalNaive * overlapFactor;
}

/**
 * Check if a point is within any traffic path.
 *
 * Useful for furniture placement validation.
 *
 * @param point - Point to check
 * @param paths - Array of traffic paths
 * @returns Traffic path containing the point, or null
 */
export function pointInTrafficPath(
  point: Point2D,
  paths: TrafficPath[]
): TrafficPath | null {
  for (const path of paths) {
    if (pointInPolygon(point, path.vertices)) {
      return path;
    }
  }
  return null;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build adjacency graph for open plan rooms
 */
function buildOpenPlanAdjacencyGraph(
  rooms: RoomBounds[]
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  for (const room of rooms) {
    graph.set(room.name, new Set());
  }

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (areRoomsAdjacent(rooms[i], rooms[j])) {
        graph.get(rooms[i].name)?.add(rooms[j].name);
        graph.get(rooms[j].name)?.add(rooms[i].name);
      }
    }
  }

  return graph;
}

/**
 * Find connected components using BFS
 */
function findConnectedComponents(
  rooms: RoomBounds[],
  graph: Map<string, Set<string>>
): RoomBounds[][] {
  const visited = new Set<string>();
  const components: RoomBounds[][] = [];

  for (const room of rooms) {
    if (visited.has(room.name)) continue;

    const component: RoomBounds[] = [];
    const queue = [room];
    visited.add(room.name);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      const neighbors = graph.get(current.name) || new Set();
      for (const neighborName of neighbors) {
        if (!visited.has(neighborName)) {
          visited.add(neighborName);
          const neighbor = rooms.find(r => r.name === neighborName);
          if (neighbor) queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  return components;
}

/**
 * Calculate bounding box for a group of rooms
 */
function calculateBounds(rooms: RoomBounds[]): ClusterBounds {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const room of rooms) {
    minX = Math.min(minX, room.x);
    minY = Math.min(minY, room.y);
    maxX = Math.max(maxX, room.x + room.width);
    maxY = Math.max(maxY, room.y + room.depth);
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    depth: maxY - minY,
  };
}

/**
 * Find entry points into/out of an open plan cluster
 */
function findClusterEntryPoints(
  clusterRooms: RoomBounds[],
  allRooms: RoomBounds[]
): PathConnection[] {
  const entries: PathConnection[] = [];

  // Find rooms adjacent to cluster that aren't part of it
  const clusterNames = new Set(clusterRooms.map(r => r.name));

  for (const clusterRoom of clusterRooms) {
    for (const otherRoom of allRooms) {
      if (clusterNames.has(otherRoom.name)) continue;

      if (areRoomsAdjacent(clusterRoom, otherRoom)) {
        // Connection to non-cluster room
        const connectionPoint = findSharedWallCenter(clusterRoom, otherRoom);

        // Determine importance based on what it connects to
        const importance: 'primary' | 'secondary' =
          otherRoom.type === 'foyer' || otherRoom.type === 'hallway'
            ? 'primary'
            : 'secondary';

        entries.push({
          type: otherRoom.type === 'hallway' ? 'hallway_entrance' : 'opening',
          point: connectionPoint,
          targetId: otherRoom.name,
          importance,
        });
      }
    }
  }

  return entries;
}

/**
 * Generate all traffic paths for a cluster
 */
function generateClusterTrafficPaths(
  rooms: OpenPlanRoom[],
  bounds: ClusterBounds,
  entryPoints: PathConnection[]
): TrafficPath[] {
  const paths: TrafficPath[] = [];

  // Primary traffic path (if we have entry points)
  if (entryPoints.length >= 2) {
    const primary = entryPoints.find(e => e.importance === 'primary');
    const secondary = entryPoints.find(e =>
      e.importance === 'secondary' || e !== primary
    );

    if (primary && secondary) {
      paths.push(createTrafficPath(
        'primary-path',
        'primary_circulation',
        'cluster',
        primary.point,
        secondary.point,
        DEFAULT_PATH_WIDTH,
        [primary, secondary],
        'primary'
      ));
    }
  }

  // Kitchen work zone
  const kitchen = rooms.find(r => r.type === 'kitchen');
  if (kitchen) {
    paths.push(generateKitchenWorkZone(kitchen.bounds, false));
  }

  return paths;
}

/**
 * Create a traffic path between two points
 */
function createTrafficPath(
  id: string,
  pathType: TrafficPathType,
  parentZoneId: string,
  startPoint: Point2D,
  endPoint: Point2D,
  width: number,
  connects: PathConnection[],
  priority: 'primary' | 'secondary' | 'tertiary'
): TrafficPath {
  const dx = endPoint[0] - startPoint[0];
  const dy = endPoint[1] - startPoint[1];
  const length = Math.sqrt(dx * dx + dy * dy);

  // Create rectangle polygon along path
  const halfWidth = width / 2;

  // Perpendicular direction
  const perpX = -dy / length * halfWidth;
  const perpY = dx / length * halfWidth;

  const vertices: Point2D[] = [
    [startPoint[0] + perpX, startPoint[1] + perpY],
    [endPoint[0] + perpX, endPoint[1] + perpY],
    [endPoint[0] - perpX, endPoint[1] - perpY],
    [startPoint[0] - perpX, startPoint[1] - perpY],
  ];

  return {
    id,
    pathType,
    parentZoneId,
    vertices,
    width,
    length,
    area: width * length,
    connects,
    blocksFurniture: true,
    priority,
  };
}

/**
 * Infer functional zone from room type
 */
function inferZone(type: RoomType): 'cooking' | 'eating' | 'living' | 'transition' {
  switch (type) {
    case 'kitchen': return 'cooking';
    case 'dining': return 'eating';
    case 'living':
    case 'family':
    case 'great_room': return 'living';
    default: return 'transition';
  }
}

/**
 * Check if two rooms are adjacent
 */
function areRoomsAdjacent(room1: RoomBounds, room2: RoomBounds): boolean {
  const TOLERANCE = 1.0;

  const r1 = {
    left: room1.x,
    right: room1.x + room1.width,
    bottom: room1.y,
    top: room1.y + room1.depth,
  };

  const r2 = {
    left: room2.x,
    right: room2.x + room2.width,
    bottom: room2.y,
    top: room2.y + room2.depth,
  };

  const verticallyAligned =
    Math.max(r1.bottom, r2.bottom) < Math.min(r1.top, r2.top) - TOLERANCE;

  if (verticallyAligned) {
    if (Math.abs(r1.right - r2.left) < TOLERANCE ||
        Math.abs(r2.right - r1.left) < TOLERANCE) {
      return true;
    }
  }

  const horizontallyAligned =
    Math.max(r1.left, r2.left) < Math.min(r1.right, r2.right) - TOLERANCE;

  if (horizontallyAligned) {
    if (Math.abs(r1.top - r2.bottom) < TOLERANCE ||
        Math.abs(r2.top - r1.bottom) < TOLERANCE) {
      return true;
    }
  }

  return false;
}

/**
 * Find center of shared wall between two adjacent rooms
 */
function findSharedWallCenter(room1: RoomBounds, room2: RoomBounds): Point2D {
  const TOLERANCE = 1.0;

  const r1 = {
    left: room1.x,
    right: room1.x + room1.width,
    bottom: room1.y,
    top: room1.y + room1.depth,
  };

  const r2 = {
    left: room2.x,
    right: room2.x + room2.width,
    bottom: room2.y,
    top: room2.y + room2.depth,
  };

  // Check vertical shared wall
  if (Math.abs(r1.right - r2.left) < TOLERANCE) {
    const overlapBottom = Math.max(r1.bottom, r2.bottom);
    const overlapTop = Math.min(r1.top, r2.top);
    return [r1.right, (overlapBottom + overlapTop) / 2];
  }

  if (Math.abs(r2.right - r1.left) < TOLERANCE) {
    const overlapBottom = Math.max(r1.bottom, r2.bottom);
    const overlapTop = Math.min(r1.top, r2.top);
    return [r1.left, (overlapBottom + overlapTop) / 2];
  }

  // Check horizontal shared wall
  if (Math.abs(r1.top - r2.bottom) < TOLERANCE) {
    const overlapLeft = Math.max(r1.left, r2.left);
    const overlapRight = Math.min(r1.right, r2.right);
    return [(overlapLeft + overlapRight) / 2, r1.top];
  }

  if (Math.abs(r2.top - r1.bottom) < TOLERANCE) {
    const overlapLeft = Math.max(r1.left, r2.left);
    const overlapRight = Math.min(r1.right, r2.right);
    return [(overlapLeft + overlapRight) / 2, r1.bottom];
  }

  // Fallback: center between centroids
  return [
    (room1.x + room1.width / 2 + room2.x + room2.width / 2) / 2,
    (room1.y + room1.depth / 2 + room2.y + room2.depth / 2) / 2,
  ];
}

/**
 * Point-in-polygon test using ray casting
 */
function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
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

// ============================================================================
// Exports
// ============================================================================

export {
  OPEN_PLAN_TYPES,
  DEFAULT_PATH_WIDTH,
  KITCHEN_WORK_DEPTH,
  FURNITURE_CLEARANCE,
  ENTRY_ZONE_DEPTH,
};
