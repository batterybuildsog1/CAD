/**
 * Stress Test Layout - 100 Rooms
 *
 * Large layout for performance testing:
 * - 10x10 grid of rooms
 * - Mix of room types
 * - Tests algorithm scalability
 */

import {
  createRectRoom,
  getBedroomIds,
  getTotalArea,
  type TestLayout,
  type TestRoom,
  type RoomType,
} from '../rooms';

/**
 * Generate 100-room grid layout
 *
 * Layout: 10x10 grid of 10x10' rooms
 * - Row 0: Entry + Public rooms
 * - Rows 1-3: Living spaces
 * - Rows 4-6: Bedrooms
 * - Rows 7-9: Mixed utilities
 */

function generateStressLayout(): TestRoom[] {
  const rooms: TestRoom[] = [];
  const roomSize = 10;
  const gridSize = 10;

  // Room type distribution
  const getType = (row: number, col: number): RoomType => {
    if (row === 0 && col === 0) return 'foyer';
    if (row === 0) return col % 2 === 0 ? 'living' : 'dining';
    if (row >= 1 && row <= 3) {
      if (col % 3 === 0) return 'kitchen';
      if (col % 3 === 1) return 'living';
      return 'dining';
    }
    if (row >= 4 && row <= 6) {
      if (col % 4 === 0) return 'bedroom';
      if (col % 4 === 1) return 'bedroom';
      if (col % 4 === 2) return 'bathroom';
      return 'bedroom';
    }
    // Utility rows
    if (col % 5 === 0) return 'garage';
    if (col % 5 === 1) return 'laundry';
    if (col % 5 === 2) return 'utility';
    if (col % 5 === 3) return 'hallway';
    return 'closet';
  };

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const x = col * roomSize;
      const y = row * roomSize;
      const id = `room-${row}-${col}`;
      const type = getType(row, col);
      const name = `${type.replace('_', ' ').toUpperCase()} ${row}-${col}`;

      rooms.push(createRectRoom(id, name, type, x, y, roomSize, roomSize));
    }
  }

  return rooms;
}

const rooms = generateStressLayout();

export const stress100RoomLayout: TestLayout = {
  name: 'Stress Test 100 Rooms',
  description: 'Large 10x10 grid layout for performance testing (10,000 sq ft)',
  rooms,
  entryRoom: 'room-0-0',
  bedroomIds: getBedroomIds(rooms),
  totalArea: getTotalArea(rooms),
};

export default stress100RoomLayout;
