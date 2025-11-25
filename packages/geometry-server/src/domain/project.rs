// Core domain types: Project, Site, Building, Level, Footprint
// These form the foundation for all higher-level systems (structural, MEP)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::ids::*;
use super::spatial::{Point2, Point3, Polygon2};

/// Unit system for the project
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UnitSystem {
    Imperial,
    Metric,
}

impl Default for UnitSystem {
    fn default() -> Self {
        Self::Imperial
    }
}

/// Building code region for compliance checks
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CodeRegion {
    pub code: String,      // e.g., "IRC", "IBC"
    pub year: u16,         // e.g., 2021
    pub jurisdiction: Option<String>, // e.g., "California"
}

impl CodeRegion {
    pub fn new(code: impl Into<String>, year: u16) -> Self {
        Self {
            code: code.into(),
            year,
            jurisdiction: None,
        }
    }

    pub fn us_irc_2021() -> Self {
        Self::new("IRC", 2021)
    }

    pub fn us_ibc_2021() -> Self {
        Self::new("IBC", 2021)
    }
}

impl Default for CodeRegion {
    fn default() -> Self {
        Self::us_irc_2021()
    }
}

/// Top-level project container
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    pub units: UnitSystem,
    pub code_region: CodeRegion,
    pub site_id: Option<SiteId>,
    pub building_ids: Vec<BuildingId>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub modified_at: chrono::DateTime<chrono::Utc>,
}

impl Project {
    pub fn new(name: impl Into<String>, units: UnitSystem, code_region: CodeRegion) -> Self {
        let now = chrono::Utc::now();
        Self {
            id: ProjectId::new(),
            name: name.into(),
            units,
            code_region,
            site_id: None,
            building_ids: Vec::new(),
            created_at: now,
            modified_at: now,
        }
    }

    pub fn touch(&mut self) {
        self.modified_at = chrono::Utc::now();
    }
}

/// Site information (lot boundary, setbacks, orientation)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Site {
    pub id: SiteId,
    pub project_id: ProjectId,
    pub boundary: Option<Polygon2>,
    pub setbacks: Setbacks,
    pub north_angle: f64, // degrees from Y-axis, clockwise
    pub elevation: f64,   // ground elevation at reference point
}

impl Site {
    pub fn new(project_id: ProjectId) -> Self {
        Self {
            id: SiteId::new(),
            project_id,
            boundary: None,
            setbacks: Setbacks::default(),
            north_angle: 0.0,
            elevation: 0.0,
        }
    }
}

/// Setback distances from property lines
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Setbacks {
    pub front: f64,
    pub back: f64,
    pub left: f64,
    pub right: f64,
}

impl Default for Setbacks {
    fn default() -> Self {
        // Typical residential setbacks in feet
        Self {
            front: 25.0,
            back: 15.0,
            left: 5.0,
            right: 5.0,
        }
    }
}

/// A building within the project
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Building {
    pub id: BuildingId,
    pub project_id: ProjectId,
    pub name: String,
    pub origin: Point3,     // building origin relative to site
    pub level_ids: Vec<LevelId>,
}

impl Building {
    pub fn new(project_id: ProjectId, name: impl Into<String>) -> Self {
        Self {
            id: BuildingId::new(),
            project_id,
            name: name.into(),
            origin: Point3::origin(),
            level_ids: Vec::new(),
        }
    }

    pub fn with_origin(mut self, origin: Point3) -> Self {
        self.origin = origin;
        self
    }
}

/// A horizontal level (floor) in a building
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Level {
    pub id: LevelId,
    pub building_id: BuildingId,
    pub name: String,
    pub elevation: f64,      // Z height of floor surface
    pub floor_to_floor: f64, // height to next level (or to ceiling if top)
    pub footprint_id: Option<FootprintId>,
    pub is_basement: bool,
    pub wall_ids: Vec<WallId>,
    pub room_ids: Vec<RoomId>,
}

impl Level {
    pub fn new(
        building_id: BuildingId,
        name: impl Into<String>,
        elevation: f64,
        floor_to_floor: f64,
    ) -> Self {
        Self {
            id: LevelId::new(),
            building_id,
            name: name.into(),
            elevation,
            floor_to_floor,
            footprint_id: None,
            is_basement: elevation < 0.0,
            wall_ids: Vec::new(),
            room_ids: Vec::new(),
        }
    }

    /// Get the ceiling elevation for this level
    pub fn ceiling_elevation(&self) -> f64 {
        self.elevation + self.floor_to_floor
    }
}

/// A 2D footprint polygon for a level
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Footprint {
    pub id: FootprintId,
    pub level_id: LevelId,
    pub polygon: Polygon2,
    pub solid_id: Option<SolidId>, // cached massing solid
}

impl Footprint {
    pub fn new(level_id: LevelId, polygon: Polygon2) -> Self {
        Self {
            id: FootprintId::new(),
            level_id,
            polygon,
            solid_id: None,
        }
    }

    pub fn area(&self) -> f64 {
        self.polygon.area()
    }

    pub fn perimeter(&self) -> f64 {
        self.polygon.perimeter()
    }

    pub fn is_valid(&self) -> bool {
        self.polygon.is_valid()
    }
}

/// Grid system for alignment and snapping
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grid {
    pub building_id: BuildingId,
    pub axes: Vec<GridAxis>,
}

impl Grid {
    pub fn new(building_id: BuildingId) -> Self {
        Self {
            building_id,
            axes: Vec::new(),
        }
    }
}

/// A single grid axis (line)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GridAxis {
    pub name: String,
    pub direction: GridDirection,
    pub offset: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum GridDirection {
    Horizontal, // parallel to X-axis
    Vertical,   // parallel to Y-axis
}

/// Aggregated statistics for a building
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildingStats {
    pub total_area: f64,
    pub level_count: usize,
    pub footprint_areas: HashMap<LevelId, f64>,
}

impl BuildingStats {
    pub fn compute(building: &Building, levels: &[&Level], footprints: &[&Footprint]) -> Self {
        let mut footprint_areas = HashMap::new();
        let mut total_area = 0.0;

        for level in levels {
            if let Some(fp) = footprints.iter().find(|f| f.level_id == level.id) {
                let area = fp.area();
                footprint_areas.insert(level.id, area);
                total_area += area;
            }
        }

        Self {
            total_area,
            level_count: levels.len(),
            footprint_areas,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_creation() {
        let project = Project::new("Test House", UnitSystem::Imperial, CodeRegion::us_irc_2021());
        assert_eq!(project.name, "Test House");
        assert_eq!(project.units, UnitSystem::Imperial);
    }

    #[test]
    fn test_level_ceiling_elevation() {
        let building_id = BuildingId::new();
        let level = Level::new(building_id, "Main", 0.0, 9.0);
        assert!((level.ceiling_elevation() - 9.0).abs() < 1e-10);
    }

    #[test]
    fn test_footprint_area() {
        let level_id = LevelId::new();
        let polygon = Polygon2::rectangle(40.0, 30.0);
        let footprint = Footprint::new(level_id, polygon);
        assert!((footprint.area() - 1200.0).abs() < 1e-10);
    }
}
