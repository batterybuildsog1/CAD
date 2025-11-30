/**
 * Circulation Graph - Room Adjacency and Connectivity Validation
 *
 * This module implements a graph-based approach to floor plan circulation validation.
 * Unlike area-based calculations, this ensures rooms are actually CONNECTED via doors,
 * openings, or hallways.
 *
 * Key Concepts:
 * - Nodes: Rooms in the floor plan
 * - Edges: Physical connections (doors, openings, hallways)
 * - Connectivity: Can you walk from entry to every room?
 *
 * Graph Theory Applied:
 * - BFS traversal for reachability analysis
 * - Shortest path for optimal routing
 * - Connected components for isolation detection
 */

import type { RoomType, Point2D } from './gemini-types';
import { ROOM_ACCESS_RULES, type RoomBounds, type DoorPosition, type AccessType } from './circulation-spine';

// ============================================================================
// Types
// ============================================================================

/**
 * A node in the circulation graph representing a room
 */
export interface GraphNode {
  /** Unique identifier for this room */
  id: string;

  /** The type of room (bedroom, bathroom, etc.) */
  roomType: RoomType;

  /** Geometric center of the room */
  centroid: Point2D;

  /** Bounding rectangle of the room */
  bounds: {
    x: number;
    y: number;
    width: number;
    depth: number;
  };
}

/**
 * An edge in the circulation graph representing a connection between rooms
 */
export interface GraphEdge {
  /** ID of the source room */
  from: string;

  /** ID of the destination room */
  to: string;

  /** Position of the door/opening (if applicable) */
  doorPosition?: Point2D;

  /** Type of connection */
  edgeType: 'door' | 'opening' | 'hallway';
}

/**
 * Result of connectivity validation
 */
export interface ConnectivityValidationResult {
  /** Whether all rooms are reachable from the entry */
  isValid: boolean;

  /** List of room IDs that cannot be reached from entry */
  unreachableRooms: string[];

  /** List of room IDs that are reachable from entry */
  reachableRooms: string[];

  /** Description of missing connections needed to fix issues */
  missingConnections: string[];

  /** Non-critical issues that should be reviewed */
  warnings: string[];

  /** Number of disconnected components in the floor plan */
  componentCount: number;
}

/**
 * Result of shortest path calculation
 */
export interface PathResult {
  /** Ordered list of room IDs from start to end */
  path: string[];

  /** Total number of connections traversed */
  distance: number;

  /** Whether a path was found */
  found: boolean;
}

// ============================================================================
// CirculationGraph Class
// ============================================================================

/**
 * CirculationGraph - Models room connectivity as a graph structure
 *
 * This class provides methods to:
 * 1. Build a graph from rooms and connections
 * 2. Validate that all rooms are reachable from entry
 * 3. Find shortest paths between rooms
 * 4. Identify required hallway connections
 *
 * @example
 * ```typescript
 * const graph = new CirculationGraph();
 *
 * // Add rooms as nodes
 * graph.addRoom({ id: 'foyer', roomType: 'foyer', centroid: [10, 5], bounds: {...} });
 * graph.addRoom({ id: 'living', roomType: 'living', centroid: [20, 15], bounds: {...} });
 *
 * // Add connections (doors/openings)
 * graph.addConnection('foyer', 'living', 'opening');
 *
 * // Validate connectivity
 * const unreachable = graph.findUnreachableRooms('foyer');
 * if (unreachable.length > 0) {
 *   console.error('Isolated rooms:', unreachable);
 * }
 * ```
 */
export class CirculationGraph {
  /** Map of room ID to node data */
  nodes: Map<string, GraphNode>;

  /** List of all edges (connections) in the graph */
  edges: GraphEdge[];

  /** Adjacency list for efficient traversal */
  private adjacencyList: Map<string, Set<string>>;

  constructor() {
    this.nodes = new Map();
    this.edges = [];
    this.adjacencyList = new Map();
  }

  // --------------------------------------------------------------------------
  // Graph Construction
  // --------------------------------------------------------------------------

  /**
   * Add a room as a node in the graph
   *
   * @param room - The room to add (can be GraphNode or RoomBounds)
   */
  addRoom(room: GraphNode | RoomBounds): void {
    // Convert RoomBounds to GraphNode if needed
    const node: GraphNode = 'id' in room
      ? room
      : {
          id: room.name,
          roomType: room.type,
          centroid: [room.x + room.width / 2, room.y + room.depth / 2],
          bounds: {
            x: room.x,
            y: room.y,
            width: room.width,
            depth: room.depth,
          },
        };

    this.nodes.set(node.id, node);

    // Initialize adjacency list entry
    if (!this.adjacencyList.has(node.id)) {
      this.adjacencyList.set(node.id, new Set());
    }
  }

  /**
   * Add a connection (edge) between two rooms
   *
   * Connections are bidirectional - a door from A to B also allows travel from B to A.
   *
   * @param fromId - ID of the first room
   * @param toId - ID of the second room
   * @param edgeType - Type of connection (door, opening, or hallway)
   * @param doorPosition - Optional position of the door/opening
   */
  addConnection(
    fromId: string,
    toId: string,
    edgeType: 'door' | 'opening' | 'hallway',
    doorPosition?: Point2D
  ): void {
    // Validate that both rooms exist
    if (!this.nodes.has(fromId)) {
      console.warn(`CirculationGraph: Cannot add connection - room '${fromId}' does not exist`);
      return;
    }
    if (!this.nodes.has(toId)) {
      console.warn(`CirculationGraph: Cannot add connection - room '${toId}' does not exist`);
      return;
    }

    // Check for duplicate edge
    const existingEdge = this.edges.find(
      e => (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId)
    );
    if (existingEdge) {
      return; // Edge already exists
    }

    // Add the edge
    this.edges.push({
      from: fromId,
      to: toId,
      edgeType,
      doorPosition,
    });

    // Update adjacency list (bidirectional)
    this.adjacencyList.get(fromId)!.add(toId);
    this.adjacencyList.get(toId)!.add(fromId);
  }

  /**
   * Remove a connection between two rooms
   *
   * @param fromId - ID of the first room
   * @param toId - ID of the second room
   */
  removeConnection(fromId: string, toId: string): void {
    // Remove from edges array
    this.edges = this.edges.filter(
      e => !((e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId))
    );

    // Update adjacency list
    this.adjacencyList.get(fromId)?.delete(toId);
    this.adjacencyList.get(toId)?.delete(fromId);
  }

  /**
   * Get all rooms connected to a given room
   *
   * @param roomId - ID of the room
   * @returns Array of connected room IDs
   */
  getConnectedRooms(roomId: string): string[] {
    return Array.from(this.adjacencyList.get(roomId) || []);
  }

  /**
   * Get the edge connecting two rooms (if any)
   *
   * @param fromId - ID of the first room
   * @param toId - ID of the second room
   * @returns The edge or undefined if not connected
   */
  getEdge(fromId: string, toId: string): GraphEdge | undefined {
    return this.edges.find(
      e => (e.from === fromId && e.to === toId) || (e.from === toId && e.to === fromId)
    );
  }

  // --------------------------------------------------------------------------
  // Connectivity Analysis
  // --------------------------------------------------------------------------

  /**
   * Check if all rooms are reachable from the entry room
   *
   * Uses Breadth-First Search (BFS) to traverse the graph from the entry point.
   * If BFS visits all nodes, the floor plan is fully connected.
   *
   * @param entryRoomId - ID of the entry room (typically foyer or front door)
   * @returns true if all rooms are reachable, false otherwise
   */
  isFullyConnected(entryRoomId: string): boolean {
    const reachable = this.bfsTraversal(entryRoomId);
    return reachable.size === this.nodes.size;
  }

  /**
   * Find all rooms that cannot be reached from the entry
   *
   * This identifies "island" rooms that have no path from the main entry.
   * These rooms represent critical floor plan errors.
   *
   * @param entryRoomId - ID of the entry room
   * @returns Array of unreachable room IDs
   */
  findUnreachableRooms(entryRoomId: string): string[] {
    const reachable = this.bfsTraversal(entryRoomId);
    const unreachable: string[] = [];

    for (const roomId of this.nodes.keys()) {
      if (!reachable.has(roomId)) {
        unreachable.push(roomId);
      }
    }

    return unreachable;
  }

  /**
   * Find the shortest path between two rooms
   *
   * Uses BFS to find the path with the minimum number of connections.
   * This is useful for circulation analysis and wayfinding.
   *
   * @param fromId - ID of the starting room
   * @param toId - ID of the destination room
   * @returns PathResult with the path and distance
   */
  getShortestPath(fromId: string, toId: string): PathResult {
    if (!this.nodes.has(fromId) || !this.nodes.has(toId)) {
      return { path: [], distance: -1, found: false };
    }

    if (fromId === toId) {
      return { path: [fromId], distance: 0, found: true };
    }

    // BFS with parent tracking for path reconstruction
    const visited = new Set<string>();
    const parent = new Map<string, string>();
    const queue: string[] = [fromId];
    visited.add(fromId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      if (current === toId) {
        // Found - reconstruct path
        const path: string[] = [];
        let node: string | undefined = toId;

        while (node !== undefined) {
          path.unshift(node);
          node = parent.get(node);
        }

        return {
          path,
          distance: path.length - 1,
          found: true,
        };
      }

      // Explore neighbors
      for (const neighbor of this.adjacencyList.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          parent.set(neighbor, current);
          queue.push(neighbor);
        }
      }
    }

    // No path found
    return { path: [], distance: -1, found: false };
  }

  /**
   * Get required hallway connections for rooms that need hallway access
   *
   * Based on ROOM_ACCESS_RULES, certain room types (bedrooms, bathrooms)
   * require direct hallway access. This method identifies rooms that need
   * such connections but don't have them.
   *
   * @returns Array of edges representing required hallway connections
   */
  getRequiredHallwayConnections(): GraphEdge[] {
    const required: GraphEdge[] = [];

    // Find all hallway nodes
    const hallwayIds = Array.from(this.nodes.values())
      .filter(n => n.roomType === 'hallway' || n.roomType === 'circulation')
      .map(n => n.id);

    // Check each room that needs direct access
    for (const [roomId, node] of this.nodes) {
      const accessType = ROOM_ACCESS_RULES[node.roomType];

      // Rooms with 'direct' access type need hallway connection
      if (accessType === 'direct') {
        const hasHallwayConnection = this.edges.some(
          e => ((e.from === roomId || e.to === roomId) &&
                (hallwayIds.includes(e.from) || hallwayIds.includes(e.to)))
        );

        if (!hasHallwayConnection) {
          // Find nearest hallway to suggest connection
          const nearestHallway = this.findNearestRoom(roomId, hallwayIds);

          if (nearestHallway) {
            required.push({
              from: roomId,
              to: nearestHallway,
              edgeType: 'hallway',
              doorPosition: node.centroid,
            });
          }
        }
      }
    }

    return required;
  }

  // --------------------------------------------------------------------------
  // Helper Methods
  // --------------------------------------------------------------------------

  /**
   * Perform BFS traversal from a starting node
   *
   * @param startId - ID of the starting node
   * @returns Set of all reachable node IDs
   */
  private bfsTraversal(startId: string): Set<string> {
    const visited = new Set<string>();

    if (!this.nodes.has(startId)) {
      return visited;
    }

    const queue: string[] = [startId];
    visited.add(startId);

    while (queue.length > 0) {
      const current = queue.shift()!;

      for (const neighbor of this.adjacencyList.get(current) || []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    return visited;
  }

  /**
   * Find the nearest room from a candidate list
   *
   * Uses Euclidean distance between centroids.
   *
   * @param roomId - ID of the reference room
   * @param candidateIds - IDs of candidate rooms to check
   * @returns ID of the nearest room or null if no candidates
   */
  private findNearestRoom(roomId: string, candidateIds: string[]): string | null {
    const room = this.nodes.get(roomId);
    if (!room || candidateIds.length === 0) {
      return null;
    }

    let nearestId: string | null = null;
    let minDistance = Infinity;

    for (const candidateId of candidateIds) {
      const candidate = this.nodes.get(candidateId);
      if (!candidate) continue;

      const dx = candidate.centroid[0] - room.centroid[0];
      const dy = candidate.centroid[1] - room.centroid[1];
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < minDistance) {
        minDistance = distance;
        nearestId = candidateId;
      }
    }

    return nearestId;
  }

  /**
   * Get all connected components in the graph
   *
   * A connected component is a maximal set of nodes where every node
   * can reach every other node. Multiple components indicate isolated
   * areas in the floor plan.
   *
   * @returns Array of sets, each containing room IDs in that component
   */
  getConnectedComponents(): Set<string>[] {
    const components: Set<string>[] = [];
    const visited = new Set<string>();

    for (const roomId of this.nodes.keys()) {
      if (!visited.has(roomId)) {
        const component = this.bfsTraversal(roomId);
        components.push(component);

        for (const id of component) {
          visited.add(id);
        }
      }
    }

    return components;
  }

  /**
   * Get statistics about the graph
   *
   * @returns Object with node count, edge count, and connectivity info
   */
  getStats(): {
    nodeCount: number;
    edgeCount: number;
    componentCount: number;
    averageConnections: number;
  } {
    const components = this.getConnectedComponents();

    let totalConnections = 0;
    for (const neighbors of this.adjacencyList.values()) {
      totalConnections += neighbors.size;
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount: this.edges.length,
      componentCount: components.length,
      averageConnections: this.nodes.size > 0
        ? totalConnections / this.nodes.size
        : 0,
    };
  }

  /**
   * Clear all nodes and edges from the graph
   */
  clear(): void {
    this.nodes.clear();
    this.edges = [];
    this.adjacencyList.clear();
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate circulation connectivity for a floor plan
 *
 * This is the main entry point for circulation validation. It:
 * 1. Builds a graph from rooms and doors
 * 2. Checks all rooms are reachable from entry
 * 3. Validates access rules are met
 * 4. Generates warnings for suboptimal layouts
 *
 * @param rooms - Array of room bounds
 * @param doors - Array of door positions
 * @param entryRoomId - ID of the entry room (typically 'foyer' or first room)
 * @returns Validation result with issues and warnings
 *
 * @example
 * ```typescript
 * const result = validateCirculationConnectivity(
 *   [
 *     { name: 'foyer', type: 'foyer', x: 0, y: 0, width: 8, depth: 8 },
 *     { name: 'living', type: 'living', x: 8, y: 0, width: 15, depth: 12 },
 *     { name: 'bedroom1', type: 'bedroom', x: 0, y: 8, width: 12, depth: 12 },
 *   ],
 *   [
 *     { point: [8, 4], width: 3, swing: 'either', connectsTo: 'living' },
 *   ],
 *   'foyer'
 * );
 *
 * if (!result.isValid) {
 *   console.error('Unreachable rooms:', result.unreachableRooms);
 * }
 * ```
 */
export function validateCirculationConnectivity(
  rooms: RoomBounds[],
  doors: DoorPosition[],
  entryRoomId: string
): ConnectivityValidationResult {
  const warnings: string[] = [];
  const missingConnections: string[] = [];

  // Validate entry room exists
  let resolvedEntryRoomId = entryRoomId;
  const entryRoomExists = rooms.some(r => r.name === entryRoomId);

  if (!entryRoomExists) {
    // Try to find a suitable entry room
    const entryTypes: RoomType[] = ['foyer', 'mudroom', 'living', 'hallway', 'circulation'];
    let foundEntry = false;

    for (const type of entryTypes) {
      const entryRoom = rooms.find(r => r.type === type);
      if (entryRoom) {
        resolvedEntryRoomId = entryRoom.name;
        foundEntry = true;
        warnings.push(`Entry room '${entryRoomId}' not found, using '${entryRoom.name}' as entry`);
        break;
      }
    }

    if (!foundEntry && rooms.length > 0) {
      resolvedEntryRoomId = rooms[0].name;
      warnings.push(`No suitable entry room found, using '${rooms[0].name}' as entry`);
    }
  }

  // Build adjacency map - rooms sharing walls are implicitly connected for reachability
  // This is the KEY FIX: For reachability validation, ANY adjacent rooms can be traversed
  // (even bedroom-to-bedroom, because there could be a door there architecturally)
  const ADJACENCY_TOLERANCE = 0.5; // feet
  const connections = new Map<string, Set<string>>();

  // Initialize all rooms
  for (const room of rooms) {
    connections.set(room.name, new Set());
  }

  // Add adjacency connections (rooms that share walls)
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (areRoomsAdjacentForValidation(rooms[i], rooms[j], ADJACENCY_TOLERANCE)) {
        connections.get(rooms[i].name)?.add(rooms[j].name);
        connections.get(rooms[j].name)?.add(rooms[i].name);
      }
    }
  }

  // Add explicit door connections (these supplement adjacency)
  for (const door of doors) {
    const ownerRoom = findRoomAtPoint(rooms, door.point);
    if (ownerRoom && door.connectsTo) {
      connections.get(ownerRoom.name)?.add(door.connectsTo);
      connections.get(door.connectsTo)?.add(ownerRoom.name);
    }
  }

  // BFS to find reachable rooms from entry
  const reachable = new Set<string>();
  const queue = [resolvedEntryRoomId];

  if (connections.has(resolvedEntryRoomId)) {
    reachable.add(resolvedEntryRoomId);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const neighbors = connections.get(current) || new Set();

    for (const neighbor of neighbors) {
      if (!reachable.has(neighbor)) {
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // Find unreachable rooms
  const unreachableRooms: string[] = [];
  for (const room of rooms) {
    if (!reachable.has(room.name)) {
      unreachableRooms.push(room.name);
    }
  }

  // Count connected components
  const componentCount = countConnectedComponents(rooms, connections);
  if (componentCount > 1) {
    warnings.push(
      `Floor plan has ${componentCount} disconnected areas - rooms may be isolated`
    );
  }

  // Build a graph for access rule validation (uses stricter rules)
  const graph = new CirculationGraph();
  for (const room of rooms) {
    graph.addRoom(room);
  }

  // Add door connections to the graph
  for (const door of doors) {
    const ownerRoom = findRoomAtPoint(rooms, door.point);
    if (ownerRoom && door.connectsTo) {
      const targetRoom = rooms.find(r => r.name === door.connectsTo);
      let edgeType: 'door' | 'opening' | 'hallway' = 'door';

      if (targetRoom) {
        const openTypes: RoomType[] = ['living', 'kitchen', 'dining', 'family', 'great_room'];
        if (openTypes.includes(ownerRoom.type) && openTypes.includes(targetRoom.type)) {
          edgeType = 'opening';
        }
        if (ownerRoom.type === 'hallway' || targetRoom.type === 'hallway') {
          edgeType = 'hallway';
        }
      }
      graph.addConnection(ownerRoom.name, door.connectsTo, edgeType, door.point);
    }
  }

  // Detect stricter adjacent connections for the graph (respects room type rules)
  detectAdjacentRoomConnections(graph, rooms);

  // Check access rules using the stricter graph
  const requiredConnections = graph.getRequiredHallwayConnections();
  for (const conn of requiredConnections) {
    const fromNode = graph.nodes.get(conn.from);
    if (fromNode) {
      missingConnections.push(
        `${fromNode.roomType} '${conn.from}' needs direct hallway access`
      );
    }
  }

  // Check low connectivity
  const stats = graph.getStats();
  if (stats.averageConnections < 1.5 && stats.nodeCount > 2) {
    warnings.push(
      'Low connectivity - consider adding more connections for better flow'
    );
  }

  // Check for hub rooms with insufficient connections
  for (const [roomId, node] of graph.nodes) {
    const neighbors = graph.getConnectedRooms(roomId);
    const accessType = ROOM_ACCESS_RULES[node.roomType];

    if (accessType === 'hub' && neighbors.length < 2) {
      warnings.push(
        `Hub room '${roomId}' (${node.roomType}) only has ${neighbors.length} connection(s)`
      );
    }
  }

  return {
    isValid: unreachableRooms.length === 0 && missingConnections.length === 0,
    unreachableRooms,
    reachableRooms: Array.from(reachable),
    missingConnections,
    warnings,
    componentCount,
  };
}

/**
 * Check if two rooms are adjacent for reachability validation purposes
 * This is a permissive check - any rooms sharing a wall are considered reachable
 * (architectural doors can be placed between any adjacent rooms)
 */
function areRoomsAdjacentForValidation(
  room1: RoomBounds,
  room2: RoomBounds,
  tolerance: number
): boolean {
  // Calculate room edges
  const r1Left = room1.x;
  const r1Right = room1.x + room1.width;
  const r1Bottom = room1.y;
  const r1Top = room1.y + room1.depth;

  const r2Left = room2.x;
  const r2Right = room2.x + room2.width;
  const r2Bottom = room2.y;
  const r2Top = room2.y + room2.depth;

  // Check for horizontal adjacency (share vertical wall)
  const horizontalOverlap = Math.max(0,
    Math.min(r1Top, r2Top) - Math.max(r1Bottom, r2Bottom)
  );

  if (horizontalOverlap > tolerance) {
    // Room1 right edge touches room2 left edge
    if (Math.abs(r1Right - r2Left) <= tolerance) {
      return true;
    }
    // Room1 left edge touches room2 right edge
    if (Math.abs(r1Left - r2Right) <= tolerance) {
      return true;
    }
  }

  // Check for vertical adjacency (share horizontal wall)
  const verticalOverlap = Math.max(0,
    Math.min(r1Right, r2Right) - Math.max(r1Left, r2Left)
  );

  if (verticalOverlap > tolerance) {
    // Room1 top edge touches room2 bottom edge
    if (Math.abs(r1Top - r2Bottom) <= tolerance) {
      return true;
    }
    // Room1 bottom edge touches room2 top edge
    if (Math.abs(r1Bottom - r2Top) <= tolerance) {
      return true;
    }
  }

  return false;
}

/**
 * Count the number of connected components in the floor plan
 */
function countConnectedComponents(
  rooms: RoomBounds[],
  connections: Map<string, Set<string>>
): number {
  const visited = new Set<string>();
  let componentCount = 0;

  for (const room of rooms) {
    if (!visited.has(room.name)) {
      componentCount++;
      // BFS to mark all rooms in this component as visited
      const queue = [room.name];
      visited.add(room.name);

      while (queue.length > 0) {
        const current = queue.shift()!;
        const neighbors = connections.get(current) || new Set();

        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }
    }
  }

  return componentCount;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Find which room contains a given point
 *
 * @param rooms - Array of room bounds
 * @param point - Point to check
 * @returns The room containing the point or undefined
 */
function findRoomAtPoint(rooms: RoomBounds[], point: Point2D): RoomBounds | undefined {
  const [px, py] = point;

  for (const room of rooms) {
    const inX = px >= room.x && px <= room.x + room.width;
    const inY = py >= room.y && py <= room.y + room.depth;

    if (inX && inY) {
      return room;
    }
  }

  // If not inside, find the nearest room edge
  let nearestRoom: RoomBounds | undefined;
  let minDistance = Infinity;

  for (const room of rooms) {
    // Check distance to room edges
    const centerX = room.x + room.width / 2;
    const centerY = room.y + room.depth / 2;

    const dx = px - centerX;
    const dy = py - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < minDistance && distance < 5) { // Within 5' of center
      minDistance = distance;
      nearestRoom = room;
    }
  }

  return nearestRoom;
}

/**
 * Detect adjacent rooms that should be connected (open floor plan)
 *
 * Rooms that share a wall and are both "open" types get automatic connections.
 *
 * @param graph - The circulation graph to add connections to
 * @param rooms - Array of room bounds
 */
function detectAdjacentRoomConnections(
  graph: CirculationGraph,
  rooms: RoomBounds[]
): void {
  const openTypes: RoomType[] = ['living', 'kitchen', 'dining', 'family', 'great_room'];
  const ADJACENCY_TOLERANCE = 1.0; // Rooms within 1' are considered adjacent

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const room1 = rooms[i];
      const room2 = rooms[j];

      // Skip if already connected
      if (graph.getEdge(room1.name, room2.name)) {
        continue;
      }

      // Check if rooms are adjacent
      const isAdjacent = areRoomsAdjacent(room1, room2, ADJACENCY_TOLERANCE);

      if (isAdjacent) {
        // CRITICAL FIX: Bedroom-to-bedroom adjacency does NOT create a connection
        // Bedrooms require hallway access - you cannot walk through one bedroom
        // to reach another (privacy + IRC R310.1 egress requirement)
        if (room1.type === 'bedroom' && room2.type === 'bedroom') {
          // Do NOT add connection - bedrooms need separate hallway access
          continue;
        }

        // CRITICAL FIX: Bathroom-to-bathroom adjacency does NOT create a connection
        // (except jack-and-jill which is handled via bedroom connections)
        if (room1.type === 'bathroom' && room2.type === 'bathroom') {
          continue;
        }

        // Both open types = automatic opening connection
        if (openTypes.includes(room1.type) && openTypes.includes(room2.type)) {
          graph.addConnection(room1.name, room2.name, 'opening');
        }

        // Hallway connections
        if (room1.type === 'hallway' || room2.type === 'hallway') {
          // Check if the other room type needs direct access
          const otherRoom = room1.type === 'hallway' ? room2 : room1;
          const accessType = ROOM_ACCESS_RULES[otherRoom.type];

          if (accessType === 'direct' || accessType === 'hub') {
            graph.addConnection(room1.name, room2.name, 'hallway');
          }
        }

        // Hub rooms (foyer, mudroom) connect to adjacent rooms
        if (ROOM_ACCESS_RULES[room1.type] === 'hub' || ROOM_ACCESS_RULES[room2.type] === 'hub') {
          graph.addConnection(room1.name, room2.name, 'door');
        }
      }
    }
  }
}

/**
 * Check if two rooms share a wall (are adjacent)
 *
 * @param room1 - First room
 * @param room2 - Second room
 * @param tolerance - Maximum gap to still consider adjacent
 * @returns true if rooms share a wall
 */
function areRoomsAdjacent(
  room1: RoomBounds,
  room2: RoomBounds,
  tolerance: number
): boolean {
  // Calculate room edges
  const r1Left = room1.x;
  const r1Right = room1.x + room1.width;
  const r1Bottom = room1.y;
  const r1Top = room1.y + room1.depth;

  const r2Left = room2.x;
  const r2Right = room2.x + room2.width;
  const r2Bottom = room2.y;
  const r2Top = room2.y + room2.depth;

  // Check for horizontal adjacency (share vertical wall)
  const horizontalOverlap = Math.max(0,
    Math.min(r1Top, r2Top) - Math.max(r1Bottom, r2Bottom)
  );

  if (horizontalOverlap > 0) {
    // Room1 right edge touches room2 left edge
    if (Math.abs(r1Right - r2Left) <= tolerance) {
      return true;
    }
    // Room1 left edge touches room2 right edge
    if (Math.abs(r1Left - r2Right) <= tolerance) {
      return true;
    }
  }

  // Check for vertical adjacency (share horizontal wall)
  const verticalOverlap = Math.max(0,
    Math.min(r1Right, r2Right) - Math.max(r1Left, r2Left)
  );

  if (verticalOverlap > 0) {
    // Room1 top edge touches room2 bottom edge
    if (Math.abs(r1Top - r2Bottom) <= tolerance) {
      return true;
    }
    // Room1 bottom edge touches room2 top edge
    if (Math.abs(r1Bottom - r2Top) <= tolerance) {
      return true;
    }
  }

  return false;
}

/**
 * Build a CirculationGraph from rooms and doors
 *
 * Convenience function that creates and populates a graph.
 *
 * @param rooms - Array of room bounds
 * @param doors - Array of door positions
 * @returns Populated CirculationGraph
 */
export function buildCirculationGraph(
  rooms: RoomBounds[],
  doors: DoorPosition[]
): CirculationGraph {
  const graph = new CirculationGraph();

  // Add rooms
  for (const room of rooms) {
    graph.addRoom(room);
  }

  // Add door connections
  for (const door of doors) {
    const ownerRoom = findRoomAtPoint(rooms, door.point);
    if (ownerRoom && door.connectsTo) {
      graph.addConnection(ownerRoom.name, door.connectsTo, 'door', door.point);
    }
  }

  // Detect implicit connections
  detectAdjacentRoomConnections(graph, rooms);

  return graph;
}

/**
 * Generate a human-readable report of circulation issues
 *
 * @param result - Validation result from validateCirculationConnectivity
 * @returns Formatted string report
 */
export function generateConnectivityReport(
  result: ConnectivityValidationResult
): string {
  const lines: string[] = [];

  lines.push('=== Circulation Connectivity Report ===');
  lines.push('');

  if (result.isValid) {
    lines.push('Status: VALID - All rooms are connected and accessible');
  } else {
    lines.push('Status: INVALID - Connectivity issues found');
  }

  lines.push('');

  // Show reachability summary
  const totalRooms = result.reachableRooms.length + result.unreachableRooms.length;
  lines.push(`Reachability: ${result.reachableRooms.length}/${totalRooms} rooms reachable from entry`);
  if (result.componentCount !== undefined) {
    lines.push(`Connected components: ${result.componentCount}`);
  }
  lines.push('');

  if (result.unreachableRooms.length > 0) {
    lines.push('UNREACHABLE ROOMS (Critical):');
    for (const room of result.unreachableRooms) {
      lines.push(`  - ${room}: Cannot be reached from entry`);
    }
    lines.push('');
  }

  if (result.missingConnections.length > 0) {
    lines.push('MISSING CONNECTIONS:');
    for (const conn of result.missingConnections) {
      lines.push(`  - ${conn}`);
    }
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push('WARNINGS:');
    for (const warning of result.warnings) {
      lines.push(`  - ${warning}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
