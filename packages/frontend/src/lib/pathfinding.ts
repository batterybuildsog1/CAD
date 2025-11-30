/**
 * A* Pathfinding Validation for Floor Plan Circulation
 *
 * This module validates that a person can actually WALK from the entry to every room
 * through the generated hallways. It provides:
 *
 * 1. A* Algorithm implementation for pathfinding
 * 2. Walkability grid generation from floor plan geometry
 * 3. Room-to-room path validation
 * 4. Full circulation reachability verification
 *
 * Core Problem Solved:
 * - Verify every room is reachable from the entry
 * - Detect dead-ends that would trap someone
 * - Ensure the path through hallways is actually walkable (no walls in the way)
 */

import type { Point2D, Polygon2D, RoomType } from './gemini-types';
import type { RoomBounds, DoorPosition } from './circulation-spine';
import { ROOM_ACCESS_RULES, type AccessType } from './circulation-spine';
import type { HallwaySegment, HallwayNetwork } from './hallway-mst';

// ============================================================================
// Types
// ============================================================================

/**
 * Node in the A* pathfinding algorithm
 */
export interface PathNode {
  /** Unique identifier for this node (grid position or point hash) */
  id: string;

  /** Position in world coordinates */
  position: Point2D;

  /** Cost from start to this node */
  gCost: number;

  /** Heuristic (estimated cost to goal) */
  hCost: number;

  /** Total cost: gCost + hCost */
  fCost: number;

  /** Parent node for path reconstruction */
  parent: PathNode | null;
}

/**
 * Result of a pathfinding operation between two points
 */
export interface PathResult {
  /** Whether a path was found */
  found: boolean;

  /** Ordered list of points from start to goal */
  path: Point2D[];

  /** Total path distance in feet */
  distance: number;

  /** Room IDs traversed along the path */
  roomsTraversed: string[];

  /** Door IDs used along the path */
  doorsUsed: string[];
}

/**
 * Hallway polygon with metadata for pathfinding
 */
export interface HallwayPolygon {
  /** Unique identifier */
  id: string;

  /** Polygon vertices (closed polygon) */
  vertices: Point2D[];

  /** Width of the hallway */
  width: number;

  /** Connected room IDs */
  connectedRooms: string[];
}

/**
 * Result of validating all rooms are reachable
 */
export interface ValidationResult {
  /** Whether all rooms are reachable from the entry */
  allReachable: boolean;

  /** List of room IDs that are reachable */
  reachableRooms: string[];

  /** List of room IDs that cannot be reached */
  unreachableRooms: string[];

  /** Path details from entry to each room */
  pathDetails: Map<string, PathResult>;
}

/**
 * Grid-based walkability representation of the floor plan
 */
export interface WalkabilityGrid {
  /** 2D array of walkable cells (true = walkable) */
  cells: boolean[][];

  /** Grid resolution in feet per cell */
  resolution: number;

  /** Grid width in cells */
  width: number;

  /** Grid height in cells */
  height: number;

  /**
   * Convert world coordinates to grid coordinates
   * @param point - Point in world space (feet)
   * @returns [gridX, gridY] tuple
   */
  toGridCoord(point: Point2D): [number, number];

  /**
   * Convert grid coordinates to world coordinates
   * @param gridX - Grid X coordinate
   * @param gridY - Grid Y coordinate
   * @returns Point in world space (feet)
   */
  toWorldCoord(gridX: number, gridY: number): Point2D;
}

/**
 * Door-to-hallway connection information
 */
export interface DoorHallwayConnection {
  /** Door identifier */
  doorId: string;

  /** Hallway identifier */
  hallwayId: string;

  /** Position of the door opening */
  position: Point2D;

  /** Room the door belongs to */
  roomId: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Default grid resolution in feet per cell */
const DEFAULT_GRID_RESOLUTION = 0.5;

/** Diagonal movement cost (sqrt(2)) */
const DIAGONAL_COST = Math.SQRT2;

/** Cardinal direction movement cost */
const CARDINAL_COST = 1.0;

/** 8-directional neighbor offsets: [dx, dy, cost] */
const NEIGHBORS: Array<[number, number, number]> = [
  [-1, 0, CARDINAL_COST],   // West
  [1, 0, CARDINAL_COST],    // East
  [0, -1, CARDINAL_COST],   // South
  [0, 1, CARDINAL_COST],    // North
  [-1, -1, DIAGONAL_COST],  // Southwest
  [1, -1, DIAGONAL_COST],   // Southeast
  [-1, 1, DIAGONAL_COST],   // Northwest
  [1, 1, DIAGONAL_COST],    // Northeast
];

// ============================================================================
// Min-Heap Implementation for A* Open Set
// ============================================================================

/**
 * Min-heap priority queue optimized for A* pathfinding
 * Orders nodes by fCost (lowest first)
 */
class MinHeap {
  private heap: PathNode[] = [];
  private nodeMap: Map<string, number> = new Map(); // id -> heap index

  /** Number of nodes in the heap */
  get size(): number {
    return this.heap.length;
  }

  /** Check if heap is empty */
  isEmpty(): boolean {
    return this.heap.length === 0;
  }

  /** Check if a node ID is in the heap */
  contains(id: string): boolean {
    return this.nodeMap.has(id);
  }

  /** Get a node by ID (or undefined if not found) */
  get(id: string): PathNode | undefined {
    const idx = this.nodeMap.get(id);
    return idx !== undefined ? this.heap[idx] : undefined;
  }

  /**
   * Insert a node into the heap
   */
  push(node: PathNode): void {
    this.heap.push(node);
    const idx = this.heap.length - 1;
    this.nodeMap.set(node.id, idx);
    this.bubbleUp(idx);
  }

  /**
   * Remove and return the node with lowest fCost
   */
  pop(): PathNode | undefined {
    if (this.heap.length === 0) return undefined;

    const min = this.heap[0];
    const last = this.heap.pop()!;
    this.nodeMap.delete(min.id);

    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.nodeMap.set(last.id, 0);
      this.bubbleDown(0);
    }

    return min;
  }

  /**
   * Update a node's priority (decrease key operation)
   */
  decreaseKey(node: PathNode): void {
    const idx = this.nodeMap.get(node.id);
    if (idx === undefined) return;

    this.heap[idx] = node;
    this.bubbleUp(idx);
  }

  /**
   * Bubble up a node to maintain heap property
   */
  private bubbleUp(idx: number): void {
    while (idx > 0) {
      const parentIdx = Math.floor((idx - 1) / 2);
      if (this.heap[idx].fCost >= this.heap[parentIdx].fCost) break;

      // Swap
      this.swap(idx, parentIdx);
      idx = parentIdx;
    }
  }

  /**
   * Bubble down a node to maintain heap property
   */
  private bubbleDown(idx: number): void {
    const length = this.heap.length;

    while (true) {
      const leftIdx = 2 * idx + 1;
      const rightIdx = 2 * idx + 2;
      let smallest = idx;

      if (leftIdx < length && this.heap[leftIdx].fCost < this.heap[smallest].fCost) {
        smallest = leftIdx;
      }
      if (rightIdx < length && this.heap[rightIdx].fCost < this.heap[smallest].fCost) {
        smallest = rightIdx;
      }

      if (smallest === idx) break;

      this.swap(idx, smallest);
      idx = smallest;
    }
  }

  /**
   * Swap two nodes in the heap
   */
  private swap(i: number, j: number): void {
    const temp = this.heap[i];
    this.heap[i] = this.heap[j];
    this.heap[j] = temp;
    this.nodeMap.set(this.heap[i].id, i);
    this.nodeMap.set(this.heap[j].id, j);
  }
}

// ============================================================================
// Core A* Algorithm
// ============================================================================

/**
 * A* pathfinding algorithm on a walkability grid
 *
 * @param grid - Walkability grid
 * @param start - Start point in world coordinates
 * @param goal - Goal point in world coordinates
 * @returns Path as array of world coordinate points, or null if no path exists
 */
export function aStarPathfind(
  grid: WalkabilityGrid,
  start: Point2D,
  goal: Point2D
): Point2D[] | null {
  // Convert to grid coordinates
  const startGrid = grid.toGridCoord(start);
  const goalGrid = grid.toGridCoord(goal);

  // Validate start and goal are walkable
  if (!isGridCellWalkable(grid, startGrid[0], startGrid[1])) {
    // Try to find nearest walkable cell to start
    const nearestStart = findNearestWalkableCell(grid, startGrid[0], startGrid[1]);
    if (!nearestStart) return null;
    startGrid[0] = nearestStart[0];
    startGrid[1] = nearestStart[1];
  }

  if (!isGridCellWalkable(grid, goalGrid[0], goalGrid[1])) {
    // Try to find nearest walkable cell to goal
    const nearestGoal = findNearestWalkableCell(grid, goalGrid[0], goalGrid[1]);
    if (!nearestGoal) return null;
    goalGrid[0] = nearestGoal[0];
    goalGrid[1] = nearestGoal[1];
  }

  // Initialize data structures
  const openSet = new MinHeap();
  const closedSet = new Set<string>();

  // Create start node
  const startNode: PathNode = {
    id: `${startGrid[0]},${startGrid[1]}`,
    position: grid.toWorldCoord(startGrid[0], startGrid[1]),
    gCost: 0,
    hCost: heuristic(startGrid, goalGrid, grid.resolution),
    fCost: 0,
    parent: null,
  };
  startNode.fCost = startNode.gCost + startNode.hCost;

  openSet.push(startNode);

  // Main A* loop
  while (!openSet.isEmpty()) {
    const current = openSet.pop()!;

    // Check if we've reached the goal
    const currentGrid = grid.toGridCoord(current.position);
    if (currentGrid[0] === goalGrid[0] && currentGrid[1] === goalGrid[1]) {
      return reconstructPath(current);
    }

    closedSet.add(current.id);

    // Explore neighbors
    for (const [dx, dy, moveCost] of NEIGHBORS) {
      const neighborX = currentGrid[0] + dx;
      const neighborY = currentGrid[1] + dy;
      const neighborId = `${neighborX},${neighborY}`;

      // Skip if out of bounds or not walkable
      if (!isGridCellWalkable(grid, neighborX, neighborY)) continue;

      // Skip if in closed set
      if (closedSet.has(neighborId)) continue;

      // For diagonal moves, check that we can actually move diagonally
      // (both adjacent cardinal cells must be walkable to prevent corner cutting)
      if (dx !== 0 && dy !== 0) {
        if (!isGridCellWalkable(grid, currentGrid[0] + dx, currentGrid[1]) ||
            !isGridCellWalkable(grid, currentGrid[0], currentGrid[1] + dy)) {
          continue;
        }
      }

      const tentativeG = current.gCost + moveCost * grid.resolution;

      // Check if already in open set
      const existingNode = openSet.get(neighborId);
      if (existingNode) {
        if (tentativeG < existingNode.gCost) {
          // Found a better path to this node
          existingNode.gCost = tentativeG;
          existingNode.fCost = tentativeG + existingNode.hCost;
          existingNode.parent = current;
          openSet.decreaseKey(existingNode);
        }
      } else {
        // Add new node to open set
        const neighborNode: PathNode = {
          id: neighborId,
          position: grid.toWorldCoord(neighborX, neighborY),
          gCost: tentativeG,
          hCost: heuristic([neighborX, neighborY], goalGrid, grid.resolution),
          fCost: 0,
          parent: current,
        };
        neighborNode.fCost = neighborNode.gCost + neighborNode.hCost;
        openSet.push(neighborNode);
      }
    }
  }

  // No path found
  return null;
}

/**
 * A* pathfinding using polygon-based walkable areas
 * This is a more direct approach that works with the raw geometry
 *
 * @param start - Start point in world coordinates
 * @param goal - Goal point in world coordinates
 * @param walkableAreas - Polygons representing walkable space (hallways + rooms)
 * @param obstacles - Polygons representing impassable obstacles (walls)
 * @returns Path as array of world coordinate points, or null if no path exists
 */
export function aStarPathfindPolygon(
  start: Point2D,
  goal: Point2D,
  walkableAreas: Polygon2D[],
  obstacles: Polygon2D[] = []
): Point2D[] | null {
  // Determine bounds of walkable area
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const polygon of walkableAreas) {
    for (const [x, y] of polygon) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (!isFinite(minX)) return null;

  // Create a temporary walkability grid
  const resolution = DEFAULT_GRID_RESOLUTION;
  const width = Math.ceil((maxX - minX) / resolution) + 2;
  const height = Math.ceil((maxY - minY) / resolution) + 2;

  const cells: boolean[][] = [];
  for (let y = 0; y < height; y++) {
    cells[y] = new Array(width).fill(false);
  }

  // Mark walkable cells
  for (let gy = 0; gy < height; gy++) {
    for (let gx = 0; gx < width; gx++) {
      const worldX = minX + gx * resolution;
      const worldY = minY + gy * resolution;
      const point: Point2D = [worldX, worldY];

      // Check if point is inside any walkable area
      let isWalkable = false;
      for (const polygon of walkableAreas) {
        if (isPointInPolygon(point, polygon)) {
          isWalkable = true;
          break;
        }
      }

      // Check if point is inside any obstacle
      if (isWalkable) {
        for (const obstacle of obstacles) {
          if (isPointInPolygon(point, obstacle)) {
            isWalkable = false;
            break;
          }
        }
      }

      cells[gy][gx] = isWalkable;
    }
  }

  // Create grid object
  const grid: WalkabilityGrid = {
    cells,
    resolution,
    width,
    height,
    toGridCoord(point: Point2D): [number, number] {
      const gx = Math.floor((point[0] - minX) / resolution);
      const gy = Math.floor((point[1] - minY) / resolution);
      return [
        Math.max(0, Math.min(width - 1, gx)),
        Math.max(0, Math.min(height - 1, gy)),
      ];
    },
    toWorldCoord(gx: number, gy: number): Point2D {
      return [
        minX + (gx + 0.5) * resolution,
        minY + (gy + 0.5) * resolution,
      ];
    },
  };

  return aStarPathfind(grid, start, goal);
}

/**
 * Heuristic function for A* (Euclidean distance)
 */
function heuristic(
  from: [number, number],
  to: [number, number],
  resolution: number
): number {
  const dx = (to[0] - from[0]) * resolution;
  const dy = (to[1] - from[1]) * resolution;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Reconstruct path from goal node back to start
 */
function reconstructPath(goalNode: PathNode): Point2D[] {
  const path: Point2D[] = [];
  let current: PathNode | null = goalNode;

  while (current !== null) {
    path.unshift(current.position);
    current = current.parent;
  }

  return path;
}

/**
 * Check if a grid cell is walkable
 */
function isGridCellWalkable(
  grid: WalkabilityGrid,
  x: number,
  y: number
): boolean {
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) {
    return false;
  }
  return grid.cells[y][x];
}

/**
 * Find the nearest walkable cell to a given grid position
 * Uses BFS to search outward from the given position
 */
function findNearestWalkableCell(
  grid: WalkabilityGrid,
  startX: number,
  startY: number,
  maxRadius: number = 10
): [number, number] | null {
  // BFS to find nearest walkable cell
  const visited = new Set<string>();
  const queue: Array<[number, number, number]> = [[startX, startY, 0]];

  while (queue.length > 0) {
    const [x, y, dist] = queue.shift()!;

    if (dist > maxRadius) continue;

    const key = `${x},${y}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (isGridCellWalkable(grid, x, y)) {
      return [x, y];
    }

    // Add neighbors
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && nx < grid.width && ny >= 0 && ny < grid.height) {
        queue.push([nx, ny, dist + 1]);
      }
    }
  }

  return null;
}

// ============================================================================
// Room-to-Room Pathfinding
// ============================================================================

/**
 * Find a path between two rooms using hallways and doors
 *
 * @param fromRoomId - ID of the starting room
 * @param toRoomId - ID of the destination room
 * @param rooms - All rooms in the floor plan
 * @param hallways - Hallway polygons connecting rooms
 * @param doors - Door positions connecting rooms to hallways
 * @returns PathResult with path details
 */
export function findPathBetweenRooms(
  fromRoomId: string,
  toRoomId: string,
  rooms: RoomBounds[],
  hallways: HallwayPolygon[],
  doors: DoorPosition[]
): PathResult {
  // Find the rooms
  const fromRoom = rooms.find(r => r.name === fromRoomId);
  const toRoom = rooms.find(r => r.name === toRoomId);

  if (!fromRoom || !toRoom) {
    return {
      found: false,
      path: [],
      distance: 0,
      roomsTraversed: [],
      doorsUsed: [],
    };
  }

  // Get room centers as start/end points
  const start: Point2D = [
    fromRoom.x + fromRoom.width / 2,
    fromRoom.y + fromRoom.depth / 2,
  ];
  const goal: Point2D = [
    toRoom.x + toRoom.width / 2,
    toRoom.y + toRoom.depth / 2,
  ];

  // Build walkable areas from rooms and hallways
  const walkableAreas: Polygon2D[] = [];

  // Add ONLY public room polygons (filter by access type)
  // Private rooms (bedroom, bathroom) require direct hallway access
  for (const room of rooms) {
    const accessType = ROOM_ACCESS_RULES[room.type];

    // Only add public/hub/service spaces to walkable areas
    // 'direct' and 'indirect' access types are private (bedroom, bathroom, closet)
    if (accessType === 'hub' || accessType === 'shared' || accessType === 'service') {
      walkableAreas.push(roomToPolygon(room));
    }
  }

  // IMPORTANT: Also add START and GOAL rooms as walkable (even if private)
  // This allows paths to START from or END at a bedroom, but not TRAVERSE through others
  const startRoom = rooms.find(r => isPointInRoom(start, r));
  const goalRoom = rooms.find(r => isPointInRoom(goal, r));
  if (startRoom) walkableAreas.push(roomToPolygon(startRoom));
  if (goalRoom && goalRoom !== startRoom) walkableAreas.push(roomToPolygon(goalRoom));

  // Add hallway polygons
  for (const hallway of hallways) {
    walkableAreas.push(hallway.vertices);
  }

  // Find path using A*
  const path = aStarPathfindPolygon(start, goal, walkableAreas);

  if (!path) {
    return {
      found: false,
      path: [],
      distance: 0,
      roomsTraversed: [],
      doorsUsed: [],
    };
  }

  // Calculate total distance
  let distance = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    distance += Math.sqrt(dx * dx + dy * dy);
  }

  // Determine rooms traversed
  const roomsTraversed = findRoomsAlongPath(path, rooms);

  // Determine doors used
  const doorsUsed = findDoorsAlongPath(path, doors);

  return {
    found: true,
    path,
    distance,
    roomsTraversed,
    doorsUsed,
  };
}

/**
 * Find all rooms that the path passes through
 */
function findRoomsAlongPath(path: Point2D[], rooms: RoomBounds[]): string[] {
  const traversed: string[] = [];
  const seen = new Set<string>();

  for (const point of path) {
    for (const room of rooms) {
      if (seen.has(room.name)) continue;

      if (isPointInRoom(point, room)) {
        traversed.push(room.name);
        seen.add(room.name);
      }
    }
  }

  return traversed;
}

/**
 * Find all doors that the path passes near
 */
function findDoorsAlongPath(path: Point2D[], doors: DoorPosition[]): string[] {
  const used: string[] = [];
  const DOOR_PROXIMITY = 2.0; // feet

  for (let i = 0; i < doors.length; i++) {
    const door = doors[i];

    for (const point of path) {
      const dx = point[0] - door.point[0];
      const dy = point[1] - door.point[1];
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < DOOR_PROXIMITY) {
        used.push(`door-${i}`);
        break;
      }
    }
  }

  return used;
}

/**
 * Check if a point is inside a room
 */
function isPointInRoom(point: Point2D, room: RoomBounds): boolean {
  return (
    point[0] >= room.x &&
    point[0] <= room.x + room.width &&
    point[1] >= room.y &&
    point[1] <= room.y + room.depth
  );
}

/**
 * Check if a room type allows general traversal (not just direct access)
 *
 * Rooms with 'hub', 'shared', or 'service' access types can be traversed.
 * Rooms with 'direct' or 'indirect' access (bedrooms, bathrooms, closets)
 * require direct hallway access and cannot be used as pass-through spaces.
 *
 * @param roomType - The type of room to check
 * @returns true if paths can traverse through this room type
 */
export function isRoomTraversable(roomType: RoomType): boolean {
  const accessType = ROOM_ACCESS_RULES[roomType];
  return accessType === 'hub' || accessType === 'shared' || accessType === 'service';
}

/**
 * Convert RoomBounds to a polygon
 */
function roomToPolygon(room: RoomBounds): Polygon2D {
  return [
    [room.x, room.y],
    [room.x + room.width, room.y],
    [room.x + room.width, room.y + room.depth],
    [room.x, room.y + room.depth],
  ];
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate that all rooms are reachable from the entry room
 *
 * @param rooms - All rooms in the floor plan
 * @param hallways - Hallway polygons connecting rooms
 * @param doors - Door positions
 * @param entryRoomId - ID of the entry/foyer room
 * @returns ValidationResult with reachability details
 */
export function validateAllRoomsReachable(
  rooms: RoomBounds[],
  hallways: HallwayPolygon[],
  doors: DoorPosition[],
  entryRoomId: string
): ValidationResult {
  const reachableRooms: string[] = [];
  const unreachableRooms: string[] = [];
  const pathDetails = new Map<string, PathResult>();

  // Find entry room
  const entryRoom = rooms.find(r => r.name === entryRoomId);
  if (!entryRoom) {
    // No entry room found - all rooms are unreachable
    return {
      allReachable: false,
      reachableRooms: [],
      unreachableRooms: rooms.map(r => r.name),
      pathDetails,
    };
  }

  // Entry room is always reachable
  reachableRooms.push(entryRoomId);
  pathDetails.set(entryRoomId, {
    found: true,
    path: [[entryRoom.x + entryRoom.width / 2, entryRoom.y + entryRoom.depth / 2]],
    distance: 0,
    roomsTraversed: [entryRoomId],
    doorsUsed: [],
  });

  // Check path from entry to each other room
  for (const room of rooms) {
    if (room.name === entryRoomId) continue;

    const result = findPathBetweenRooms(
      entryRoomId,
      room.name,
      rooms,
      hallways,
      doors
    );

    pathDetails.set(room.name, result);

    if (result.found) {
      reachableRooms.push(room.name);
    } else {
      unreachableRooms.push(room.name);
    }
  }

  return {
    allReachable: unreachableRooms.length === 0,
    reachableRooms,
    unreachableRooms,
    pathDetails,
  };
}

/**
 * Validate reachability using the MST hallway network
 *
 * @param rooms - All rooms in the floor plan
 * @param network - Hallway network from MST algorithm
 * @param entryRoomId - ID of the entry/foyer room
 * @returns ValidationResult with reachability details
 */
export function validateNetworkReachability(
  rooms: RoomBounds[],
  network: HallwayNetwork,
  entryRoomId: string
): ValidationResult {
  // Convert hallway segments to polygons
  const hallways: HallwayPolygon[] = network.segments.map(seg => ({
    id: seg.id,
    vertices: createHallwayPolygonFromSegment(seg),
    width: seg.width,
    connectedRooms: [seg.from.roomId, seg.to.roomId],
  }));

  // No explicit doors - the segment connections imply door positions
  const doors: DoorPosition[] = [];

  return validateAllRoomsReachable(rooms, hallways, doors, entryRoomId);
}

/**
 * Create a polygon from a hallway segment
 */
function createHallwayPolygonFromSegment(segment: HallwaySegment): Polygon2D {
  const halfWidth = segment.width / 2;
  const start = segment.from.point;
  const end = segment.to.point;

  // Calculate direction vector
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len < 0.01) {
    // Degenerate segment - return small square
    return [
      [start[0] - halfWidth, start[1] - halfWidth],
      [start[0] + halfWidth, start[1] - halfWidth],
      [start[0] + halfWidth, start[1] + halfWidth],
      [start[0] - halfWidth, start[1] + halfWidth],
    ];
  }

  // Normalize and get perpendicular
  const nx = dx / len;
  const ny = dy / len;
  const px = -ny;
  const py = nx;

  // Create rectangle
  return [
    [start[0] + px * halfWidth, start[1] + py * halfWidth],
    [start[0] - px * halfWidth, start[1] - py * halfWidth],
    [end[0] - px * halfWidth, end[1] - py * halfWidth],
    [end[0] + px * halfWidth, end[1] + py * halfWidth],
  ];
}

/**
 * Check if a point is inside walkable area (rooms or hallways)
 *
 * @param point - Point to check
 * @param rooms - All rooms in the floor plan
 * @param hallways - Hallway polygons
 * @returns true if the point is walkable
 */
export function isPointWalkable(
  point: Point2D,
  rooms: RoomBounds[],
  hallways: HallwayPolygon[]
): boolean {
  // Check rooms
  for (const room of rooms) {
    if (isPointInRoom(point, room)) {
      return true;
    }
  }

  // Check hallways
  for (const hallway of hallways) {
    if (isPointInPolygon(point, hallway.vertices)) {
      return true;
    }
  }

  return false;
}

/**
 * Get all door positions that connect to hallways
 *
 * @param doors - All door positions
 * @param hallways - Hallway polygons
 * @returns Array of door-hallway connections
 */
export function getDoorToHallwayConnections(
  doors: DoorPosition[],
  hallways: HallwayPolygon[]
): DoorHallwayConnection[] {
  const connections: DoorHallwayConnection[] = [];

  for (let i = 0; i < doors.length; i++) {
    const door = doors[i];

    for (const hallway of hallways) {
      // Check if door position is near the hallway
      if (isPointInPolygon(door.point, hallway.vertices) ||
          isPointNearPolygon(door.point, hallway.vertices, door.width)) {
        connections.push({
          doorId: `door-${i}`,
          hallwayId: hallway.id,
          position: door.point,
          roomId: door.connectsTo,
        });
      }
    }
  }

  return connections;
}

/**
 * Check if a point is near a polygon (within distance)
 */
function isPointNearPolygon(
  point: Point2D,
  polygon: Polygon2D,
  maxDistance: number
): boolean {
  // Check distance to each edge of the polygon
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const dist = distanceToLineSegment(point, polygon[i], polygon[j]);
    if (dist <= maxDistance) {
      return true;
    }
  }
  return false;
}

/**
 * Calculate distance from a point to a line segment
 */
function distanceToLineSegment(point: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) {
    // Degenerate segment (a == b)
    const pdx = point[0] - a[0];
    const pdy = point[1] - a[1];
    return Math.sqrt(pdx * pdx + pdy * pdy);
  }

  // Calculate projection parameter
  const t = Math.max(0, Math.min(1,
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq
  ));

  // Find closest point on segment
  const projX = a[0] + t * dx;
  const projY = a[1] + t * dy;

  // Return distance
  const pdx = point[0] - projX;
  const pdy = point[1] - projY;
  return Math.sqrt(pdx * pdx + pdy * pdy);
}

// ============================================================================
// Grid Creation
// ============================================================================

/**
 * Create a walkability grid from floor plan geometry
 *
 * @param footprint - Building footprint dimensions
 * @param rooms - All rooms in the floor plan
 * @param hallways - Hallway polygons
 * @param gridResolution - Resolution in feet per cell (default 0.5')
 * @returns WalkabilityGrid with walkable/blocked cells
 */
export function createWalkabilityGrid(
  footprint: { width: number; depth: number },
  rooms: RoomBounds[],
  hallways: HallwayPolygon[],
  gridResolution: number = DEFAULT_GRID_RESOLUTION
): WalkabilityGrid {
  const gridWidth = Math.ceil(footprint.width / gridResolution);
  const gridHeight = Math.ceil(footprint.depth / gridResolution);

  // Initialize grid with all cells blocked
  const cells: boolean[][] = [];
  for (let y = 0; y < gridHeight; y++) {
    cells[y] = new Array(gridWidth).fill(false);
  }

  // Mark room cells as walkable (only public/hub rooms)
  for (const room of rooms) {
    const accessType = ROOM_ACCESS_RULES[room.type];

    // Skip private rooms - they're not walkable areas for general pathfinding
    // Private rooms require direct hallway access, not traversal through other rooms
    if (accessType === 'direct' || accessType === 'indirect') {
      continue;
    }

    const startX = Math.floor(room.x / gridResolution);
    const startY = Math.floor(room.y / gridResolution);
    const endX = Math.ceil((room.x + room.width) / gridResolution);
    const endY = Math.ceil((room.y + room.depth) / gridResolution);

    for (let y = startY; y < endY && y < gridHeight; y++) {
      for (let x = startX; x < endX && x < gridWidth; x++) {
        if (x >= 0 && y >= 0) {
          cells[y][x] = true;
        }
      }
    }
  }

  // Mark hallway cells as walkable
  for (const hallway of hallways) {
    // Get bounding box of hallway polygon
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    for (const [x, y] of hallway.vertices) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const startX = Math.max(0, Math.floor(minX / gridResolution));
    const startY = Math.max(0, Math.floor(minY / gridResolution));
    const endX = Math.min(gridWidth, Math.ceil(maxX / gridResolution));
    const endY = Math.min(gridHeight, Math.ceil(maxY / gridResolution));

    for (let gy = startY; gy < endY; gy++) {
      for (let gx = startX; gx < endX; gx++) {
        const worldX = gx * gridResolution + gridResolution / 2;
        const worldY = gy * gridResolution + gridResolution / 2;

        if (isPointInPolygon([worldX, worldY], hallway.vertices)) {
          cells[gy][gx] = true;
        }
      }
    }
  }

  // Create conversion functions with closure over resolution
  const resolution = gridResolution;

  return {
    cells,
    resolution,
    width: gridWidth,
    height: gridHeight,
    toGridCoord(point: Point2D): [number, number] {
      return [
        Math.max(0, Math.min(gridWidth - 1, Math.floor(point[0] / resolution))),
        Math.max(0, Math.min(gridHeight - 1, Math.floor(point[1] / resolution))),
      ];
    },
    toWorldCoord(gx: number, gy: number): Point2D {
      return [
        (gx + 0.5) * resolution,
        (gy + 0.5) * resolution,
      ];
    },
  };
}

// ============================================================================
// Geometry Utilities
// ============================================================================

/**
 * Check if a point is inside a polygon using ray casting algorithm
 *
 * @param point - Point to check
 * @param polygon - Polygon vertices (closed polygon, no need to repeat first point)
 * @returns true if point is inside polygon
 */
export function isPointInPolygon(point: Point2D, polygon: Polygon2D): boolean {
  if (polygon.length < 3) return false;

  const [px, py] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];

    // Check if ray from point going right intersects this edge
    if (((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }

  return inside;
}

/**
 * Calculate Euclidean distance between two points
 */
export function distance(a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get center point of a polygon
 */
export function getPolygonCenter(polygon: Polygon2D): Point2D {
  if (polygon.length === 0) return [0, 0];

  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of polygon) {
    sumX += x;
    sumY += y;
  }

  return [sumX / polygon.length, sumY / polygon.length];
}

// ============================================================================
// Debug/Visualization Helpers
// ============================================================================

/**
 * Generate a human-readable path description
 */
export function describePathResult(result: PathResult): string {
  if (!result.found) {
    return 'No path found';
  }

  const lines: string[] = [
    `Path found: ${result.distance.toFixed(1)} feet`,
    `  Waypoints: ${result.path.length}`,
    `  Rooms traversed: ${result.roomsTraversed.join(' -> ')}`,
  ];

  if (result.doorsUsed.length > 0) {
    lines.push(`  Doors used: ${result.doorsUsed.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Generate a validation summary
 */
export function describeValidationResult(result: ValidationResult): string {
  const lines: string[] = [
    result.allReachable
      ? 'All rooms are reachable from entry.'
      : `WARNING: ${result.unreachableRooms.length} room(s) are unreachable!`,
    '',
    `Reachable (${result.reachableRooms.length}):`,
  ];

  for (const roomId of result.reachableRooms) {
    const pathResult = result.pathDetails.get(roomId);
    const dist = pathResult?.distance ?? 0;
    lines.push(`  - ${roomId}: ${dist.toFixed(1)} ft`);
  }

  if (result.unreachableRooms.length > 0) {
    lines.push('');
    lines.push(`Unreachable (${result.unreachableRooms.length}):`);
    for (const roomId of result.unreachableRooms) {
      lines.push(`  - ${roomId}`);
    }
  }

  return lines.join('\n');
}

/**
 * Render walkability grid as ASCII art for debugging
 */
export function renderGridAsAscii(grid: WalkabilityGrid): string {
  const lines: string[] = [];

  // Render from top to bottom (reverse Y order)
  for (let y = grid.height - 1; y >= 0; y--) {
    let line = '';
    for (let x = 0; x < grid.width; x++) {
      line += grid.cells[y][x] ? '.' : '#';
    }
    lines.push(line);
  }

  return lines.join('\n');
}
