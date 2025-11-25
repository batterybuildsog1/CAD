// Spatial types - wrappers and utilities for Truck geometry types
// We use Truck types directly per architectural decision, but provide
// convenient constructors and serialization support.

use serde::{Deserialize, Serialize};

/// A 2D point, used for footprints and floor plans
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point2 {
    pub x: f64,
    pub y: f64,
}

impl Point2 {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    pub fn origin() -> Self {
        Self { x: 0.0, y: 0.0 }
    }

    pub fn distance_to(&self, other: &Point2) -> f64 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        (dx * dx + dy * dy).sqrt()
    }

    /// Convert to Truck Point2 (uses cgmath via truck_modeling)
    pub fn to_truck(&self) -> truck_modeling::Point2 {
        truck_modeling::Point2::new(self.x, self.y)
    }

    /// Create from Truck Point2
    pub fn from_truck(p: truck_modeling::Point2) -> Self {
        Self { x: p.x, y: p.y }
    }
}

impl From<(f64, f64)> for Point2 {
    fn from((x, y): (f64, f64)) -> Self {
        Self::new(x, y)
    }
}

/// A 3D point, used for positioning objects in space
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Point3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Point3 {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn origin() -> Self {
        Self { x: 0.0, y: 0.0, z: 0.0 }
    }

    pub fn distance_to(&self, other: &Point3) -> f64 {
        let dx = self.x - other.x;
        let dy = self.y - other.y;
        let dz = self.z - other.z;
        (dx * dx + dy * dy + dz * dz).sqrt()
    }

    /// Convert to Truck Point3 (uses cgmath via truck_modeling)
    pub fn to_truck(&self) -> truck_modeling::Point3 {
        truck_modeling::Point3::new(self.x, self.y, self.z)
    }

    /// Create from Truck Point3
    pub fn from_truck(p: truck_modeling::Point3) -> Self {
        Self { x: p.x, y: p.y, z: p.z }
    }
}

impl From<(f64, f64, f64)> for Point3 {
    fn from((x, y, z): (f64, f64, f64)) -> Self {
        Self::new(x, y, z)
    }
}

/// A 3D direction vector (normalized)
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Vector3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl Vector3 {
    pub fn new(x: f64, y: f64, z: f64) -> Self {
        Self { x, y, z }
    }

    pub fn up() -> Self {
        Self { x: 0.0, y: 0.0, z: 1.0 }
    }

    pub fn down() -> Self {
        Self { x: 0.0, y: 0.0, z: -1.0 }
    }

    pub fn normalize(&self) -> Self {
        let len = (self.x * self.x + self.y * self.y + self.z * self.z).sqrt();
        if len > 1e-10 {
            Self {
                x: self.x / len,
                y: self.y / len,
                z: self.z / len,
            }
        } else {
            *self
        }
    }

    pub fn to_truck(&self) -> truck_modeling::Vector3 {
        truck_modeling::Vector3::new(self.x, self.y, self.z)
    }

    pub fn from_truck(v: truck_modeling::Vector3) -> Self {
        Self { x: v.x, y: v.y, z: v.z }
    }
}

/// A 2D polygon (closed, potentially with holes)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Polygon2 {
    /// Outer boundary (counterclockwise winding)
    pub outer: Vec<Point2>,
    /// Inner holes (clockwise winding)
    pub holes: Vec<Vec<Point2>>,
}

impl Polygon2 {
    pub fn new(outer: Vec<Point2>) -> Self {
        Self {
            outer,
            holes: Vec::new(),
        }
    }

    pub fn with_holes(outer: Vec<Point2>, holes: Vec<Vec<Point2>>) -> Self {
        Self { outer, holes }
    }

    /// Create a simple rectangle
    pub fn rectangle(width: f64, depth: f64) -> Self {
        Self::new(vec![
            Point2::new(0.0, 0.0),
            Point2::new(width, 0.0),
            Point2::new(width, depth),
            Point2::new(0.0, depth),
        ])
    }

    /// Calculate the signed area (positive if counterclockwise)
    pub fn signed_area(&self) -> f64 {
        if self.outer.len() < 3 {
            return 0.0;
        }

        let mut area = 0.0;
        let n = self.outer.len();
        for i in 0..n {
            let j = (i + 1) % n;
            area += self.outer[i].x * self.outer[j].y;
            area -= self.outer[j].x * self.outer[i].y;
        }
        area / 2.0
    }

    /// Get absolute area (subtracting holes)
    pub fn area(&self) -> f64 {
        let outer_area = self.signed_area().abs();
        let hole_area: f64 = self.holes.iter()
            .map(|hole| {
                let poly = Polygon2::new(hole.clone());
                poly.signed_area().abs()
            })
            .sum();
        outer_area - hole_area
    }

    /// Check if the polygon is valid (closed, non-self-intersecting)
    pub fn is_valid(&self) -> bool {
        // Minimum 3 vertices for a polygon
        if self.outer.len() < 3 {
            return false;
        }

        // Check for duplicate consecutive points
        for i in 0..self.outer.len() {
            let j = (i + 1) % self.outer.len();
            if self.outer[i].distance_to(&self.outer[j]) < 1e-10 {
                return false;
            }
        }

        // Basic self-intersection check (O(n^2) - can optimize later)
        // For now, just check that area is non-zero
        self.signed_area().abs() > 1e-10
    }

    /// Calculate centroid
    pub fn centroid(&self) -> Point2 {
        if self.outer.is_empty() {
            return Point2::origin();
        }

        let n = self.outer.len() as f64;
        let sum_x: f64 = self.outer.iter().map(|p| p.x).sum();
        let sum_y: f64 = self.outer.iter().map(|p| p.y).sum();

        Point2::new(sum_x / n, sum_y / n)
    }

    /// Get perimeter length
    pub fn perimeter(&self) -> f64 {
        if self.outer.len() < 2 {
            return 0.0;
        }

        let mut perimeter = 0.0;
        let n = self.outer.len();
        for i in 0..n {
            let j = (i + 1) % n;
            perimeter += self.outer[i].distance_to(&self.outer[j]);
        }
        perimeter
    }

    /// Offset the polygon by a distance (positive = expand, negative = shrink)
    /// TODO: Implement robust offset algorithm (e.g. straight skeleton)
    pub fn offset(&self, _distance: f64) -> Self {
        // Placeholder: return clone for now
        self.clone()
    }

    /// Split the polygon by a line defined by two points
    /// Returns a tuple of (left_polygon, right_polygon)
    /// TODO: Implement robust polygon splitting
    pub fn split(&self, _p1: Point2, _p2: Point2) -> Option<(Self, Self)> {
        // Placeholder: return None to indicate split failed/not implemented
        None
    }
}

/// A 3D polyline (sequence of connected points)
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Polyline3 {
    pub points: Vec<Point3>,
}

impl Polyline3 {
    pub fn new(points: Vec<Point3>) -> Self {
        Self { points }
    }

    pub fn length(&self) -> f64 {
        if self.points.len() < 2 {
            return 0.0;
        }

        let mut len = 0.0;
        for i in 0..self.points.len() - 1 {
            len += self.points[i].distance_to(&self.points[i + 1]);
        }
        len
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rectangle_area() {
        let rect = Polygon2::rectangle(10.0, 20.0);
        assert!((rect.area() - 200.0).abs() < 1e-10);
    }

    #[test]
    fn test_polygon_perimeter() {
        let rect = Polygon2::rectangle(10.0, 20.0);
        assert!((rect.perimeter() - 60.0).abs() < 1e-10);
    }

    #[test]
    fn test_polygon_centroid() {
        let rect = Polygon2::rectangle(10.0, 20.0);
        let centroid = rect.centroid();
        assert!((centroid.x - 5.0).abs() < 1e-10);
        assert!((centroid.y - 10.0).abs() < 1e-10);
    }

    #[test]
    fn test_polygon_valid() {
        let rect = Polygon2::rectangle(10.0, 20.0);
        assert!(rect.is_valid());

        let degenerate = Polygon2::new(vec![Point2::new(0.0, 0.0), Point2::new(1.0, 0.0)]);
        assert!(!degenerate.is_valid());
    }
}
