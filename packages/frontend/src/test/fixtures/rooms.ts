/**
 * Test Fixtures - Room Factory Functions
 *
 * Provides factory functions for creating test room layouts
 * with various configurations for unit and integration tests.
 */

import type { RoomType, Point2D } from '@/lib/gemini-types';

// Re-export RoomType for test convenience
export type { RoomType, Point2D };

/**
 * Room data structure for testing
 */
export interface TestRoom {
  id: string;
  name: string;
  type: RoomType;
  /** Polygon points [[x, y], ...] */
  points: Point2D[];
  /** Computed bounds */
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
    centerX: number;
    centerY: number;
  };
  /** Area in square feet */
  area: number;
}

/**
 * Test layout with rooms and metadata
 */
export interface TestLayout {
  name: string;
  description: string;
  rooms: TestRoom[];
  /** Expected entry room ID */
  entryRoom?: string;
  /** Expected bedroom IDs */
  bedroomIds: string[];
  /** Total footprint area */
  totalArea: number;
}

/**
 * Create a rectangular room from corner and dimensions
 */
export function createRectRoom(
  id: string,
  name: string,
  type: RoomType,
  x: number,
  y: number,
  width: number,
  height: number
): TestRoom {
  const points: Point2D[] = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];

  return {
    id,
    name,
    type,
    points,
    bounds: {
      minX: x,
      minY: y,
      maxX: x + width,
      maxY: y + height,
      width,
      height,
      centerX: x + width / 2,
      centerY: y + height / 2,
    },
    area: width * height,
  };
}

/**
 * Create a room from polygon points
 */
export function createPolygonRoom(
  id: string,
  name: string,
  type: RoomType,
  points: Point2D[]
): TestRoom {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Shoelace formula for polygon area
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i][0] * points[j][1];
    area -= points[j][0] * points[i][1];
  }
  area = Math.abs(area) / 2;

  return {
    id,
    name,
    type,
    points,
    bounds: {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
    },
    area,
  };
}

/**
 * Create entry/foyer room
 */
export function createEntry(x = 0, y = 0, width = 8, height = 8): TestRoom {
  return createRectRoom('entry', 'Entry', 'foyer', x, y, width, height);
}

/**
 * Create living room
 */
export function createLivingRoom(
  x = 8,
  y = 0,
  width = 16,
  height = 14
): TestRoom {
  return createRectRoom('living', 'Living Room', 'living', x, y, width, height);
}

/**
 * Create kitchen
 */
export function createKitchen(
  x = 24,
  y = 0,
  width = 12,
  height = 10
): TestRoom {
  return createRectRoom('kitchen', 'Kitchen', 'kitchen', x, y, width, height);
}

/**
 * Create dining room
 */
export function createDiningRoom(
  x = 24,
  y = 10,
  width = 12,
  height = 10
): TestRoom {
  return createRectRoom('dining', 'Dining Room', 'dining', x, y, width, height);
}

/**
 * Create bedroom
 */
export function createBedroom(
  id: string,
  name: string,
  x: number,
  y: number,
  width = 12,
  height = 12,
  isPrimary = false
): TestRoom {
  return createRectRoom(
    id,
    name,
    'bedroom', // Note: isPrimary is for test logic, all are 'bedroom' type
    x,
    y,
    width,
    height
  );
}

/**
 * Create bathroom
 */
export function createBathroom(
  id: string,
  name: string,
  x: number,
  y: number,
  width = 8,
  height = 6
): TestRoom {
  return createRectRoom(id, name, 'bathroom', x, y, width, height);
}

/**
 * Create hallway
 */
export function createHallway(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number
): TestRoom {
  return createRectRoom(id, `Hallway ${id}`, 'hallway', x, y, width, height);
}

/**
 * Create garage
 */
export function createGarage(
  x = 0,
  y = 20,
  width = 20,
  height = 20
): TestRoom {
  return createRectRoom('garage', 'Garage', 'garage', x, y, width, height);
}

/**
 * Calculate distance between two room centers
 */
export function roomDistance(a: TestRoom, b: TestRoom): number {
  const dx = a.bounds.centerX - b.bounds.centerX;
  const dy = a.bounds.centerY - b.bounds.centerY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Check if two rooms are adjacent (share an edge within tolerance)
 */
export function areAdjacent(a: TestRoom, b: TestRoom, tolerance = 0.5): boolean {
  // Check if rooms share an edge
  const gapX = Math.max(0, Math.max(a.bounds.minX, b.bounds.minX) - Math.min(a.bounds.maxX, b.bounds.maxX));
  const gapY = Math.max(0, Math.max(a.bounds.minY, b.bounds.minY) - Math.min(a.bounds.maxY, b.bounds.maxY));

  // Adjacent if gap in one direction is within tolerance and they overlap in the other
  const overlapX = Math.min(a.bounds.maxX, b.bounds.maxX) - Math.max(a.bounds.minX, b.bounds.minX);
  const overlapY = Math.min(a.bounds.maxY, b.bounds.maxY) - Math.max(a.bounds.minY, b.bounds.minY);

  return (gapX <= tolerance && overlapY > 0) || (gapY <= tolerance && overlapX > 0);
}

/**
 * Build adjacency map from room array
 */
export function buildAdjacencyMap(
  rooms: TestRoom[],
  tolerance = 0.5
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();

  for (const room of rooms) {
    adjacency.set(room.id, new Set());
  }

  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      if (areAdjacent(rooms[i], rooms[j], tolerance)) {
        adjacency.get(rooms[i].id)!.add(rooms[j].id);
        adjacency.get(rooms[j].id)!.add(rooms[i].id);
      }
    }
  }

  return adjacency;
}

/**
 * Check if a room is a bedroom type
 */
export function isBedroom(room: TestRoom): boolean {
  return (
    room.type === 'bedroom' ||
    room.name.toLowerCase().includes('primary') ||
    room.name.toLowerCase().includes('guest')
  );
}

/**
 * Get all bedroom IDs from a layout
 */
export function getBedroomIds(rooms: TestRoom[]): string[] {
  return rooms.filter(isBedroom).map((r) => r.id);
}

/**
 * Calculate total area of all rooms
 */
export function getTotalArea(rooms: TestRoom[]): number {
  return rooms.reduce((sum, r) => sum + r.area, 0);
}
