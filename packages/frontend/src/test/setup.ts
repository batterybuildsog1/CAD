/**
 * Vitest Setup - Custom Matchers for Geometry Testing
 *
 * Provides custom matchers for testing CAD algorithms:
 * - toBeNearPoint: Check if two points are within tolerance
 * - toHaveMSTProperty: Validate minimum spanning tree properties
 * - toBeConvexPolygon: Check polygon convexity
 * - toHaveNoOverlaps: Validate no room overlaps
 */

import { expect } from 'vitest';

// Tolerance for floating point comparisons (in feet)
const DEFAULT_TOLERANCE = 0.001;

// Extend Vitest matchers
interface CustomMatchers<R = unknown> {
  /** Check if point is within tolerance of expected point */
  toBeNearPoint(expected: [number, number], tolerance?: number): R;
  /** Check if a graph has MST properties (N-1 edges for N nodes, connected) */
  toHaveMSTProperty(nodeCount: number): R;
  /** Check if polygon vertices form a convex shape */
  toBeConvexPolygon(): R;
  /** Check if array of rectangles has no overlaps */
  toHaveNoOverlaps(): R;
  /** Check if all rooms are reachable from entry */
  toBeFullyConnected(): R;
  /** Check if path avoids bedroom-to-bedroom traversal */
  toAvoidBedroomTraversal(): R;
}

declare module 'vitest' {
  interface Assertion<T = unknown> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}

expect.extend({
  /**
   * Check if a point [x, y] is within tolerance of expected point
   */
  toBeNearPoint(received: [number, number], expected: [number, number], tolerance = DEFAULT_TOLERANCE) {
    const [rx, ry] = received;
    const [ex, ey] = expected;
    const distance = Math.sqrt((rx - ex) ** 2 + (ry - ey) ** 2);
    const pass = distance <= tolerance;

    return {
      pass,
      message: () =>
        pass
          ? `Expected [${rx}, ${ry}] not to be near [${ex}, ${ey}] (tolerance: ${tolerance})`
          : `Expected [${rx}, ${ry}] to be near [${ex}, ${ey}] (distance: ${distance.toFixed(4)}, tolerance: ${tolerance})`,
    };
  },

  /**
   * Check if an edge array has MST properties:
   * - Exactly N-1 edges for N nodes
   * - All nodes connected (graph is a tree)
   */
  toHaveMSTProperty(received: Array<{ from: string; to: string }>, nodeCount: number) {
    const expectedEdges = nodeCount - 1;
    const actualEdges = received.length;

    // Check edge count
    if (actualEdges !== expectedEdges) {
      return {
        pass: false,
        message: () =>
          `Expected ${expectedEdges} edges for ${nodeCount} nodes, but got ${actualEdges}`,
      };
    }

    // Check connectivity using union-find
    const parent = new Map<string, string>();
    const find = (x: string): string => {
      if (!parent.has(x)) parent.set(x, x);
      if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
      return parent.get(x)!;
    };
    const union = (a: string, b: string) => {
      parent.set(find(a), find(b));
    };

    const nodes = new Set<string>();
    for (const edge of received) {
      nodes.add(edge.from);
      nodes.add(edge.to);
      union(edge.from, edge.to);
    }

    // Check all nodes have same root (connected)
    const roots = new Set([...nodes].map((n) => find(n)));
    const isConnected = roots.size === 1;

    return {
      pass: isConnected,
      message: () =>
        isConnected
          ? `Expected graph not to be connected`
          : `Expected graph to be connected, but found ${roots.size} components`,
    };
  },

  /**
   * Check if polygon vertices form a convex shape
   */
  toBeConvexPolygon(received: Array<[number, number]>) {
    if (received.length < 3) {
      return {
        pass: false,
        message: () => `Polygon must have at least 3 vertices, got ${received.length}`,
      };
    }

    // Check cross product signs are consistent
    let sign = 0;
    const n = received.length;

    for (let i = 0; i < n; i++) {
      const [x1, y1] = received[i];
      const [x2, y2] = received[(i + 1) % n];
      const [x3, y3] = received[(i + 2) % n];

      const cross = (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2);

      if (cross !== 0) {
        if (sign === 0) {
          sign = cross > 0 ? 1 : -1;
        } else if ((cross > 0 ? 1 : -1) !== sign) {
          return {
            pass: false,
            message: () =>
              `Polygon is not convex: cross product sign changed at vertex ${i}`,
          };
        }
      }
    }

    return {
      pass: true,
      message: () => `Expected polygon not to be convex`,
    };
  },

  /**
   * Check if array of rectangles has no overlaps
   */
  toHaveNoOverlaps(received: Array<{ x: number; y: number; width: number; height: number }>) {
    for (let i = 0; i < received.length; i++) {
      for (let j = i + 1; j < received.length; j++) {
        const a = received[i];
        const b = received[j];

        // Check for overlap using AABB
        const overlapX = a.x < b.x + b.width && a.x + a.width > b.x;
        const overlapY = a.y < b.y + b.height && a.y + a.height > b.y;

        if (overlapX && overlapY) {
          return {
            pass: false,
            message: () =>
              `Rectangles ${i} and ${j} overlap:\n` +
              `  Rect ${i}: (${a.x}, ${a.y}) ${a.width}x${a.height}\n` +
              `  Rect ${j}: (${b.x}, ${b.y}) ${b.width}x${b.height}`,
          };
        }
      }
    }

    return {
      pass: true,
      message: () => `Expected rectangles to have overlaps`,
    };
  },

  /**
   * Check if all rooms in adjacency map are reachable from 'entry' or first room
   */
  toBeFullyConnected(received: Map<string, Set<string>>) {
    if (received.size === 0) {
      return {
        pass: true,
        message: () => `Empty graph is trivially connected`,
      };
    }

    const nodes = [...received.keys()];
    const startNode = received.has('entry') ? 'entry' : nodes[0];

    // BFS to find all reachable nodes
    const visited = new Set<string>();
    const queue = [startNode];
    visited.add(startNode);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = received.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    const unreachable = nodes.filter((n) => !visited.has(n));
    const pass = unreachable.length === 0;

    return {
      pass,
      message: () =>
        pass
          ? `Expected graph not to be fully connected`
          : `Unreachable rooms from ${startNode}: ${unreachable.join(', ')}`,
    };
  },

  /**
   * Check if path array doesn't pass through bedrooms (except start/end)
   */
  toAvoidBedroomTraversal(
    received: { path: string[]; roomTypes: Map<string, string> }
  ) {
    const { path, roomTypes } = received;

    if (path.length <= 2) {
      return {
        pass: true,
        message: () => `Path too short for bedroom traversal`,
      };
    }

    // Check intermediate nodes (not first or last)
    const bedroomTypes = ['bedroom'];  // All bedrooms use 'bedroom' type
    const violations: string[] = [];

    for (let i = 1; i < path.length - 1; i++) {
      const room = path[i];
      const type = roomTypes.get(room)?.toLowerCase() || '';
      if (bedroomTypes.some((bt) => type.includes(bt))) {
        violations.push(`${room} (${type})`);
      }
    }

    const pass = violations.length === 0;

    return {
      pass,
      message: () =>
        pass
          ? `Expected path to traverse through bedrooms`
          : `Path traverses bedrooms: ${violations.join(', ')}`,
    };
  },
});

// Export types for use in tests
export type Point2D = [number, number];
export type RoomRect = { x: number; y: number; width: number; height: number };
export type Edge = { from: string; to: string };
