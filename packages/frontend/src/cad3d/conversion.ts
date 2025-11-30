/**
 * CAD3D / ObservableState Conversion
 *
 * This module converts the LLM-friendly ObservableState (llmState) into a
 * CAD3D model. It is intentionally conservative:
 *
 * - Only uses canonical geometry from state.floorplan.rooms[*].points
 * - Does not guess missing data (no fake boxes or inferred walls)
 * - Produces a minimal but correct 3D representation:
 *   - RoomElement per room
 *   - Optional FloorSlabElement bounding all rooms on the active level
 *
 * This is used by the CAD Lab page to visualize the last Gemini result.
 */

import type { ObservableState } from '@/lib/observable-state';
import type { Cad3DModel, RoomElement, FloorSlabElement } from './model';
import { createEmptyCadModel, addElement } from './state';

/**
 * Build a minimal Cad3DModel from an ObservableState.
 *
 * @param state - LLM-friendly observable state (llmState)
 * @param modelId - Optional explicit model ID
 * @param name - Optional human-readable name for the model
 */
export function buildCadModelFromObservableState(
  state: ObservableState,
  modelId?: string,
  name?: string
): Cad3DModel {
  const id = modelId ?? `cad3d-from-llm-${Date.now()}`;
  const label =
    name ??
    (state.context.projectId
      ? `CAD3D for project ${state.context.projectId}`
      : 'CAD3D from ObservableState');

  let model = createEmptyCadModel(label, id);
  // Mark source so we can distinguish demo vs converted models in UIs.
  model = {
    ...model,
    meta: {
      ...model.meta,
      source: 'observable-state',
    },
  };

  const rooms = state.floorplan?.rooms ?? [];

  // Derive a level identifier from context; if none is set, fall back to a placeholder.
  const levelId = (state.context.levelId as string | null) ?? 'Level-0';

  // Convert each room summary into a RoomElement, only if it has a valid polygon.
  for (const room of rooms) {
    if (!room.points || room.points.length < 3) continue;

    const roomElement: RoomElement = {
      id: room.id,
      kind: 'room',
      name: room.name,
      tags: [room.type, 'from_llm'],
      parentId: undefined,
      childrenIds: [],
      levelId,
      roomType: room.type,
      footprint: room.points,
      height: 9, // default residential floor height; can be refined from level data later
    };

    model = addElement(model, roomElement);
  }

  // Optionally add a single floor slab that bounds all rooms on this level.
  if (rooms.length > 0) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const r of rooms) {
      const b = r.bounds;
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }

    if (isFinite(minX) && isFinite(minY) && isFinite(maxX) && isFinite(maxY)) {
      const slab: FloorSlabElement = {
        id: `slab:${levelId}`,
        kind: 'floor_slab',
        name: `Slab ${levelId}`,
        tags: ['slab', 'from_llm'],
        parentId: undefined,
        childrenIds: [],
        levelId,
        footprint: [
          [minX, minY],
          [maxX, minY],
          [maxX, maxY],
          [minX, maxY],
        ],
        thickness: 0.75, // default 9" slab; refine via level/assembly spec later
      };

      model = addElement(model, slab);
    }
  }

  return model;
}


