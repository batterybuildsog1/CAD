<script lang="ts">
  /**
   * FloorPlanViewer.svelte - Interactive 2D Floor Plan Editor
   * Uses Canvas2D for rendering with full drag/resize capabilities
   */
  import { onMount, onDestroy } from 'svelte';
  import { wasmManager, type RoomSummary } from '$lib/wasm-store.svelte';
  import {
    selectionManager,
    computeTransform,
    getCursorForHandle,
    type HandleType,
    type DragState
  } from '$lib/selection-store.svelte';

  // Props
  interface Props {
    showGrid?: boolean;
    showLabels?: boolean;
    showDimensions?: boolean;
    backgroundColor?: string;
    onRoomMoved?: (roomId: string, newCenter: [number, number]) => void;
    onRoomResized?: (roomId: string, newCenter: [number, number], newDimensions: { width: number; depth: number }) => void;
  }

  let {
    showGrid = true,
    showLabels = true,
    showDimensions = true,
    backgroundColor = '#f3f4f6',
    onRoomMoved,
    onRoomResized
  }: Props = $props();

  // Canvas reference
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;

  // View state
  let scale = $state(20); // pixels per foot
  let offsetX = $state(50);
  let offsetY = $state(50);

  // Pan state
  let isPanning = $state(false);
  let panStart = $state<{ x: number; y: number } | null>(null);

  // Derived state
  let rooms = $derived(wasmManager.observableState.floorplan.rooms);
  let footprint = $derived(wasmManager.observableState.footprint);
  let openings = $derived(wasmManager.observableState.floorplan.openings || []);

  // Selection state
  let selectedRoomIds = $derived(selectionManager.selectedRoomIds);
  let hoveredRoomId = $derived(selectionManager.state.hoveredRoomId);
  let isDragging = $derived(selectionManager.isDragging);
  let dragState = $derived(selectionManager.dragState);
  let activeHandle = $derived(selectionManager.activeHandle);

  // Cursor derived from active handle or hover state
  let cursor = $derived.by(() => {
    if (isDragging && activeHandle) {
      return getCursorForHandle(activeHandle);
    }
    if (selectionManager.state.activeHandle) {
      return getCursorForHandle(selectionManager.state.activeHandle);
    }
    if (isPanning) {
      return 'grabbing';
    }
    return 'default';
  });

  // Room colors
  const ROOM_COLORS: Record<string, string> = {
    living: '#3b5249',
    kitchen: '#4a4a38',
    bedroom: '#3d4a5c',
    bathroom: '#4a4359',
    hallway: '#45424a',
    dining: '#45424a',
    closet: '#3d3d3d',
    utility: '#3d3d3d',
    default: '#6b7280'
  };

  // Handle size in pixels
  const HANDLE_SIZE = 8;
  const HANDLE_HIT_RADIUS = 12;  // Larger hit area for easier grabbing

  onMount(() => {
    ctx = canvas.getContext('2d');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
  });

  onDestroy(() => {
    window.removeEventListener('resize', resizeCanvas);
  });

  function resizeCanvas() {
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    draw();
  }

  // Redraw when state changes
  $effect(() => {
    if (ctx && (rooms || footprint || openings || selectedRoomIds || hoveredRoomId || dragState)) {
      draw();
    }
  });

  // ============= COORDINATE CONVERSION =============

  function worldToScreen(worldX: number, worldY: number): [number, number] {
    return [
      offsetX + worldX * scale,
      canvas.height - offsetY - worldY * scale
    ];
  }

  function screenToWorld(screenX: number, screenY: number): [number, number] {
    return [
      (screenX - offsetX) / scale,
      (canvas.height - screenY - offsetY) / scale
    ];
  }

  // ============= HIT TESTING =============

  interface HitResult {
    type: 'room' | 'handle' | 'opening' | 'none';
    roomId?: string;
    openingId?: string;
    handleType?: HandleType;
  }

  function hitTest(screenX: number, screenY: number): HitResult {
    const [worldX, worldY] = screenToWorld(screenX, screenY);

    // First check handles on selected rooms (highest priority)
    for (const roomId of selectedRoomIds) {
      const room = rooms.find(r => r.id === roomId);
      if (!room) continue;

      const handle = hitTestHandles(room, screenX, screenY);
      if (handle) {
        return { type: 'handle', roomId, handleType: handle };
      }
    }

    // Then check room interiors
    for (const room of rooms) {
      if (isPointInRoom(worldX, worldY, room)) {
        return { type: 'room', roomId: room.id };
      }
    }

    return { type: 'none' };
  }

  function isPointInRoom(worldX: number, worldY: number, room: RoomSummary): boolean {
    const halfW = room.dimensions.width / 2;
    const halfD = room.dimensions.depth / 2;

    return (
      worldX >= room.center[0] - halfW &&
      worldX <= room.center[0] + halfW &&
      worldY >= room.center[1] - halfD &&
      worldY <= room.center[1] + halfD
    );
  }

  function hitTestHandles(room: RoomSummary, screenX: number, screenY: number): HandleType | null {
    const handles = getHandlePositions(room);

    for (const [handle, pos] of Object.entries(handles)) {
      const [hx, hy] = pos;
      const dx = screenX - hx;
      const dy = screenY - hy;
      if (Math.sqrt(dx * dx + dy * dy) <= HANDLE_HIT_RADIUS) {
        return handle as HandleType;
      }
    }

    return null;
  }

  function getHandlePositions(room: RoomSummary): Record<HandleType, [number, number]> {
    const halfW = room.dimensions.width / 2;
    const halfD = room.dimensions.depth / 2;

    const [cx, cy] = worldToScreen(room.center[0], room.center[1]);
    const w = halfW * scale;
    const d = halfD * scale;

    return {
      center: [cx, cy],
      n: [cx, cy - d],
      s: [cx, cy + d],
      e: [cx + w, cy],
      w: [cx - w, cy],
      ne: [cx + w, cy - d],
      nw: [cx - w, cy - d],
      se: [cx + w, cy + d],
      sw: [cx - w, cy + d]
    };
  }

  // ============= POINTER EVENT HANDLERS =============

  function handlePointerDown(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Middle mouse button or space+click for panning
    if (e.button === 1 || (e.button === 0 && e.altKey)) {
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    const hit = hitTest(screenX, screenY);

    if (hit.type === 'none') {
      // Click on empty space - clear selection
      selectionManager.clearSelection();
      return;
    }

    if (hit.type === 'handle' && hit.roomId && hit.handleType) {
      // Start dragging a handle
      const room = rooms.find(r => r.id === hit.roomId);
      if (room) {
        const [worldX, worldY] = screenToWorld(screenX, screenY);
        selectionManager.startDrag(
          hit.roomId,
          hit.handleType,
          [worldX, worldY],
          room.center,
          room.dimensions
        );
        canvas.setPointerCapture(e.pointerId);
      }
      return;
    }

    if (hit.type === 'room' && hit.roomId) {
      // Select room
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      selectionManager.selectRoom(hit.roomId, additive);

      // If clicking on already selected room, start center drag
      if (selectedRoomIds.includes(hit.roomId)) {
        const room = rooms.find(r => r.id === hit.roomId);
        if (room) {
          const [worldX, worldY] = screenToWorld(screenX, screenY);
          selectionManager.startDrag(
            hit.roomId,
            'center',
            [worldX, worldY],
            room.center,
            room.dimensions
          );
          canvas.setPointerCapture(e.pointerId);
        }
      }
    }
  }

  function handlePointerMove(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Handle panning
    if (isPanning && panStart) {
      offsetX += e.clientX - panStart.x;
      offsetY -= e.clientY - panStart.y;  // Y is inverted
      panStart = { x: e.clientX, y: e.clientY };
      draw();
      return;
    }

    // Handle dragging
    if (isDragging && dragState) {
      const [worldX, worldY] = screenToWorld(screenX, screenY);
      selectionManager.updateDrag([worldX, worldY]);
      draw();
      return;
    }

    // Update hover state and cursor
    const hit = hitTest(screenX, screenY);

    if (hit.type === 'handle' && hit.handleType) {
      selectionManager.setActiveHandle(hit.handleType);
      selectionManager.setHoveredRoom(hit.roomId || null);
    } else if (hit.type === 'room') {
      selectionManager.setActiveHandle(null);
      selectionManager.setHoveredRoom(hit.roomId || null);
    } else {
      selectionManager.setActiveHandle(null);
      selectionManager.setHoveredRoom(null);
    }
  }

  function handlePointerUp(e: PointerEvent) {
    canvas.releasePointerCapture(e.pointerId);

    // End panning
    if (isPanning) {
      isPanning = false;
      panStart = null;
      return;
    }

    // End dragging and commit changes
    if (isDragging && dragState) {
      const finalDrag = selectionManager.endDrag();
      if (finalDrag) {
        commitDrag(finalDrag);
      }
    }
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Zoom centered on mouse position
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(50, Math.max(5, scale * zoomFactor));

    // Adjust offset to zoom toward mouse position
    const scaleRatio = newScale / scale;
    offsetX = mouseX - (mouseX - offsetX) * scaleRatio;
    offsetY = (canvas.height - mouseY) - ((canvas.height - mouseY) - offsetY) * scaleRatio;

    scale = newScale;
    draw();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (isDragging) {
        selectionManager.cancelDrag();
        draw();
      } else {
        selectionManager.clearSelection();
      }
    }

    if (e.key === 'Delete' || e.key === 'Backspace') {
      // TODO: Delete selected rooms (with confirmation?)
    }
  }

  // ============= COMMIT CHANGES =============

  function commitDrag(drag: DragState) {
    const { newCenter, newDimensions } = computeTransform(
      drag,
      selectionManager.snapSettings.enabled,
      selectionManager.snapSettings.gridSize
    );

    if (drag.handleType === 'center') {
      // Only position changed
      onRoomMoved?.(drag.roomId, newCenter);
    } else {
      // Dimensions changed
      onRoomResized?.(drag.roomId, newCenter, newDimensions);
    }
  }

  // ============= DRAWING =============

  function draw() {
    if (!ctx || !canvas) return;

    const { width, height } = canvas;

    // Clear canvas
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Draw grid
    if (showGrid) {
      drawGrid();
    }

    // Draw footprint outline
    if (footprint.width > 0 && footprint.depth > 0) {
      drawFootprint();
    }

    // Draw rooms
    for (const room of rooms) {
      drawRoom(room);
    }

    // Draw drag preview
    if (isDragging && dragState) {
      drawDragPreview(dragState);
    }

    // Draw handles on selected rooms
    for (const roomId of selectedRoomIds) {
      const room = rooms.find(r => r.id === roomId);
      if (room && !isDragging) {
        drawHandles(room);
      }
    }

    // Draw doors/openings on top
    drawDoors();
  }

  function drawGrid() {
    if (!ctx || !canvas) return;

    const gridSize = scale; // 1 foot grid
    ctx.strokeStyle = '#e5e7eb';
    ctx.lineWidth = 0.5;

    // Vertical lines
    for (let x = offsetX % gridSize; x < canvas.width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    // Horizontal lines
    for (let y = (canvas.height - offsetY) % gridSize; y < canvas.height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }

    // Major grid lines (every 5 feet)
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 1;
    const majorGridSize = gridSize * 5;

    for (let x = offsetX % majorGridSize; x < canvas.width; x += majorGridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    }

    for (let y = (canvas.height - offsetY) % majorGridSize; y < canvas.height; y += majorGridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  function drawFootprint() {
    if (!ctx) return;

    const [x, y] = worldToScreen(0, footprint.depth);
    const w = footprint.width * scale;
    const h = footprint.depth * scale;

    // Footprint outline
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Dimensions
    if (showDimensions) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = '#374151';
      ctx.textAlign = 'center';

      // Width label
      ctx.fillText(
        `${footprint.width}'`,
        x + w / 2,
        y + h + 16
      );

      // Depth label
      ctx.save();
      ctx.translate(x - 16, y + h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`${footprint.depth}'`, 0, 0);
      ctx.restore();
    }
  }

  function drawRoom(room: RoomSummary) {
    if (!ctx) return;

    // Skip if this room is being dragged (we draw preview instead)
    if (isDragging && dragState?.roomId === room.id) {
      // Draw ghost of original position
      drawRoomGhost(room);
      return;
    }

    const [x, y] = worldToScreen(
      room.center[0] - room.dimensions.width / 2,
      room.center[1] + room.dimensions.depth / 2
    );
    const w = room.dimensions.width * scale;
    const h = room.dimensions.depth * scale;

    const isSelected = selectedRoomIds.includes(room.id);
    const isHovered = hoveredRoomId === room.id;

    // Room fill
    const color = ROOM_COLORS[room.type] || ROOM_COLORS.default;
    ctx.fillStyle = color + (isSelected ? '60' : '40'); // 37% or 25% opacity
    ctx.fillRect(x, y, w, h);

    // Room outline
    if (isSelected) {
      ctx.strokeStyle = '#f59e0b';  // Amber for selected
      ctx.lineWidth = 3;
    } else if (isHovered) {
      ctx.strokeStyle = '#3b82f6';  // Blue for hovered
      ctx.lineWidth = 2;
    } else {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
    }
    ctx.strokeRect(x, y, w, h);

    // Labels
    if (showLabels) {
      ctx.fillStyle = '#1f2937';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(room.name, x + w / 2, y + h / 2 - 8);

      // Dimensions
      if (showDimensions) {
        ctx.font = '10px system-ui, sans-serif';
        ctx.fillStyle = '#6b7280';
        ctx.fillText(
          `${room.dimensions.width}' × ${room.dimensions.depth}'`,
          x + w / 2,
          y + h / 2 + 8
        );
      }
    }
  }

  function drawRoomGhost(room: RoomSummary) {
    if (!ctx) return;

    const [x, y] = worldToScreen(
      room.center[0] - room.dimensions.width / 2,
      room.center[1] + room.dimensions.depth / 2
    );
    const w = room.dimensions.width * scale;
    const h = room.dimensions.depth * scale;

    // Ghost outline (dashed)
    ctx.strokeStyle = '#9ca3af';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
  }

  function drawDragPreview(drag: DragState) {
    if (!ctx) return;

    const room = rooms.find(r => r.id === drag.roomId);
    if (!room) return;

    const { newCenter, newDimensions } = computeTransform(
      drag,
      selectionManager.snapSettings.enabled,
      selectionManager.snapSettings.gridSize
    );

    const [x, y] = worldToScreen(
      newCenter[0] - newDimensions.width / 2,
      newCenter[1] + newDimensions.depth / 2
    );
    const w = newDimensions.width * scale;
    const h = newDimensions.depth * scale;

    // Preview fill
    const color = ROOM_COLORS[room.type] || ROOM_COLORS.default;
    ctx.fillStyle = color + '50';
    ctx.fillRect(x, y, w, h);

    // Preview outline
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);

    // Dimension labels
    ctx.fillStyle = '#1f2937';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `${newDimensions.width.toFixed(1)}' × ${newDimensions.depth.toFixed(1)}'`,
      x + w / 2,
      y + h / 2
    );

    // Draw handles on preview
    drawHandlesAt(newCenter, newDimensions);
  }

  function drawHandles(room: RoomSummary) {
    drawHandlesAt(room.center, room.dimensions);
  }

  function drawHandlesAt(center: [number, number], dimensions: { width: number; depth: number }) {
    if (!ctx) return;

    const halfW = dimensions.width / 2;
    const halfD = dimensions.depth / 2;

    const handles: Array<{ pos: [number, number]; type: HandleType; isCorner: boolean }> = [
      { pos: [center[0], center[1]], type: 'center', isCorner: false },
      { pos: [center[0], center[1] + halfD], type: 'n', isCorner: false },
      { pos: [center[0], center[1] - halfD], type: 's', isCorner: false },
      { pos: [center[0] + halfW, center[1]], type: 'e', isCorner: false },
      { pos: [center[0] - halfW, center[1]], type: 'w', isCorner: false },
      { pos: [center[0] + halfW, center[1] + halfD], type: 'ne', isCorner: true },
      { pos: [center[0] - halfW, center[1] + halfD], type: 'nw', isCorner: true },
      { pos: [center[0] + halfW, center[1] - halfD], type: 'se', isCorner: true },
      { pos: [center[0] - halfW, center[1] - halfD], type: 'sw', isCorner: true }
    ];

    for (const handle of handles) {
      const [sx, sy] = worldToScreen(handle.pos[0], handle.pos[1]);

      // Handle fill
      if (handle.type === 'center') {
        ctx.fillStyle = '#fbbf24';  // Amber
      } else if (handle.isCorner) {
        ctx.fillStyle = '#4ade80';  // Green
      } else {
        ctx.fillStyle = '#60a5fa';  // Blue
      }

      ctx.beginPath();
      if (handle.type === 'center') {
        // Center handle is circular
        ctx.arc(sx, sy, HANDLE_SIZE / 2 + 2, 0, Math.PI * 2);
      } else {
        // Other handles are squares
        ctx.rect(sx - HANDLE_SIZE / 2, sy - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
      }
      ctx.fill();

      // Handle border
      ctx.strokeStyle = '#1f2937';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function drawDoors() {
    if (!ctx) return;

    for (const opening of openings) {
      // Only draw doors/openings with positions
      if (!opening.position || opening.type === 'window') continue;

      const [doorX, doorY] = opening.position;
      const [screenX, screenY] = worldToScreen(doorX, doorY);
      const doorWidth = (opening.width || 3) * scale;

      // Determine door orientation from wall direction
      const isVertical = opening.wallDirection === 'east' || opening.wallDirection === 'west';

      // Draw door opening (white gap in wall)
      ctx.fillStyle = '#ffffff';
      if (isVertical) {
        ctx.fillRect(screenX - 2, screenY - doorWidth / 2, 4, doorWidth);
      } else {
        ctx.fillRect(screenX - doorWidth / 2, screenY - 2, doorWidth, 4);
      }

      // Draw door swing arc for regular doors
      if (opening.type === 'door') {
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 1;
        ctx.beginPath();

        const arcRadius = doorWidth * 0.8;

        if (isVertical) {
          if (opening.wallDirection === 'east') {
            ctx.arc(screenX, screenY - doorWidth / 2, arcRadius, 0, Math.PI / 2);
          } else {
            ctx.arc(screenX, screenY + doorWidth / 2, arcRadius, -Math.PI / 2, 0);
          }
        } else {
          if (opening.wallDirection === 'north') {
            ctx.arc(screenX - doorWidth / 2, screenY, arcRadius, -Math.PI / 2, 0);
          } else {
            ctx.arc(screenX + doorWidth / 2, screenY, arcRadius, Math.PI, Math.PI * 1.5);
          }
        }
        ctx.stroke();

        // Door line
        ctx.beginPath();
        if (isVertical) {
          if (opening.wallDirection === 'east') {
            ctx.moveTo(screenX, screenY - doorWidth / 2);
            ctx.lineTo(screenX + arcRadius, screenY - doorWidth / 2);
          } else {
            ctx.moveTo(screenX, screenY + doorWidth / 2);
            ctx.lineTo(screenX - arcRadius, screenY + doorWidth / 2);
          }
        } else {
          if (opening.wallDirection === 'north') {
            ctx.moveTo(screenX - doorWidth / 2, screenY);
            ctx.lineTo(screenX - doorWidth / 2, screenY - arcRadius);
          } else {
            ctx.moveTo(screenX + doorWidth / 2, screenY);
            ctx.lineTo(screenX + doorWidth / 2, screenY + arcRadius);
          }
        }
        ctx.stroke();
      } else if (opening.type === 'cased_opening') {
        ctx.strokeStyle = '#6b7280';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);

        if (isVertical) {
          ctx.beginPath();
          ctx.moveTo(screenX - 3, screenY - doorWidth / 2);
          ctx.lineTo(screenX - 3, screenY + doorWidth / 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(screenX + 3, screenY - doorWidth / 2);
          ctx.lineTo(screenX + 3, screenY + doorWidth / 2);
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.moveTo(screenX - doorWidth / 2, screenY - 3);
          ctx.lineTo(screenX + doorWidth / 2, screenY - 3);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(screenX - doorWidth / 2, screenY + 3);
          ctx.lineTo(screenX + doorWidth / 2, screenY + 3);
          ctx.stroke();
        }

        ctx.setLineDash([]);
      }
    }
  }

  // Zoom controls
  function zoomIn() {
    scale = Math.min(scale * 1.2, 50);
  }

  function zoomOut() {
    scale = Math.max(scale / 1.2, 5);
  }

  function resetView() {
    scale = 20;
    offsetX = 50;
    offsetY = 50;
  }

  function toggleSnap() {
    selectionManager.toggleSnap();
  }
</script>

<svelte:window on:keydown={handleKeyDown} />

<div class="relative w-full h-full" style="background-color: {backgroundColor}">
  <canvas
    bind:this={canvas}
    class="w-full h-full"
    style="cursor: {cursor}"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onwheel={handleWheel}
  ></canvas>

  <!-- Zoom controls -->
  <div class="absolute bottom-4 right-4 flex flex-col gap-1 bg-white rounded-lg shadow-md p-1">
    <button
      onclick={zoomIn}
      class="p-2 hover:bg-gray-100 rounded text-gray-700"
      title="Zoom In"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
      </svg>
    </button>
    <button
      onclick={zoomOut}
      class="p-2 hover:bg-gray-100 rounded text-gray-700"
      title="Zoom Out"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4" />
      </svg>
    </button>
    <button
      onclick={resetView}
      class="p-2 hover:bg-gray-100 rounded text-gray-700"
      title="Reset View"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
      </svg>
    </button>
    <div class="border-t border-gray-200 my-1"></div>
    <button
      onclick={toggleSnap}
      class="p-2 hover:bg-gray-100 rounded {selectionManager.snapSettings.enabled ? 'text-blue-600 bg-blue-50' : 'text-gray-400'}"
      title="Toggle Grid Snap ({selectionManager.snapSettings.enabled ? 'On' : 'Off'})"
    >
      <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm0 8a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2zm0 8a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2z" />
      </svg>
    </button>
  </div>

  <!-- Legend -->
  <div class="absolute top-4 left-4 bg-white/90 rounded-lg shadow-sm p-2 text-xs">
    <div class="font-semibold text-gray-700 mb-1">Room Types</div>
    <div class="grid grid-cols-2 gap-1">
      {#each Object.entries(ROOM_COLORS).slice(0, 6) as [type, color]}
        <div class="flex items-center gap-1">
          <div class="w-3 h-3 rounded" style="background-color: {color}40; border: 1px solid {color}"></div>
          <span class="text-gray-600 capitalize">{type}</span>
        </div>
      {/each}
    </div>
  </div>

  <!-- Selection info -->
  {#if selectedRoomIds.length > 0}
    {@const selectedRoom = rooms.find(r => r.id === selectedRoomIds[0])}
    {#if selectedRoom}
      <div class="absolute top-4 right-4 bg-white/95 rounded-lg shadow-md p-3 text-sm min-w-[180px]">
        <div class="font-semibold text-gray-800 mb-2">{selectedRoom.name}</div>
        <div class="space-y-1 text-gray-600">
          <div class="flex justify-between">
            <span>Type:</span>
            <span class="capitalize">{selectedRoom.type}</span>
          </div>
          <div class="flex justify-between">
            <span>Size:</span>
            <span>{selectedRoom.dimensions.width}' × {selectedRoom.dimensions.depth}'</span>
          </div>
          <div class="flex justify-between">
            <span>Area:</span>
            <span>{selectedRoom.area.toFixed(0)} sq ft</span>
          </div>
          <div class="flex justify-between">
            <span>Center:</span>
            <span>({selectedRoom.center[0].toFixed(1)}, {selectedRoom.center[1].toFixed(1)})</span>
          </div>
        </div>
        <div class="mt-3 pt-2 border-t border-gray-200 text-xs text-gray-500">
          Drag to move · Handles to resize
        </div>
      </div>
    {/if}
  {/if}

  <!-- Snap indicator -->
  {#if selectionManager.snapSettings.enabled}
    <div class="absolute bottom-4 left-4 bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-medium">
      Snap: {selectionManager.snapSettings.gridSize}' grid
    </div>
  {/if}
</div>
