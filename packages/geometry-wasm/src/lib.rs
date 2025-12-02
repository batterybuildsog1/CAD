use wasm_bindgen::prelude::*;
use geometry_core::store::{SharedStore, new_shared_store};
use geometry_core::domain::{
    UnitSystem, CodeRegion, LevelId, ProjectId, BuildingId, WallAssemblyId, WallId, FootprintId,
    Point2, Point3, Polygon2, RoomType, WallLayer, WallAssembly, RoomId,
    OpeningId, OpeningType, GridAxis, GridDirection,
    FramingLayout, FramingMember, FramingMemberType, LumberSize, FramingMaterial,
    RoughOpening, WallFramingConfig,
    // Costing types
    MaterialType, LaborType, PricingUnit, UnitPrice, LaborRate, PriceTable,
};
use geometry_core::costing::{CostCalculator, CostInput, RoomCostInput, OpeningCostInput};
use geometry_core::geometry::{solid_to_mesh, extrude_polygon, extrude_polygon_shell, create_box};
use std::str::FromStr;
use std::collections::HashMap;

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

use std::cell::{Cell, RefCell};

#[wasm_bindgen]
pub struct WasmStore {
    inner: SharedStore,
    mutation_count: Cell<u64>,
    cost_calculator: RefCell<CostCalculator>,
}

#[wasm_bindgen]
impl WasmStore {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: new_shared_store(),
            mutation_count: Cell::new(0),
            cost_calculator: RefCell::new(CostCalculator::with_defaults()),
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

    // ============================================================================
    // WALL RENDERING
    // ============================================================================

    /// Render all walls on a level as individual box meshes
    /// Returns an array of { mesh: WasmMesh, wallId: string, thickness: number }
    #[wasm_bindgen]
    pub fn render_walls(&self, level_id: &str) -> Result<js_sys::Array, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let level = store.get_level(level_id)
            .ok_or_else(|| JsValue::from_str("Level not found"))?;

        let walls = store.get_level_walls(level_id);
        let result = js_sys::Array::new();

        for wall in walls {
            // Get wall assembly for thickness
            let thickness = store.get_wall_assembly(wall.assembly_id)
                .map(|a| a.total_thickness / 12.0) // Convert inches to feet
                .unwrap_or(0.5);

            // Build wall polygon from start/end + perpendicular offset by half thickness
            let half_thickness = thickness / 2.0;
            let (px, py) = wall.perpendicular();

            // Create four corners of the wall footprint
            let p1 = Point2::new(
                wall.start.x + px * half_thickness,
                wall.start.y + py * half_thickness,
            );
            let p2 = Point2::new(
                wall.end.x + px * half_thickness,
                wall.end.y + py * half_thickness,
            );
            let p3 = Point2::new(
                wall.end.x - px * half_thickness,
                wall.end.y - py * half_thickness,
            );
            let p4 = Point2::new(
                wall.start.x - px * half_thickness,
                wall.start.y - py * half_thickness,
            );

            let wall_polygon = Polygon2::new(vec![p1, p2, p3, p4]);
            let base_z = level.elevation + wall.base_offset;

            // Extrude the wall polygon
            match extrude_polygon(&wall_polygon, base_z, wall.height) {
                Ok(solid) => {
                    match solid_to_mesh(&solid, 0.1) {
                        Ok(mesh_data) => {
                            let mesh = WasmMesh {
                                positions: mesh_data.positions,
                                normals: mesh_data.normals,
                                indices: mesh_data.indices,
                            };

                            // Create result object with mesh and metadata
                            let obj = js_sys::Object::new();
                            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("mesh"), &mesh.into());
                            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("wallId"), &JsValue::from_str(&wall.id.to_string()));
                            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("thickness"), &JsValue::from_f64(thickness));

                            result.push(&obj.into());
                        }
                        Err(_) => continue,
                    }
                }
                Err(_) => continue,
            }
        }

        Ok(result)
    }

    /// Render framing members for a specific wall
    /// Returns array of { mesh: WasmMesh, memberType: string, lumberSize: string }
    #[wasm_bindgen]
    pub fn render_wall_framing(&self, wall_id: &str) -> Result<js_sys::Array, JsValue> {
        let wall_id = WallId::from_str(wall_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let wall = store.get_wall(wall_id)
            .ok_or_else(|| JsValue::from_str("Wall not found"))?;

        let level = store.get_level(wall.level_id)
            .ok_or_else(|| JsValue::from_str("Level not found for wall"))?;

        let layout = store.get_wall_framing_layout(wall_id)
            .ok_or_else(|| JsValue::from_str("No framing layout found for wall. Generate framing first."))?;

        let result = js_sys::Array::new();
        let base_z = level.elevation + wall.base_offset;

        for member in &layout.members {
            let (width, depth) = member.lumber_size.actual_dimensions();
            // Convert dimensions from inches to feet for geometry
            let width_ft = width / 12.0;
            let depth_ft = depth / 12.0;
            let length_ft = member.length / 12.0;

            // Create box geometry based on member orientation
            let (box_width, box_depth, box_height) = if member.member_type.is_vertical() {
                // Vertical members: width x depth cross-section, length is height
                (width_ft, depth_ft, length_ft)
            } else {
                // Horizontal members: length along wall, width x depth cross-section
                (length_ft, width_ft, depth_ft)
            };

            // Calculate origin in 3D space (member position is in inches, convert to feet)
            let origin = Point3::new(
                member.position.x / 12.0,
                member.position.y / 12.0,
                base_z + member.position.z / 12.0,
            );

            match create_box(box_width, box_depth, box_height, &origin) {
                Ok(solid) => {
                    match solid_to_mesh(&solid, 0.05) {
                        Ok(mesh_data) => {
                            let mesh = WasmMesh {
                                positions: mesh_data.positions,
                                normals: mesh_data.normals,
                                indices: mesh_data.indices,
                            };

                            let obj = js_sys::Object::new();
                            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("mesh"), &mesh.into());
                            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("memberType"), &JsValue::from_str(member.member_type.display_name()));
                            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("lumberSize"), &JsValue::from_str(&member.lumber_size.nominal_name()));
                            let _ = js_sys::Reflect::set(&obj, &JsValue::from_str("memberId"), &JsValue::from_str(&member.id.to_string()));

                            result.push(&obj.into());
                        }
                        Err(_) => continue,
                    }
                }
                Err(_) => continue,
            }
        }

        Ok(result)
    }

    // ============================================================================
    // WALL CREATION (ALTERNATIVE SIGNATURES)
    // ============================================================================

    /// Create a wall between two points using coordinate values directly
    #[wasm_bindgen]
    pub fn create_wall_coords(
        &self,
        level_id: &str,
        start_x: f64,
        start_y: f64,
        end_x: f64,
        end_y: f64,
        height: f64,
        assembly_id: &str,
    ) -> Result<String, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let assembly_id = WallAssemblyId::from_str(assembly_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let start = Point2::new(start_x, start_y);
        let end = Point2::new(end_x, end_y);

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        let wall_id = store.create_wall(level_id, assembly_id, start, end, height)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.bump_mutation_count();
        Ok(wall_id.to_string())
    }

    /// Create wall assembly (or get existing by name)
    /// assembly_type: "exterior_2x6", "interior_partition", "interior_load_bearing"
    #[wasm_bindgen]
    pub fn get_or_create_wall_assembly(&self, assembly_type: &str) -> Result<String, JsValue> {
        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        // Check if assembly with this name already exists
        let existing = store.list_wall_assemblies()
            .iter()
            .find(|a| a.name.to_lowercase().replace(" ", "_").contains(&assembly_type.to_lowercase()))
            .map(|a| a.id);

        if let Some(id) = existing {
            return Ok(id.to_string());
        }

        // Create new assembly based on type
        let assembly = match assembly_type.to_lowercase().as_str() {
            "exterior_2x6" | "exterior" => WallAssembly::exterior_2x6(),
            "interior_partition" | "interior" | "partition" => WallAssembly::interior_partition(),
            _ => {
                // Default to interior partition for unknown types
                WallAssembly::interior_partition()
            }
        };

        let layers = assembly.layers.clone();
        let name = assembly.name.clone();

        let assembly_id = store.create_wall_assembly(name, layers)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.bump_mutation_count();
        Ok(assembly_id.to_string())
    }

    /// Auto-generate walls for a level based on room types and adjacencies
    /// Returns summary: { wallsCreated: number, decisions: [{ room1, room2, wallType, reason }] }
    #[wasm_bindgen]
    pub fn auto_generate_walls(&self, level_id: &str) -> Result<JsValue, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        // Get all rooms on level
        let rooms: Vec<_> = store.get_level_rooms(level_id)
            .into_iter()
            .map(|r| (r.id, r.room_type.clone(), r.name.clone(), r.boundary.clone()))
            .collect();

        if rooms.is_empty() {
            return Ok(serde_wasm_bindgen::to_value(&serde_json::json!({
                "wallsCreated": 0,
                "decisions": [],
                "message": "No rooms found on level"
            })).unwrap_or(JsValue::NULL));
        }

        // Get or create default wall assembly
        let assembly_id = {
            let existing = store.list_wall_assemblies().first().map(|a| a.id);
            if let Some(id) = existing {
                id
            } else {
                let layers = vec![WallLayer::stud_2x6()];
                store.create_wall_assembly("Default Wall", layers)
                    .map_err(|e| JsValue::from_str(&e.to_string()))?
            }
        };

        let level = store.get_level(level_id)
            .ok_or_else(|| JsValue::from_str("Level not found"))?;
        let wall_height = level.floor_to_floor;

        let mut walls_created = 0;
        let mut decisions: Vec<serde_json::Value> = Vec::new();

        // Compute room adjacencies and decide on walls
        for i in 0..rooms.len() {
            for j in (i + 1)..rooms.len() {
                let (id1, type1, name1, boundary1) = &rooms[i];
                let (id2, type2, name2, boundary2) = &rooms[j];

                // Check if rooms share an edge (are adjacent)
                if let Some((shared_start, shared_end)) = find_shared_edge(boundary1, boundary2, 1.0) {
                    // Decide if wall should exist based on room types
                    let (wall_type, reason) = decide_wall_type(type1, type2);

                    decisions.push(serde_json::json!({
                        "room1": name1,
                        "room2": name2,
                        "room1Id": id1.to_string(),
                        "room2Id": id2.to_string(),
                        "wallType": wall_type,
                        "reason": reason
                    }));

                    // Create wall if needed
                    if wall_type == "full" {
                        let wall_result = store.create_wall(
                            level_id,
                            assembly_id,
                            shared_start,
                            shared_end,
                            wall_height,
                        );

                        if wall_result.is_ok() {
                            walls_created += 1;
                        }
                    }
                }
            }
        }

        self.bump_mutation_count();

        Ok(serde_wasm_bindgen::to_value(&serde_json::json!({
            "wallsCreated": walls_created,
            "decisions": decisions
        })).unwrap_or(JsValue::NULL))
    }

    /// Set wall type between two rooms (override auto decision)
    /// wall_type: "full" | "none" | "half" | "cased_opening"
    #[wasm_bindgen]
    pub fn set_wall_between_rooms(
        &self,
        room1_id: &str,
        room2_id: &str,
        wall_type: &str,
    ) -> Result<JsValue, JsValue> {
        let room1_id = RoomId::from_str(room1_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
        let room2_id = RoomId::from_str(room2_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        // Get rooms
        let room1 = store.get_room(room1_id)
            .ok_or_else(|| JsValue::from_str("Room 1 not found"))?;
        let room2 = store.get_room(room2_id)
            .ok_or_else(|| JsValue::from_str("Room 2 not found"))?;

        // Verify rooms are on the same level
        if room1.level_id != room2.level_id {
            return Err(JsValue::from_str("Rooms must be on the same level"));
        }

        let level_id = room1.level_id;
        let boundary1 = room1.boundary.clone();
        let boundary2 = room2.boundary.clone();

        // Find shared edge
        let (shared_start, shared_end) = find_shared_edge(&boundary1, &boundary2, 1.0)
            .ok_or_else(|| JsValue::from_str("Rooms do not share an edge"))?;

        // Extract level data before mutable operations
        let floor_to_floor = store.get_level(level_id)
            .ok_or_else(|| JsValue::from_str("Level not found"))?
            .floor_to_floor;

        // Get or create wall assembly
        let assembly_id = {
            let existing = store.list_wall_assemblies().first().map(|a| a.id);
            if let Some(id) = existing {
                id
            } else {
                let layers = vec![WallLayer::stud_2x6()];
                store.create_wall_assembly("Default Wall", layers)
                    .map_err(|e| JsValue::from_str(&e.to_string()))?
            }
        };

        // Find and remove any existing wall between these rooms
        let walls_to_remove: Vec<_> = store.get_level_walls(level_id)
            .iter()
            .filter(|w| {
                let wall_on_edge = is_wall_on_edge(w, &shared_start, &shared_end, 0.5);
                wall_on_edge
            })
            .map(|w| w.id)
            .collect();

        for wall_id in walls_to_remove {
            let _ = store.remove_wall(wall_id);
        }

        // Create new wall based on wall_type
        let result = match wall_type.to_lowercase().as_str() {
            "full" => {
                let wall_id = store.create_wall(
                    level_id,
                    assembly_id,
                    shared_start,
                    shared_end,
                    floor_to_floor,
                ).map_err(|e| JsValue::from_str(&e.to_string()))?;

                serde_json::json!({
                    "action": "created",
                    "wallType": "full",
                    "wallId": wall_id.to_string()
                })
            }
            "half" => {
                // Create a half-height wall
                let wall_id = store.create_wall(
                    level_id,
                    assembly_id,
                    shared_start,
                    shared_end,
                    floor_to_floor / 2.0,
                ).map_err(|e| JsValue::from_str(&e.to_string()))?;

                serde_json::json!({
                    "action": "created",
                    "wallType": "half",
                    "wallId": wall_id.to_string()
                })
            }
            "cased_opening" => {
                // Create wall with a cased opening (full wall, but we note it should have opening)
                let wall_id = store.create_wall(
                    level_id,
                    assembly_id,
                    shared_start,
                    shared_end,
                    floor_to_floor,
                ).map_err(|e| JsValue::from_str(&e.to_string()))?;

                // Add a cased opening in the middle
                let _ = store.add_opening(
                    wall_id,
                    OpeningType::Other("Cased Opening".to_string()),
                    0.5, // Center of wall
                    6.0, // 6 foot wide opening
                    floor_to_floor - 1.0, // Almost full height
                    0.0, // Floor level
                );

                serde_json::json!({
                    "action": "created",
                    "wallType": "cased_opening",
                    "wallId": wall_id.to_string()
                })
            }
            "none" => {
                serde_json::json!({
                    "action": "removed",
                    "wallType": "none"
                })
            }
            _ => {
                return Err(JsValue::from_str("Invalid wall_type. Use: full, none, half, or cased_opening"));
            }
        };

        self.bump_mutation_count();
        Ok(serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL))
    }

    // ============================================================================
    // FRAMING GENERATION
    // ============================================================================

    /// Generate framing for a wall (or regenerate if already exists)
    /// Returns framing summary with member counts and board feet
    #[wasm_bindgen]
    pub fn generate_wall_framing(&self, wall_id: &str) -> Result<JsValue, JsValue> {
        let wall_id = WallId::from_str(wall_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        // Get wall data
        let wall = store.get_wall(wall_id)
            .ok_or_else(|| JsValue::from_str("Wall not found"))?;

        let wall_length = wall.length() * 12.0; // Convert to inches
        let wall_height = wall.height * 12.0;   // Convert to inches
        let framing_config = wall.framing_config.clone();
        let wall_start = wall.start.clone();
        let (dir_x, dir_y) = wall.direction();

        // Get openings for this wall
        let openings: Vec<_> = store.get_wall_openings(wall_id)
            .iter()
            .map(|o| RoughOpening::new(
                o.id,
                o.width * 12.0,  // Convert to inches
                o.height * 12.0,
                o.position_along_wall * wall_length, // Convert position to inches along wall
            ))
            .collect();

        // Remove existing layout if present
        if let Some(layout_id) = store.get_wall(wall_id).and_then(|w| w.framing_layout_id) {
            let _ = store.remove_framing_layout(layout_id);
        }

        // Generate new framing layout
        let mut layout = FramingLayout::new(wall_id, framing_config.stud_spacing, framing_config.lumber_size);
        layout.double_top_plate = framing_config.double_top_plate;

        // Calculate plate thickness (for stud height calculation)
        let (_, plate_depth) = framing_config.lumber_size.actual_dimensions();
        let num_top_plates = if framing_config.double_top_plate { 2 } else { 1 };
        let stud_height = wall_height - plate_depth - (num_top_plates as f64 * plate_depth);

        // Generate bottom plate
        layout.add_member(FramingMember::bottom_plate(
            Point3::new(wall_start.x * 12.0, wall_start.y * 12.0, 0.0),
            wall_length,
            framing_config.lumber_size,
            dir_y.atan2(dir_x),
            wall_id,
        ));

        // Generate top plate(s)
        let top_plate_z = wall_height - plate_depth;
        layout.add_member(FramingMember::top_plate(
            Point3::new(wall_start.x * 12.0, wall_start.y * 12.0, top_plate_z),
            wall_length,
            framing_config.lumber_size,
            dir_y.atan2(dir_x),
            wall_id,
        ));

        if framing_config.double_top_plate {
            layout.add_member(FramingMember::new(
                FramingMemberType::DoubleTopPlate,
                framing_config.lumber_size,
                FramingMaterial::SPF,
                Point3::new(wall_start.x * 12.0, wall_start.y * 12.0, top_plate_z - plate_depth),
                wall_length,
                dir_y.atan2(dir_x),
                wall_id,
            ));
        }

        // Generate studs at regular spacing
        let stud_base_z = plate_depth;
        let mut position = 0.0;
        let mut stud_index = 0;

        while position <= wall_length {
            // Check if this position conflicts with an opening
            let in_opening = openings.iter().any(|o| {
                let opening_start = o.position_along_wall - o.width / 2.0;
                let opening_end = o.position_along_wall + o.width / 2.0;
                position > opening_start && position < opening_end
            });

            if !in_opening {
                // Calculate stud position in world coordinates
                let stud_x = wall_start.x * 12.0 + dir_x * position;
                let stud_y = wall_start.y * 12.0 + dir_y * position;

                layout.add_member(FramingMember::stud(
                    Point3::new(stud_x, stud_y, stud_base_z),
                    stud_height,
                    framing_config.lumber_size,
                    wall_id,
                ));
            }

            stud_index += 1;
            position = stud_index as f64 * framing_config.stud_spacing;
        }

        // Generate framing around openings (king studs, jack studs, headers)
        for opening in &openings {
            let opening_start = opening.position_along_wall - opening.width / 2.0;
            let opening_end = opening.position_along_wall + opening.width / 2.0;

            // King studs (full height on each side)
            for king_pos in [opening_start - 1.5, opening_end + 1.5] {
                if king_pos >= 0.0 && king_pos <= wall_length {
                    let stud_x = wall_start.x * 12.0 + dir_x * king_pos;
                    let stud_y = wall_start.y * 12.0 + dir_y * king_pos;

                    layout.add_member(FramingMember::new(
                        FramingMemberType::KingStud,
                        framing_config.lumber_size,
                        FramingMaterial::SPF,
                        Point3::new(stud_x, stud_y, stud_base_z),
                        stud_height,
                        0.0,
                        wall_id,
                    ).with_opening(opening.opening_id));
                }
            }

            // Jack studs (support header)
            let jack_height = opening.height + opening.header_depth;
            for jack_pos in [opening_start, opening_end] {
                if jack_pos >= 0.0 && jack_pos <= wall_length {
                    let stud_x = wall_start.x * 12.0 + dir_x * jack_pos;
                    let stud_y = wall_start.y * 12.0 + dir_y * jack_pos;

                    layout.add_member(FramingMember::new(
                        FramingMemberType::JackStud,
                        framing_config.lumber_size,
                        FramingMaterial::SPF,
                        Point3::new(stud_x, stud_y, stud_base_z),
                        jack_height,
                        0.0,
                        wall_id,
                    ).with_opening(opening.opening_id));
                }
            }

            // Header
            let header_pos_x = wall_start.x * 12.0 + dir_x * opening_start;
            let header_pos_y = wall_start.y * 12.0 + dir_y * opening_start;
            let header_z = stud_base_z + opening.height;

            layout.add_member(FramingMember::new(
                FramingMemberType::Header,
                LumberSize::TwoByEight, // Headers typically larger
                FramingMaterial::SPF,
                Point3::new(header_pos_x, header_pos_y, header_z),
                opening.width,
                dir_y.atan2(dir_x),
                wall_id,
            ).with_opening(opening.opening_id));

            // Sill (for windows)
            if opening.requires_sill {
                let sill_z = stud_base_z; // At bottom plate level
                layout.add_member(FramingMember::new(
                    FramingMemberType::Sill,
                    framing_config.lumber_size,
                    FramingMaterial::SPF,
                    Point3::new(header_pos_x, header_pos_y, sill_z),
                    opening.width,
                    dir_y.atan2(dir_x),
                    wall_id,
                ).with_opening(opening.opening_id));
            }
        }

        // Recalculate totals
        layout.recalculate_totals();

        // Create summary before storing
        let summary = serde_json::json!({
            "layoutId": layout.id.to_string(),
            "wallId": wall_id.to_string(),
            "studCount": layout.stud_count,
            "totalBoardFeet": layout.total_board_feet,
            "memberCount": layout.members.len(),
            "studSpacing": layout.stud_spacing,
            "lumberSize": layout.lumber_size.nominal_name(),
            "doubleTopPlate": layout.double_top_plate
        });

        // Store the layout
        store.store_framing_layout(layout)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        self.bump_mutation_count();
        Ok(serde_wasm_bindgen::to_value(&summary).unwrap_or(JsValue::NULL))
    }

    /// Get framing summary for a wall (without regenerating)
    #[wasm_bindgen]
    pub fn get_wall_framing_summary(&self, wall_id: &str) -> Result<JsValue, JsValue> {
        let wall_id = WallId::from_str(wall_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        let layout = store.get_wall_framing_layout(wall_id)
            .ok_or_else(|| JsValue::from_str("No framing layout found for wall"))?;

        // Build member breakdown
        let mut member_breakdown: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        for member in &layout.members {
            let type_name = member.member_type.display_name().to_string();
            *member_breakdown.entry(type_name).or_insert(0) += 1;
        }

        let summary = serde_json::json!({
            "layoutId": layout.id.to_string(),
            "wallId": layout.wall_id.to_string(),
            "studCount": layout.stud_count,
            "totalBoardFeet": layout.total_board_feet,
            "memberCount": layout.members.len(),
            "studSpacing": layout.stud_spacing,
            "lumberSize": layout.lumber_size.nominal_name(),
            "doubleTopPlate": layout.double_top_plate,
            "memberBreakdown": member_breakdown
        });

        Ok(serde_wasm_bindgen::to_value(&summary).unwrap_or(JsValue::NULL))
    }

    /// Set framing configuration for a wall
    #[wasm_bindgen]
    pub fn set_wall_framing_config(
        &self,
        wall_id: &str,
        stud_spacing: f64,
        lumber_size: &str,
        double_top_plate: bool,
        is_load_bearing: bool,
    ) -> Result<(), JsValue> {
        let wall_id = WallId::from_str(wall_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let lumber = match lumber_size.to_lowercase().as_str() {
            "2x4" => LumberSize::TwoByFour,
            "2x6" => LumberSize::TwoBySix,
            "2x8" => LumberSize::TwoByEight,
            "2x10" => LumberSize::TwoByTen,
            "2x12" => LumberSize::TwoByTwelve,
            _ => return Err(JsValue::from_str("Invalid lumber size. Use: 2x4, 2x6, 2x8, 2x10, or 2x12")),
        };

        let config = WallFramingConfig::new(stud_spacing, lumber, double_top_plate, is_load_bearing);

        let mut store = self.inner.write()
            .map_err(|_| JsValue::from_str("Failed to acquire write lock"))?;

        let wall = store.walls.get_mut(&wall_id)
            .ok_or_else(|| JsValue::from_str("Wall not found"))?;

        wall.framing_config = config;
        self.bump_mutation_count();
        Ok(())
    }

    // ============================================================================
    // COST ESTIMATION
    // ============================================================================

    /// Generate a cost estimate for a level
    /// Returns a serialized CostEstimate object
    #[wasm_bindgen]
    pub fn generate_cost_estimate(&self, level_id: &str) -> Result<JsValue, JsValue> {
        let level_id = LevelId::from_str(level_id)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let store = self.inner.read()
            .map_err(|_| JsValue::from_str("Failed to acquire read lock"))?;

        // Build cost input from store data
        let cost_input = self.build_cost_input(&store, level_id)?;

        // Calculate estimate
        let calculator = self.cost_calculator.borrow();
        let estimate = calculator.calculate(&cost_input);

        // Serialize to JS
        serde_wasm_bindgen::to_value(&estimate)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize estimate: {}", e)))
    }

    /// Build a CostInput from store data for a given level
    fn build_cost_input(
        &self,
        store: &geometry_core::store::Store,
        level_id: LevelId,
    ) -> Result<CostInput, JsValue> {
        let level = store.get_level(level_id)
            .ok_or_else(|| JsValue::from_str("Level not found"))?;

        // Get footprint data
        let footprint = store.get_level_footprint(level_id);
        let footprint_sqft = footprint
            .as_ref()
            .map(|fp| fp.polygon.area())
            .unwrap_or(0.0);
        let exterior_perimeter = footprint
            .as_ref()
            .map(|fp| fp.polygon.perimeter())
            .unwrap_or(0.0);

        // Get rooms
        let rooms = store.get_level_rooms(level_id);
        let total_floor_area: f64 = rooms.iter().map(|r| r.area()).sum();

        // Build room cost inputs
        let room_inputs: Vec<RoomCostInput> = rooms
            .iter()
            .map(|room| {
                let perimeter = room.boundary.perimeter();
                let floor_sqft = room.area();
                let wall_sqft = perimeter * level.floor_to_floor;
                RoomCostInput {
                    id: room.id,
                    room_type: room.room_type.display_name().to_string(),
                    floor_sqft,
                    wall_sqft,
                    perimeter_ft: perimeter,
                }
            })
            .collect();

        // Get walls and calculate wall areas
        let walls = store.get_level_walls(level_id);
        let mut exterior_wall_linear_ft = 0.0;
        let mut interior_wall_linear_ft = 0.0;

        for wall in &walls {
            let wall_length = wall.length();
            // For now, assume all walls are interior
            // TODO: Determine exterior vs interior based on footprint boundary
            interior_wall_linear_ft += wall_length;
        }

        // Use footprint perimeter as exterior wall estimate if no explicit exterior walls
        if exterior_wall_linear_ft == 0.0 {
            exterior_wall_linear_ft = exterior_perimeter;
        }

        let exterior_wall_sqft = exterior_wall_linear_ft * level.floor_to_floor;

        // Build opening cost inputs
        let mut opening_inputs: Vec<OpeningCostInput> = Vec::new();
        let mut opening_counts: HashMap<String, (OpeningId, String, f64, f64, u32)> = HashMap::new();

        for wall in &walls {
            let openings = store.get_wall_openings(wall.id);
            for opening in openings {
                let opening_type = match &opening.opening_type {
                    geometry_core::domain::OpeningType::Door => "exterior_door".to_string(),
                    geometry_core::domain::OpeningType::Window => "window".to_string(),
                    geometry_core::domain::OpeningType::Other(name) => {
                        if name.to_lowercase().contains("interior") {
                            "interior_door".to_string()
                        } else if name.to_lowercase().contains("garage") {
                            "garage_door".to_string()
                        } else {
                            "window".to_string()
                        }
                    }
                };

                // Group by type and dimensions for counting
                let key = format!("{}_{}x{}", opening_type, opening.width as i32, opening.height as i32);
                let entry = opening_counts.entry(key).or_insert((
                    opening.id,
                    opening_type,
                    opening.width,
                    opening.height,
                    0,
                ));
                entry.4 += 1;
            }
        }

        for (_, (id, opening_type, width, height, count)) in opening_counts {
            opening_inputs.push(OpeningCostInput {
                id,
                opening_type,
                width,
                height,
                count,
            });
        }

        // Estimate roof area (simple multiplier for pitch)
        let roof_sqft = footprint_sqft * 1.1; // 10% overhang/pitch factor

        Ok(CostInput {
            level_id,
            footprint_sqft,
            total_floor_area: if total_floor_area > 0.0 { total_floor_area } else { footprint_sqft },
            exterior_wall_linear_ft,
            exterior_wall_sqft,
            interior_wall_linear_ft,
            roof_sqft,
            foundation_sqft: footprint_sqft,
            rooms: room_inputs,
            openings: opening_inputs,
            wall_height: level.floor_to_floor,
        })
    }

    /// Set a material price in the price table
    /// material_type: string name of the MaterialType enum
    /// unit: string name of the PricingUnit enum
    /// price: the price value
    #[wasm_bindgen]
    pub fn set_material_price(
        &self,
        material_type: &str,
        unit: &str,
        price: f64,
    ) -> Result<(), JsValue> {
        let material = parse_material_type(material_type)?;
        let pricing_unit = parse_pricing_unit(unit)?;

        let unit_price = UnitPrice::new(material, pricing_unit, price);

        self.cost_calculator
            .borrow_mut()
            .set_material_price(material, unit_price);

        Ok(())
    }

    /// Set a labor rate in the price table
    /// labor_type: string name of the LaborType enum
    /// unit: string name of the PricingUnit enum
    /// rate: the rate value
    #[wasm_bindgen]
    pub fn set_labor_rate(
        &self,
        labor_type: &str,
        unit: &str,
        rate: f64,
    ) -> Result<(), JsValue> {
        let labor = parse_labor_type(labor_type)?;
        let pricing_unit = parse_pricing_unit(unit)?;

        let labor_rate = LaborRate::new(labor, pricing_unit, rate);

        self.cost_calculator
            .borrow_mut()
            .set_labor_rate(labor, labor_rate);

        Ok(())
    }

    /// Get the current price table as JSON
    #[wasm_bindgen]
    pub fn get_price_table(&self) -> Result<JsValue, JsValue> {
        let calculator = self.cost_calculator.borrow();
        let price_table = calculator.price_table();

        serde_wasm_bindgen::to_value(price_table)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize price table: {}", e)))
    }

    /// Import a price table from JSON
    /// Merges with existing prices (overwrites matching keys)
    #[wasm_bindgen]
    pub fn import_price_table(&self, table_json: &JsValue) -> Result<(), JsValue> {
        let imported: PriceTable = serde_wasm_bindgen::from_value(table_json.clone())
            .map_err(|e| JsValue::from_str(&format!("Failed to parse price table: {}", e)))?;

        let mut calculator = self.cost_calculator.borrow_mut();

        // Merge material prices
        for (material, price) in imported.material_prices {
            calculator.set_material_price(material, price);
        }

        // Merge labor rates
        for (labor, rate) in imported.labor_rates {
            calculator.set_labor_rate(labor, rate);
        }

        Ok(())
    }

    /// Get all material type names (for UI dropdown population)
    #[wasm_bindgen]
    pub fn get_material_types(&self) -> JsValue {
        let types = vec![
            "concrete_mix",
            "concrete_rebar",
            "concrete_forms",
            "concrete_vapor_barrier",
            "concrete_gravel",
            "lumber_2x4",
            "lumber_2x6",
            "lumber_2x8",
            "lumber_2x10",
            "lumber_2x12",
            "lvl_beam",
            "sheathing",
            "asphalt_shingles",
            "metal_roofing",
            "tile_roofing",
            "roofing_underlayment",
            "vinyl_siding",
            "hardie_board",
            "stucco",
            "brick",
            "stone",
            "window_unit",
            "exterior_door",
            "interior_door",
            "garage_door",
            "drywall",
            "insulation",
            "paint",
            "hardwood",
            "tile",
            "carpet",
            "lvp",
            "trim",
            "truss",
            "light_fixture",
            "plumbing_fixture",
            "cabinet",
            "countertop",
            "appliance",
        ];

        serde_wasm_bindgen::to_value(&types).unwrap_or(JsValue::NULL)
    }

    /// Get all labor type names (for UI dropdown population)
    #[wasm_bindgen]
    pub fn get_labor_types(&self) -> JsValue {
        let types = vec![
            "general_labor",
            "skilled_labor",
            "framing_carpentry",
            "concrete_subgrade_prep",
            "concrete_form_install",
            "concrete_rebar_install",
            "concrete_place_finish",
            "roofing_install",
            "siding_install",
            "drywall_install",
            "painting_labor",
            "flooring_install",
            "tile_install",
            "plumbing_labor",
            "electrical_labor",
            "hvac_install",
        ];

        serde_wasm_bindgen::to_value(&types).unwrap_or(JsValue::NULL)
    }

    /// Get all pricing unit names (for UI dropdown population)
    #[wasm_bindgen]
    pub fn get_pricing_units(&self) -> JsValue {
        let units = vec![
            "per_component",
            "per_square_foot",
            "per_linear_foot",
            "per_cubic_yard",
            "per_pound",
            "per_board",
            "per_hour",
            "lump",
        ];

        serde_wasm_bindgen::to_value(&units).unwrap_or(JsValue::NULL)
    }
}

// ============================================================================
// COSTING HELPER FUNCTIONS
// ============================================================================

/// Parse a MaterialType from a snake_case string
fn parse_material_type(s: &str) -> Result<MaterialType, JsValue> {
    match s.to_lowercase().as_str() {
        "concrete_mix" => Ok(MaterialType::ConcreteMix),
        "concrete_rebar" => Ok(MaterialType::ConcreteRebar),
        "concrete_forms" => Ok(MaterialType::ConcreteForms),
        "concrete_vapor_barrier" => Ok(MaterialType::ConcreteVaporBarrier),
        "concrete_gravel" => Ok(MaterialType::ConcreteGravel),
        "lumber_2x4" => Ok(MaterialType::Lumber2x4),
        "lumber_2x6" => Ok(MaterialType::Lumber2x6),
        "lumber_2x8" => Ok(MaterialType::Lumber2x8),
        "lumber_2x10" => Ok(MaterialType::Lumber2x10),
        "lumber_2x12" => Ok(MaterialType::Lumber2x12),
        "lvl_beam" => Ok(MaterialType::LVLBeam),
        "sheathing" => Ok(MaterialType::Sheathing),
        "asphalt_shingles" => Ok(MaterialType::AsphaltShingles),
        "metal_roofing" => Ok(MaterialType::MetalRoofing),
        "tile_roofing" => Ok(MaterialType::TileRoofing),
        "roofing_underlayment" => Ok(MaterialType::RoofingUnderlayment),
        "vinyl_siding" => Ok(MaterialType::VinylSiding),
        "hardie_board" => Ok(MaterialType::HardieBoard),
        "stucco" => Ok(MaterialType::Stucco),
        "brick" => Ok(MaterialType::Brick),
        "stone" => Ok(MaterialType::Stone),
        "window_unit" => Ok(MaterialType::WindowUnit),
        "exterior_door" => Ok(MaterialType::ExteriorDoor),
        "interior_door" => Ok(MaterialType::InteriorDoor),
        "garage_door" => Ok(MaterialType::GarageDoor),
        "drywall" => Ok(MaterialType::Drywall),
        "insulation" => Ok(MaterialType::Insulation),
        "paint" => Ok(MaterialType::Paint),
        "hardwood" => Ok(MaterialType::Hardwood),
        "tile" => Ok(MaterialType::Tile),
        "carpet" => Ok(MaterialType::Carpet),
        "lvp" => Ok(MaterialType::LVP),
        "trim" => Ok(MaterialType::Trim),
        "truss" => Ok(MaterialType::Truss),
        "light_fixture" => Ok(MaterialType::LightFixture),
        "plumbing_fixture" => Ok(MaterialType::PlumbingFixture),
        "cabinet" => Ok(MaterialType::Cabinet),
        "countertop" => Ok(MaterialType::Countertop),
        "appliance" => Ok(MaterialType::Appliance),
        _ => Err(JsValue::from_str(&format!("Unknown material type: {}", s))),
    }
}

/// Parse a LaborType from a snake_case string
fn parse_labor_type(s: &str) -> Result<LaborType, JsValue> {
    match s.to_lowercase().as_str() {
        "general_labor" => Ok(LaborType::GeneralLabor),
        "skilled_labor" => Ok(LaborType::SkilledLabor),
        "framing_carpentry" => Ok(LaborType::FramingCarpentry),
        "concrete_subgrade_prep" => Ok(LaborType::ConcreteSubgradePrep),
        "concrete_form_install" => Ok(LaborType::ConcreteFormInstall),
        "concrete_rebar_install" => Ok(LaborType::ConcreteRebarInstall),
        "concrete_place_finish" => Ok(LaborType::ConcretePlaceFinish),
        "roofing_install" => Ok(LaborType::RoofingInstall),
        "siding_install" => Ok(LaborType::SidingInstall),
        "drywall_install" => Ok(LaborType::DrywallInstall),
        "painting_labor" => Ok(LaborType::PaintingLabor),
        "flooring_install" => Ok(LaborType::FlooringInstall),
        "tile_install" => Ok(LaborType::TileInstall),
        "plumbing_labor" => Ok(LaborType::PlumbingLabor),
        "electrical_labor" => Ok(LaborType::ElectricalLabor),
        "hvac_install" => Ok(LaborType::HVACInstall),
        _ => Err(JsValue::from_str(&format!("Unknown labor type: {}", s))),
    }
}

/// Parse a PricingUnit from a snake_case string
fn parse_pricing_unit(s: &str) -> Result<PricingUnit, JsValue> {
    match s.to_lowercase().as_str() {
        "per_component" => Ok(PricingUnit::PerComponent),
        "per_square_foot" => Ok(PricingUnit::PerSquareFoot),
        "per_linear_foot" => Ok(PricingUnit::PerLinearFoot),
        "per_cubic_yard" => Ok(PricingUnit::PerCubicYard),
        "per_pound" => Ok(PricingUnit::PerPound),
        "per_board" => Ok(PricingUnit::PerBoard),
        "per_hour" => Ok(PricingUnit::PerHour),
        "lump" => Ok(PricingUnit::Lump),
        _ => Err(JsValue::from_str(&format!("Unknown pricing unit: {}", s))),
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

/// Find the shared edge between two polygons (if any)
/// Returns the start and end points of the shared edge
fn find_shared_edge(
    poly1: &geometry_core::domain::Polygon2,
    poly2: &geometry_core::domain::Polygon2,
    tolerance: f64,
) -> Option<(Point2, Point2)> {
    // Check each edge of poly1 against each edge of poly2
    for i in 0..poly1.outer.len() {
        let j = (i + 1) % poly1.outer.len();
        let edge1_start = &poly1.outer[i];
        let edge1_end = &poly1.outer[j];

        for k in 0..poly2.outer.len() {
            let l = (k + 1) % poly2.outer.len();
            let edge2_start = &poly2.outer[k];
            let edge2_end = &poly2.outer[l];

            // Check if edges overlap (share a segment)
            if edges_overlap(edge1_start, edge1_end, edge2_start, edge2_end, tolerance) {
                // Return the overlapping segment
                let shared_start = Point2::new(
                    (edge1_start.x + edge2_end.x) / 2.0,
                    (edge1_start.y + edge2_end.y) / 2.0,
                );
                let shared_end = Point2::new(
                    (edge1_end.x + edge2_start.x) / 2.0,
                    (edge1_end.y + edge2_start.y) / 2.0,
                );

                // Ensure we have a meaningful edge (not a point)
                if shared_start.distance_to(&shared_end) > tolerance {
                    return Some((shared_start, shared_end));
                }
            }
        }
    }
    None
}

/// Check if two edges overlap (share a segment within tolerance)
fn edges_overlap(
    e1_start: &geometry_core::domain::Point2,
    e1_end: &geometry_core::domain::Point2,
    e2_start: &geometry_core::domain::Point2,
    e2_end: &geometry_core::domain::Point2,
    tolerance: f64,
) -> bool {
    // Check if edges are collinear and overlapping
    // First check if points are close to the other edge
    let d1_start = point_to_segment_distance(e1_start, e2_start, e2_end);
    let d1_end = point_to_segment_distance(e1_end, e2_start, e2_end);
    let d2_start = point_to_segment_distance(e2_start, e1_start, e1_end);
    let d2_end = point_to_segment_distance(e2_end, e1_start, e1_end);

    // At least two endpoints should be close to the other edge for overlap
    let close_count = [d1_start, d1_end, d2_start, d2_end]
        .iter()
        .filter(|&&d| d < tolerance)
        .count();

    close_count >= 2
}

/// Decide what wall type should exist between two room types
fn decide_wall_type(
    room1_type: &geometry_core::domain::RoomType,
    room2_type: &geometry_core::domain::RoomType,
) -> (&'static str, &'static str) {
    use geometry_core::domain::RoomType;

    // Privacy rooms always get walls
    let privacy_rooms = |rt: &RoomType| {
        matches!(
            rt,
            RoomType::Bedroom | RoomType::Bathroom | RoomType::Closet | RoomType::Office
        )
    };

    // Open concept pairs don't need walls
    let is_open_concept_pair = |r1: &RoomType, r2: &RoomType| {
        matches!(
            (r1, r2),
            (RoomType::Kitchen, RoomType::DiningRoom)
                | (RoomType::DiningRoom, RoomType::Kitchen)
                | (RoomType::Kitchen, RoomType::LivingRoom)
                | (RoomType::LivingRoom, RoomType::Kitchen)
                | (RoomType::Kitchen, RoomType::FamilyRoom)
                | (RoomType::FamilyRoom, RoomType::Kitchen)
                | (RoomType::LivingRoom, RoomType::DiningRoom)
                | (RoomType::DiningRoom, RoomType::LivingRoom)
                | (RoomType::LivingRoom, RoomType::FamilyRoom)
                | (RoomType::FamilyRoom, RoomType::LivingRoom)
                | (RoomType::Foyer, RoomType::LivingRoom)
                | (RoomType::LivingRoom, RoomType::Foyer)
        )
    };

    // Circulation spaces typically open to adjacent spaces
    let is_circulation = |rt: &RoomType| {
        matches!(rt, RoomType::Hallway | RoomType::Foyer | RoomType::Mudroom)
    };

    if privacy_rooms(room1_type) || privacy_rooms(room2_type) {
        ("full", "Privacy room requires wall")
    } else if is_open_concept_pair(room1_type, room2_type) {
        ("none", "Open concept between living spaces")
    } else if is_circulation(room1_type) && !privacy_rooms(room2_type) {
        ("none", "Circulation space open to living area")
    } else if is_circulation(room2_type) && !privacy_rooms(room1_type) {
        ("none", "Circulation space open to living area")
    } else if matches!(room1_type, RoomType::Garage) || matches!(room2_type, RoomType::Garage) {
        ("full", "Garage requires fire separation")
    } else {
        ("full", "Default: separate spaces with wall")
    }
}

/// Check if a wall is on a given edge (within tolerance)
fn is_wall_on_edge(
    wall: &geometry_core::domain::Wall,
    edge_start: &Point2,
    edge_end: &Point2,
    tolerance: f64,
) -> bool {
    // Check if wall endpoints are close to the edge
    let d_start_to_edge = point_to_segment_distance(&wall.start, edge_start, edge_end);
    let d_end_to_edge = point_to_segment_distance(&wall.end, edge_start, edge_end);

    d_start_to_edge < tolerance && d_end_to_edge < tolerance
}

// Import JS types for typed arrays
use js_sys::{Float32Array, Uint32Array};
