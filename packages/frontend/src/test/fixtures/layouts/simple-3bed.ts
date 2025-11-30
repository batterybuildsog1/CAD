/**
 * Simple 3-Bedroom Layout Fixture
 *
 * Standard ranch-style layout:
 * - Entry → Living → Kitchen/Dining
 * - Hallway to 3 bedrooms + 2 bathrooms
 * - ~1,800 sq ft
 */

import {
  createEntry,
  createLivingRoom,
  createKitchen,
  createDiningRoom,
  createBedroom,
  createBathroom,
  createHallway,
  getBedroomIds,
  getTotalArea,
  type TestLayout,
  type TestRoom,
} from '../rooms';

/**
 * Room layout (approximate):
 *
 * +--------+----------------+------------+
 * | Entry  |    Living      |  Kitchen   |
 * | 8x8    |    16x14       |  12x10     |
 * +--------+                +------------+
 *          |                |  Dining    |
 *          +----------------+  12x10     |
 *          |    Hallway     +------------+
 *          |     4x20                    |
 * +--------+--------+--------+           |
 * | Bed 1  | Bath 1 | Bed 2  |           |
 * | 12x12  | 8x6    | 12x12  |           |
 * +--------+--------+--------+-----------+
 * | Primary Bedroom |  Bath 2  |
 * |     14x14       |   10x8   |
 * +-----------------+----------+
 */

const rooms: TestRoom[] = [
  // Public zone
  createEntry(0, 0, 8, 8),
  createLivingRoom(8, 0, 16, 14),
  createKitchen(24, 0, 12, 10),
  createDiningRoom(24, 10, 12, 10),

  // Circulation
  createHallway('hall-main', 8, 14, 4, 20),

  // Bedroom wing
  createBedroom('bed-1', 'Bedroom 1', 0, 14, 12, 12),
  createBathroom('bath-1', 'Bathroom 1', 12, 14, 8, 6),
  createBedroom('bed-2', 'Bedroom 2', 20, 14, 12, 12),

  // Primary suite
  createBedroom('primary', 'Primary Bedroom', 0, 26, 14, 14, true),
  createBathroom('bath-primary', 'Primary Bath', 14, 26, 10, 8),
];

export const simple3BedLayout: TestLayout = {
  name: 'Simple 3-Bedroom',
  description: 'Standard ranch-style 3BR/2.5BA layout (~1,800 sq ft)',
  rooms,
  entryRoom: 'entry',
  bedroomIds: getBedroomIds(rooms),
  totalArea: getTotalArea(rooms),
};

export default simple3BedLayout;
