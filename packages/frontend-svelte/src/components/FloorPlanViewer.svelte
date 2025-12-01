<script lang="ts">
  /**
   * FloorPlanViewer.svelte - 2D Floor Plan Renderer
   * Uses Canvas2D for fast 2D rendering of floor plans
   */
  import { onMount, onDestroy } from 'svelte';
  import { wasmManager } from '$lib/wasm-store.svelte';

  // Props
  interface Props {
    showGrid?: boolean;
    showLabels?: boolean;
    showDimensions?: boolean;
    backgroundColor?: string;
  }

  let {
    showGrid = true,
    showLabels = true,
    showDimensions = true,
    backgroundColor = '#f3f4f6'
  }: Props = $props();

  // Canvas reference
  let canvas: HTMLCanvasElement;
  let ctx: CanvasRenderingContext2D | null = null;

  // View state
  let scale = $state(20); // pixels per foot
  let offsetX = $state(50);
  let offsetY = $state(50);

  // Derived state
  let rooms = $derived(wasmManager.observableState.floorplan.rooms);
  let footprint = $derived(wasmManager.observableState.footprint);
  let openings = $derived(wasmManager.observableState.floorplan.openings || []);

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
    if (ctx && (rooms || footprint || openings)) {
      draw();
    }
  });

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
    for (let y = offsetY % gridSize; y < canvas.height; y += gridSize) {
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

    for (let y = offsetY % majorGridSize; y < canvas.height; y += majorGridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
      ctx.stroke();
    }
  }

  function drawFootprint() {
    if (!ctx) return;

    const x = offsetX;
    const y = offsetY;
    const w = footprint.width * scale;
    const h = footprint.depth * scale;

    // Footprint outline
    ctx.strokeStyle = '#374151';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, canvas.height - y - h, w, h);

    // Dimensions
    if (showDimensions) {
      ctx.font = '12px system-ui, sans-serif';
      ctx.fillStyle = '#374151';
      ctx.textAlign = 'center';

      // Width label
      ctx.fillText(
        `${footprint.width}'`,
        x + w / 2,
        canvas.height - y + 16
      );

      // Depth label
      ctx.save();
      ctx.translate(x - 16, canvas.height - y - h / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(`${footprint.depth}'`, 0, 0);
      ctx.restore();
    }
  }

  function drawRoom(room: typeof rooms[0]) {
    if (!ctx) return;

    const x = offsetX + room.center[0] * scale - (room.dimensions.width * scale) / 2;
    const y = canvas.height - offsetY - room.center[1] * scale - (room.dimensions.depth * scale) / 2;
    const w = room.dimensions.width * scale;
    const h = room.dimensions.depth * scale;

    // Room fill
    const color = ROOM_COLORS[room.type] || ROOM_COLORS.default;
    ctx.fillStyle = color + '40'; // 25% opacity
    ctx.fillRect(x, y, w, h);

    // Room outline
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
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

  function drawDoors() {
    if (!ctx) return;

    for (const opening of openings) {
      // Only draw doors/openings with positions
      if (!opening.position || opening.type === 'window') continue;

      const [doorX, doorY] = opening.position;
      const screenX = offsetX + doorX * scale;
      const screenY = canvas.height - offsetY - doorY * scale;
      const doorWidth = (opening.width || 3) * scale;

      // Determine door orientation from wall direction
      const isVertical = opening.wallDirection === 'east' || opening.wallDirection === 'west';

      // Draw door opening (white gap in wall)
      ctx.fillStyle = '#ffffff';
      if (isVertical) {
        // Vertical wall - horizontal door gap
        ctx.fillRect(screenX - 2, screenY - doorWidth / 2, 4, doorWidth);
      } else {
        // Horizontal wall - vertical door gap
        ctx.fillRect(screenX - doorWidth / 2, screenY - 2, doorWidth, 4);
      }

      // Draw door swing arc for regular doors
      if (opening.type === 'door') {
        ctx.strokeStyle = '#374151';
        ctx.lineWidth = 1;
        ctx.beginPath();

        const arcRadius = doorWidth * 0.8;

        if (isVertical) {
          // Door on vertical wall
          if (opening.wallDirection === 'east') {
            ctx.arc(screenX, screenY - doorWidth / 2, arcRadius, 0, Math.PI / 2);
          } else {
            ctx.arc(screenX, screenY + doorWidth / 2, arcRadius, -Math.PI / 2, 0);
          }
        } else {
          // Door on horizontal wall
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
        // Draw cased opening as dashed lines on both sides
        ctx.strokeStyle = '#6b7280';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);

        if (isVertical) {
          // Vertical wall
          ctx.beginPath();
          ctx.moveTo(screenX - 3, screenY - doorWidth / 2);
          ctx.lineTo(screenX - 3, screenY + doorWidth / 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(screenX + 3, screenY - doorWidth / 2);
          ctx.lineTo(screenX + 3, screenY + doorWidth / 2);
          ctx.stroke();
        } else {
          // Horizontal wall
          ctx.beginPath();
          ctx.moveTo(screenX - doorWidth / 2, screenY - 3);
          ctx.lineTo(screenX + doorWidth / 2, screenY - 3);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(screenX - doorWidth / 2, screenY + 3);
          ctx.lineTo(screenX + doorWidth / 2, screenY + 3);
          ctx.stroke();
        }

        ctx.setLineDash([]); // Reset dash
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
</script>

<div class="relative w-full h-full" style="background-color: {backgroundColor}">
  <canvas
    bind:this={canvas}
    class="w-full h-full"
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
</div>
