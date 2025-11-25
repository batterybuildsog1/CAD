## Antigravity CAD Architecture & Roadmap

This document describes the **end-to-end architecture** and a **phased development plan** for Antigravity CAD, with a focus on:

- **Rust + Truck** as the authoritative geometry and domain engine.
- **Rhai** as the embedded scripting layer that both humans and AI can use safely.
- A **clear dependency graph across phases**, so each layer builds on a sound foundation.

Each phase below explains:

- **What** we build.
- **How** it interacts with Truck and Rhai.
- **How** it depends on previous phases and unlocks later ones.

---

## Phase 0 – Core Platform & Minimal Vertical Slice

**Goal:** Stand up a small but real system where:

- Rust owns the **project state**.
- Truck can be called for basic geometry (even if trivial).
- Rhai can **safely** execute simple scripts that modify that state.
- The frontend can render something driven by the Rust server.

### Domain & Data

- **Core types (Rust)**:
  - `Project`, `Site`, `Building`, `Level`, `Footprint` (no rooms/MEP yet).
  - A simple, in-memory **store** keyed by `ProjectId`.
  - An **event log** per project (e.g. `ProjectCreated`, `LevelAdded`, `FootprintSet`).

- **Geometry**:
  - For now, minimal use of Truck:
    - validate a polygon (basic checks),
    - extrude a `Footprint` into a simple massing solid (optional).

### Rhai Integration

- **Objective:** Prove that Rhai can orchestrate operations without touching low-level Rust internals.

- Expose a small, safe API to Rhai:
  - `create_project(name, units, code_region) -> ProjectId`
  - `add_building(project_id, name) -> BuildingId`
  - `add_level(building_id, name, elevation, height) -> LevelId`
  - `set_level_footprint(level_id, polygon) -> FootprintId`

- Scripts must:
  - Run in a **sandboxed engine** (no filesystem, no OS access).
  - Only call whitelisted functions that operate on the Rust store.

### Frontend Interaction

- Next.js frontend:
  - Calls HTTP endpoints to create/open a project and fetch state.
  - Renders a basic **2D footprint** and (optionally) a simple 3D extrusion.

### Dependencies & Future Impact

- **Depends on nothing** but Rust/Tokio/Truck/Rhai wiring.
- **Enables** every later phase because:
  - we have a way to persist and mutate state,
  - we have a proven Rhai control path,
  - we have a basic frontend→backend loop.

---

## Phase 1 – Footprint & Layout Editing

**Goal:** Make footprint and level editing interactive and robust. This is the foundation for everything structural and spatial.

### Domain & Data

- Strengthen:
  - `Site` (boundary polygon, setbacks, north angle).
  - `Level` (elevation, height).
  - `Footprint` (outer polygon + holes).

- Add:
  - Optional `Grid` / `GridAxis` objects for snapping and alignment.

### Truck Usage

- Use Truck to:
  - ensure polygons are valid (non-self-intersecting, closed),
  - optionally compute derived properties (area, centroid) robustly,
  - extrude footprints into **massing solids** for visualization.

This stage does not rely on advanced B‑Rep operations, keeping kernel risk low.

### Rhai Integration

- Rhai scripts can:
  - programmatically generate massing options (rectangles, L-shapes),
  - adjust footprints (e.g. offset for setbacks).

- Example script:

```rhai
let project = create_project("Scandi House", "imperial", "US_IRC_2021");
let bldg = add_building(project, "Main");
let main = add_level(bldg, "Main", 0.0, 9.0);
let upper = add_level(bldg, "Upper", 9.0, 8.0);

let footprint = [
    (0.0, 0.0),
    (40.0, 0.0),
    (40.0, 30.0),
    (0.0, 30.0)
];
set_level_footprint(main, footprint);
set_level_footprint(upper, footprint);
```

### Frontend Interaction

- 2D plan:
  - Vertex dragging for footprints.
  - Display of measured dimensions and area.
- 3D:
  - Massing per level from Truck.

All edits:

- become **events** on the Rust side,
- are not changing meshes directly in the frontend.

### Dependencies & Future Impact

- **Depends on** Phase 0 store + Rhai.
- **Enables:**
  - Phase 2 structural elements, which will attach to `Level` + `Footprint`.
  - Room layout (Phase 3), which must live inside valid footprints.

---

## Phase 2 – Structural Layer (Walls, Floors, Roof) MVP

**Goal:** Introduce **load-bearing geometry** and quantities (studs, sheets, joists) that set up for structural checks and costing.

### Domain & Data

- Add **assemblies**:
  - `WallAssembly`, `FloorAssembly`, `RoofAssembly` with:
    - framing sizes and spacing,
    - sheathing and gypsum layers,
    - insulation slots, basic strength/deflection properties.

- Add **instances**:
  - `Wall` (linked to `Level`, start/end 2D, height, assembly).
  - `FloorSystem` (boundary polygon per level, assembly, joist direction).
  - `RoofSystem` (collection of `RoofSurface`s with slope and boundaries).

### Truck Usage

- For each structural element:
  - build a **B‑Rep solid**:
    - wall = extruded rectangle along wall axis,
    - floor system = extruded polygon slab,
    - roof surface = planar polygon at pitch, extruded by thickness.
  - tessellate to meshes for the frontend.

- Use Truck only for:
  - solid generation,
  - meshing,
  - simple boolean operations later (e.g., cutting openings).

### Rhai Integration

- Expose high-level structural operations:

```rhai
let ext_assembly = create_wall_assembly("2x6 ext", ...);
let int_assembly = create_wall_assembly("2x4 int", ...);

let walls = create_exterior_walls_from_footprint(main_level_id, ext_assembly);
let floor = create_floor_system(main_level_id, footprint_polygon, floor_assembly);
let roof = create_simple_gable_roof(building_id, roof_assembly, 6.0/12.0);
```

- Rhai:
  - does not call Truck directly,
  - only uses domain operations that internally call Truck.

### Frontend Interaction

- 2D plan:
  - show walls as thick lines with differentiation for exterior vs interior.
- 3D:
  - full shell (walls, floor, roof) from Truck meshes.

- Inspectors:
  - click a wall/floor/roof to see:
    - length/area,
    - assembly type,
    - rough quantities (stud count, sheet count, etc.).

### Dependencies & Future Impact

- **Depends on**:
  - valid `Footprint` and `Level` geometry (Phase 1).
  - working Truck integration.
- **Enables**:
  - Phase 3 rooms, which bind to walls/floors.
  - structural checking (spans, load paths) in later phases.
  - collisions and clearances for MEP components.

---

## Phase 3 – Rooms, Openings, and Envelope

**Goal:** Turn the shell into **habitable space** with explicit rooms, doors, windows, and envelope surfaces for load calculations and layout rules.

### Domain & Data

- Add:
  - `Room` (with `RoomType`, area, `bounding_wall_ids`).
  - `Opening` (window/door) referencing a `Wall` and rooms.
  - `WindowProps`, `DoorProps` with U‑values, SHGC, etc.
  - `EnvelopeSurface` objects derived from walls/roof/floor + assemblies.

- Room rules:
  - basic min area/width per `RoomType`,
  - optional adjacency guidelines.

### Truck Usage

- Use Truck to:
  - cut **openings** into wall solids:
    - `Wall` solid − opening extrusions → updated B‑Rep.
  - extract **surface areas and normals** for envelope surfaces.

Truck remains the source for:

- precise geometry of walls & openings,
- surface-level computations for envelope.

### Rhai Integration

- Expose room and opening tools:

```rhai
let program = [
    #{ room_type: "Living", target_area: 400.0 },
    #{ room_type: "Kitchen", target_area: 200.0 },
    #{ room_type: "Bedroom", target_area: 150.0 },
];

let rooms = subdivide_level_into_rooms(main_level_id, program);

for room in rooms {
    if get_room_type(room) == "Bedroom" {
        auto_add_bedroom_windows(room, style = "scandinavian");
    }
}

rebuild_envelope_surfaces(building_id);
```

- Scripts operate on **Rooms** and **Openings**; Truck work is fully encapsulated in Rust functions.

### Frontend Interaction

- 2D:
  - rooms as polygons with labels (name, area),
  - windows/doors in standard symbols.
- 3D:
  - cut openings in wall meshes, room volumes visualized (optional).

- Room inspector:
  - area, type, rule warnings,
  - envelope summary (wall/roof/floor area, window area, R/U values).

### Dependencies & Future Impact

- **Depends on**:
  - walls/floors/roof from Phase 2.
  - assemblies with insulation and window specs.
- **Enables**:
  - Phase 4 HVAC loads (needs room volumes + envelope).
  - plumbing/electrical fixture placement (needs room types).

---

## Phase 4 – HVAC Loads & Duct Network

**Goal:** Compute **per-room loads**, define **zones**, and model an explicit **duct network** with real components (equipment, registers, ducts).

### Domain & Data

- Add:
  - `HVACRoomLoad` (cooling/heating BTU/h, CFM).
  - `HVACZone` (groups rooms + design setpoints).
  - `AirHandler` (capacities, airflow, location).
  - `SupplyRegister` / `ReturnGrille`.
  - Duct graph:
    - `DuctNode` (equipment, terminals, junctions),
    - `DuctSegment` (shape, length, flow, pressure drop),
    - `DuctFitting` (elbows, tees, transitions).

### Truck Usage

- For each duct segment:
  - generate a **swept solid** (from centerline + cross-section).
  - use this for:
    - 3D visualization,
    - collisions with structure and other systems.

### Rhai Integration

- Tools for AI and scripts:

```rhai
let zone = create_zone(building_id, "House Zone 1", room_ids);
let loads = compute_zone_loads(zone);
let ahu = select_air_handler(zone);

let terminals = auto_place_terminals(zone);
let ducts = auto_route_ducts(zone, ahu);
size_ducts(zone);
```

- Rhai never sets duct geometry directly; it:
  - declares intent (zone, handler, layout style),
  - receives back created nodes/segments as IDs.

### Frontend Interaction

- 3D:
  - overlay duct centerlines/solids over structure.
  - visualize supply vs return color-coded.

- Zone/room views:
  - show loads, CFM, and whether each room is adequately served.

### Dependencies & Future Impact

- **Depends on**:
  - room/envelope model from Phase 3.
  - structural data for collision checks.
- **Enables**:
  - integrated clash detection,
  - mechanical costing,
  - later optimization of routes.

---

## Phase 5 – Plumbing DWV Graph

**Goal:** Represent the drain/waste/vent system as a precise **graph of fixtures, traps, stacks, pipes, and vents**, all with geometry.

### Domain & Data

- Add:
  - `Fixture` (kind, room, position, connection ports).
  - `DWVNode` (fixture drains, traps, stack nodes, sewer connection, vent terminations).
  - `DWVPipeSegment` (from/to nodes, diameter, material, slope, 3D path).
  - `Trap`, `Stack`, `Cleanout`.

### Truck Usage

- Generate:
  - pipe solids (cylinders or extruded profiles),
  - 3D positioning of vertical stacks through slabs and roofs,
  - collision detection vs structure, ducts, and future cables.

### Rhai Integration

- High-level plumbing tools:

```rhai
let fixtures = auto_place_bathroom_fixtures(room_id, style);
let stack = create_stack([main, upper, roof], (x, y));
let dwv = auto_plumb_bath_group(room_id, stack);

let issues = get_dwv_conflicts(building_id);
```

- Scripts think in terms of:
  - “plumb this bathroom to that stack,”
  - “create a vertical stack through these levels.”

Rust/Truck handle:

- actual pipe geometry,
- slopes,
- collisions.

### Frontend Interaction

- 2D:
  - fixtures and simplified DWV layout over floor plan.
- 3D:
  - pipes, traps, stacks, and roof penetrations visualized.

### Dependencies & Future Impact

- **Depends on**:
  - room layout and fixtures (room types from Phase 3).
  - structure from Phase 2.
- **Enables**:
  - realistic plumbing visuals and takeoffs,
  - integrated MEP clash detection.

---

## Phase 6 – Electrical: Panels, Circuits, Devices, Cables

**Goal:** Model the electrical system as a network of **panels, circuits, devices, and (optionally) cables**, plus basic best‑practice checks.

### Domain & Data

- Add:
  - `Panel` (location, main rating, circuit list).
  - `Circuit` (kind, breaker rating, voltage, connected devices).
  - `Device` (receptacle, switch, light fixture, junction box, appliance).
  - Optional `CableSegment` (from panel to devices, with 3D path).

### Truck Usage

- Primarily for:
  - optional cable routing geometry,
  - collision detection when routing cables in walls and floors.

### Rhai Integration

- Tools:

```rhai
let panel = add_panel(building_id, panel_location, 200.0);

let recs = auto_place_receptacles(room_id);
let lights_and_switches = auto_place_lights_and_switches(room_id);

let circuits = auto_assign_circuits(panel, recs + lights_and_switches);
let warnings = get_electrical_warnings(building_id);
```

- Scripts express:
  - “place devices according to typical spacing rules,”
  - “group loads into circuits.”

The Rust core enforces:

- circuit loading math,
- device placement patterns,
- optional routing logic.

### Frontend Interaction

- Plan:
  - show outlets, switches, lights as symbols.
- Panels:
  - circuit list with per‑circuit loads and warnings.

### Dependencies & Future Impact

- **Depends on**:
  - rooms and structural surfaces for placement,
  - some knowledge of appliances from earlier phases.
- **Enables**:
  - electrical costing and checks,
  - integrated clash detection (with other systems).

---

## Phase 7 – Integrated Checks, Clashes, and Reporting

**Goal:** Tie all systems together for **analysis, conflict detection, and outputs** that are meaningful for engineers/inspectors.

### Cross‑System Collision & Constraints

- Give each discrete component (walls, beams, ducts, pipes, cables, fixtures, devices) a:
  - link to a Truck solid or swept volume,
  - simple bounding volume for broad‑phase collision.

- Implement:
  - **broad‑phase** overlaps by bounding boxes,
  - **narrow‑phase** tests using Truck or a collision crate where needed.

- Categorize conflicts:
  - structure vs HVAC,
  - structure vs plumbing,
  - structure vs electrical,
  - HVAC vs plumbing/electrical,
  - egress/layout issues (rooms vs doors/stairs).

### Structural & System Checks

- Structural:
  - simple span checks for joists/beams,
  - load aggregation from floors/roof.

- Systems:
  - HVAC: load coverage vs equipment and duct sizing.
  - Plumbing: trap/vent distances, pipe sizes vs fixture units.
  - Electrical: outlet spacing, circuit loading, panel capacity hints.

### Reporting

- Provide:
  - per‑system summaries (structure, HVAC, plumbing, electrical),
  - conflict lists, grouped and filterable,
  - basic quantity takeoffs for costing (studs, sheets, ducts, pipes, devices).

### Rhai & AI

- AI operates as:
  - a **critic and refiner**:
    - reads summaries and warnings,
    - proposes alternate layouts or minor tweaks,
    - calls tools to fix issues (e.g. add a duct branch, adjust wall, move fixture).

- Rhai:
  - remains the **transaction language** for all such changes,
  - ensures the Rust core remains the single source of truth.

---

## Architecture Soundness Summary

- **Single source of truth**:
  - Rust domain model + Truck geometry for all systems.
- **Scripting boundary**:
  - Rhai exposes only high‑level, domain‑safe operations; AI never touches low‑level geometry or memory.
- **Phase dependencies**:
  - each phase builds on well‑defined types and APIs from the previous one,
  - later MEP systems always attach to existing structural and room geometry.
- **Extensibility**:
  - domains are additive: you can enrich any layer (e.g. more detailed assemblies, more advanced analysis) without breaking the overall shape.

This layered design keeps the architecture **sound and evolvable** while allowing you to start small (Phase 0–2) and grow into advanced structural/MEP capabilities over time.


