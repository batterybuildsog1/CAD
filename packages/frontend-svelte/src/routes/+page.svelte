<script lang="ts">
  /**
   * Main Workspace Page - Gemini CAD Application
   * Svelte 5 implementation with unified 3D/2D views and chat
   */
  import { onMount } from 'svelte';
  import Viewer3D from '$components/Viewer3D.svelte';
  import ChatPanel from '$components/ChatPanel.svelte';
  import FloorPlanViewer from '$components/FloorPlanViewer.svelte';
  import { wasmManager } from '$lib/wasm-store.svelte';

  // View mode state
  type ViewMode = '3d' | '2d' | 'split';
  let viewMode = $state<ViewMode>('3d');

  // Render mode for 3D viewer
  type RenderMode = 'solid' | 'shell' | 'combined';
  let renderMode = $state<RenderMode>('combined');

  // Canvas reference for visual feedback
  let canvasElement: HTMLCanvasElement | null = null;

  // Derived state
  let levelIds = $derived(wasmManager.levelIds);
  let loading = $derived(wasmManager.loading);
  let footprint = $derived(wasmManager.observableState.footprint);
  let roomCount = $derived(wasmManager.observableState.floorplan.rooms.length);

  // Initialize WASM on mount
  onMount(async () => {
    await wasmManager.init();
  });

  function handleStoreReady() {
    console.log('[Workspace] WASM store ready');
  }

  function handleGenerate() {
    // Refresh view after generation
    console.log('[Workspace] Generation complete, levels:', levelIds);
  }

  function setViewMode(mode: ViewMode) {
    viewMode = mode;
  }

  function setRenderMode(mode: RenderMode) {
    renderMode = mode;
  }
</script>

<svelte:head>
  <title>Gemini CAD</title>
</svelte:head>

<div class="h-full flex flex-col bg-gray-100">
  <!-- Header -->
  <header class="flex items-center justify-between px-4 py-2 bg-white border-b border-gray-200 shadow-sm">
    <div class="flex items-center gap-4">
      <h1 class="text-lg font-bold text-gray-900">Gemini CAD</h1>

      <!-- View mode toggle -->
      <div class="flex rounded-lg bg-gray-100 p-0.5">
        <button
          onclick={() => setViewMode('3d')}
          class="px-3 py-1 text-sm font-medium rounded-md transition-colors
                 {viewMode === '3d' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}"
        >
          3D
        </button>
        <button
          onclick={() => setViewMode('2d')}
          class="px-3 py-1 text-sm font-medium rounded-md transition-colors
                 {viewMode === '2d' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}"
        >
          2D
        </button>
        <button
          onclick={() => setViewMode('split')}
          class="px-3 py-1 text-sm font-medium rounded-md transition-colors
                 {viewMode === 'split' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}"
        >
          Split
        </button>
      </div>

      <!-- Render mode (3D only) -->
      {#if viewMode !== '2d'}
        <div class="flex rounded-lg bg-gray-100 p-0.5">
          <button
            onclick={() => setRenderMode('solid')}
            class="px-3 py-1 text-sm font-medium rounded-md transition-colors
                   {renderMode === 'solid' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}"
          >
            Solid
          </button>
          <button
            onclick={() => setRenderMode('shell')}
            class="px-3 py-1 text-sm font-medium rounded-md transition-colors
                   {renderMode === 'shell' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}"
          >
            Shell
          </button>
          <button
            onclick={() => setRenderMode('combined')}
            class="px-3 py-1 text-sm font-medium rounded-md transition-colors
                   {renderMode === 'combined' ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'}"
          >
            Combined
          </button>
        </div>
      {/if}
    </div>

    <!-- Stats -->
    <div class="flex items-center gap-4 text-sm text-gray-600">
      {#if footprint.width > 0}
        <span>Footprint: {footprint.width}' × {footprint.depth}'</span>
      {/if}
      {#if roomCount > 0}
        <span>Rooms: {roomCount}</span>
      {/if}
      {#if loading}
        <span class="text-blue-600">Loading WASM...</span>
      {/if}
    </div>
  </header>

  <!-- Main content -->
  <div class="flex-1 flex overflow-hidden">
    <!-- Viewer area -->
    <div class="flex-1 flex">
      {#if viewMode === '3d'}
        <div class="flex-1">
          <Viewer3D
            {levelIds}
            {renderMode}
            onStoreReady={handleStoreReady}
          />
        </div>
      {:else if viewMode === '2d'}
        <div class="flex-1">
          <FloorPlanViewer />
        </div>
      {:else}
        <!-- Split view -->
        <div class="flex-1 flex">
          <div class="w-1/2 border-r border-gray-300">
            <Viewer3D
              {levelIds}
              {renderMode}
              onStoreReady={handleStoreReady}
            />
          </div>
          <div class="w-1/2">
            <FloorPlanViewer />
          </div>
        </div>
      {/if}
    </div>

    <!-- Chat panel -->
    <div class="w-96 flex-shrink-0">
      <ChatPanel
        canvas={canvasElement}
        onGenerate={handleGenerate}
      />
    </div>
  </div>
</div>
