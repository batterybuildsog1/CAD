# Antigravity CAD Architecture

## Overview
Antigravity CAD is a high-performance, browser-based architectural design tool. It leverages **Rust** and **WebAssembly (WASM)** to deliver near-native performance for geometric operations directly in the client's browser.

## Core Philosophy
1.  **Client-Side First:** All interactive geometry processing happens locally on the user's device via WASM. This ensures 60 FPS interactivity and zero-latency feedback.
2.  **Rust for Correctness:** The core domain logic and geometric kernel are written in Rust, ensuring memory safety and robustness.
3.  **Scriptable:** The **Rhai** scripting engine is embedded in the WASM module, allowing users to define parametric designs using a safe, sandboxed scripting language.

## System Architecture

### 1. `geometry-core` (Rust Library)
The platform-agnostic heart of the application. It contains no HTTP or WASM-specific code.
-   **Domain:** Defines `Project`, `Building`, `Level`, `Wall`, `Room`, etc.
-   **Store:** In-memory state management (Redux-like) with event sourcing.
-   **Geometry:** Wraps the **Truck** CAD kernel for B-Rep operations (boolean, extrusion, offset).
-   **Rhai API:** Bindings for the Rhai scripting engine.

### 2. `geometry-wasm` (WASM Module)
The bridge between Rust and the Browser.
-   **Bindings:** Uses `wasm-bindgen` to expose `geometry-core` functionality to JavaScript.
-   **Memory Management:** Handles the transfer of large binary data (meshes) using `Float32Array` views to minimize copying.
-   **Render Loop:** Generates tessellated meshes from Truck BREPs for rendering.

### 3. Frontend (Next.js + React Three Fiber)
The user interface and visualization layer.
-   **UI:** React components for the project tree, property editors, and script editor.
-   **Visualization:** `@react-three/fiber` renders the mesh data received from the WASM module.
-   **State Sync:** Maintains a lightweight sync of the WASM store state for UI rendering.

## Data Flow

1.  **User Action:** User drags a wall in the 3D view.
2.  **JS Event:** React captures the input.
3.  **WASM Call:** JS calls `wasm_module.update_wall(id, new_position)`.
4.  **Rust Update:**
    -   `geometry-core` updates the `Wall` entity.
    -   Truck kernel recalculates the wall geometry (and any intersections).
    -   Store emits a `WallUpdated` event.
5.  **Mesh Generation:** Rust tessellates the new geometry into a flat vertex buffer.
6.  **Render:** JS receives a pointer to the vertex buffer and updates the `THREE.BufferGeometry`.
7.  **Paint:** The browser repaints the frame.
**Total Latency:** < 16ms (vs 200ms+ for server roundtrip).

## Technology Stack
-   **Language:** Rust (2021 edition)
-   **CAD Kernel:** Truck (B-Rep / NURBS)
-   **Scripting:** Rhai
-   **WASM Tooling:** `wasm-bindgen`, `wasm-pack`
-   **Frontend:** TypeScript, Next.js, React Three Fiber, TailwindCSS

## Directory Structure
```
packages/
  geometry-core/    # Pure Rust logic (no I/O)
  geometry-wasm/    # WASM bindings
  frontend/         # Next.js application
```

## Implementation Phases

### Phase 1: Core Refactoring
- Extract `geometry-core` from `geometry-server`.
- Ensure `no_std` compatibility where possible.
- Create `geometry-wasm` crate with `wasm-bindgen` setup.

### Phase 2: Frontend Integration
- Configure Vite/Next.js for WASM loading.
- Implement direct WASM calls for geometry updates.
- Render 3D meshes from shared memory buffers.

### Phase 3: Scripting
- Compile Rhai for WASM.
- Expose scripting API to the frontend.

### Phase 4: AI Integration (COMPLETED)
- Integrate Gemini 3.0 Pro for natural language CAD generation.
- Observable state pattern - Gemini sees what it creates, verifies, iterates.
- 26+ CAD tools with structured function calling.
- See [Gemini Integration Guide](./GEMINI_INTEGRATION.md) for detailed architecture.

### Phase 5: Coherent Home Layout System (COMPLETED)
Three-layer defense-in-depth for spatially coherent floor plans:

**Layer 1: Prompting**
- System prompt instructs Gemini to use `skill_apply_home_template` for multi-room houses
- Design guidelines enforced: Kitchen→Living, Primary→Bath adjacencies

**Layer 2: Auto-Inject Layout**
- When `position_type="auto"`, system infers adjacencies from room type
- `inferAdjacencyForRoomType()` + `layoutFloor()` compute optimal positions
- Falls back to simple placement only if smart placement fails

**Layer 3: Constraint Validation**
- `validateRoomAdjacencies()` checks layout after each room creation
- Warnings (not errors) shown in observable state
- Gemini sees warnings and can self-correct

### Phase 6: Expert Agents (COMPLETED)
Specialized agents with MINIMUM→NICE→EXTRA tier reasoning:

**Room Layout Expert** (`room-layout-expert.ts`)
- `skill_create_open_plan_expert` - Kitchen + Living + Dining combined
- `skill_create_bedroom_expert` - Sized for bed type (twin/full/queen/king)
- `skill_create_bathroom_expert` - half/three-quarter/full/jack-and-jill
- `skill_create_laundry_expert` - closet-stacked/closet-side-by-side/room

**Circulation Expert** (`circulation-expert.ts`)
- `skill_create_entry_expert` - none/landing/foyer/foyer-with-closet
- `skill_create_hallway_expert` - straight/L-shaped/T-shaped
- `skill_create_stairs_expert` - IRC code compliant
- `skill_place_interior_door` / `skill_place_exterior_door`

## Tool Hierarchy

Gemini calls tools in order of preference:

```
┌─────────────────────────────────────────────────────────┐
│ TIER 1: EXPERT AGENTS (Highest - Preferred)             │
│ Returns tier reasoning with WHY explanations            │
│ • skill_create_open_plan_expert                        │
│ • skill_create_bedroom_expert                          │
│ • skill_create_entry_expert, etc.                      │
└────────────────────────┬────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ TIER 2: BASE SKILLS (cad-skills.ts)                    │
│ Encapsulates architectural knowledge                    │
│ • skill_apply_home_template (layout planning)          │
│ • skill_create_rectangular_room                        │
│ • skill_create_hallway                                 │
└────────────────────────┬────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ TIER 3: RAW CAD TOOLS                                  │
│ Low-level geometry operations                           │
│ • create_project → add_building → add_level            │
│ • create_room (polygon points)                         │
│ • create_wall, add_opening                             │
└─────────────────────────────────────────────────────────┘
```

## Production Home Templates

Three tiers for affordable housing ($200K-$450K):

| Template | Sqft | Price | Beds/Baths | Key Features |
|----------|------|-------|------------|--------------|
| **Starter** | 1,000-1,500 | $200K-$300K | 2-3/1-2 | Open concept, compact |
| **Family** | 1,800-2,500 | $280K-$380K | 3-4/2-2.5 | Formal entry, family room |
| **Executive** | 2,500-4,500 | $350K-$450K | 4-5/3+ | Primary suite, separate wings |

Each template defines:
- **Zones**: Entry (NORTH), Public, Private (SOUTH), Service (WEST)
- **Adjacencies**: Required room relationships (Kitchen→Living, Primary→Bath)
- **Cardinal directions**: Where each zone should be positioned

## Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `gemini-cad.ts` | AI client, system prompt, tool routing | ~1,480 |
| `cad-skills.ts` | Skills, templates, adjacency rules | ~1,860 |
| `observable-state.ts` | State tracking, constraint validation | ~880 |
| `room-layout-expert.ts` | Expert agent for interior spaces | ~1,100 |
| `circulation-expert.ts` | Expert agent for movement/doors | ~2,430 |
| `expert-types.ts` | Shared tier types (DesignTier, TierReasoning) | ~75 |


