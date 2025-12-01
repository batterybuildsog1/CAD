use wasm_bindgen::prelude::*;
use geometry_core::store::{SharedStore, new_shared_store};
use geometry_core::domain::{
    UnitSystem, CodeRegion, LevelId, ProjectId, BuildingId, WallAssemblyId, WallId, FootprintId,
    Point2, Polygon2, RoomType, WallLayer,
    OpeningId, OpeningType, GridAxis, GridDirection,
};
use geometry_core::geometry::{solid_to_mesh, extrude_polygon, extrude_polygon_shell};
use std::str::FromStr;

#[wasm_bindgen]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Structured mesh data for Three.js
#[wasm_bindgen]
pub struct WasmMesh {
    positions: Vec<f32>,
    normals: Vec<f32>,
    indices: Vec<u32>,
}

#[wasm_bindgen]
impl WasmMesh {
    #[wasm_bindgen(getter)]
    pub fn positions(&self) -> Float32Array {
        unsafe { Float32Array::view(&self.positions) }
    }

    #[wasm_bindgen(getter)]
    pub fn normals(&self) -> Float32Array {
        unsafe { Float32Array::view(&self.normals) }
    }

    #[wasm_bindgen(getter)]
    pub fn indices(&self) -> Uint32Array {
        unsafe { Uint32Array::view(&self.indices) }
    }
}

use std::cell::Cell;

#[wasm_bindgen]
pub struct WasmStore {
    inner: SharedStore,
    mutation_count: Cell<u64>,
}

#[wasm_bindgen]
impl WasmStore {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: new_shared_store(),
            mutation_count: Cell::new(0),
        }
    }

    /// Increment mutation count (called after successful mutations)
    fn bump_mutation_count(&self) {
        self.mutation_count.set(self.mutation_count.get() + 1);
    }

    pub fn create_project(&self, name: &str) -> Result<String, JsValue> {
        let mut store = self.inner.write().map_err(|_| "Failed to acquire write lock")?;
        let id = store.create_project(name, UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .map_err(|e| e.to_string())?;
        self.bump_mutation_count();
        Ok(id.to_string())
    }

    pub fn render_level(&self, level_id: &str) -> Result<WasmMesh, JsValue> {
        use std::str::FromStr;
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| e.to_string())?;
        
        let store = self.inner.read().map_err(|_| "Failed to acquire read lock")?;
        let level = store.get_level(level_id).ok_or("Level not found")?;
        let footprint = store.get_level_footprint(level_id).ok_or("Footprint not found")?;

        let solid = extrude_polygon(&footprint.polygon, level.elevation, level.floor_to_floor)
            .map_err(|e| e.to_string())?;
        
        let mesh_data = solid_to_mesh(&solid, 0.1)
            .map_err(|e| e.to_string())?;

        Ok(WasmMesh {
            positions: mesh_data.positions,
            normals: mesh_data.normals,
            indices: mesh_data.indices,
        })
    }

    pub fn get_all_geometry(&self, building_id: &str) -> Result<js_sys::Array, JsValue> {
        // Placeholder for fetching all geometry (walls, floors, etc.)
        // For now, we'll just return an empty array or basic level geometry
        // This will be expanded as we add more entity types to the store
        Ok(js_sys::Array::new())
    }

    /// Add a building to a project
    pub fn add_building(&self, project_id: &str, name: &str) -> Result<String, JsValue> {
        let project_id = ProjectId::from_str(project_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        let building_id = store.add_building(project_id, name)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.bump_mutation_count();
        Ok(building_id.to_string())
    }

    /// Add a level to a building
    pub fn add_level(
        &self,
        building_id: &str,
        name: &str,
        elevation: f64,
        floor_to_floor: f64,
    ) -> Result<String, JsValue> {
        let building_id = BuildingId::from_str(building_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        let level_id = store.add_level(building_id, name, elevation, floor_to_floor)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.bump_mutation_count();
        Ok(level_id.to_string())
    }

    /// Set a rectangular footprint for a level
    pub fn set_level_footprint_rect(
        &self,
        level_id: &str,
        width: f64,
        depth: f64,
    ) -> Result<String, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Create rectangular polygon centered at origin
        let polygon = Polygon2::new(vec![
            Point2::new(0.0, 0.0),
            Point2::new(width, 0.0),
            Point2::new(width, depth),
            Point2::new(0.0, depth),
        ]);

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        let footprint_id = store.set_level_footprint(level_id, polygon)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.bump_mutation_count();
        Ok(footprint_id.to_string())
    }

    /// Set a custom footprint for a level using an array of points
    pub fn set_level_footprint(
        &self,
        level_id: &str,
        points: &JsValue,
    ) -> Result<String, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Parse points from JsValue (array of [x, y] arrays)
        let points_array: Vec<Vec<f64>> = serde_wasm_bindgen::from_value(points.clone())
            .map_err(|e| JsValue::from_str(&format!("Failed to parse points: {}", e)))?;

        let polygon_points: Vec<Point2> = points_array
            .iter()
            .map(|p| {
                if p.len() >= 2 {
                    Point2::new(p[0], p[1])
                } else {
                    Point2::new(0.0, 0.0)
                }
            })
            .collect();

        let polygon = Polygon2::new(polygon_points);

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        let footprint_id = store.set_level_footprint(level_id, polygon)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.bump_mutation_count();
        Ok(footprint_id.to_string())
    }

    /// Create a basic wall assembly with a single layer
    pub fn create_wall_assembly(&self, name: &str) -> Result<String, JsValue> {
        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        // Create a basic wall assembly with a single 2x6 stud layer
        let layers = vec![WallLayer::stud_2x6()];

        let assembly_id = store.create_wall_assembly(name, layers)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.bump_mutation_count();
        Ok(assembly_id.to_string())
    }

    /// Create a wall on a level
    pub fn create_wall(
        &self,
        level_id: &str,
        assembly_id: &str,
        start: &JsValue,
        end: &JsValue,
        height: f64,
    ) -> Result<String, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let assembly_id = WallAssemblyId::from_str(assembly_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Parse start point from JsValue (array of [x, y])
        let start_arr: Vec<f64> = serde_wasm_bindgen::from_value(start.clone())
            .map_err(|e| JsValue::from_str(&format!("Failed to parse start point: {}", e)))?;
        if start_arr.len() < 2 {
            return Err(JsValue::from_str("Start point must have at least 2 values [x, y]"));
        }
        let start_point = Point2::new(start_arr[0], start_arr[1]);

        // Parse end point from JsValue (array of [x, y])
        let end_arr: Vec<f64> = serde_wasm_bindgen::from_value(end.clone())
            .map_err(|e| JsValue::from_str(&format!("Failed to parse end point: {}", e)))?;
        if end_arr.len() < 2 {
            return Err(JsValue::from_str("End point must have at least 2 values [x, y]"));
        }
        let end_point = Point2::new(end_arr[0], end_arr[1]);

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        let wall_id = store.create_wall(level_id, assembly_id, start_point, end_point, height)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.bump_mutation_count();
        Ok(wall_id.to_string())
    }

    /// Create a room on a level
    pub fn create_room(
        &self,
        level_id: &str,
        room_type: &str,
        name: &str,
        points: &JsValue,
    ) -> Result<String, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Parse room_type string to RoomType enum
        let room_type = RoomType::from_str(room_type);

        // Parse points from JsValue (array of [x, y] arrays)
        let points_array: Vec<Vec<f64>> = serde_wasm_bindgen::from_value(points.clone())
            .map_err(|e| JsValue::from_str(&format!("Failed to parse points: {}", e)))?;

        let polygon_points: Vec<Point2> = points_array
            .iter()
            .map(|p| {
                if p.len() >= 2 {
                    Point2::new(p[0], p[1])
                } else {
                    Point2::new(0.0, 0.0)
                }
            })
            .collect();

        let boundary = Polygon2::new(polygon_points);

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        let room_id = store.create_room(level_id, room_type, name, boundary)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.bump_mutation_count();
        Ok(room_id.to_string())
    }

    // ============ PROJECT QUERIES ============

    /// Get project name by ID
    pub fn get_project_name(&self, project_id: &str) -> Result<String, JsValue> {
        let project_id = ProjectId::from_str(project_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let project = store.get_project(project_id)
            .ok_or_else(|| JsValue::from_str("Project not found"))?;

        Ok(project.name.clone())
    }

    /// List all project IDs
    pub fn list_project_ids(&self) -> Result<js_sys::Array, JsValue> {
        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let projects = store.list_projects();
        let arr = js_sys::Array::new();
        for project in projects {
            arr.push(&JsValue::from_str(&project.id.to_string()));
        }
        Ok(arr)
    }

    // ============ BUILDING QUERIES ============

    /// Get building name by ID
    pub fn get_building_name(&self, building_id: &str) -> Result<String, JsValue> {
        let building_id = BuildingId::from_str(building_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let building = store.get_building(building_id)
            .ok_or_else(|| JsValue::from_str("Building not found"))?;

        Ok(building.name.clone())
    }

    /// Get all level IDs for a building
    pub fn get_building_levels(&self, building_id: &str) -> Result<js_sys::Array, JsValue> {
        let building_id = BuildingId::from_str(building_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let levels = store.get_building_levels(building_id);
        let arr = js_sys::Array::new();
        for level in levels {
            arr.push(&JsValue::from_str(&level.id.to_string()));
        }
        Ok(arr)
    }

    /// Get building statistics (total area, level count)
    pub fn get_building_stats(&self, building_id: &str) -> Result<JsValue, JsValue> {
        let building_id = BuildingId::from_str(building_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let stats = store.get_building_stats(building_id)
            .ok_or_else(|| JsValue::from_str("Building not found or has no stats"))?;

        let obj = js_sys::Object::new();
        let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("total_area"), &JsValue::from_f64(stats.total_area));
        let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("level_count"), &JsValue::from_f64(stats.level_count as f64));

        Ok(obj.into())
    }

    // ============ LEVEL QUERIES ============

    /// Get level name by ID
    pub fn get_level_name(&self, level_id: &str) -> Result<String, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let level = store.get_level(level_id)
            .ok_or_else(|| JsValue::from_str("Level not found"))?;

        Ok(level.name.clone())
    }

    /// Get level elevation
    pub fn get_level_elevation(&self, level_id: &str) -> Result<f64, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let level = store.get_level(level_id)
            .ok_or_else(|| JsValue::from_str("Level not found"))?;

        Ok(level.elevation)
    }

    /// Get level floor-to-floor height
    pub fn get_level_height(&self, level_id: &str) -> Result<f64, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let level = store.get_level(level_id)
            .ok_or_else(|| JsValue::from_str("Level not found"))?;

        Ok(level.floor_to_floor)
    }

    // ============ FOOTPRINT QUERIES ============

    /// Get footprint area for a level
    pub fn get_footprint_area(&self, level_id: &str) -> Result<f64, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let footprint = store.get_level_footprint(level_id)
            .ok_or_else(|| JsValue::from_str("Footprint not found"))?;

        Ok(footprint.polygon.area())
    }

    /// Get footprint perimeter for a level
    pub fn get_footprint_perimeter(&self, level_id: &str) -> Result<f64, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let footprint = store.get_level_footprint(level_id)
            .ok_or_else(|| JsValue::from_str("Footprint not found"))?;

        Ok(footprint.polygon.perimeter())
    }

    // ============ WALL QUERIES ============

    /// Get wall assembly ID for a wall
    pub fn get_wall_assembly(&self, wall_id: &str) -> Result<String, JsValue> {
        let wall_id = WallId::from_str(wall_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let wall = store.get_wall(wall_id)
            .ok_or_else(|| JsValue::from_str("Wall not found"))?;

        Ok(wall.assembly_id.to_string())
    }

    // ============ EVENT QUERIES ============

    /// Get event count for a project
    pub fn get_event_count(&self, project_id: &str) -> Result<u32, JsValue> {
        let project_id = ProjectId::from_str(project_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let event_log = store.get_event_log(project_id)
            .ok_or_else(|| JsValue::from_str("Event log not found"))?;

        Ok(event_log.len() as u32)
    }

    // ============ DELETE OPERATIONS ============

    /// Remove a building (cascades to remove all levels and footprints)
    pub fn remove_building(&self, building_id: &str) -> Result<(), JsValue> {
        let building_id = BuildingId::from_str(building_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        store.remove_building(building_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.bump_mutation_count();
        Ok(())
    }

    /// Remove a level (cascades to remove footprint)
    pub fn remove_level(&self, level_id: &str) -> Result<(), JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        store.remove_level(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.bump_mutation_count();
        Ok(())
    }

    /// Offset a footprint by a distance
    pub fn offset_footprint(&self, footprint_id: &str, distance: f64) -> Result<(), JsValue> {
        let footprint_id = FootprintId::from_str(footprint_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        store.offset_footprint(footprint_id, distance)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.bump_mutation_count();
        Ok(())
    }

    /// Remove a wall (cascades to remove all openings)
    pub fn remove_wall(&self, wall_id: &str) -> Result<(), JsValue> {
        let wall_id = WallId::from_str(wall_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        store.remove_wall(wall_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.bump_mutation_count();
        Ok(())
    }

    /// Get the current state as a JS object with entity counts
    pub fn get_state(&self) -> JsValue {
        let store = match self.inner.read() {
            Ok(s) => s,
            Err(_) => return JsValue::NULL,
        };

        let state = js_sys::Object::new();

        // Count entities
        let _ = js_sys::Reflect::set(
            &state,
            &JsValue::from_str("projects"),
            &JsValue::from_f64(store.projects.len() as f64),
        );
        let _ = js_sys::Reflect::set(
            &state,
            &JsValue::from_str("buildings"),
            &JsValue::from_f64(store.buildings.len() as f64),
        );
        let _ = js_sys::Reflect::set(
            &state,
            &JsValue::from_str("levels"),
            &JsValue::from_f64(store.levels.len() as f64),
        );
        let _ = js_sys::Reflect::set(
            &state,
            &JsValue::from_str("walls"),
            &JsValue::from_f64(store.walls.len() as f64),
        );
        let _ = js_sys::Reflect::set(
            &state,
            &JsValue::from_str("rooms"),
            &JsValue::from_f64(store.rooms.len() as f64),
        );
        let _ = js_sys::Reflect::set(
            &state,
            &JsValue::from_str("footprints"),
            &JsValue::from_f64(store.footprints.len() as f64),
        );
        let _ = js_sys::Reflect::set(
            &state,
            &JsValue::from_str("wall_assemblies"),
            &JsValue::from_f64(store.wall_assemblies.len() as f64),
        );

        state.into()
    }

    // ============ OPENING OPERATIONS ============

    /// Add an opening (door/window) to a wall
    /// position: 0.0 = start of wall, 1.0 = end of wall
    pub fn add_opening(
        &self,
        wall_id: &str,
        opening_type: &str,
        position: f64,
        width: f64,
        height: f64,
        sill_height: f64,
    ) -> Result<String, JsValue> {
        let wall_id = WallId::from_str(wall_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Parse opening type from string
        let opening_type = OpeningType::from_str(opening_type);

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        let opening_id = store.add_opening(
            wall_id,
            opening_type,
            position,
            width,
            height,
            sill_height,
        ).map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.bump_mutation_count();
        Ok(opening_id.to_string())
    }

    /// Get all opening IDs for a wall
    pub fn get_wall_openings(&self, wall_id: &str) -> Result<js_sys::Array, JsValue> {
        let wall_id = WallId::from_str(wall_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let openings = store.get_wall_openings(wall_id);
        let arr = js_sys::Array::new();
        for opening in openings {
            arr.push(&JsValue::from_str(&opening.id.to_string()));
        }
        Ok(arr)
    }

    /// Remove an opening from a wall
    pub fn remove_opening(&self, opening_id: &str) -> Result<(), JsValue> {
        let opening_id = OpeningId::from_str(opening_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        store.remove_opening(opening_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.bump_mutation_count();
        Ok(())
    }

    // ============ GRID OPERATIONS ============

    /// Create a grid for a building
    pub fn create_grid(&self, building_id: &str) -> Result<(), JsValue> {
        let building_id = BuildingId::from_str(building_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        store.create_grid(building_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.bump_mutation_count();
        Ok(())
    }

    /// Add a grid axis to a building's grid
    /// direction: "horizontal" or "vertical"
    pub fn add_grid_axis(
        &self,
        building_id: &str,
        name: &str,
        direction: &str,
        offset: f64,
    ) -> Result<(), JsValue> {
        let building_id = BuildingId::from_str(building_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        // Parse direction
        let grid_direction = match direction.to_lowercase().as_str() {
            "horizontal" | "h" => GridDirection::Horizontal,
            "vertical" | "v" => GridDirection::Vertical,
            _ => return Err(JsValue::from_str("Invalid direction: use 'horizontal' or 'vertical'")),
        };

        let axis = GridAxis {
            name: name.to_string(),
            direction: grid_direction,
            offset,
        };

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        store.add_grid_axis(building_id, axis)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        self.bump_mutation_count();
        Ok(())
    }

    // ============ SHELL AND ROOM RENDERING ============

    /// Render level footprint as hollow shell walls
    ///
    /// # Arguments
    /// * `level_id` - Level to render
    /// * `wall_thickness` - Wall thickness in feet (default 0.667 for 8" walls)
    pub fn render_level_shell(
        &self,
        level_id: &str,
        wall_thickness: f64,
    ) -> Result<WasmMesh, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let level = store.get_level(level_id)
            .ok_or_else(|| JsValue::from_str("Level not found"))?;

        let footprint = store.get_level_footprint(level_id)
            .ok_or_else(|| JsValue::from_str("Footprint not found"))?;

        let solid = extrude_polygon_shell(
            &footprint.polygon,
            level.elevation,
            level.floor_to_floor,
            wall_thickness,
        ).map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mesh_data = solid_to_mesh(&solid, 0.1)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        Ok(WasmMesh {
            positions: mesh_data.positions,
            normals: mesh_data.normals,
            indices: mesh_data.indices,
        })
    }

    /// Render all rooms on a level as floor plates
    ///
    /// Returns an array of meshes, one per room, each as thin (0.5') slabs
    pub fn render_rooms(&self, level_id: &str) -> Result<js_sys::Array, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let level = store.get_level(level_id)
            .ok_or_else(|| JsValue::from_str("Level not found"))?;

        let rooms = store.get_level_rooms(level_id);
        let result = js_sys::Array::new();

        // Room floor plate thickness: 0.5 feet (6 inches)
        let floor_thickness = 0.5;

        for room in rooms {
            // Skip rooms with invalid boundaries
            if !room.boundary.is_valid() {
                // Log warning but continue processing other rooms
                continue;
            }

            // Extrude room boundary as thin floor slab
            // Place floor plate at level elevation
            match extrude_polygon(&room.boundary, level.elevation, floor_thickness) {
                Ok(solid) => {
                    match solid_to_mesh(&solid, 0.1) {
                        Ok(mesh_data) => {
                            let mesh = WasmMesh {
                                positions: mesh_data.positions,
                                normals: mesh_data.normals,
                                indices: mesh_data.indices,
                            };
                            result.push(&mesh.into());
                        }
                        Err(_) => {
                            // Skip rooms that fail to mesh
                            continue;
                        }
                    }
                }
                Err(_) => {
                    // Skip rooms that fail to extrude
                    continue;
                }
            }
        }

        Ok(result)
    }

    /// Render level with both shell walls and room floor plates
    ///
    /// Returns object with { shell: WasmMesh, rooms: WasmMesh[] }
    pub fn render_level_combined(
        &self,
        level_id: &str,
        wall_thickness: f64,
    ) -> Result<JsValue, JsValue> {
        let level_id_parsed = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let level = store.get_level(level_id_parsed)
            .ok_or_else(|| JsValue::from_str("Level not found"))?;

        // Create result object
        let result = js_sys::Object::new();

        // Render shell if footprint exists
        if let Some(footprint) = store.get_level_footprint(level_id_parsed) {
            match extrude_polygon_shell(
                &footprint.polygon,
                level.elevation,
                level.floor_to_floor,
                wall_thickness,
            ) {
                Ok(solid) => {
                    if let Ok(mesh_data) = solid_to_mesh(&solid, 0.1) {
                        let shell_mesh = WasmMesh {
                            positions: mesh_data.positions,
                            normals: mesh_data.normals,
                            indices: mesh_data.indices,
                        };
                        let _ = js_sys::Reflect::set(
                            &result,
                            &JsValue::from_str("shell"),
                            &shell_mesh.into(),
                        );
                    }
                }
                Err(e) => {
                    // Set shell to null with error message
                    let _ = js_sys::Reflect::set(
                        &result,
                        &JsValue::from_str("shellError"),
                        &JsValue::from_str(&e.to_string()),
                    );
                }
            }
        }

        // Render rooms
        let rooms = store.get_level_rooms(level_id_parsed);
        let rooms_array = js_sys::Array::new();
        let floor_thickness = 0.5;

        for room in rooms {
            if !room.boundary.is_valid() {
                continue;
            }

            if let Ok(solid) = extrude_polygon(&room.boundary, level.elevation, floor_thickness) {
                if let Ok(mesh_data) = solid_to_mesh(&solid, 0.1) {
                    let mesh = WasmMesh {
                        positions: mesh_data.positions,
                        normals: mesh_data.normals,
                        indices: mesh_data.indices,
                    };
                    rooms_array.push(&mesh.into());
                }
            }
        }

        let _ = js_sys::Reflect::set(
            &result,
            &JsValue::from_str("rooms"),
            &rooms_array.into(),
        );

        Ok(result.into())
    }

    // ============ STATE DERIVATION QUERY METHODS ============

    /// Get all rooms for a level with full details for state derivation
    /// Returns serialized array of RoomSummary objects
    pub fn get_level_rooms(&self, level_id: &str) -> JsValue {
        let level_id = match LevelId::from_str(level_id) {
            Ok(id) => id,
            Err(_) => return JsValue::NULL,
        };

        let store = match self.inner.read() {
            Ok(s) => s,
            Err(_) => return JsValue::NULL,
        };

        let rooms = store.get_level_rooms(level_id);
        let room_summaries: Vec<serde_json::Value> = rooms
            .iter()
            .map(|room| {
                let centroid = room.boundary.centroid();
                let bbox = compute_bounding_box(&room.boundary);
                serde_json::json!({
                    "id": room.id.to_string(),
                    "name": room.name,
                    "type": room.room_type.display_name(),
                    "area": room.area(),
                    "center": [centroid.x, centroid.y],
                    "dimensions": {
                        "width": bbox.0,
                        "depth": bbox.1
                    }
                })
            })
            .collect();

        serde_wasm_bindgen::to_value(&room_summaries).unwrap_or(JsValue::NULL)
    }

    /// Get all walls for a level with full details for state derivation
    /// Returns serialized array of WallSummary objects
    #[wasm_bindgen(js_name = "get_level_walls")]
    pub fn get_level_walls_wasm(&self, level_id: &str) -> JsValue {
        let level_id = match LevelId::from_str(level_id) {
            Ok(id) => id,
            Err(_) => return JsValue::NULL,
        };

        let store = match self.inner.read() {
            Ok(s) => s,
            Err(_) => return JsValue::NULL,
        };

        let walls = store.get_level_walls(level_id);
        let wall_summaries: Vec<serde_json::Value> = walls
            .iter()
            .map(|wall| {
                // Get wall assembly thickness
                let thickness = store
                    .get_wall_assembly(wall.assembly_id)
                    .map(|a| a.total_thickness / 12.0) // Convert inches to feet
                    .unwrap_or(0.5);

                serde_json::json!({
                    "id": wall.id.to_string(),
                    "start": [wall.start.x, wall.start.y],
                    "end": [wall.end.x, wall.end.y],
                    "thickness": thickness,
                    "height": wall.height
                })
            })
            .collect();

        serde_wasm_bindgen::to_value(&wall_summaries).unwrap_or(JsValue::NULL)
    }

    /// Get complete observable state for LLM feedback
    /// Returns the full state structure matching the TypeScript ObservableState interface
    pub fn get_observable_state(&self, level_id: &str) -> JsValue {
        let level_id_parsed = match LevelId::from_str(level_id) {
            Ok(id) => id,
            Err(_) => return JsValue::NULL,
        };

        let store = match self.inner.read() {
            Ok(s) => s,
            Err(_) => return JsValue::NULL,
        };

        // Get rooms
        let rooms = store.get_level_rooms(level_id_parsed);
        let room_summaries: Vec<serde_json::Value> = rooms
            .iter()
            .map(|room| {
                let centroid = room.boundary.centroid();
                let bbox = compute_bounding_box(&room.boundary);
                serde_json::json!({
                    "id": room.id.to_string(),
                    "name": room.name,
                    "type": room.room_type.display_name(),
                    "area": room.area(),
                    "center": [centroid.x, centroid.y],
                    "dimensions": {
                        "width": bbox.0,
                        "depth": bbox.1
                    }
                })
            })
            .collect();

        // Get walls
        let walls = store.get_level_walls(level_id_parsed);
        let wall_summaries: Vec<serde_json::Value> = walls
            .iter()
            .map(|wall| {
                let thickness = store
                    .get_wall_assembly(wall.assembly_id)
                    .map(|a| a.total_thickness / 12.0)
                    .unwrap_or(0.5);

                serde_json::json!({
                    "id": wall.id.to_string(),
                    "start": [wall.start.x, wall.start.y],
                    "end": [wall.end.x, wall.end.y],
                    "thickness": thickness,
                    "height": wall.height
                })
            })
            .collect();

        // Get openings (collect from all walls on this level)
        let opening_summaries: Vec<serde_json::Value> = walls
            .iter()
            .flat_map(|wall| {
                store.get_wall_openings(wall.id).into_iter().map(|opening| {
                    let opening_type = match &opening.opening_type {
                        geometry_core::domain::OpeningType::Door => "door",
                        geometry_core::domain::OpeningType::Window => "window",
                        geometry_core::domain::OpeningType::Other(_) => "other",
                    };
                    serde_json::json!({
                        "id": opening.id.to_string(),
                        "type": opening_type,
                        "wallId": opening.wall_id.to_string(),
                        "width": opening.width,
                        "height": opening.height,
                        "position": opening.position_along_wall
                    })
                })
            })
            .collect();

        // Calculate total area and bounding box from rooms
        let total_area: f64 = rooms.iter().map(|r| r.area()).sum();

        // Calculate overall bounding box from footprint or rooms
        let (footprint_width, footprint_depth) = store
            .get_level_footprint(level_id_parsed)
            .map(|fp| compute_bounding_box(&fp.polygon))
            .unwrap_or_else(|| {
                // Calculate from rooms if no footprint
                if rooms.is_empty() {
                    (0.0, 0.0)
                } else {
                    let mut min_x = f64::MAX;
                    let mut max_x = f64::MIN;
                    let mut min_y = f64::MAX;
                    let mut max_y = f64::MIN;
                    for room in &rooms {
                        for pt in &room.boundary.outer {
                            min_x = min_x.min(pt.x);
                            max_x = max_x.max(pt.x);
                            min_y = min_y.min(pt.y);
                            max_y = max_y.max(pt.y);
                        }
                    }
                    (max_x - min_x, max_y - min_y)
                }
            });

        // Calculate room adjacencies (rooms that share an edge or are within 1 ft)
        let mut adjacencies: Vec<(String, String)> = Vec::new();
        for i in 0..rooms.len() {
            for j in (i + 1)..rooms.len() {
                if rooms_are_adjacent(&rooms[i].boundary, &rooms[j].boundary, 1.0) {
                    adjacencies.push((rooms[i].id.to_string(), rooms[j].id.to_string()));
                }
            }
        }

        // Identify circulation spaces (hallways, foyers, etc.)
        let circulation: Vec<String> = rooms
            .iter()
            .filter(|r| {
                matches!(
                    r.room_type,
                    geometry_core::domain::RoomType::Hallway
                        | geometry_core::domain::RoomType::Foyer
                        | geometry_core::domain::RoomType::Mudroom
                )
            })
            .map(|r| r.id.to_string())
            .collect();

        // Build constraints (simplified for now - can be enhanced)
        let satisfied: Vec<String> = Vec::new();
        let violated: Vec<String> = Vec::new();
        let warnings: Vec<String> = Vec::new();

        let observable_state = serde_json::json!({
            "floorplan": {
                "rooms": room_summaries,
                "walls": wall_summaries,
                "openings": opening_summaries
            },
            "layout": {
                "totalArea": total_area,
                "boundingBox": {
                    "width": footprint_width,
                    "depth": footprint_depth
                },
                "roomAdjacencies": adjacencies,
                "circulation": circulation
            },
            "constraints": {
                "satisfied": satisfied,
                "violated": violated,
                "warnings": warnings
            },
            "footprint": {
                "width": footprint_width,
                "depth": footprint_depth
            }
        });

        serde_wasm_bindgen::to_value(&observable_state).unwrap_or(JsValue::NULL)
    }

    /// Get mutation counter for cache invalidation
    /// This counter increments on every mutation operation
    pub fn get_mutation_count(&self) -> u64 {
        self.mutation_count.get()
    }
}

/// Compute bounding box (width, depth) for a polygon
fn compute_bounding_box(polygon: &geometry_core::domain::Polygon2) -> (f64, f64) {
    if polygon.outer.is_empty() {
        return (0.0, 0.0);
    }
    let mut min_x = f64::MAX;
    let mut max_x = f64::MIN;
    let mut min_y = f64::MAX;
    let mut max_y = f64::MIN;
    for pt in &polygon.outer {
        min_x = min_x.min(pt.x);
        max_x = max_x.max(pt.x);
        min_y = min_y.min(pt.y);
        max_y = max_y.max(pt.y);
    }
    (max_x - min_x, max_y - min_y)
}

/// Check if two room polygons are adjacent (within tolerance)
fn rooms_are_adjacent(
    poly1: &geometry_core::domain::Polygon2,
    poly2: &geometry_core::domain::Polygon2,
    tolerance: f64,
) -> bool {
    // Check if any vertex of poly1 is close to any edge of poly2
    for pt1 in &poly1.outer {
        for i in 0..poly2.outer.len() {
            let j = (i + 1) % poly2.outer.len();
            let dist = point_to_segment_distance(pt1, &poly2.outer[i], &poly2.outer[j]);
            if dist < tolerance {
                return true;
            }
        }
    }
    // Check the reverse
    for pt2 in &poly2.outer {
        for i in 0..poly1.outer.len() {
            let j = (i + 1) % poly1.outer.len();
            let dist = point_to_segment_distance(pt2, &poly1.outer[i], &poly1.outer[j]);
            if dist < tolerance {
                return true;
            }
        }
    }
    false
}

/// Calculate distance from a point to a line segment
fn point_to_segment_distance(
    pt: &geometry_core::domain::Point2,
    seg_start: &geometry_core::domain::Point2,
    seg_end: &geometry_core::domain::Point2,
) -> f64 {
    let dx = seg_end.x - seg_start.x;
    let dy = seg_end.y - seg_start.y;
    let len_sq = dx * dx + dy * dy;

    if len_sq < 1e-10 {
        // Degenerate segment (start == end)
        return pt.distance_to(seg_start);
    }

    // Project point onto line
    let t = ((pt.x - seg_start.x) * dx + (pt.y - seg_start.y) * dy) / len_sq;
    let t_clamped = t.clamp(0.0, 1.0);

    // Closest point on segment
    let closest_x = seg_start.x + t_clamped * dx;
    let closest_y = seg_start.y + t_clamped * dy;

    let diff_x = pt.x - closest_x;
    let diff_y = pt.y - closest_y;
    (diff_x * diff_x + diff_y * diff_y).sqrt()
}

// Import JS types for typed arrays
use js_sys::{Float32Array, Uint32Array};
