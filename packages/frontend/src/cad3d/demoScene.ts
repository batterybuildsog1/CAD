/**
 * CAD3D Demo Scene
 *
 * A tiny, hard-coded model used by the CAD Lab page to verify:
 * - The core Cad3DModel types are wired correctly
 * - Basic rendering of rooms and studs works
 *
 * This is NOT used by the main workspace – it is safe to change and extend.
 */

import type { Cad3DModel, RoomElement, StudElement, Transform3D, ComponentId } from './model';
import { createEmptyCadModel, addElement } from './state';

function makeId(suffix: string): ComponentId {
  return `demo:${suffix}`;
}

/** Simple helper to build a Transform3D. */
function t(position: [number, number, number], rotation: [number, number, number] = [0, 0, 0]): Transform3D {
  return {
    position,
    rotation,
    scale: [1, 1, 1],
  };
}

/**
 * Create a minimal demo model:
 * - One ground floor level (implicit, levelId="GF")
 * - One rectangular room footprint
 * - A short run of 2x4 studs along the south wall
 */
export function createDemoCadModel(): Cad3DModel {
  let model = createEmptyCadModel('CAD3D Demo House', 'cad3d-demo-1');

  const levelId = 'GF';

  // Room footprint: 20' x 16' rectangle at origin
  const room: RoomElement = {
    id: makeId('room:GF-Living'),
    kind: 'room',
    name: 'Living Room',
    tags: ['living', 'demo'],
    parentId: undefined,
    childrenIds: [],
    levelId,
    roomType: 'living',
    footprint: [
      [0, 0],
      [20, 0],
      [20, 16],
      [0, 16],
    ],
    height: 9,
  };

  model = addElement(model, room);

  // A short run of 2x4 studs (1.5" x 3.5" ≈ 0.125' x 0.292') along the south wall
  const studSection = { width: 0.125, depth: 0.292 };
  const studLength = 8; // 8' stud (for 9' room height with plates)
  const studSpacing = 1.333; // ~16" on center

  const studCount = 6;
  for (let i = 0; i < studCount; i++) {
    const x = 0.75 + i * studSpacing; // offset a bit from origin
    const stud: StudElement = {
      id: makeId(`stud:GF-Living:S${i + 1}`),
      kind: 'stud',
      name: `Stud ${i + 1}`,
      tags: ['stud', 'demo', 'south_wall'],
      parentId: room.id,
      childrenIds: [],
      wallId: makeId('wall:GF-Living:South'),
      length: studLength,
      section: studSection,
      transform: t([x, 0, studLength / 2]), // centered in height
    };
    model = addElement(model, stud);
  }

  return model;
}


