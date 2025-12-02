/**
 * Selection Store - Manages selection state for 2D floor plan editing
 * Tracks which rooms/openings are selected and current interaction mode
 */

export type HandleType =
  | 'center'  // Move entire room
  | 'n' | 's' | 'e' | 'w'  // Edge resize (single dimension)
  | 'ne' | 'nw' | 'se' | 'sw';  // Corner resize (both dimensions)

export interface SelectionState {
  selectedRoomIds: string[];
  selectedOpeningIds: string[];
  hoveredRoomId: string | null;
  hoveredOpeningId: string | null;
  activeHandle: HandleType | null;
  isDragging: boolean;
}

export interface DragState {
  roomId: string;
  handleType: HandleType;
  startWorldPos: [number, number];
  startCenter: [number, number];
  startDimensions: { width: number; depth: number };
  currentWorldPos: [number, number];
}

/**
 * Snap settings for grid/edge alignment
 */
export interface SnapSettings {
  enabled: boolean;
  gridSize: number;  // feet
  edgeSnapDistance: number;  // pixels
}

/**
 * Svelte 5 Runes-based Selection Manager
 */
class SelectionManager {
  #state = $state<SelectionState>({
    selectedRoomIds: [],
    selectedOpeningIds: [],
    hoveredRoomId: null,
    hoveredOpeningId: null,
    activeHandle: null,
    isDragging: false
  });

  #dragState = $state<DragState | null>(null);

  #snapSettings = $state<SnapSettings>({
    enabled: true,
    gridSize: 1.0,  // 1 foot grid
    edgeSnapDistance: 10  // pixels
  });

  // Getters
  get state() { return this.#state; }
  get dragState() { return this.#dragState; }
  get snapSettings() { return this.#snapSettings; }

  get selectedRoomIds() { return this.#state.selectedRoomIds; }
  get primarySelection() { return this.#state.selectedRoomIds[0] ?? null; }
  get isMultiSelect() { return this.#state.selectedRoomIds.length > 1; }
  get isDragging() { return this.#state.isDragging; }
  get activeHandle() { return this.#state.activeHandle; }

  // Selection methods
  selectRoom(roomId: string, additive: boolean = false): void {
    if (additive) {
      if (this.#state.selectedRoomIds.includes(roomId)) {
        // Toggle off if already selected
        this.deselectRoom(roomId);
      } else {
        this.#state.selectedRoomIds = [...this.#state.selectedRoomIds, roomId];
      }
    } else {
      this.#state.selectedRoomIds = [roomId];
    }
    this.#state.selectedOpeningIds = [];  // Clear opening selection when selecting room
  }

  deselectRoom(roomId: string): void {
    this.#state.selectedRoomIds = this.#state.selectedRoomIds.filter(id => id !== roomId);
  }

  clearSelection(): void {
    this.#state.selectedRoomIds = [];
    this.#state.selectedOpeningIds = [];
    this.#state.activeHandle = null;
  }

  selectOpening(openingId: string): void {
    this.#state.selectedOpeningIds = [openingId];
    this.#state.selectedRoomIds = [];  // Clear room selection
  }

  // Hover state
  setHoveredRoom(roomId: string | null): void {
    this.#state.hoveredRoomId = roomId;
  }

  setHoveredOpening(openingId: string | null): void {
    this.#state.hoveredOpeningId = openingId;
  }

  // Handle activation
  setActiveHandle(handle: HandleType | null): void {
    this.#state.activeHandle = handle;
  }

  // Drag operations
  startDrag(
    roomId: string,
    handleType: HandleType,
    worldPos: [number, number],
    center: [number, number],
    dimensions: { width: number; depth: number }
  ): void {
    this.#state.isDragging = true;
    this.#state.activeHandle = handleType;
    this.#dragState = {
      roomId,
      handleType,
      startWorldPos: [...worldPos],
      startCenter: [...center],
      startDimensions: { ...dimensions },
      currentWorldPos: [...worldPos]
    };
  }

  updateDrag(worldPos: [number, number]): void {
    if (this.#dragState) {
      this.#dragState.currentWorldPos = [...worldPos];
    }
  }

  endDrag(): DragState | null {
    const finalState = this.#dragState;
    this.#state.isDragging = false;
    this.#state.activeHandle = null;
    this.#dragState = null;
    return finalState;
  }

  cancelDrag(): void {
    this.#state.isDragging = false;
    this.#state.activeHandle = null;
    this.#dragState = null;
  }

  // Snap settings
  setSnapEnabled(enabled: boolean): void {
    this.#snapSettings.enabled = enabled;
  }

  setGridSize(size: number): void {
    this.#snapSettings.gridSize = size;
  }

  toggleSnap(): void {
    this.#snapSettings.enabled = !this.#snapSettings.enabled;
  }

  // Calculate snapped position
  snapToGrid(value: number): number {
    if (!this.#snapSettings.enabled) return value;
    const grid = this.#snapSettings.gridSize;
    return Math.round(value / grid) * grid;
  }

  snapPosition(pos: [number, number]): [number, number] {
    return [
      this.snapToGrid(pos[0]),
      this.snapToGrid(pos[1])
    ];
  }

  // Check if a room is selected
  isSelected(roomId: string): boolean {
    return this.#state.selectedRoomIds.includes(roomId);
  }

  // Check if a room is hovered
  isHovered(roomId: string): boolean {
    return this.#state.hoveredRoomId === roomId;
  }
}

// Export singleton
export const selectionManager = new SelectionManager();

/**
 * Compute new center and dimensions based on drag handle type
 */
export function computeTransform(
  dragState: DragState,
  snapEnabled: boolean,
  gridSize: number
): { newCenter: [number, number]; newDimensions: { width: number; depth: number } } {
  const deltaX = dragState.currentWorldPos[0] - dragState.startWorldPos[0];
  const deltaY = dragState.currentWorldPos[1] - dragState.startWorldPos[1];

  let newCenterX = dragState.startCenter[0];
  let newCenterY = dragState.startCenter[1];
  let newWidth = dragState.startDimensions.width;
  let newDepth = dragState.startDimensions.depth;

  const MIN_SIZE = 4;  // 4 feet minimum room dimension

  switch (dragState.handleType) {
    case 'center':
      // Move entire room
      newCenterX += deltaX;
      newCenterY += deltaY;
      break;

    case 'e':
      // Resize east edge (increase width, shift center right)
      newWidth = Math.max(MIN_SIZE, dragState.startDimensions.width + deltaX);
      newCenterX = dragState.startCenter[0] + (newWidth - dragState.startDimensions.width) / 2;
      break;

    case 'w':
      // Resize west edge (increase width, shift center left)
      newWidth = Math.max(MIN_SIZE, dragState.startDimensions.width - deltaX);
      newCenterX = dragState.startCenter[0] - (newWidth - dragState.startDimensions.width) / 2;
      break;

    case 'n':
      // Resize north edge (increase depth, shift center up)
      newDepth = Math.max(MIN_SIZE, dragState.startDimensions.depth + deltaY);
      newCenterY = dragState.startCenter[1] + (newDepth - dragState.startDimensions.depth) / 2;
      break;

    case 's':
      // Resize south edge (increase depth, shift center down)
      newDepth = Math.max(MIN_SIZE, dragState.startDimensions.depth - deltaY);
      newCenterY = dragState.startCenter[1] - (newDepth - dragState.startDimensions.depth) / 2;
      break;

    case 'ne':
      // Resize NE corner
      newWidth = Math.max(MIN_SIZE, dragState.startDimensions.width + deltaX);
      newDepth = Math.max(MIN_SIZE, dragState.startDimensions.depth + deltaY);
      newCenterX = dragState.startCenter[0] + (newWidth - dragState.startDimensions.width) / 2;
      newCenterY = dragState.startCenter[1] + (newDepth - dragState.startDimensions.depth) / 2;
      break;

    case 'nw':
      // Resize NW corner
      newWidth = Math.max(MIN_SIZE, dragState.startDimensions.width - deltaX);
      newDepth = Math.max(MIN_SIZE, dragState.startDimensions.depth + deltaY);
      newCenterX = dragState.startCenter[0] - (newWidth - dragState.startDimensions.width) / 2;
      newCenterY = dragState.startCenter[1] + (newDepth - dragState.startDimensions.depth) / 2;
      break;

    case 'se':
      // Resize SE corner
      newWidth = Math.max(MIN_SIZE, dragState.startDimensions.width + deltaX);
      newDepth = Math.max(MIN_SIZE, dragState.startDimensions.depth - deltaY);
      newCenterX = dragState.startCenter[0] + (newWidth - dragState.startDimensions.width) / 2;
      newCenterY = dragState.startCenter[1] - (newDepth - dragState.startDimensions.depth) / 2;
      break;

    case 'sw':
      // Resize SW corner
      newWidth = Math.max(MIN_SIZE, dragState.startDimensions.width - deltaX);
      newDepth = Math.max(MIN_SIZE, dragState.startDimensions.depth - deltaY);
      newCenterX = dragState.startCenter[0] - (newWidth - dragState.startDimensions.width) / 2;
      newCenterY = dragState.startCenter[1] - (newDepth - dragState.startDimensions.depth) / 2;
      break;
  }

  // Apply grid snapping
  if (snapEnabled) {
    const snap = (v: number) => Math.round(v / gridSize) * gridSize;

    if (dragState.handleType === 'center') {
      // Snap center position
      newCenterX = snap(newCenterX);
      newCenterY = snap(newCenterY);
    } else {
      // Snap dimensions
      newWidth = snap(newWidth);
      newDepth = snap(newDepth);

      // Recalculate center based on snapped dimensions and which edge was moved
      if (dragState.handleType.includes('e')) {
        newCenterX = dragState.startCenter[0] + (newWidth - dragState.startDimensions.width) / 2;
      } else if (dragState.handleType.includes('w')) {
        newCenterX = dragState.startCenter[0] - (newWidth - dragState.startDimensions.width) / 2;
      }
      if (dragState.handleType.includes('n')) {
        newCenterY = dragState.startCenter[1] + (newDepth - dragState.startDimensions.depth) / 2;
      } else if (dragState.handleType.includes('s')) {
        newCenterY = dragState.startCenter[1] - (newDepth - dragState.startDimensions.depth) / 2;
      }
    }
  }

  return {
    newCenter: [newCenterX, newCenterY],
    newDimensions: { width: newWidth, depth: newDepth }
  };
}

/**
 * Get cursor style for handle type
 */
export function getCursorForHandle(handle: HandleType | null): string {
  if (!handle) return 'default';

  switch (handle) {
    case 'center': return 'move';
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'nw': case 'se': return 'nwse-resize';
    default: return 'default';
  }
}
