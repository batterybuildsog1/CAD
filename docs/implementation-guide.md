# Antigravity CAD Implementation Guide

This document provides technical implementation details for agents and developers building on the foundation.

## Current Implementation Status

**Phase 0**: Complete - Core platform operational
**Phase 2/3 Domain Types**: Complete - Wall, Room, Opening types implemented
**Phase 2/3 Store/Rhai**: Complete - CRUD operations and scripting available
**Phase 2/3 HTTP API**: Partial - endpoints not yet exposed (use Rhai scripts)

### Directory Structure

```
packages/geometry-server/src/
├── main.rs              # Server entry point
├── domain/
│   ├── mod.rs           # Module exports
│   ├── ids.rs           # Strongly-typed ID wrappers (ProjectId, LevelId, WallId, RoomId, OpeningId, etc.)
│   ├── spatial.rs       # Point2, Point3, Vector3, Polygon2, Polyline3
│   ├── project.rs       # Project, Site, Building, Level, Footprint, Grid
│   ├── events.rs        # Event types for event log
│   ├── wall.rs          # WallLayer, WallAssembly, Wall (Phase 2)
│   ├── room.rs          # RoomType, Room (Phase 3)
│   └── opening.rs       # OpeningType, Opening, WindowProperties, DoorProperties (Phase 3)
├── store/
│   └── mod.rs           # In-memory store with CRUD + event recording (includes Phase 2/3 entities)
├── rhai_api/
│   └── mod.rs           # Sandboxed Rhai engine with domain functions (includes Phase 2/3 functions)
├── geometry/
│   └── mod.rs           # Truck geometry operations (extrude, mesh, etc.)
└── api/
    └── mod.rs           # HTTP API endpoints (Phase 0 only)
```

### Key Patterns

#### 1. ID Types (domain/ids.rs)
All entities have strongly-typed ID wrappers:
```rust
define_id!(ProjectId);
define_id!(BuildingId);
define_id!(LevelId);
// ... etc
```

When adding new entity types, use the `define_id!` macro.

#### 2. Store Pattern (store/mod.rs)
All mutations go through the store, which automatically records events:
```rust
// Example: Adding a level
pub fn add_level(&mut self, building_id: BuildingId, ...) -> Result<LevelId> {
    // 1. Validate inputs
    // 2. Create entity
    // 3. Update relationships
    // 4. Record event
    // 5. Return ID
}
```

#### 3. Rhai Functions (rhai_api/mod.rs)
Rhai functions are registered in category-specific functions:
```rust
fn register_level_functions(engine: &mut Engine, store: SharedStore) {
    let s = store.clone();
    engine.register_fn("add_level", move |...| { ... });
}
```

Pattern for adding new Rhai functions:
1. Clone the store Arc
2. Register function with closure that captures the clone
3. Use `.read().unwrap()` for queries, `.write().unwrap()` for mutations
4. Return `Result<T, Box<EvalAltResult>>` for error handling

#### 4. Geometry Operations (geometry/mod.rs)
Truck operations are encapsulated:
```rust
pub fn extrude_polygon(polygon: &Polygon2, base_z: f64, height: f64) -> Result<Solid>
pub fn solid_to_mesh(solid: &Solid, tolerance: f64) -> Result<MeshData>
```

---

## Phase 1: Footprint & Layout Editing (COMPLETE)

### Implemented Store Operations
```rust
// Grid management - IMPLEMENTED
fn create_grid(&mut self, building_id: BuildingId) -> Result<()>;
fn add_grid_axis(&mut self, building_id: BuildingId, axis: GridAxis) -> Result<()>;

// Footprint editing - IMPLEMENTED
fn offset_footprint(&mut self, footprint_id: FootprintId, distance: f64) -> Result<()>;
fn split_footprint(&mut self, footprint_id: FootprintId, p1: Point2, p2: Point2) -> Result<...>;
```

### Implemented Rhai Functions
```rhai
// Grid - IMPLEMENTED
create_grid(building_id)
add_grid_axis(building_id, name, direction, offset)

// Footprint generation - IMPLEMENTED
set_level_footprint(level_id, points_array)
set_level_footprint_rect(level_id, width, depth)
offset_footprint(footprint_id, distance)
```

### Implemented API Endpoints
```
POST /api/v1/buildings/:id/grid      - Create grid (IMPLEMENTED)
GET  /api/v1/buildings/:id/grid      - Get grid axes (IMPLEMENTED)
POST /api/v1/buildings/:id/grid/axes - Add grid axis (IMPLEMENTED)
```

---

## Phase 2: Structural Layer - Walls (COMPLETE)

### Implemented Domain Types (domain/wall.rs)

```rust
// WallLayer - IMPLEMENTED
pub struct WallLayer {
    pub material: String,
    pub thickness: f64,
    pub is_structural: bool,
}

// WallAssembly - IMPLEMENTED
pub struct WallAssembly {
    pub id: WallAssemblyId,
    pub name: String,
    pub layers: Vec<WallLayer>,
    pub total_thickness: f64,
}

// Wall - IMPLEMENTED
pub struct Wall {
    pub id: WallId,
    pub assembly_id: WallAssemblyId,
    pub level_id: LevelId,
    pub start: Point2,
    pub end: Point2,
    pub height: f64,
    pub base_offset: f64,
}
```

### Implemented Store Operations
```rust
// IMPLEMENTED in store/mod.rs
fn create_wall_assembly(&mut self, name: &str, layers: Vec<WallLayer>) -> Result<WallAssemblyId>;
fn get_wall_assembly(&self, id: WallAssemblyId) -> Option<&WallAssembly>;
fn create_wall(&mut self, level_id, assembly_id, start, end, height) -> Result<WallId>;
fn get_wall(&self, id: WallId) -> Option<&Wall>;
fn get_level_walls(&self, level_id: LevelId) -> Vec<&Wall>;
fn remove_wall(&mut self, wall_id: WallId) -> Result<()>;
```

### Implemented Rhai Functions
```rhai
// IMPLEMENTED
create_wall_assembly(name)
create_wall(level_id, assembly_id, start_point, end_point, height)
get_wall_assembly(wall_id)
```

### Not Yet Implemented (Phase 2 Remaining)
- FloorAssembly, FloorSystem types
- RoofAssembly, RoofSystem types
- Beam type
- HTTP API endpoints for walls
- Geometry generation for wall solids

---

## Phase 3: Rooms, Openings (COMPLETE)

### Implemented Domain Types

**domain/room.rs - IMPLEMENTED:**
```rust
pub enum RoomType {
    LivingRoom, Kitchen, Bedroom, Bathroom, Closet, Hallway,
    Utility, Garage, DiningRoom, FamilyRoom, Office, Laundry,
    Pantry, Mudroom, Foyer, Other(String),
}

pub struct Room {
    pub id: RoomId,
    pub level_id: LevelId,
    pub room_type: RoomType,
    pub name: String,
    pub boundary: Polygon2,
    pub floor_finish: String,
    pub ceiling_height: Option<f64>,
    pub bounding_wall_ids: Vec<WallId>,
}
```

**domain/opening.rs - IMPLEMENTED:**
```rust
pub enum OpeningType { Window, Door, Other(String) }

pub struct WindowProperties {
    pub u_value: f64,
    pub shgc: f64,
}

pub struct DoorProperties {
    pub is_exterior: bool,
    pub fire_rating: Option<u32>,
}

pub struct Opening {
    pub id: OpeningId,
    pub wall_id: WallId,
    pub opening_type: OpeningType,
    pub position_along_wall: f64,
    pub width: f64,
    pub height: f64,
    pub sill_height: f64,
    pub window_properties: Option<WindowProperties>,
    pub door_properties: Option<DoorProperties>,
}
```

### Implemented Store Operations
```rust
// Rooms - IMPLEMENTED
fn create_room(&mut self, level_id, room_type, name, boundary) -> Result<RoomId>;
fn get_room(&self, id: RoomId) -> Option<&Room>;
fn get_level_rooms(&self, level_id: LevelId) -> Vec<&Room>;
fn remove_room(&mut self, room_id: RoomId) -> Result<()>;
fn set_room_bounding_walls(&mut self, room_id, wall_ids) -> Result<()>;

// Openings - IMPLEMENTED
fn add_opening(&mut self, wall_id, type, position, width, height, sill) -> Result<OpeningId>;
fn get_opening(&self, id: OpeningId) -> Option<&Opening>;
fn get_wall_openings(&self, wall_id: WallId) -> Vec<&Opening>;
fn remove_opening(&mut self, opening_id: OpeningId) -> Result<()>;
```

### Implemented Rhai Functions
```rhai
// IMPLEMENTED
create_room(level_id, room_type_str, name, points_array)
add_opening(wall_id, type_str, position, width, height, sill_height)
```

### Not Yet Implemented (Phase 3 Remaining)
- EnvelopeSurface type and calculations
- HTTP API endpoints for rooms/openings
- Geometry operations for cutting openings in walls
- Room validation rules per code region
- Auto-subdivision of levels into rooms

---

## Cross-Phase Integration

### Event Types to Add
```rust
// In domain/events.rs, extend EventKind:
enum EventKind {
    // ... existing ...

    // Phase 2
    WallAssemblyCreated { ... },
    WallCreated { ... },
    FloorSystemCreated { ... },
    RoofCreated { ... },

    // Phase 3
    RoomCreated { ... },
    RoomModified { ... },
    OpeningAdded { ... },
    EnvelopeRebuilt { ... },
}
```

### Dependency Graph
```
Phase 0 (Complete)
    └── Phase 1 (Footprint Editing)
            └── Phase 2 (Structural)
                    └── Phase 3 (Rooms/Openings)
                            ├── Phase 4 (HVAC)
                            ├── Phase 5 (Plumbing)
                            └── Phase 6 (Electrical)
```

### Shared Conventions

1. **All mutations through Store** - Never modify entities directly
2. **All geometry through Truck** - Never construct meshes manually
3. **All scripting through Rhai** - Never expose internal APIs
4. **All IDs strongly typed** - Use the `define_id!` macro
5. **All changes logged** - Record events for every mutation

---

## Testing Guidelines

Each module should have unit tests at the bottom:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_feature() {
        // Arrange
        // Act
        // Assert
    }
}
```

Integration tests should go in `tests/` directory.

---

## API Response Format

All API responses use this wrapper:
```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

Or on error:
```json
{
  "success": false,
  "data": null,
  "error": "Error message here"
}
```
