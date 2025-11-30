/**
 * Open Concept Layout Fixture
 *
 * Modern open floor plan:
 * - Great room combining living/kitchen/dining
 * - No walls between public spaces
 * - 3 bedrooms in separate wing
 * - ~2,200 sq ft
 */

import {
  createEntry,
  createPolygonRoom,
  createBedroom,
  createBathroom,
  createHallway,
  getBedroomIds,
  getTotalArea,
  type TestLayout,
  type TestRoom,
  type Point2D,
} from '../rooms';

/**
 * Room layout (L-shaped great room):
 *
 * +--------+-------------------------------+
 * | Entry  |                               |
 * | 10x10  |       Great Room              |
 * +--------+       (L-shaped)              |
 *          |       30x24                   |
 *          |                   +----------+
 *          |                   |  Pantry  |
 *          +-------------------+  6x6     |
 *          |    Hallway 4x16   +-----------
 * +--------+--------+--------+
 * | Bed 1  | Bath 1 | Bed 2  |
 * | 12x12  | 8x8    | 12x12  |
 * +--------+--------+--------+
 * | Primary Suite   | Bath 2 |
 * |     16x14       | 10x10  |
 * +-----------------+--------+
 */

// Great room as L-shaped polygon
const greatRoomPoints: Point2D[] = [
  [10, 0],
  [40, 0],
  [40, 18],
  [34, 18],
  [34, 24],
  [10, 24],
];

const rooms: TestRoom[] = [
  // Entry
  createEntry(0, 0, 10, 10),

  // Open great room (living + kitchen + dining as one space)
  createPolygonRoom('great-room', 'Great Room', 'great_room', greatRoomPoints),

  // Pantry
  createPolygonRoom('pantry', 'Pantry', 'pantry', [
    [34, 18],
    [40, 18],
    [40, 24],
    [34, 24],
  ]),

  // Circulation
  createHallway('hall-main', 10, 24, 4, 16),

  // Bedroom wing
  createBedroom('bed-1', 'Bedroom 1', 0, 24, 12, 12),
  createBathroom('bath-1', 'Bathroom 1', 12, 24, 8, 8),
  createBedroom('bed-2', 'Bedroom 2', 20, 24, 12, 12),

  // Primary suite
  createBedroom('primary', 'Primary Suite', 0, 36, 16, 14, true),
  createBathroom('bath-primary', 'Primary Bath', 16, 36, 10, 10),
];

export const openConceptLayout: TestLayout = {
  name: 'Open Concept',
  description: 'Modern open floor plan with great room (~2,200 sq ft)',
  rooms,
  entryRoom: 'entry',
  bedroomIds: getBedroomIds(rooms),
  totalArea: getTotalArea(rooms),
};

export default openConceptLayout;
