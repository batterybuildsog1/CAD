// Rhai scripting integration
// Exposes safe, sandboxed functions for AI and human scripts to drive modeling
// Updated to use StructuredError for observable feedback loops with Gemini

use rhai::{Dynamic, Engine, EvalAltResult, Map, Scope, AST};
use std::sync::Arc;
use anyhow::{anyhow, Result};

use crate::domain::*;
use crate::domain::error::{StructuredError, EntityType};
use crate::store::SharedStore;

/// Convert a StructuredError to a Rhai EvalAltResult
/// The error message is JSON-formatted for Gemini to parse
fn structured_err(err: StructuredError) -> Box<EvalAltResult> {
    err.to_rhai_string().into()
}

/// Result type for Rhai script execution
#[derive(Debug)]
pub struct ScriptResult {
    pub success: bool,
    pub return_value: Option<Dynamic>,
    pub error: Option<String>,
    pub events_generated: usize,
}

/// Create a sandboxed Rhai engine with domain functions registered
pub fn create_engine(store: SharedStore) -> Engine {
    let mut engine = Engine::new();

    // Disable potentially dangerous operations
    engine.set_max_expr_depths(64, 32);
    engine.set_max_call_levels(32);
    engine.set_max_operations(100_000);
    engine.set_max_string_size(10_000);
    engine.set_max_array_size(1_000);
    engine.set_max_map_size(500);

    // Register custom types for IDs (as opaque handles)
    engine.register_type_with_name::<ProjectId>("ProjectId");
    engine.register_type_with_name::<BuildingId>("BuildingId");
    engine.register_type_with_name::<LevelId>("LevelId");
    engine.register_type_with_name::<FootprintId>("FootprintId");
    engine.register_type_with_name::<SiteId>("SiteId");
    engine.register_type_with_name::<WallId>("WallId");
    engine.register_type_with_name::<WallAssemblyId>("WallAssemblyId");
    engine.register_type_with_name::<RoomId>("RoomId");
    engine.register_type_with_name::<OpeningId>("OpeningId");

    // Register domain functions
    register_project_functions(&mut engine, store.clone());
    register_building_functions(&mut engine, store.clone());
    register_level_functions(&mut engine, store.clone());
    register_footprint_functions(&mut engine, store.clone());
    register_grid_functions(&mut engine, store.clone());
    register_wall_functions(&mut engine, store.clone());
    register_room_functions(&mut engine, store.clone());
    register_opening_functions(&mut engine, store.clone());
    register_query_functions(&mut engine, store.clone());

    engine
}

/// Execute a Rhai script and return the result
pub fn execute_script(
    engine: &Engine,
    script: &str,
    store: SharedStore,
) -> ScriptResult {
    let events_before = {
        let store_read = store.read().unwrap();
        store_read.event_logs.values().map(|l| l.len()).sum::<usize>()
    };

    let result = engine.eval::<Dynamic>(script);

    let events_after = {
        let store_read = store.read().unwrap();
        store_read.event_logs.values().map(|l| l.len()).sum::<usize>()
    };

    match result {
        Ok(value) => ScriptResult {
            success: true,
            return_value: Some(value),
            error: None,
            events_generated: events_after - events_before,
        },
        Err(e) => ScriptResult {
            success: false,
            return_value: None,
            error: Some(e.to_string()),
            events_generated: 0,
        },
    }
}

/// Compile a script without executing (for validation)
pub fn compile_script(engine: &Engine, script: &str) -> Result<AST> {
    engine.compile(script).map_err(|e| anyhow!("Compilation error: {}", e))
}

// ========== Project Functions ==========

fn register_project_functions(engine: &mut Engine, store: SharedStore) {
    let s = store.clone();
    engine.register_fn("create_project", move |name: &str, units: &str, code_region: &str| -> Result<ProjectId, Box<EvalAltResult>> {
        let units = match units.to_lowercase().as_str() {
            "imperial" | "us" | "feet" => UnitSystem::Imperial,
            "metric" | "si" | "meters" => UnitSystem::Metric,
            _ => return Err(structured_err(StructuredError::unknown_unit_system(units))),
        };

        let code_region = parse_code_region(code_region)?;

        let mut store = s.write().unwrap();
        store.create_project(name, units, code_region)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });

    let s = store.clone();
    engine.register_fn("get_project_name", move |id: ProjectId| -> Result<String, Box<EvalAltResult>> {
        let store = s.read().unwrap();
        store.get_project(id)
            .map(|p| p.name.clone())
            .ok_or_else(|| structured_err(StructuredError::entity_not_found(EntityType::Project, id)))
    });

    let s = store.clone();
    engine.register_fn("list_project_ids", move || -> Vec<Dynamic> {
        let store = s.read().unwrap();
        store.projects.keys()
            .map(|id| Dynamic::from(*id))
            .collect()
    });
}

// ========== Building Functions ==========

fn register_building_functions(engine: &mut Engine, store: SharedStore) {
    let s = store.clone();
    engine.register_fn("add_building", move |project_id: ProjectId, name: &str| -> Result<BuildingId, Box<EvalAltResult>> {
        let mut store = s.write().unwrap();
        store.add_building(project_id, name)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });

    let s = store.clone();
    engine.register_fn("get_building_name", move |id: BuildingId| -> Result<String, Box<EvalAltResult>> {
        let store = s.read().unwrap();
        store.get_building(id)
            .map(|b| b.name.clone())
            .ok_or_else(|| structured_err(StructuredError::entity_not_found(EntityType::Building, id)))
    });

    let s = store.clone();
    engine.register_fn("get_building_levels", move |id: BuildingId| -> Vec<Dynamic> {
        let store = s.read().unwrap();
        store.get_building_levels(id)
            .iter()
            .map(|l| Dynamic::from(l.id))
            .collect()
    });

    let s = store.clone();
    engine.register_fn("remove_building", move |id: BuildingId| -> Result<(), Box<EvalAltResult>> {
        let mut store = s.write().unwrap();
        store.remove_building(id)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });
}

// ========== Level Functions ==========

fn register_level_functions(engine: &mut Engine, store: SharedStore) {
    let s = store.clone();
    engine.register_fn("add_level", move |building_id: BuildingId, name: &str, elevation: f64, floor_to_floor: f64| -> Result<LevelId, Box<EvalAltResult>> {
        // Validate floor_to_floor height
        if floor_to_floor <= 0.0 {
            return Err(structured_err(StructuredError::parameter_out_of_range(
                "floor_to_floor",
                floor_to_floor,
                Some(0.0),
                None,
            )));
        }

        let mut store = s.write().unwrap();
        store.add_level(building_id, name, elevation, floor_to_floor)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });

    let s = store.clone();
    engine.register_fn("get_level_name", move |id: LevelId| -> Result<String, Box<EvalAltResult>> {
        let store = s.read().unwrap();
        store.get_level(id)
            .map(|l| l.name.clone())
            .ok_or_else(|| structured_err(StructuredError::entity_not_found(EntityType::Level, id)))
    });

    let s = store.clone();
    engine.register_fn("get_level_elevation", move |id: LevelId| -> Result<f64, Box<EvalAltResult>> {
        let store = s.read().unwrap();
        store.get_level(id)
            .map(|l| l.elevation)
            .ok_or_else(|| structured_err(StructuredError::entity_not_found(EntityType::Level, id)))
    });

    let s = store.clone();
    engine.register_fn("get_level_height", move |id: LevelId| -> Result<f64, Box<EvalAltResult>> {
        let store = s.read().unwrap();
        store.get_level(id)
            .map(|l| l.floor_to_floor)
            .ok_or_else(|| structured_err(StructuredError::entity_not_found(EntityType::Level, id)))
    });

    let s = store.clone();
    engine.register_fn("remove_level", move |id: LevelId| -> Result<(), Box<EvalAltResult>> {
        let mut store = s.write().unwrap();
        store.remove_level(id)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });
}

// ========== Footprint Functions ==========

fn register_footprint_functions(engine: &mut Engine, store: SharedStore) {
    // Set footprint from array of tuples: [(x, y), ...]
    let s = store.clone();
    engine.register_fn("set_level_footprint", move |level_id: LevelId, points: rhai::Array| -> Result<FootprintId, Box<EvalAltResult>> {
        let polygon = array_to_polygon(points)?;

        let mut store = s.write().unwrap();
        store.set_level_footprint(level_id, polygon)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });

    // Set footprint from explicit width/depth (rectangle)
    let s = store.clone();
    engine.register_fn("set_level_footprint_rect", move |level_id: LevelId, width: f64, depth: f64| -> Result<FootprintId, Box<EvalAltResult>> {
        if width <= 0.0 {
            return Err(structured_err(StructuredError::parameter_out_of_range(
                "width",
                width,
                Some(0.0),
                None,
            )));
        }
        if depth <= 0.0 {
            return Err(structured_err(StructuredError::parameter_out_of_range(
                "depth",
                depth,
                Some(0.0),
                None,
            )));
        }

        let polygon = Polygon2::rectangle(width, depth);

        let mut store = s.write().unwrap();
        store.set_level_footprint(level_id, polygon)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });

    let s = store.clone();
    engine.register_fn("get_footprint_area", move |level_id: LevelId| -> Result<f64, Box<EvalAltResult>> {
        let store = s.read().unwrap();
        store.get_level_footprint(level_id)
            .map(|f| f.area())
            .ok_or_else(|| structured_err(StructuredError::entity_not_found(EntityType::Footprint, level_id)))
    });

    let s = store.clone();
    engine.register_fn("get_footprint_perimeter", move |level_id: LevelId| -> Result<f64, Box<EvalAltResult>> {
        let store = s.read().unwrap();
        store.get_level_footprint(level_id)
            .map(|f| f.perimeter())
            .ok_or_else(|| structured_err(StructuredError::entity_not_found(EntityType::Footprint, level_id)))
    });

    let s = store.clone();
    engine.register_fn("offset_footprint", move |footprint_id: FootprintId, distance: f64| -> Result<(), Box<EvalAltResult>> {
        let mut store = s.write().unwrap();
        store.offset_footprint(footprint_id, distance)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });
}

// ========== Grid Functions ==========

fn register_grid_functions(engine: &mut Engine, store: SharedStore) {
    let s = store.clone();
    engine.register_fn("create_grid", move |building_id: BuildingId| -> Result<(), Box<EvalAltResult>> {
        let mut store = s.write().unwrap();
        store.create_grid(building_id)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });

    let s = store.clone();
    engine.register_fn("add_grid_axis", move |building_id: BuildingId, name: &str, direction: &str, offset: f64| -> Result<(), Box<EvalAltResult>> {
        let dir = match direction.to_lowercase().as_str() {
            "horizontal" | "h" | "x" => GridDirection::Horizontal,
            "vertical" | "v" | "y" => GridDirection::Vertical,
            _ => return Err(structured_err(StructuredError::unknown_grid_direction(direction))),
        };

        let axis = GridAxis {
            name: name.to_string(),
            direction: dir,
            offset,
        };

        let mut store = s.write().unwrap();
        store.add_grid_axis(building_id, axis)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });
}

// ========== Wall Functions ==========

fn register_wall_functions(engine: &mut Engine, store: SharedStore) {
    let s = store.clone();
    engine.register_fn("create_wall_assembly", move |name: &str| -> Result<WallAssemblyId, Box<EvalAltResult>> {
        let layers = vec![];
        let mut store = s.write().unwrap();
        store.create_wall_assembly(name, layers)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });

    let s = store.clone();
    engine.register_fn("create_wall", move |level_id: LevelId, assembly_id: WallAssemblyId, start: Dynamic, end: Dynamic, height: f64| -> Result<WallId, Box<EvalAltResult>> {
        let start_pt = array_to_point(start)?;
        let end_pt = array_to_point(end)?;

        // Validate height
        if height <= 0.0 {
            return Err(structured_err(StructuredError::parameter_out_of_range(
                "height",
                height,
                Some(0.0),
                None,
            )));
        }

        let mut store = s.write().unwrap();
        store.create_wall(level_id, assembly_id, start_pt, end_pt, height)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });

    let s = store.clone();
    engine.register_fn("get_wall_assembly", move |id: WallId| -> Result<WallAssemblyId, Box<EvalAltResult>> {
        let store = s.read().unwrap();
        store.get_wall(id)
            .map(|w| w.assembly_id)
            .ok_or_else(|| structured_err(StructuredError::entity_not_found(EntityType::Wall, id)))
    });
}

// ========== Room Functions ==========

fn register_room_functions(engine: &mut Engine, store: SharedStore) {
    let s = store.clone();
    engine.register_fn("create_room", move |level_id: LevelId, room_type_str: &str, name: &str, points: rhai::Array| -> Result<RoomId, Box<EvalAltResult>> {
        let polygon = array_to_polygon(points)?;

        // Parse room type - allow custom types but log standard ones
        let room_type = match room_type_str.to_lowercase().as_str() {
            "living" | "livingroom" | "living_room" => RoomType::LivingRoom,
            "kitchen" => RoomType::Kitchen,
            "bedroom" => RoomType::Bedroom,
            "bathroom" | "bath" => RoomType::Bathroom,
            "garage" => RoomType::Garage,
            "utility" | "mechanical" => RoomType::Utility,
            "circulation" | "hallway" | "hall" | "corridor" => RoomType::Hallway,
            other => RoomType::Other(other.to_string()),
        };

        let mut store = s.write().unwrap();
        store.create_room(level_id, room_type, name, polygon)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });
}

// ========== Opening Functions ==========

fn register_opening_functions(engine: &mut Engine, store: SharedStore) {
    let s = store.clone();
    engine.register_fn("add_opening", move |wall_id: WallId, type_str: &str, position: f64, width: f64, height: f64, sill: f64| -> Result<OpeningId, Box<EvalAltResult>> {
        // Parse opening type
        let opening_type = match type_str.to_lowercase().as_str() {
            "window" => OpeningType::Window,
            "door" => OpeningType::Door,
            _ => return Err(structured_err(StructuredError::unknown_opening_type(type_str))),
        };

        // Validate position (0.0 to 1.0)
        if position < 0.0 || position > 1.0 {
            return Err(structured_err(StructuredError::parameter_out_of_range(
                "position",
                position,
                Some(0.0),
                Some(1.0),
            )));
        }

        // Validate width
        if width <= 0.0 {
            return Err(structured_err(StructuredError::parameter_out_of_range(
                "width",
                width,
                Some(0.0),
                None,
            )));
        }

        // Validate height
        if height <= 0.0 {
            return Err(structured_err(StructuredError::parameter_out_of_range(
                "height",
                height,
                Some(0.0),
                None,
            )));
        }

        // Validate sill height
        if sill < 0.0 {
            return Err(structured_err(StructuredError::parameter_out_of_range(
                "sill_height",
                sill,
                Some(0.0),
                None,
            )));
        }

        let mut store = s.write().unwrap();
        store.add_opening(wall_id, opening_type, position, width, height, sill)
            .map_err(|e| structured_err(StructuredError::from(e)))
    });
}

// ========== Query Functions ==========

fn register_query_functions(engine: &mut Engine, store: SharedStore) {
    let s = store.clone();
    engine.register_fn("get_building_stats", move |building_id: BuildingId| -> Result<Map, Box<EvalAltResult>> {
        let store = s.read().unwrap();
        let stats = store.get_building_stats(building_id)
            .ok_or_else(|| structured_err(StructuredError::entity_not_found(EntityType::Building, building_id)))?;

        let mut map = Map::new();
        map.insert("total_area".into(), Dynamic::from(stats.total_area));
        map.insert("level_count".into(), Dynamic::from(stats.level_count as i64));
        Ok(map)
    });

    let s = store.clone();
    engine.register_fn("get_event_count", move |project_id: ProjectId| -> Result<i64, Box<EvalAltResult>> {
        let store = s.read().unwrap();
        store.get_event_log(project_id)
            .map(|l| l.len() as i64)
            .ok_or_else(|| structured_err(StructuredError::entity_not_found(EntityType::Project, project_id)))
    });
}

// ========== Helper Functions ==========

fn parse_code_region(s: &str) -> Result<CodeRegion, Box<EvalAltResult>> {
    // Parse strings like "US_IRC_2021" or "US_IBC_2018"
    let parts: Vec<&str> = s.split('_').collect();
    if parts.len() >= 3 {
        let code = parts[1].to_string();
        let year = parts[2].parse::<u16>()
            .map_err(|_| structured_err(StructuredError::unknown_code_region(s)))?;
        Ok(CodeRegion::new(code, year))
    } else if s.to_lowercase().contains("irc") {
        Ok(CodeRegion::us_irc_2021())
    } else if s.to_lowercase().contains("ibc") {
        Ok(CodeRegion::us_ibc_2021())
    } else {
        Err(structured_err(StructuredError::unknown_code_region(s)))
    }
}

fn extract_number(val: &Dynamic) -> Option<f64> {
    // Try as float first
    if let Ok(f) = val.as_float() {
        return Some(f);
    }
    // Then try as int
    if let Ok(i) = val.as_int() {
        return Some(i as f64);
    }
    None
}



fn array_to_point(val: Dynamic) -> Result<Point2, Box<EvalAltResult>> {
    // Try as array first [x, y]
    if let Some(pair) = val.clone().try_cast::<rhai::Array>() {
        if pair.len() == 2 {
            let x = extract_number(&pair[0])
                .ok_or_else(|| structured_err(StructuredError::invalid_parameter(
                    "x",
                    "Expected number for x coordinate",
                    format!("{:?}", pair[0]),
                    Some("numeric value".to_string()),
                )))?;
            let y = extract_number(&pair[1])
                .ok_or_else(|| structured_err(StructuredError::invalid_parameter(
                    "y",
                    "Expected number for y coordinate",
                    format!("{:?}", pair[1]),
                    Some("numeric value".to_string()),
                )))?;
            return Ok(Point2::new(x, y));
        }
    }

    // Try as map with x/y keys
    if let Some(map) = val.clone().try_cast::<Map>() {
        let x = map.get("x")
            .and_then(|v| extract_number(v))
            .ok_or_else(|| structured_err(StructuredError::invalid_parameter(
                "x",
                "Expected 'x' key with numeric value in point object",
                "missing or non-numeric",
                Some("{x: number, y: number}".to_string()),
            )))?;
        let y = map.get("y")
            .and_then(|v| extract_number(v))
            .ok_or_else(|| structured_err(StructuredError::invalid_parameter(
                "y",
                "Expected 'y' key with numeric value in point object",
                "missing or non-numeric",
                Some("{x: number, y: number}".to_string()),
            )))?;
        return Ok(Point2::new(x, y));
    }

    Err(structured_err(StructuredError::invalid_geometry(
        "Invalid point format",
        vec![
            "Use array format: [x, y]".to_string(),
            "Or object format: {x: number, y: number}".to_string(),
        ],
    )))
}

fn array_to_polygon(arr: rhai::Array) -> Result<Polygon2, Box<EvalAltResult>> {
    let mut points = Vec::with_capacity(arr.len());

    for (idx, item) in arr.iter().enumerate() {
        // Try as array first [x, y]
        if let Some(pair) = item.clone().try_cast::<rhai::Array>() {
            if pair.len() == 2 {
                let x = extract_number(&pair[0])
                    .ok_or_else(|| structured_err(StructuredError::invalid_parameter(
                        format!("points[{}].x", idx),
                        "Expected number for x coordinate",
                        format!("{:?}", pair[0]),
                        Some("numeric value".to_string()),
                    )))?;
                let y = extract_number(&pair[1])
                    .ok_or_else(|| structured_err(StructuredError::invalid_parameter(
                        format!("points[{}].y", idx),
                        "Expected number for y coordinate",
                        format!("{:?}", pair[1]),
                        Some("numeric value".to_string()),
                    )))?;
                points.push(Point2::new(x, y));
                continue;
            }
        }

        // Try as map with x/y keys
        if let Some(map) = item.clone().try_cast::<Map>() {
            let x = map.get("x")
                .and_then(|v| extract_number(v))
                .ok_or_else(|| structured_err(StructuredError::invalid_parameter(
                    format!("points[{}].x", idx),
                    "Expected 'x' key with numeric value",
                    "missing or non-numeric",
                    Some("{x: number, y: number}".to_string()),
                )))?;
            let y = map.get("y")
                .and_then(|v| extract_number(v))
                .ok_or_else(|| structured_err(StructuredError::invalid_parameter(
                    format!("points[{}].y", idx),
                    "Expected 'y' key with numeric value",
                    "missing or non-numeric",
                    Some("{x: number, y: number}".to_string()),
                )))?;
            points.push(Point2::new(x, y));
            continue;
        }

        return Err(structured_err(StructuredError::invalid_geometry(
            format!("Invalid point format at index {}", idx),
            vec![
                "Use array format: [x, y]".to_string(),
                "Or object format: {x: number, y: number}".to_string(),
            ],
        )));
    }

    if points.len() < 3 {
        return Err(structured_err(StructuredError::degenerate_geometry(
            EntityType::Footprint,
            format!("Polygon requires at least 3 points, got {}", points.len()),
        )));
    }

    Ok(Polygon2::new(points))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::new_shared_store;

    #[test]
    fn test_create_project_script() {
        let store = new_shared_store();
        let engine = create_engine(store.clone());

        let script = r#"
            let project = create_project("Test House", "imperial", "US_IRC_2021");
            project
        "#;

        let result = execute_script(&engine, script, store.clone());
        assert!(result.success, "Script failed: {:?}", result.error);
        assert!(result.events_generated > 0);
    }

    #[test]
    fn test_full_building_script() {
        let store = new_shared_store();
        let engine = create_engine(store.clone());

        let script = r#"
            let project = create_project("Scandi House", "imperial", "US_IRC_2021");
            let bldg = add_building(project, "Main");
            let main = add_level(bldg, "Main Floor", 0.0, 9.0);
            let upper = add_level(bldg, "Upper Floor", 9.0, 8.0);

            set_level_footprint_rect(main, 40.0, 30.0);
            set_level_footprint_rect(upper, 40.0, 30.0);

            let stats = get_building_stats(bldg);
            stats.total_area
        "#;

        let result = execute_script(&engine, script, store.clone());
        assert!(result.success, "Script failed: {:?}", result.error);

        if let Some(value) = result.return_value {
            let area = value.as_float().unwrap();
            assert!((area - 2400.0).abs() < 1e-10);
        }
    }

    #[test]
    fn test_polygon_footprint_script() {
        let store = new_shared_store();
        let engine = create_engine(store.clone());

        let script = r#"
            let project = create_project("L-Shape", "imperial", "US_IRC_2021");
            let bldg = add_building(project, "Main");
            let main = add_level(bldg, "Main", 0.0, 9.0);

            // L-shaped footprint
            let footprint = [
                [0.0, 0.0],
                [40.0, 0.0],
                [40.0, 20.0],
                [20.0, 20.0],
                [20.0, 30.0],
                [0.0, 30.0]
            ];
            set_level_footprint(main, footprint);

            get_footprint_area(main)
        "#;

        let result = execute_script(&engine, script, store.clone());
        assert!(result.success, "Script failed: {:?}", result.error);

        // L-shape area: (40*20) + (20*10) = 800 + 200 = 1000
        if let Some(value) = result.return_value {
            let area = value.as_float().unwrap();
            assert!((area - 1000.0).abs() < 1e-10);
        }
    }

    #[test]
    fn test_script_error_handling() {
        let store = new_shared_store();
        let engine = create_engine(store.clone());

        let script = r#"
            // Try to add a building to a non-existent project
            let fake_project = create_project("Test", "imperial", "IRC");
            add_level(fake_project, "Test", 0.0, 9.0)
        "#;

        // This should fail because we're adding a level directly to a project (wrong type)
        let result = execute_script(&engine, script, store.clone());
        assert!(!result.success);
    }

    #[test]
    fn test_max_operations_limit() {
        let store = new_shared_store();
        let engine = create_engine(store.clone());

        // This should hit the operations limit
        let script = r#"
            let x = 0;
            loop {
                x += 1;
            }
        "#;

        let result = execute_script(&engine, script, store.clone());
        assert!(!result.success);
        assert!(result.error.unwrap().contains("operations"));
    }

    #[test]
    fn test_phase2_script() {
        let store = new_shared_store();
        let engine = create_engine(store.clone());

        let script = r#"
            let project = create_project("Phase2 House", "imperial", "IRC");
            let bldg = add_building(project, "Main");
            let level = add_level(bldg, "L1", 0.0, 10.0);
            
            let assembly = create_wall_assembly("Basic Wall");
            
            let p1 = [0.0, 0.0];
            let p2 = [10.0, 0.0];
            let wall = create_wall(level, assembly, p1, p2, 10.0);
            
            add_opening(wall, "window", 0.5, 3.0, 4.0, 2.0);
            
            let room_poly = [[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0]];
            create_room(level, "living", "Living Room", room_poly);
        "#;

        let result = execute_script(&engine, script, store.clone());
        assert!(result.success, "Script failed: {:?}", result.error);
    }
}
