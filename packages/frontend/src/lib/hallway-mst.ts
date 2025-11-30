/**
 * MST-Based Hallway Network Generator
 *
 * Implements Minimum Spanning Tree algorithm to find the OPTIMAL hallway network
 * connecting all rooms with minimum total corridor length.
 *
 * Algorithm Overview:
 * 1. Create complete graph where nodes = room centroids, edges = distances
 * 2. Apply Prim's MST algorithm to find minimum cost tree
 * 3. Convert MST edges to hallway segments with proper geometry
 *
 * Key Insight: MST guarantees all rooms are connected with minimum total hallway length,
 * which minimizes circulation area and maximizes usable room space.
 */

import type { Point2D, RoomType } from './gemini-types';
import type { RoomBounds } from './circulation-spine';

// ============================================================================
// Types
// ============================================================================

/**
 * A single hallway segment connecting two rooms
 */
export interface HallwaySegment {
  /** Unique identifier for this segment */
  id: string;

  /** Start point with associated room */
  from: {
    roomId: string;
    point: Point2D;
  };

  /** End point with associated room */
  to: {
    roomId: string;
    point: Point2D;
  };

  /** Length of the hallway segment in feet */
  length: number;

  /** Width of the hallway in feet */
  width: number;

  /** Polyline representing the centerline from start to end */
  centerline: Point2D[];
}

/**
 * Complete hallway network connecting all rooms
 */
export interface HallwayNetwork {
  /** All hallway segments in the network */
  segments: HallwaySegment[];

  /** Total length of all hallways combined */
  totalLength: number;

  /** Total area of all hallways (length * width for each) */
  totalArea: number;

  /** Points where multiple hallway segments meet */
  junctions: Point2D[];
}

/**
 * Edge in the MST graph representing potential hallway between rooms
 */
interface GraphEdge {
  /** Index of the first room in the rooms array */
  from: number;

  /** Index of the second room in the rooms array */
  to: number;

  /** Euclidean distance between room centroids */
  weight: number;
}

/**
 * Result of adjacency check between two rooms
 */
interface AdjacencyResult {
  /** Whether the rooms share a wall */
  isAdjacent: boolean;

  /** The shared wall segment if adjacent */
  sharedWall?: {
    start: Point2D;
    end: Point2D;
  };
}

/**
 * Extended adjacency info that tracks whether a hallway is needed
 */
interface AdjacencyInfo {
  /** Always true for entries in the map */
  isAdjacent: true;

  /** Whether these adjacent rooms need a hallway between them */
  needsHallway: boolean;

  /** The shared wall segment */
  sharedWall: { start: Point2D; end: Point2D };
}

// ============================================================================
// Constants
// ============================================================================

/** Default hallway width in feet */
const DEFAULT_HALLWAY_WIDTH = 3.5;

/** Tolerance for determining if rooms share a wall (in feet) */
const ADJACENCY_TOLERANCE = 0.5;

/** Room types that act as entry points (should be MST root) */
const ENTRY_ROOM_TYPES: RoomType[] = ['foyer', 'mudroom', 'hallway', 'circulation'];

/** Room type pairs that should be on the same branch */
const BRANCH_PAIRS: Array<[RoomType, RoomType]> = [
  ['bedroom', 'bathroom'],
  ['bedroom', 'closet'],
  ['kitchen', 'pantry'],
];

/**
 * Room type pairs that CAN connect directly without a hallway.
 * This is the key fix: NOT all adjacent rooms should skip hallways.
 *
 * Rules:
 * - Open floor plan rooms (living/kitchen/dining) can connect directly
 * - Entry connections (foyer→living) can connect directly
 * - Primary suite internal (bedroom→ensuite bath, bedroom→closet) can connect directly
 * - Bedroom-to-bedroom NEVER connects directly (privacy + IRC egress code)
 * - Bathroom-to-bathroom NEVER connects directly (privacy)
 */
const DIRECT_CONNECTION_PAIRS: Array<[RoomType, RoomType]> = [
  // Open floor plan - public zones can flow into each other
  ['living', 'kitchen'],
  ['living', 'dining'],
  ['living', 'family'],
  ['kitchen', 'dining'],
  ['kitchen', 'family'],
  ['dining', 'family'],
  ['great_room', 'kitchen'],
  ['great_room', 'dining'],
  ['great_room', 'living'],

  // Entry connections - foyer opens to public spaces
  ['foyer', 'living'],
  ['foyer', 'dining'],
  ['foyer', 'family'],
  ['foyer', 'great_room'],

  // Service connections
  ['mudroom', 'laundry'],
  ['mudroom', 'garage'],
  ['laundry', 'garage'],

  // Primary suite internal connections (ensuite access)
  ['bedroom', 'bathroom'],  // Ensuite bathroom
  ['bedroom', 'closet'],    // Walk-in closet
  ['bathroom', 'closet'],   // Jack-and-jill or dressing room
];

/** Room types that act as circulation hubs - they connect to everything */
const HUB_ROOM_TYPES: RoomType[] = ['hallway', 'circulation', 'foyer', 'mudroom', 'stair', 'landing'];

/**
 * Check if two room types can be directly connected without requiring a hallway.
 *
 * This is the CRITICAL function that fixes the bug. Previously, ANY adjacent
 * rooms were treated as "no hallway needed". Now we check room types.
 *
 * @param room1 - First room
 * @param room2 - Second room
 * @returns true if rooms can connect directly, false if they need a hallway
 */
function canRoomsConnectDirectly(room1: RoomBounds, room2: RoomBounds): boolean {
  const type1 = room1.type;
  const type2 = room2.type;

  // CRITICAL RULE 1: Bedroom-to-bedroom NEVER connects directly
  // You cannot walk through one bedroom to reach another (privacy + IRC R310.1)
  if (type1 === 'bedroom' && type2 === 'bedroom') {
    return false;
  }

  // CRITICAL RULE 2: Bathroom-to-bathroom NEVER connects directly (except jack-and-jill)
  // For now, treat all bath-to-bath as needing hallway; jack-and-jill handled via bedroom
  if (type1 === 'bathroom' && type2 === 'bathroom') {
    return false;
  }

  // RULE 3: Hub rooms (hallway, foyer, circulation) connect to anything
  // That's literally their purpose - to provide access
  if (HUB_ROOM_TYPES.includes(type1) || HUB_ROOM_TYPES.includes(type2)) {
    return true;
  }

  // RULE 4: Check explicit direct connection pairs
  for (const [t1, t2] of DIRECT_CONNECTION_PAIRS) {
    if ((type1 === t1 && type2 === t2) || (type1 === t2 && type2 === t1)) {
      return true;
    }
  }

  // RULE 5: Indirect rooms (closet, pantry) connect through their parent
  // But only if they're adjacent - which is checked geometrically
  const indirectTypes: RoomType[] = ['closet', 'pantry'];
  if (indirectTypes.includes(type1) || indirectTypes.includes(type2)) {
    // Closet can connect to bedroom or foyer (coat closet)
    // Pantry can connect to kitchen
    const otherType = indirectTypes.includes(type1) ? type2 : type1;
    const indirectType = indirectTypes.includes(type1) ? type1 : type2;

    if (indirectType === 'closet' && ['bedroom', 'foyer', 'mudroom', 'hallway'].includes(otherType)) {
      return true;
    }
    if (indirectType === 'pantry' && ['kitchen'].includes(otherType)) {
      return true;
    }
  }

  // Default: rooms that don't match any rule need a hallway
  return false;
}

// ============================================================================
// Core MST Functions
// ============================================================================

/**
 * Compute the optimal hallway network using Minimum Spanning Tree algorithm.
 *
 * The MST approach guarantees:
 * - All rooms are connected (reachability)
 * - Total hallway length is minimized (efficiency)
 * - No redundant hallways (tree structure)
 *
 * @param rooms - Array of rooms with bounds to connect
 * @param hallwayWidth - Width of hallways in feet (default 3.5')
 * @returns HallwayNetwork with optimal segments connecting all rooms
 */
export function computeMinimumHallwayNetwork(
  rooms: RoomBounds[],
  hallwayWidth: number = DEFAULT_HALLWAY_WIDTH
): HallwayNetwork {
  if (rooms.length === 0) {
    return {
      segments: [],
      totalLength: 0,
      totalArea: 0,
      junctions: [],
    };
  }

  if (rooms.length === 1) {
    // Single room needs no hallways
    return {
      segments: [],
      totalLength: 0,
      totalArea: 0,
      junctions: [],
    };
  }

  // Step 1: Find the entry room to use as MST root
  const rootIndex = findEntryRoomIndex(rooms);

  // Step 2: Build adjacency map (rooms sharing walls don't need hallways)
  const adjacencyMap = buildAdjacencyMap(rooms);

  // Step 3: Run Prim's algorithm to get MST edges
  const mstEdges = primsAlgorithm(rooms, rootIndex, adjacencyMap);

  // Step 4: Convert MST edges to hallway segments
  // Filter out edges where rooms are adjacent AND don't need hallways
  const segments = mstEdges
    .filter(edge => {
      const adjacencyInfo = adjacencyMap.get(`${edge.from}-${edge.to}`);
      // Keep edge if: not adjacent at all, OR adjacent but needs hallway
      return !adjacencyInfo || adjacencyInfo.needsHallway;
    })
    .map((edge, index) => {
      const adjacencyInfo = adjacencyMap.get(`${edge.from}-${edge.to}`);
      return createHallwaySegment(
        rooms[edge.from],
        rooms[edge.to],
        edge.weight,
        hallwayWidth,
        `hallway-${index}`,
        adjacencyInfo
      );
    })
    .filter((seg): seg is HallwaySegment => seg !== null);

  // Step 5: Find junction points (where segments meet)
  const junctions = findJunctionPoints(segments);

  // Step 6: Calculate totals
  const totalLength = segments.reduce((sum, seg) => sum + seg.length, 0);
  const totalArea = segments.reduce((sum, seg) => sum + seg.length * seg.width, 0);

  return {
    segments,
    totalLength,
    totalArea,
    junctions,
  };
}

/**
 * Compute Euclidean distance between centroids of two rooms.
 *
 * @param room1 - First room bounds
 * @param room2 - Second room bounds
 * @returns Distance in feet between room centroids
 */
export function computeRoomDistance(room1: RoomBounds, room2: RoomBounds): number {
  const centroid1 = getRoomCentroid(room1);
  const centroid2 = getRoomCentroid(room2);

  const dx = centroid2[0] - centroid1[0];
  const dy = centroid2[1] - centroid1[1];

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Find the point on a room's boundary where a hallway should connect.
 *
 * The connection point is on the room's boundary (not centroid) in the
 * direction of the target. This ensures hallways connect at walls, not
 * through room interiors.
 *
 * @param room - Room bounds to find connection point on
 * @param targetDirection - Point indicating direction to connect toward
 * @returns Point on room boundary facing the target direction
 */
export function findHallwayConnectionPoint(
  room: RoomBounds,
  targetDirection: Point2D
): Point2D {
  const centroid = getRoomCentroid(room);

  // Calculate direction vector from centroid to target
  const dx = targetDirection[0] - centroid[0];
  const dy = targetDirection[1] - centroid[1];

  // Determine which wall the connection should be on
  const halfWidth = room.width / 2;
  const halfDepth = room.depth / 2;

  // Use ray-box intersection to find boundary point
  // The ray goes from centroid in direction of target

  if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
    // Target is at centroid, use arbitrary boundary point
    return [room.x + room.width / 2, room.y];
  }

  // Calculate intersection with each wall and find the closest
  const walls = [
    { // North wall
      point: [room.x + room.width / 2, room.y + room.depth] as Point2D,
      normal: [0, 1] as Point2D,
      t: (room.y + room.depth - centroid[1]) / dy,
    },
    { // South wall
      point: [room.x + room.width / 2, room.y] as Point2D,
      normal: [0, -1] as Point2D,
      t: (room.y - centroid[1]) / dy,
    },
    { // East wall
      point: [room.x + room.width, room.y + room.depth / 2] as Point2D,
      normal: [1, 0] as Point2D,
      t: (room.x + room.width - centroid[0]) / dx,
    },
    { // West wall
      point: [room.x, room.y + room.depth / 2] as Point2D,
      normal: [-1, 0] as Point2D,
      t: (room.x - centroid[0]) / dx,
    },
  ];

  // Find the wall with positive t (in direction of target) that's closest
  let bestT = Infinity;
  let bestPoint: Point2D = [room.x + room.width / 2, room.y + room.depth / 2];

  for (const wall of walls) {
    if (isFinite(wall.t) && wall.t > 0 && wall.t < bestT) {
      // Calculate intersection point
      const intersectX = centroid[0] + dx * wall.t;
      const intersectY = centroid[1] + dy * wall.t;

      // Clamp to wall bounds
      const clampedX = Math.max(room.x, Math.min(room.x + room.width, intersectX));
      const clampedY = Math.max(room.y, Math.min(room.y + room.depth, intersectY));

      bestT = wall.t;
      bestPoint = [clampedX, clampedY];
    }
  }

  return bestPoint;
}

/**
 * Prim's Minimum Spanning Tree algorithm.
 *
 * Starting from the root node (entry room), greedily adds the minimum-weight
 * edge that connects a new node to the growing tree until all nodes are included.
 *
 * Time Complexity: O(V^2) for dense graphs (which floor plans typically are)
 * Space Complexity: O(V + E)
 *
 * @param rooms - Array of rooms (nodes in the graph)
 * @param rootIndex - Index of the starting room (entry/foyer)
 * @param adjacencyMap - Map of adjacent room pairs (share walls)
 * @returns Array of edges forming the MST
 */
export function primsAlgorithm(
  rooms: RoomBounds[],
  rootIndex: number = 0,
  adjacencyMap: Map<string, AdjacencyInfo> = new Map()
): Array<{ from: number; to: number; weight: number }> {
  const n = rooms.length;
  if (n === 0) return [];
  if (n === 1) return [];

  // Track which nodes are in the MST
  const inMST = new Array(n).fill(false);

  // Track minimum edge weight to each node from the MST
  const minWeight = new Array(n).fill(Infinity);

  // Track which node the minimum edge comes from
  const parent = new Array(n).fill(-1);

  // Start with root node
  minWeight[rootIndex] = 0;

  const mstEdges: Array<{ from: number; to: number; weight: number }> = [];

  for (let count = 0; count < n; count++) {
    // Find minimum weight node not yet in MST
    let minIdx = -1;
    let minVal = Infinity;

    for (let v = 0; v < n; v++) {
      if (!inMST[v] && minWeight[v] < minVal) {
        minVal = minWeight[v];
        minIdx = v;
      }
    }

    if (minIdx === -1) break; // Graph is disconnected

    // Add node to MST
    inMST[minIdx] = true;

    // Add edge to result (except for root)
    if (parent[minIdx] !== -1) {
      mstEdges.push({
        from: parent[minIdx],
        to: minIdx,
        weight: minVal,
      });
    }

    // Update adjacent nodes
    for (let v = 0; v < n; v++) {
      if (!inMST[v]) {
        // Calculate edge weight
        let weight = computeRoomDistance(rooms[minIdx], rooms[v]);

        // Check adjacency info
        const adjacencyKey1 = `${minIdx}-${v}`;
        const adjacencyKey2 = `${v}-${minIdx}`;
        const adjacencyInfo = adjacencyMap.get(adjacencyKey1) || adjacencyMap.get(adjacencyKey2);

        if (adjacencyInfo && !adjacencyInfo.needsHallway) {
          // Rooms are adjacent AND can connect directly - zero weight
          weight = 0;
        }
        // If adjacencyInfo.needsHallway is true, keep the full weight - they need a hallway

        // Apply branch preference bonus for bedroom-bathroom pairs
        weight = applyBranchPreference(rooms, minIdx, v, weight);

        if (weight < minWeight[v]) {
          minWeight[v] = weight;
          parent[v] = minIdx;
        }
      }
    }
  }

  return mstEdges;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the centroid (center point) of a room
 */
function getRoomCentroid(room: RoomBounds): Point2D {
  return [
    room.x + room.width / 2,
    room.y + room.depth / 2,
  ];
}

/**
 * Find the index of an entry room (foyer, mudroom, etc.) to use as MST root.
 * If no entry room exists, returns 0.
 */
function findEntryRoomIndex(rooms: RoomBounds[]): number {
  for (let i = 0; i < rooms.length; i++) {
    if (ENTRY_ROOM_TYPES.includes(rooms[i].type)) {
      return i;
    }
  }
  return 0;
}

/**
 * Build a map of ALL adjacent room pairs with metadata about hallway requirements.
 *
 * This map tracks:
 * 1. Which room pairs share a wall (geometric adjacency)
 * 2. Whether each pair needs a hallway (based on room type compatibility)
 * 3. The shared wall geometry (for creating door threshold segments)
 *
 * KEY INSIGHT: Adjacent rooms that CAN'T connect directly (e.g., kitchen-bathroom)
 * still share a wall. When we create a hallway segment between them, we need to
 * know about this shared wall to create a proper door threshold segment instead
 * of a zero-length hallway.
 */
function buildAdjacencyMap(rooms: RoomBounds[]): Map<string, AdjacencyInfo> {
  const map = new Map<string, AdjacencyInfo>();

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const result = checkAdjacency(rooms[i], rooms[j]);

      if (result.isAdjacent && result.sharedWall) {
        const canConnectDirectly = canRoomsConnectDirectly(rooms[i], rooms[j]);
        const info: AdjacencyInfo = {
          isAdjacent: true,
          needsHallway: !canConnectDirectly,
          sharedWall: result.sharedWall,
        };
        map.set(`${i}-${j}`, info);
        map.set(`${j}-${i}`, info);
      }
    }
  }

  return map;
}

/**
 * Check if two rooms are adjacent (share a wall).
 * Rooms are adjacent if their boundaries overlap by more than the tolerance.
 */
function checkAdjacency(room1: RoomBounds, room2: RoomBounds): AdjacencyResult {
  // Calculate bounding box edges for each room
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

  // Check for shared vertical wall (rooms side by side)
  const verticallyAligned =
    Math.max(r1.bottom, r2.bottom) < Math.min(r1.top, r2.top) - ADJACENCY_TOLERANCE;

  if (verticallyAligned) {
    // Check if room1's right edge touches room2's left edge
    if (Math.abs(r1.right - r2.left) < ADJACENCY_TOLERANCE) {
      const overlapBottom = Math.max(r1.bottom, r2.bottom);
      const overlapTop = Math.min(r1.top, r2.top);
      return {
        isAdjacent: true,
        sharedWall: {
          start: [r1.right, overlapBottom],
          end: [r1.right, overlapTop],
        },
      };
    }
    // Check if room2's right edge touches room1's left edge
    if (Math.abs(r2.right - r1.left) < ADJACENCY_TOLERANCE) {
      const overlapBottom = Math.max(r1.bottom, r2.bottom);
      const overlapTop = Math.min(r1.top, r2.top);
      return {
        isAdjacent: true,
        sharedWall: {
          start: [r1.left, overlapBottom],
          end: [r1.left, overlapTop],
        },
      };
    }
  }

  // Check for shared horizontal wall (rooms stacked)
  const horizontallyAligned =
    Math.max(r1.left, r2.left) < Math.min(r1.right, r2.right) - ADJACENCY_TOLERANCE;

  if (horizontallyAligned) {
    // Check if room1's top edge touches room2's bottom edge
    if (Math.abs(r1.top - r2.bottom) < ADJACENCY_TOLERANCE) {
      const overlapLeft = Math.max(r1.left, r2.left);
      const overlapRight = Math.min(r1.right, r2.right);
      return {
        isAdjacent: true,
        sharedWall: {
          start: [overlapLeft, r1.top],
          end: [overlapRight, r1.top],
        },
      };
    }
    // Check if room2's top edge touches room1's bottom edge
    if (Math.abs(r2.top - r1.bottom) < ADJACENCY_TOLERANCE) {
      const overlapLeft = Math.max(r1.left, r2.left);
      const overlapRight = Math.min(r1.right, r2.right);
      return {
        isAdjacent: true,
        sharedWall: {
          start: [overlapLeft, r1.bottom],
          end: [overlapRight, r1.bottom],
        },
      };
    }
  }

  return { isAdjacent: false };
}

/**
 * Apply branch preference for room pairs that should be on the same branch.
 * Reduces weight between bedrooms and their associated bathrooms/closets.
 */
function applyBranchPreference(
  rooms: RoomBounds[],
  idx1: number,
  idx2: number,
  weight: number
): number {
  const type1 = rooms[idx1].type;
  const type2 = rooms[idx2].type;

  for (const [t1, t2] of BRANCH_PAIRS) {
    if ((type1 === t1 && type2 === t2) || (type1 === t2 && type2 === t1)) {
      // Reduce weight by 30% to encourage these rooms to be connected
      return weight * 0.7;
    }
  }

  return weight;
}

/** Minimum length for a door threshold segment in feet */
const DOOR_THRESHOLD_LENGTH = 3.0;

/** Minimum meaningful hallway length in feet */
const MIN_HALLWAY_LENGTH = 0.5;

/**
 * Create a HallwaySegment from two rooms and their distance.
 *
 * Handles two cases:
 * 1. Non-adjacent rooms: Creates a hallway from boundary to boundary
 * 2. Adjacent rooms needing hallway: Creates a door threshold segment
 *
 * @param room1 - First room
 * @param room2 - Second room
 * @param distance - Distance between rooms
 * @param width - Hallway width
 * @param id - Segment ID
 * @param adjacencyInfo - Optional adjacency info for adjacent room pairs
 * @returns HallwaySegment or null if segment is too short to be meaningful
 */
function createHallwaySegment(
  room1: RoomBounds,
  room2: RoomBounds,
  distance: number,
  width: number,
  id: string,
  adjacencyInfo?: AdjacencyInfo
): HallwaySegment | null {
  const centroid1 = getRoomCentroid(room1);
  const centroid2 = getRoomCentroid(room2);

  let point1: Point2D;
  let point2: Point2D;
  let length: number;

  if (adjacencyInfo && adjacencyInfo.needsHallway) {
    // Adjacent rooms that need a hallway - create a door threshold segment
    // The hallway runs perpendicular to the shared wall (not along it)
    const wall = adjacencyInfo.sharedWall;
    const wallMidX = (wall.start[0] + wall.end[0]) / 2;
    const wallMidY = (wall.start[1] + wall.end[1]) / 2;

    // Determine wall orientation
    const wallDx = wall.end[0] - wall.start[0];
    const wallDy = wall.end[1] - wall.start[1];
    const isVertical = Math.abs(wallDx) < 0.1;

    // Create a minimum-length threshold (door opening + clearance)
    // The hallway extends perpendicular to the wall
    if (isVertical) {
      // Wall runs north-south, hallway extends east-west
      point1 = [wallMidX - DOOR_THRESHOLD_LENGTH / 2, wallMidY];
      point2 = [wallMidX + DOOR_THRESHOLD_LENGTH / 2, wallMidY];
    } else {
      // Wall runs east-west, hallway extends north-south
      point1 = [wallMidX, wallMidY - DOOR_THRESHOLD_LENGTH / 2];
      point2 = [wallMidX, wallMidY + DOOR_THRESHOLD_LENGTH / 2];
    }

    length = DOOR_THRESHOLD_LENGTH;
  } else {
    // Non-adjacent rooms - use boundary connection points
    point1 = findHallwayConnectionPoint(room1, centroid2);
    point2 = findHallwayConnectionPoint(room2, centroid1);

    const dx = point2[0] - point1[0];
    const dy = point2[1] - point1[1];
    length = Math.sqrt(dx * dx + dy * dy);

    // If length is still too small (overlap), skip this segment
    if (length < MIN_HALLWAY_LENGTH) {
      console.warn(`Skipping hallway ${id} between ${room1.name} and ${room2.name}: length ${length.toFixed(2)}' is below minimum`);
      return null;
    }
  }

  // Build centerline
  const centerline: Point2D[] = [point1, point2];

  return {
    id,
    from: {
      roomId: room1.name,
      point: point1,
    },
    to: {
      roomId: room2.name,
      point: point2,
    },
    length,
    width,
    centerline,
  };
}

/**
 * Find junction points where multiple hallway segments meet.
 * Junctions occur when the same room has multiple hallway connections.
 */
function findJunctionPoints(segments: HallwaySegment[]): Point2D[] {
  // Count how many times each room appears in segments
  const roomConnections = new Map<string, Point2D[]>();

  for (const seg of segments) {
    // Track from-room connections
    const fromPoints = roomConnections.get(seg.from.roomId) || [];
    fromPoints.push(seg.from.point);
    roomConnections.set(seg.from.roomId, fromPoints);

    // Track to-room connections
    const toPoints = roomConnections.get(seg.to.roomId) || [];
    toPoints.push(seg.to.point);
    roomConnections.set(seg.to.roomId, toPoints);
  }

  // Rooms with 3+ connections are junctions
  const junctions: Point2D[] = [];

  Array.from(roomConnections.entries()).forEach(([_roomId, points]) => {
    if (points.length >= 3) {
      // Use centroid of connection points as junction location
      const sumX = points.reduce((s, p) => s + p[0], 0);
      const sumY = points.reduce((s, p) => s + p[1], 0);
      junctions.push([sumX / points.length, sumY / points.length]);
    }
  });

  return junctions;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if the hallway network is fully connected (all rooms reachable).
 *
 * @param network - The hallway network to check
 * @param rooms - All rooms that should be connected
 * @returns true if all rooms are reachable through hallways or adjacency
 */
export function isNetworkConnected(
  network: HallwayNetwork,
  rooms: RoomBounds[]
): boolean {
  if (rooms.length <= 1) return true;

  // Build adjacency list from segments
  const adj = new Map<string, Set<string>>();

  for (const room of rooms) {
    adj.set(room.name, new Set());
  }

  for (const seg of network.segments) {
    adj.get(seg.from.roomId)?.add(seg.to.roomId);
    adj.get(seg.to.roomId)?.add(seg.from.roomId);
  }

  // BFS from first room
  const visited = new Set<string>();
  const queue = [rooms[0].name];
  visited.add(rooms[0].name);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = adj.get(current) || new Set<string>();

    Array.from(neighbors).forEach(neighbor => {
      if (!visited.has(neighbor)) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    });
  }

  return visited.size === rooms.length;
}

/**
 * Calculate efficiency ratio of the hallway network.
 * Lower is better (less hallway per room).
 *
 * @param network - The hallway network
 * @param totalRoomArea - Combined area of all rooms
 * @returns Ratio of hallway area to room area
 */
export function calculateNetworkEfficiency(
  network: HallwayNetwork,
  totalRoomArea: number
): number {
  if (totalRoomArea === 0) return 0;
  return network.totalArea / totalRoomArea;
}

/**
 * Get a human-readable summary of the hallway network.
 */
export function getNetworkSummary(network: HallwayNetwork): string {
  const lines: string[] = [
    `Hallway Network Summary:`,
    `  Segments: ${network.segments.length}`,
    `  Total Length: ${network.totalLength.toFixed(1)} ft`,
    `  Total Area: ${network.totalArea.toFixed(1)} sq ft`,
    `  Junctions: ${network.junctions.length}`,
    ``,
    `Segments:`,
  ];

  for (const seg of network.segments) {
    lines.push(
      `  - ${seg.from.roomId} -> ${seg.to.roomId}: ${seg.length.toFixed(1)}' x ${seg.width}' = ${(seg.length * seg.width).toFixed(1)} sq ft`
    );
  }

  return lines.join('\n');
}
