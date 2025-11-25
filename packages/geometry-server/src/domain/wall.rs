// Wall structures - assemblies and individual wall elements
// Walls are defined by centerline with layers offset from center

use serde::{Deserialize, Serialize};
use super::ids::*;
use super::spatial::Point2;

/// A single layer within a wall assembly (e.g., drywall, insulation, sheathing)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallLayer {
    pub material: String,
    pub thickness: f64,      // in current units
    pub is_structural: bool,
}

impl WallLayer {
    pub fn new(material: impl Into<String>, thickness: f64, is_structural: bool) -> Self {
        Self {
            material: material.into(),
            thickness,
            is_structural,
        }
    }

    /// Common layer presets (thicknesses in inches for Imperial)
    pub fn gypsum_5_8() -> Self {
        Self::new("Gypsum Board 5/8\"", 0.625, false)
    }

    pub fn osb_7_16() -> Self {
        Self::new("OSB 7/16\"", 0.4375, true)
    }

    pub fn fiberglass_r19() -> Self {
        Self::new("Fiberglass Insulation R19", 6.25, false)
    }

    pub fn stud_2x6() -> Self {
        Self::new("2x6 Wood Stud", 5.5, true)
    }
}

/// A wall assembly defining the complete layer stack
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallAssembly {
    pub id: WallAssemblyId,
    pub name: String,
    pub layers: Vec<WallLayer>,
    pub total_thickness: f64,
}

impl WallAssembly {
    pub fn new(name: impl Into<String>, layers: Vec<WallLayer>) -> Self {
        let total_thickness = layers.iter().map(|l| l.thickness).sum();
        Self {
            id: WallAssemblyId::new(),
            name: name.into(),
            layers,
            total_thickness,
        }
    }

    /// Standard 2x6 exterior wall assembly (Imperial)
    pub fn exterior_2x6() -> Self {
        Self::new(
            "Exterior 2x6 Wall",
            vec![
                WallLayer::gypsum_5_8(),
                WallLayer::stud_2x6(),
                WallLayer::fiberglass_r19(),
                WallLayer::osb_7_16(),
            ],
        )
    }

    /// Standard interior partition (Imperial)
    pub fn interior_partition() -> Self {
        Self::new(
            "Interior Partition",
            vec![
                WallLayer::gypsum_5_8(),
                WallLayer::new("2x4 Wood Stud", 3.5, true),
                WallLayer::gypsum_5_8(),
            ],
        )
    }

    /// Calculate R-value if layers have thermal properties (stub for future)
    pub fn r_value(&self) -> f64 {
        // Placeholder - would sum R-values of layers
        0.0
    }

    /// Get structural depth (thickness of structural layers)
    pub fn structural_depth(&self) -> f64 {
        self.layers
            .iter()
            .filter(|l| l.is_structural)
            .map(|l| l.thickness)
            .max_by(|a, b| a.partial_cmp(b).unwrap())
            .unwrap_or(0.0)
    }
}

/// An individual wall instance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wall {
    pub id: WallId,
    pub assembly_id: WallAssemblyId,
    pub level_id: LevelId,
    pub start: Point2,  // centerline start point
    pub end: Point2,    // centerline end point
    pub height: f64,    // usually matches floor_to_floor
    pub base_offset: f64, // offset from level elevation
}

impl Wall {
    pub fn new(
        assembly_id: WallAssemblyId,
        level_id: LevelId,
        start: Point2,
        end: Point2,
        height: f64,
    ) -> Self {
        Self {
            id: WallId::new(),
            assembly_id,
            level_id,
            start,
            end,
            height,
            base_offset: 0.0,
        }
    }

    pub fn with_base_offset(mut self, offset: f64) -> Self {
        self.base_offset = offset;
        self
    }

    /// Get the wall length (horizontal distance)
    pub fn length(&self) -> f64 {
        self.start.distance_to(&self.end)
    }

    /// Get the centerline direction vector (normalized)
    pub fn direction(&self) -> (f64, f64) {
        let dx = self.end.x - self.start.x;
        let dy = self.end.y - self.start.y;
        let len = self.length();
        if len > 1e-10 {
            (dx / len, dy / len)
        } else {
            (0.0, 0.0)
        }
    }

    /// Get perpendicular direction (to the left when looking from start to end)
    pub fn perpendicular(&self) -> (f64, f64) {
        let (dx, dy) = self.direction();
        (-dy, dx)
    }

    /// Calculate wall area (length * height)
    pub fn area(&self) -> f64 {
        self.length() * self.height
    }

    /// Get the centerline midpoint
    pub fn midpoint(&self) -> Point2 {
        Point2::new(
            (self.start.x + self.end.x) / 2.0,
            (self.start.y + self.end.y) / 2.0,
        )
    }

    /// Check if this wall shares an endpoint with another wall
    pub fn connects_to(&self, other: &Wall, tolerance: f64) -> bool {
        self.start.distance_to(&other.start) < tolerance
            || self.start.distance_to(&other.end) < tolerance
            || self.end.distance_to(&other.start) < tolerance
            || self.end.distance_to(&other.end) < tolerance
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wall_assembly_thickness() {
        let assembly = WallAssembly::exterior_2x6();
        assert!(assembly.total_thickness > 6.0);
        assert!(assembly.layers.len() == 4);
    }

    #[test]
    fn test_wall_length() {
        let wall = Wall::new(
            WallAssemblyId::new(),
            LevelId::new(),
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            9.0,
        );
        assert!((wall.length() - 10.0).abs() < 1e-10);
    }

    #[test]
    fn test_wall_area() {
        let wall = Wall::new(
            WallAssemblyId::new(),
            LevelId::new(),
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            9.0,
        );
        assert!((wall.area() - 90.0).abs() < 1e-10);
    }

    #[test]
    fn test_wall_direction() {
        let wall = Wall::new(
            WallAssemblyId::new(),
            LevelId::new(),
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            9.0,
        );
        let (dx, dy) = wall.direction();
        assert!((dx - 1.0).abs() < 1e-10);
        assert!(dy.abs() < 1e-10);
    }

    #[test]
    fn test_wall_perpendicular() {
        let wall = Wall::new(
            WallAssemblyId::new(),
            LevelId::new(),
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            9.0,
        );
        let (px, py) = wall.perpendicular();
        assert!(px.abs() < 1e-10);
        assert!((py - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_wall_connection() {
        let wall1 = Wall::new(
            WallAssemblyId::new(),
            LevelId::new(),
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            9.0,
        );
        let wall2 = Wall::new(
            WallAssemblyId::new(),
            LevelId::new(),
            Point2::new(10.0, 0.0),
            Point2::new(10.0, 10.0),
            9.0,
        );
        assert!(wall1.connects_to(&wall2, 0.001));
    }
}
