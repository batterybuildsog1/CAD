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

## Visualization & Accuracy Strategy

### Stepped Visualization Fidelity

We treat graphics fidelity as a *stepped pipeline* built on a single canonical building model:

- **Tier 1 – Design-Time Views (Fast, Clear)**
  - Purpose: rapid iteration with Gemini and the user.
  - Views:
    - 2D floor plans rendered from `ObservableState` / `llmState` (rooms, walls, circulation).
    - 3D massing / shells rendered via the WASM CAD kernel + WebGL (react-three-fiber).
  - Characteristics:
    - Stylized, high-contrast, “diagrammatic” visuals.
    - Always synchronized with the latest LLM-driven geometry and constraints.
    - Prioritizes clarity, FPS, and editability over photorealism.

- **Tier 2 – Review & Coordination Views (Richer, Still Interactive)**
  - Purpose: stakeholder review, internal QA, and trade coordination.
  - Views:
    - Enhanced 2D sheets with dimensions, tags, and validation/code overlays.
    - 3D with better materials, shadows, lighting and section cuts; per-system overlays (plumbing, electrical, HVAC).
  - Characteristics:
    - More realistic shading and lighting where it improves comprehension.
    - Uses the same geometry and instance data as Tier 1, rendered with richer shaders and post-processing.
    - Tuned for navigation and explanation rather than frame-perfect editing.

- **Tier 3 – Presentation / Marketing Output (High-End, Possibly Offline)**
  - Purpose: final sign-off, client presentations, and marketing imagery.
  - Views:
    - Path-traced or baked-lighting renders, cinematic camera paths, and high-resolution stills.
  - Characteristics:
    - Derived strictly from the canonical model; no “cheating” geometry that diverges from the CAD/MEP truth.
    - Can be produced as background/offline jobs; not required for interactive design loops.

> **LLM Perspective:** Gemini primarily consumes **structured scene data** (geometry, topology, semantics, graphs, validation results) rather than pixels. All visual tiers are just different renderings of the same canonical model, so what humans see is always aligned with what the LLM reasons about.

### Accuracy Goals: Beyond Traditional CAD Drawings

Our target is **CAD-level and beyond** for *building completeness*, not sub-millimeter machining precision.

- **Accuracy Focus**
  - We care about:
    - Correct topology and connectivity (rooms, walls, levels, systems).
    - Full coverage of building systems (plumbing, electrical, HVAC, etc.).
    - No impossible overlaps or missing connections.
  - We do *not* optimize for fractions-of-a-millimeter tolerance; centimeter-level building accuracy is acceptable as long as:
    - Components fit and coordinate across trades.
    - Quantities and extents are correct for procurement, cost, and permitting.

- **Scope of the Canonical Model**
  - The WASM CAD engine and `ObservableState` / `NewObservableState` together represent:
    - **Architecture:** levels, footprints, rooms, walls, openings, stairs, roofs.
    - **MEP Systems:** plumbing supply and waste, electrical branches and panels, low-voltage, HVAC ductwork and equipment.
    - **Components:** every instance has an ID, type, geometry, and metadata (material, spec, trade, system).
  - This model is the **single source of truth** for:
    - Interactive 2D/3D views.
    - Schedules and material takeoffs.
    - Code and design validation logic.
    - Export formats (2D plan sets and 3D models).

### Deliverables: 2D Plan Sets and Navigable 3D Models

We design the system to produce both traditional drawings and modern 3D experiences from the same underlying data:

- **2D Plan Sets (for City & Subcontractors)**
  - Dimensioned floor plans, RCPs, elevations, sections.
  - Trade-specific sheets (P, E, M, etc.) with appropriate symbols and annotations.
  - Schedules (doors, windows, fixtures, equipment) and material takeoffs.

- **3D Navigable Model**
  - An explorable 3D model of the building suitable for:
    - City reviewers (where accepted).
    - Subcontractors and installers.
    - Owners and internal teams.
  - Exactly matches the 2D sheets in geometry, systems, and quantities.

### Future: Code and Standards Checking

As the canonical model matures, we will integrate automated and semi-automated code checks:

- Encode rules and standards (e.g., life safety, accessibility, energy, ventilation) against:
  - Spaces and occupancies.
  - Egress paths and travel distances.
  - Clearances and fire separations.
  - System capacities and loads.
- The LLM acts as:
  - A **code explainer** (why something passes/fails).
  - A **navigator** (highlight violations, show alternative solutions).
  - A **design assistant** (suggest changes that resolve violations while preserving design intent).

The core principle is that **visual fidelity, material takeoffs, and code checks all derive from the same complete and coordinated building model**, ensuring consistency from early design to permit submission and construction.

### Canonical Building Model (Data Layers)

At the data level we organize the canonical model into four main layers:

- **Identity & Hierarchy**
  - `Project` → `Building` → `Level` hierarchy, owned by the Rust/WASM store.
  - Stable IDs for every entity (project, building, level, room, wall, opening, component, system).
  - This hierarchy is the anchor for exports (plan sets, 3D models) and versioning.

- **Spaces & Envelopes**
  - Architectural “spaces” such as rooms, circulation, and outdoor areas.
  - Physical enclosing elements: walls, slabs, roofs, openings, stairs.
  - Tracked both in the WASM engine and in `observable-state.ts` as LLM-friendly summaries (room polygons, wall segments, adjacencies).

- **Systems & Components**
  - Building systems (plumbing, electrical, HVAC, low-voltage, etc.) defined as **systems** with:
    - Type (e.g., `plumbing_supply`, `electrical_branch`, `hvac_supply`).
    - Served spaces (room IDs) and major equipment.
  - Individual **component instances** (fixtures, fittings, segments of pipe/duct/wire, panels, diffusers, etc.) with:
    - Geometry and placement (level, approximate location, extents).
    - Specification references (material/system spec IDs).
    - Trade and category tags for filtering and takeoffs.

- **Quantities, Schedules & Views**
  - Aggregated quantities (length/area/volume/count) by spec, trade, and system for material takeoffs and BOMs.
  - Schedule-friendly slices (doors, windows, equipment, circuits, runs).
  - View state (active level, view mode, selected entities, overlays) which ties the canonical model to concrete 2D/3D views and what the LLM “thinks the user is looking at”.

The Rust/WASM store remains the **authoritative geometric model**, while `observable-state.ts` provides an LLM-oriented projection of this canonical model (rooms, walls, constraints, and—over time—systems, components, and quantities). All new visualization, takeoff, and code-check features will build on this shared model rather than introducing ad‑hoc data paths.

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

### Phase 7: Graph-Based Circulation System (COMPLETED)
Replaced area-only calculation with geometry-aware connected hallway network.

**Problem with Old Approach:**
- Calculated hallway AREAS (e.g., "70 sqft") but no actual geometry
- No connectivity validation - hallways could be disconnected
- Zone accessPoints were hardcoded offsets with no relation to room positions
- Could produce "broken" floor plans where rooms are unreachable

**New Graph-Based Architecture:**

```
┌─────────────────────────────────────────────────────────────────────┐
│ circulation-graph.ts - Room Adjacency Graph                         │
│ • Rooms as nodes, doors/openings as edges                           │
│ • BFS connectivity validation                                        │
│ • findUnreachableRooms(), isFullyConnected()                        │
└────────────────────────┬────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────────┐
│ hallway-mst.ts - Minimum Spanning Tree                              │
│ • Prim's algorithm for optimal hallway network                      │
│ • Entry/foyer as root, bedroom-bathroom pairs weighted              │
│ • Produces HallwayNetwork with segments and junctions               │
└────────────────────────┬────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────────┐
│ spine-geometry.ts - Polygon Generation                              │
│ • Converts MST centerlines to actual hallway polygons               │
│ • Perpendicular offset math for polygon vertices                    │
│ • SAT collision detection, polygon clipping                         │
└────────────────────────┬────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────────────────┐
│ pathfinding.ts - A* Validation                                      │
│ • Grid-based and polygon-based pathfinding                          │
│ • validateAllRoomsReachable() from entry point                      │
│ • 8-directional movement, min-heap priority queue                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Key Functions (circulation-spine.ts):**
- `buildCirculationGraph(rooms)` → CirculationGraph
- `generateHallwayNetwork(rooms, width, depth)` → HallwayNetwork
- `generateSpineGeometry(rooms, width, depth)` → SpineGeometry
- `validateCirculation(rooms, hallways)` → ValidationResult

**Validation Guarantees:**
1. All rooms reachable from entry (A* pathfinding)
2. Floor plan is fully connected (BFS)
3. Hallway geometry matches budget area
4. No broken/disconnected hallway segments

**Bug Fixes Applied (v1.1):**

1. **Prevent Bedroom Traversal** (`pathfinding.ts`)
   - A* now filters walkable areas by `ROOM_ACCESS_RULES`
   - Private rooms (bedroom, bathroom) excluded from walkable polygon set
   - Paths use hallways instead of cutting through bedrooms
   - Added `isRoomTraversable()` helper function

2. **Eliminate Zero-Length Hallways** (`hallway-mst.ts`)
   - `AdjacencyInfo` interface tracks `needsHallway` flag
   - Adjacent rooms needing hallways get 3ft door threshold segments
   - Segments < 0.5ft filtered out with warning

3. **Integrate Bedroom Corridors** (`spine-geometry.ts`)
   - `generateSpineGeometry()` now accepts `bedroomCorridors` parameter
   - Corridor polygons from cluster detection included in geometry
   - Geometry/budget ratio improved from 0.10 to 0.64

4. **Align Connectivity Validators** (`circulation-graph.ts`)
   - `validateCirculationConnectivity()` uses adjacency-based reachability
   - Added `areRoomsAdjacentForValidation()` helper
   - Both validators now report consistent results (15/15 reachable)

## Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `gemini-cad.ts` | AI client, system prompt, tool routing | ~1,480 |
| `cad-skills.ts` | Skills, templates, adjacency rules | ~1,860 |
| `observable-state.ts` | State tracking, constraint validation | ~880 |
| `room-layout-expert.ts` | Expert agent for interior spaces | ~1,100 |
| `circulation-expert.ts` | Expert agent for movement/doors | ~2,430 |
| `expert-types.ts` | Shared tier types (DesignTier, TierReasoning) | ~75 |
| `circulation-spine.ts` | Circulation zone planning, spine calculation | ~1,635 |
| `circulation-graph.ts` | Room adjacency graph, BFS connectivity | ~850 |
| `hallway-mst.ts` | MST-based optimal hallway network | ~400 |
| `spine-geometry.ts` | Hallway polygon generation | ~500 |
| `pathfinding.ts` | A* pathfinding, walkability validation | ~1,235 |
| `space-budget.ts` | Room size standards, allocation | ~1,100 |
| `bedroom-cluster.ts` | Bedroom cluster detection, corridor generation | ~770 |
| `traffic-paths.ts` | Open plan traffic path detection | ~760 |
| `lib/logger/` | Session-based JSONL logging (client & server) | ~500 |

## Testing & Logging Infrastructure

**Unit Tests (Vitest):**
- `vitest.config.ts` - Test configuration with path aliases
- `src/test/setup.ts` - Custom matchers: `toBeNearPoint`, `toHaveMSTProperty`, `toBeConvexPolygon`
- `src/test/fixtures/` - Room factories and layout fixtures
- `src/test/unit/hallway-mst.test.ts` - 33 tests for MST algorithm
- Run: `npm test` or `npm run test:coverage`

**Logging System:**
- `lib/logger/client-logger.ts` - IndexedDB persistence with ring buffer (1000 entries)
- `lib/logger/server-logger.ts` - JSONL files in `.logs/` directory
- `lib/logger/session.ts` - Session ID tracking via localStorage
- `components/LoggerProvider.tsx` - Console interceptor
- Export API: `GET /api/logs/export?sessionId=xxx`

### Phase 8: CAD3D Experimental Model & Lab (IN PROGRESS)

To prepare for a full SketchUp/Revit-style experience, we introduced a **CAD3D
experimental subtree** that lives alongside the main Next.js app without
changing existing behavior.

- Location: `packages/frontend/src/cad3d/`
- Entry page: `app/cad-lab/page.tsx` (navigate to `/cad-lab` in dev)
- Purpose:
  - Define a rich 3D model (`Cad3DModel`) with:
    - Layout elements: rooms, walls, slabs, roofs
    - Structural elements: studs, plates, sheathing panels
    - Openings: windows, doors
    - MEP placeholders: pipes, ducts, conduits, fixtures
  - Provide spec registries for future performance modeling:
    - `MaterialSpec`, `WindowSpec`, `DoorSpec`
    - `WallAssemblySpec`, `RoofAssemblySpec`, `SlabAssemblySpec`
  - Seed a CAD Lab scene for visual experiments (one room + a row of studs).

This tree is intentionally isolated:

- No existing workspace routes import from `cad3d/` (only `/cad-lab`).
- Circulation and pathfinding modules are not wired into CAD3D yet.
- The CAD Lab can read the last Gemini `llmState` from `localStorage`
  (`cad3d:last_llm_state`), convert it to a `Cad3DModel` via
  `cad3d/conversion.ts`, and render a 3D preview of the current floorplan
  without affecting the main WASM-based viewer.
- It acts as a "git feature branch in the filesystem" that can be merged into
  the main UX once tested and validated.



