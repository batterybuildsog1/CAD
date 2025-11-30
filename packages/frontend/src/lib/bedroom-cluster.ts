/**
 * Bedroom Cluster Detection and Corridor Generation
 *
 * When multiple bedrooms exist in a floor plan, they typically share access
 * via a common corridor rather than individual point-to-point hallways.
 *
 * This module detects bedroom clusters and generates proper corridor geometry
 * that all bedroom doors open onto.
 *
 * Architecture:
 * ```
 * [Public Zone]----[Corridor]----[Bed1]
 *                      |----[Bed2]
 *                      |----[Bed3]
 *                      |----[Hall Bath]
 * ```
 *
 * IRC Code Compliance:
 * - R311.6: Minimum hallway width 36" (3 feet)
 * - R310.1: Bedroom must have direct egress (cannot pass through another bedroom)
 */

import type { Point2D, RoomType } from './gemini-types';
import type { RoomBounds } from './circulation-spine';
import type { HallwaySegment } from './hallway-mst';

// ============================================================================
// Types
// ============================================================================

/**
 * A cluster of bedrooms that share a common corridor
 */
export interface BedroomCluster {
  /** Unique identifier for this cluster */
  id: string;

  /** All bedrooms in this cluster */
  bedrooms: RoomBounds[];

  /** Associated hall bathrooms (not ensuite) */
  hallBathrooms: RoomBounds[];

  /** Primary suite if detected (bedroom + ensuite bath + closet) */
  primarySuite: PrimarySuiteGroup | null;

  /** Bounding box encompassing all cluster rooms */
  bounds: ClusterBounds;

  /** Optimal direction for the corridor to run */
  corridorAxis: 'horizontal' | 'vertical';

  /** Required corridor length based on room count */
  corridorLength: number;

  /** Calculated corridor width (minimum 3.5') */
  corridorWidth: number;

  /** Point where corridor connects to public zone */
  publicConnectionPoint: Point2D;

  /** All rooms that need doors to this corridor */
  roomsNeedingAccess: RoomBounds[];
}

/**
 * Primary suite group: bedroom + optional ensuite + optional closet(s)
 */
export interface PrimarySuiteGroup {
  /** The primary bedroom */
  bedroom: RoomBounds;

  /** Ensuite bathroom (if present) */
  bathroom: RoomBounds | null;

  /** Walk-in closet(s) */
  closets: RoomBounds[];

  /** Whether suite has internal circulation (bathroom accessed through closet, etc.) */
  hasInternalCirculation: boolean;
}

/**
 * Bounding box for a cluster of rooms
 */
export interface ClusterBounds {
  x: number;
  y: number;
  width: number;
  depth: number;
  centroid: Point2D;
}

/**
 * Specification for generating corridor geometry
 */
export interface CorridorSpec {
  /** Unique identifier */
  id: string;

  /** Corridor centerline start point */
  startPoint: Point2D;

  /** Corridor centerline end point */
  endPoint: Point2D;

  /** Width in feet (minimum 3.5' per IRC) */
  width: number;

  /** Length in feet */
  length: number;

  /** Door positions for each room accessing this corridor */
  doors: CorridorDoor[];

  /** Connection point to public zone (for MST integration) */
  publicConnection: Point2D;

  /** Which side of the corridor rooms are on */
  roomSide: 'left' | 'right' | 'both';
}

/**
 * Door position along a corridor
 */
export interface CorridorDoor {
  /** Room this door leads to */
  roomId: string;

  /** Room type */
  roomType: RoomType;

  /** Position along corridor centerline (0-1 normalized) */
  positionAlongCorridor: number;

  /** Absolute position */
  position: Point2D;

  /** Which wall of the corridor the door is on */
  side: 'left' | 'right';

  /** Door width in feet */
  doorWidth: number;
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum corridor width per IRC R311.6 */
const MIN_CORRIDOR_WIDTH = 3.0;

/** Recommended corridor width for comfort */
const DEFAULT_CORRIDOR_WIDTH = 3.5;

/** Accessible corridor width (Fair Housing Act) */
const ACCESSIBLE_CORRIDOR_WIDTH = 4.0;

/** Space per door along corridor (door width + clearance) */
const SPACE_PER_DOOR = 4.0;

/** Buffer space at corridor ends */
const CORRIDOR_END_BUFFER = 4.0;

/** Standard interior door width */
const STANDARD_DOOR_WIDTH = 3.0;

/** Distance from corner to door (code requirement) */
const DOOR_CORNER_OFFSET = 1.5;

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Detect all bedroom clusters in a floor plan.
 *
 * Clustering algorithm:
 * 1. Find all bedrooms
 * 2. Group bedrooms by proximity (within clustering distance)
 * 3. Identify primary suite (bedroom with adjacent bathroom/closet)
 * 4. For each cluster, find associated hall bathrooms
 *
 * @param rooms - All rooms in the floor plan
 * @returns Array of bedroom clusters
 */
export function detectBedroomClusters(rooms: RoomBounds[]): BedroomCluster[] {
  const bedrooms = rooms.filter(r => r.type === 'bedroom');
  const bathrooms = rooms.filter(r => r.type === 'bathroom');
  const closets = rooms.filter(r => r.type === 'closet');

  if (bedrooms.length === 0) {
    return [];
  }

  // For single bedroom, no cluster needed (but still might need hallway access)
  if (bedrooms.length === 1) {
    return [];
  }

  // Build bedroom adjacency graph
  const adjacencyGraph = buildBedroomAdjacencyGraph(bedrooms);

  // Find connected components (clusters of adjacent bedrooms)
  const clusterGroups = findConnectedComponents(bedrooms, adjacencyGraph);

  // Convert each group to a BedroomCluster
  const clusters: BedroomCluster[] = [];
  let clusterId = 0;

  for (const bedroomGroup of clusterGroups) {
    if (bedroomGroup.length < 2) {
      // Single bedrooms don't form a cluster by themselves
      // But we might still create a cluster for proper corridor access
      continue;
    }

    // Detect primary suite within this cluster
    const primarySuite = detectPrimarySuite(bedroomGroup, bathrooms, closets);

    // Find hall bathrooms (not ensuite, but near cluster)
    const hallBaths = findHallBathrooms(bedroomGroup, bathrooms, primarySuite);

    // Calculate cluster bounds
    const allClusterRooms = [
      ...bedroomGroup,
      ...hallBaths,
      ...(primarySuite?.closets || []),
    ];
    const bounds = calculateClusterBounds(allClusterRooms);

    // Determine corridor axis based on cluster shape
    const corridorAxis = bounds.width > bounds.depth ? 'horizontal' : 'vertical';

    // Calculate corridor length: 4' per door + buffer
    const doorsNeeded = bedroomGroup.length + hallBaths.length;
    const corridorLength = (doorsNeeded * SPACE_PER_DOOR) + CORRIDOR_END_BUFFER;

    // Calculate public connection point
    const publicConnectionPoint = calculatePublicConnectionPoint(bounds, corridorAxis);

    // Rooms needing corridor access
    const roomsNeedingAccess = [
      ...bedroomGroup.filter(b => b !== primarySuite?.bedroom),
      ...hallBaths,
    ];
    // Primary bedroom needs access too, but may have internal suite circulation
    if (primarySuite) {
      roomsNeedingAccess.push(primarySuite.bedroom);
    }

    clusters.push({
      id: `bedroom-cluster-${clusterId++}`,
      bedrooms: bedroomGroup,
      hallBathrooms: hallBaths,
      primarySuite,
      bounds,
      corridorAxis,
      corridorLength,
      corridorWidth: DEFAULT_CORRIDOR_WIDTH,
      publicConnectionPoint,
      roomsNeedingAccess,
    });
  }

  // If we have multiple bedrooms but no cluster was formed (spread out),
  // create a single cluster containing all of them
  if (clusters.length === 0 && bedrooms.length >= 2) {
    const primarySuite = detectPrimarySuite(bedrooms, bathrooms, closets);
    const hallBaths = findHallBathrooms(bedrooms, bathrooms, primarySuite);
    const bounds = calculateClusterBounds([...bedrooms, ...hallBaths]);
    const corridorAxis = bounds.width > bounds.depth ? 'horizontal' : 'vertical';
    const doorsNeeded = bedrooms.length + hallBaths.length;
    const corridorLength = (doorsNeeded * SPACE_PER_DOOR) + CORRIDOR_END_BUFFER;
    const publicConnectionPoint = calculatePublicConnectionPoint(bounds, corridorAxis);

    clusters.push({
      id: 'bedroom-cluster-0',
      bedrooms,
      hallBathrooms: hallBaths,
      primarySuite,
      bounds,
      corridorAxis,
      corridorLength,
      corridorWidth: DEFAULT_CORRIDOR_WIDTH,
      publicConnectionPoint,
      roomsNeedingAccess: [...bedrooms, ...hallBaths],
    });
  }

  return clusters;
}

/**
 * Generate corridor geometry for a bedroom cluster.
 *
 * Creates a corridor specification that can be converted to hallway segments.
 *
 * @param cluster - The bedroom cluster
 * @param width - Corridor width (default 3.5')
 * @returns Corridor specification
 */
export function generateClusterCorridor(
  cluster: BedroomCluster,
  width: number = DEFAULT_CORRIDOR_WIDTH
): CorridorSpec {
  const { bounds, corridorAxis, corridorLength, publicConnectionPoint, roomsNeedingAccess } = cluster;

  let startPoint: Point2D;
  let endPoint: Point2D;
  let roomSide: 'left' | 'right' | 'both' = 'both';

  if (corridorAxis === 'horizontal') {
    // Corridor runs horizontally along the south edge of bedrooms
    // Position corridor just below the bedroom bounding box
    const corridorY = bounds.y - (width / 2) - 0.5; // Small gap

    startPoint = [bounds.x - DOOR_CORNER_OFFSET, corridorY];
    endPoint = [bounds.x + Math.max(corridorLength, bounds.width) + DOOR_CORNER_OFFSET, corridorY];

    // Rooms are north of the corridor
    roomSide = 'left'; // In our coordinate system, "left" = north when corridor is horizontal
  } else {
    // Corridor runs vertically along the west edge of bedrooms
    const corridorX = bounds.x - (width / 2) - 0.5;

    startPoint = [corridorX, bounds.y - DOOR_CORNER_OFFSET];
    endPoint = [corridorX, bounds.y + Math.max(corridorLength, bounds.depth) + DOOR_CORNER_OFFSET];

    // Rooms are east of the corridor
    roomSide = 'right';
  }

  // Calculate actual length
  const dx = endPoint[0] - startPoint[0];
  const dy = endPoint[1] - startPoint[1];
  const length = Math.sqrt(dx * dx + dy * dy);

  // Calculate door positions for each room
  const doors = calculateDoorPositions(
    roomsNeedingAccess,
    startPoint,
    endPoint,
    corridorAxis,
    roomSide
  );

  return {
    id: `${cluster.id}-corridor`,
    startPoint,
    endPoint,
    width,
    length,
    doors,
    publicConnection: publicConnectionPoint,
    roomSide,
  };
}

/**
 * Convert a corridor specification to hallway segments.
 *
 * This integrates the corridor into the MST hallway network.
 *
 * @param corridor - Corridor specification
 * @param hallwayWidth - Width for hallway segments
 * @returns Array of hallway segments
 */
export function corridorToHallwaySegments(
  corridor: CorridorSpec,
  hallwayWidth: number = DEFAULT_CORRIDOR_WIDTH
): HallwaySegment[] {
  const segments: HallwaySegment[] = [];

  // Main corridor segment
  segments.push({
    id: corridor.id,
    from: {
      roomId: 'corridor-start',
      point: corridor.startPoint,
    },
    to: {
      roomId: 'corridor-end',
      point: corridor.endPoint,
    },
    length: corridor.length,
    width: hallwayWidth,
    centerline: [corridor.startPoint, corridor.endPoint],
  });

  // Add stub segments for each door (perpendicular connections to rooms)
  for (const door of corridor.doors) {
    const stubLength = hallwayWidth / 2 + 0.5; // Short stub to room wall

    // Calculate stub direction based on door side
    let stubEnd: Point2D;
    if (door.side === 'left') {
      // Stub goes "up" or "left" depending on corridor axis
      stubEnd = [
        door.position[0],
        door.position[1] + stubLength,
      ];
    } else {
      stubEnd = [
        door.position[0],
        door.position[1] - stubLength,
      ];
    }

    segments.push({
      id: `${corridor.id}-door-${door.roomId}`,
      from: {
        roomId: corridor.id,
        point: door.position,
      },
      to: {
        roomId: door.roomId,
        point: stubEnd,
      },
      length: stubLength,
      width: door.doorWidth,
      centerline: [door.position, stubEnd],
    });
  }

  return segments;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build adjacency graph for bedrooms (which ones are near each other)
 */
function buildBedroomAdjacencyGraph(
  bedrooms: RoomBounds[]
): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();

  // Initialize graph
  for (const bed of bedrooms) {
    graph.set(bed.name, new Set());
  }

  // Clustering distance: bedrooms within this distance are considered same cluster
  const CLUSTER_DISTANCE = 30; // feet

  // Check all pairs
  for (let i = 0; i < bedrooms.length; i++) {
    for (let j = i + 1; j < bedrooms.length; j++) {
      const distance = roomDistance(bedrooms[i], bedrooms[j]);

      if (distance < CLUSTER_DISTANCE) {
        graph.get(bedrooms[i].name)?.add(bedrooms[j].name);
        graph.get(bedrooms[j].name)?.add(bedrooms[i].name);
      }
    }
  }

  return graph;
}

/**
 * Find connected components in the bedroom adjacency graph
 */
function findConnectedComponents(
  bedrooms: RoomBounds[],
  graph: Map<string, Set<string>>
): RoomBounds[][] {
  const visited = new Set<string>();
  const components: RoomBounds[][] = [];

  for (const bed of bedrooms) {
    if (visited.has(bed.name)) continue;

    // BFS to find all connected bedrooms
    const component: RoomBounds[] = [];
    const queue = [bed];
    visited.add(bed.name);

    while (queue.length > 0) {
      const current = queue.shift()!;
      component.push(current);

      const neighbors = graph.get(current.name) || new Set();
      for (const neighborName of neighbors) {
        if (!visited.has(neighborName)) {
          visited.add(neighborName);
          const neighbor = bedrooms.find(b => b.name === neighborName);
          if (neighbor) queue.push(neighbor);
        }
      }
    }

    components.push(component);
  }

  return components;
}

/**
 * Detect if there's a primary suite in the bedroom cluster
 */
function detectPrimarySuite(
  bedrooms: RoomBounds[],
  bathrooms: RoomBounds[],
  closets: RoomBounds[]
): PrimarySuiteGroup | null {
  // Primary bedroom is typically:
  // 1. Named "primary", "master", or "owner"
  // 2. The largest bedroom
  // 3. Has an adjacent bathroom

  // First try by name
  let primaryBed = bedrooms.find(b =>
    b.name.toLowerCase().includes('primary') ||
    b.name.toLowerCase().includes('master') ||
    b.name.toLowerCase().includes('owner')
  );

  // If not found by name, find largest bedroom with adjacent bathroom
  if (!primaryBed) {
    const bedsWithBaths = bedrooms.filter(bed =>
      bathrooms.some(bath => areRoomsAdjacent(bed, bath))
    );

    if (bedsWithBaths.length > 0) {
      // Get largest
      primaryBed = bedsWithBaths.reduce((a, b) =>
        (a.width * a.depth) > (b.width * b.depth) ? a : b
      );
    }
  }

  if (!primaryBed) return null;

  // Find ensuite bathroom (adjacent to primary)
  const ensuite = bathrooms.find(bath =>
    areRoomsAdjacent(primaryBed!, bath) &&
    (bath.name.toLowerCase().includes('primary') ||
     bath.name.toLowerCase().includes('master') ||
     bath.name.toLowerCase().includes('ensuite'))
  ) || bathrooms.find(bath => areRoomsAdjacent(primaryBed!, bath));

  // Find walk-in closet(s) (adjacent to primary bedroom or ensuite)
  const suiteClosets = closets.filter(closet =>
    areRoomsAdjacent(primaryBed!, closet) ||
    (ensuite && areRoomsAdjacent(ensuite, closet))
  );

  // Check for internal circulation (bathroom accessed through closet)
  const hasInternalCirculation = suiteClosets.some(closet =>
    ensuite && areRoomsAdjacent(closet, ensuite)
  );

  return {
    bedroom: primaryBed,
    bathroom: ensuite || null,
    closets: suiteClosets,
    hasInternalCirculation,
  };
}

/**
 * Find hall bathrooms that need corridor access (not ensuite)
 */
function findHallBathrooms(
  bedrooms: RoomBounds[],
  bathrooms: RoomBounds[],
  primarySuite: PrimarySuiteGroup | null
): RoomBounds[] {
  // Hall bath is:
  // 1. Not the ensuite
  // 2. Near the bedroom cluster
  // 3. Not adjacent to any single bedroom (that would make it an ensuite)

  return bathrooms.filter(bath => {
    // Skip if it's the primary ensuite
    if (primarySuite?.bathroom?.name === bath.name) {
      return false;
    }

    // Skip if it's a secondary ensuite (adjacent to exactly one bedroom)
    const adjacentBedrooms = bedrooms.filter(bed => areRoomsAdjacent(bed, bath));
    if (adjacentBedrooms.length === 1) {
      return false;
    }

    // Include if it's near the cluster but not an ensuite
    // Check if within reasonable distance of any bedroom
    const HALL_BATH_DISTANCE = 25; // feet
    return bedrooms.some(bed => roomDistance(bed, bath) < HALL_BATH_DISTANCE);
  });
}

/**
 * Calculate bounding box for a group of rooms
 */
function calculateClusterBounds(rooms: RoomBounds[]): ClusterBounds {
  if (rooms.length === 0) {
    return { x: 0, y: 0, width: 0, depth: 0, centroid: [0, 0] };
  }

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const room of rooms) {
    minX = Math.min(minX, room.x);
    minY = Math.min(minY, room.y);
    maxX = Math.max(maxX, room.x + room.width);
    maxY = Math.max(maxY, room.y + room.depth);
  }

  const width = maxX - minX;
  const depth = maxY - minY;

  return {
    x: minX,
    y: minY,
    width,
    depth,
    centroid: [minX + width / 2, minY + depth / 2],
  };
}

/**
 * Calculate where corridor connects to public zone
 */
function calculatePublicConnectionPoint(
  bounds: ClusterBounds,
  corridorAxis: 'horizontal' | 'vertical'
): Point2D {
  // Connection point is at the "public" end of the corridor
  // Typically the south or west end (closer to main living areas)

  if (corridorAxis === 'horizontal') {
    // Public connection at west end of horizontal corridor
    return [bounds.x - CORRIDOR_END_BUFFER, bounds.y + bounds.depth / 2];
  } else {
    // Public connection at south end of vertical corridor
    return [bounds.x + bounds.width / 2, bounds.y - CORRIDOR_END_BUFFER];
  }
}

/**
 * Calculate door positions along a corridor for each room
 */
function calculateDoorPositions(
  rooms: RoomBounds[],
  startPoint: Point2D,
  endPoint: Point2D,
  axis: 'horizontal' | 'vertical',
  roomSide: 'left' | 'right' | 'both'
): CorridorDoor[] {
  const doors: CorridorDoor[] = [];

  // Calculate corridor direction vector
  const dx = endPoint[0] - startPoint[0];
  const dy = endPoint[1] - startPoint[1];
  const corridorLength = Math.sqrt(dx * dx + dy * dy);

  if (corridorLength === 0) return doors;

  // Sort rooms by their position along the corridor axis
  const sortedRooms = [...rooms].sort((a, b) => {
    if (axis === 'horizontal') {
      return a.x - b.x;
    } else {
      return a.y - b.y;
    }
  });

  // Place doors evenly along corridor
  const spacing = corridorLength / (sortedRooms.length + 1);

  for (let i = 0; i < sortedRooms.length; i++) {
    const room = sortedRooms[i];
    const t = (i + 1) / (sortedRooms.length + 1);

    // Position along corridor
    const position: Point2D = [
      startPoint[0] + dx * t,
      startPoint[1] + dy * t,
    ];

    // Determine which side based on room position relative to corridor
    const roomCentroid: Point2D = [
      room.x + room.width / 2,
      room.y + room.depth / 2,
    ];

    let side: 'left' | 'right';
    if (axis === 'horizontal') {
      side = roomCentroid[1] > position[1] ? 'left' : 'right';
    } else {
      side = roomCentroid[0] < position[0] ? 'left' : 'right';
    }

    doors.push({
      roomId: room.name,
      roomType: room.type,
      positionAlongCorridor: t,
      position,
      side,
      doorWidth: STANDARD_DOOR_WIDTH,
    });
  }

  return doors;
}

/**
 * Check if two rooms are adjacent (share a wall)
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

  // Check vertical adjacency (side by side)
  const verticallyAligned =
    Math.max(r1.bottom, r2.bottom) < Math.min(r1.top, r2.top) - TOLERANCE;

  if (verticallyAligned) {
    if (Math.abs(r1.right - r2.left) < TOLERANCE ||
        Math.abs(r2.right - r1.left) < TOLERANCE) {
      return true;
    }
  }

  // Check horizontal adjacency (stacked)
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
 * Calculate distance between room centroids
 */
function roomDistance(room1: RoomBounds, room2: RoomBounds): number {
  const c1: Point2D = [room1.x + room1.width / 2, room1.y + room1.depth / 2];
  const c2: Point2D = [room2.x + room2.width / 2, room2.y + room2.depth / 2];

  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];

  return Math.sqrt(dx * dx + dy * dy);
}

// ============================================================================
// Exports
// ============================================================================

export {
  MIN_CORRIDOR_WIDTH,
  DEFAULT_CORRIDOR_WIDTH,
  ACCESSIBLE_CORRIDOR_WIDTH,
  SPACE_PER_DOOR,
  CORRIDOR_END_BUFFER,
};
