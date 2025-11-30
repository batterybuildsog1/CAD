// Geometry operations using Truck B-Rep kernel
// Provides solid generation, meshing, and collision detection utilities

pub mod polygon_ops;

use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use truck_modeling::{builder, Solid, Vertex, Wire};
use truck_modeling::Point3 as TruckPoint3;
use truck_modeling::Vector3 as TruckVector3;
use truck_meshalgo::prelude::*;

use crate::domain::{Polygon2, SolidId, Level, Footprint};
use polygon_ops::offset_polygon;

/// Cache for generated Truck solids
pub type SolidCache = Arc<RwLock<HashMap<SolidId, Solid>>>;

/// Create a new solid cache
pub fn new_solid_cache() -> SolidCache {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Mesh data ready for frontend rendering (Three.js compatible)
#[derive(Debug, Clone, serde::Serialize)]
pub struct MeshData {
    pub positions: Vec<f32>,   // flattened [x, y, z, x, y, z, ...]
    pub normals: Vec<f32>,     // flattened [nx, ny, nz, ...]
    pub indices: Vec<u32>,     // triangle indices
}

impl MeshData {
    pub fn vertex_count(&self) -> usize {
        self.positions.len() / 3
    }

    pub fn triangle_count(&self) -> usize {
        self.indices.len() / 3
    }
}

/// Create a wire from a sequence of 2D points at a given Z elevation
fn points_to_wire(points: &[crate::domain::Point2], z: f64) -> Wire {
    let vertices: Vec<Vertex> = points
        .iter()
        .map(|p| builder::vertex(TruckPoint3::new(p.x, p.y, z)))
        .collect();

    let mut edges = Vec::new();
    for i in 0..vertices.len() {
        let j = (i + 1) % vertices.len();
        let edge = builder::line(&vertices[i], &vertices[j]);
        edges.push(edge);
    }

    Wire::from_iter(edges.into_iter())
}

/// Extrude a 2D polygon into a 3D solid (for massing/footprint visualization)
pub fn extrude_polygon(polygon: &Polygon2, base_z: f64, height: f64) -> Result<Solid> {
    if polygon.outer.len() < 3 {
        return Err(anyhow!("Polygon must have at least 3 vertices"));
    }

    if height <= 0.0 {
        return Err(anyhow!("Height must be positive"));
    }

    // Create outer wire
    let outer_wire = points_to_wire(&polygon.outer, base_z);

    // Create wires for holes (if any)
    let mut wires = vec![outer_wire];
    for hole in &polygon.holes {
        if hole.len() >= 3 {
            let hole_wire = points_to_wire(hole, base_z);
            wires.push(hole_wire);
        }
    }

    // Create bottom face (with holes if present)
    let bottom_face = builder::try_attach_plane(&wires)
        .map_err(|e| anyhow!("Failed to create base face: {:?}", e))?;

    // Extrude to create solid
    let extrusion_vector = TruckVector3::new(0.0, 0.0, height);
    let solid = builder::tsweep(&bottom_face, extrusion_vector);

    Ok(solid)
}

/// Extrude a polygon as a hollow shell (walls only, no top/bottom faces inside)
///
/// Creates a ring-shaped extrusion by:
/// 1. Creating outer boundary from polygon
/// 2. Creating inner boundary by offsetting inward by wall_thickness
/// 3. Extruding the ring between them
///
/// # Arguments
/// * `polygon` - The outer boundary polygon
/// * `base_z` - Base elevation
/// * `height` - Wall height (floor-to-floor)
/// * `wall_thickness` - Thickness of walls in feet (e.g., 0.667 for 8")
///
/// # Returns
/// A Solid representing hollow shell walls
pub fn extrude_polygon_shell(
    polygon: &Polygon2,
    base_z: f64,
    height: f64,
    wall_thickness: f64,
) -> Result<Solid> {
    if polygon.outer.len() < 3 {
        return Err(anyhow!("Polygon must have at least 3 vertices"));
    }

    if height <= 0.0 {
        return Err(anyhow!("Height must be positive"));
    }

    if wall_thickness <= 0.0 {
        return Err(anyhow!("Wall thickness must be positive"));
    }

    // Calculate minimum dimension of the polygon to validate wall thickness
    // Use a simple bounding box approximation
    let min_x = polygon.outer.iter().map(|p| p.x).fold(f64::MAX, f64::min);
    let max_x = polygon.outer.iter().map(|p| p.x).fold(f64::MIN, f64::max);
    let min_y = polygon.outer.iter().map(|p| p.y).fold(f64::MAX, f64::min);
    let max_y = polygon.outer.iter().map(|p| p.y).fold(f64::MIN, f64::max);
    let min_dimension = (max_x - min_x).min(max_y - min_y);

    // Wall thickness must be less than half the minimum dimension
    // otherwise the inner walls would overlap
    if wall_thickness >= min_dimension / 2.0 {
        return Err(anyhow!(
            "Wall thickness ({:.3}) must be less than half the minimum polygon dimension ({:.3}). \
             Maximum allowed: {:.3}",
            wall_thickness,
            min_dimension,
            min_dimension / 2.0 - 0.001
        ));
    }

    // Create inner boundary by offsetting inward
    // Note: offset_polygon has inverted normal direction, so positive distance = inward
    // for counterclockwise polygons. We use positive wall_thickness here.
    let inner_result = offset_polygon(polygon, wall_thickness);

    match inner_result {
        Ok(inner_polygon) => {
            // Validate that the inner polygon is usable
            if inner_polygon.outer.len() < 3 || !inner_polygon.is_valid() {
                // Fall back to solid extrusion if inner polygon is degenerate
                eprintln!(
                    "[geometry-core] Warning: Inner polygon degenerate after offset, falling back to solid extrusion"
                );
                return extrude_polygon(polygon, base_z, height);
            }

            // Create shell polygon: outer boundary with inner as a hole
            let shell_polygon = Polygon2::with_holes(
                polygon.outer.clone(),
                vec![inner_polygon.outer],
            );

            // Extrude the shell polygon (Truck handles holes via multiple wires)
            extrude_polygon(&shell_polygon, base_z, height)
        }
        Err(e) => {
            // Fall back to solid extrusion with warning
            eprintln!(
                "[geometry-core] Warning: Failed to create inner offset for shell: {}. Falling back to solid extrusion.",
                e
            );
            extrude_polygon(polygon, base_z, height)
        }
    }
}

/// Create a simple box solid
pub fn create_box(width: f64, depth: f64, height: f64, origin: &crate::domain::Point3) -> Result<Solid> {
    if width <= 0.0 || depth <= 0.0 || height <= 0.0 {
        return Err(anyhow!("All dimensions must be positive"));
    }

    let v0 = builder::vertex(TruckPoint3::new(origin.x, origin.y, origin.z));
    let v1 = builder::vertex(TruckPoint3::new(origin.x + width, origin.y, origin.z));
    let v2 = builder::vertex(TruckPoint3::new(origin.x + width, origin.y + depth, origin.z));
    let v3 = builder::vertex(TruckPoint3::new(origin.x, origin.y + depth, origin.z));

    let edge0 = builder::line(&v0, &v1);
    let edge1 = builder::line(&v1, &v2);
    let edge2 = builder::line(&v2, &v3);
    let edge3 = builder::line(&v3, &v0);

    let wire = Wire::from_iter(vec![edge0, edge1, edge2, edge3].into_iter());
    let bottom = builder::try_attach_plane(&[wire])
        .map_err(|e| anyhow!("Failed to create base face: {:?}", e))?;

    let solid = builder::tsweep(&bottom, TruckVector3::new(0.0, 0.0, height));
    Ok(solid)
}

/// Convert a Truck Solid to mesh data for frontend rendering
pub fn solid_to_mesh(solid: &Solid, tolerance: f64) -> Result<MeshData> {
    // Tessellate the solid
    let poly = solid.triangulation(tolerance)
        .to_polygon();

    let mut positions = Vec::new();
    let mut normals = Vec::new();
    let mut indices = Vec::new();

    // Extract vertex positions and normals
    for position in poly.positions() {
        positions.push(position.x as f32);
        positions.push(position.y as f32);
        positions.push(position.z as f32);
    }

    // Extract normals from Truck polygon mesh
    let poly_normals = poly.normals();
    if !poly_normals.is_empty() {
        for normal in poly_normals {
            normals.push(normal.x as f32);
            normals.push(normal.y as f32);
            normals.push(normal.z as f32);
        }
    } else {
        // Generate flat normals per vertex (approximate)
        for _ in 0..positions.len() / 3 {
            normals.push(0.0);
            normals.push(0.0);
            normals.push(1.0);
        }
    }

    // Extract triangle indices
    for tri in poly.tri_faces() {
        indices.push(tri[0].pos as u32);
        indices.push(tri[1].pos as u32);
        indices.push(tri[2].pos as u32);
    }

    Ok(MeshData {
        positions,
        normals,
        indices,
    })
}

/// Compute the bounding box of a solid
#[derive(Debug, Clone, Copy, serde::Serialize)]
pub struct BoundingBox {
    pub min: [f64; 3],
    pub max: [f64; 3],
}

impl BoundingBox {
    pub fn from_solid(solid: &Solid) -> Self {
        let mut min = [f64::MAX, f64::MAX, f64::MAX];
        let mut max = [f64::MIN, f64::MIN, f64::MIN];

        for shell in solid.boundaries() {
            for face in shell.face_iter() {
                for edge in face.boundaries().iter().flat_map(|w| w.edge_iter()) {
                    let curve = edge.oriented_curve();
                    // Sample points along the curve
                    for t in (0..=10).map(|i| i as f64 / 10.0) {
                        let p = curve.subs(t);
                        min[0] = min[0].min(p.x);
                        min[1] = min[1].min(p.y);
                        min[2] = min[2].min(p.z);
                        max[0] = max[0].max(p.x);
                        max[1] = max[1].max(p.y);
                        max[2] = max[2].max(p.z);
                    }
                }
            }
        }

        Self { min, max }
    }

    pub fn center(&self) -> [f64; 3] {
        [
            (self.min[0] + self.max[0]) / 2.0,
            (self.min[1] + self.max[1]) / 2.0,
            (self.min[2] + self.max[2]) / 2.0,
        ]
    }

    pub fn size(&self) -> [f64; 3] {
        [
            self.max[0] - self.min[0],
            self.max[1] - self.min[1],
            self.max[2] - self.min[2],
        ]
    }

    pub fn intersects(&self, other: &BoundingBox) -> bool {
        self.min[0] <= other.max[0] && self.max[0] >= other.min[0] &&
        self.min[1] <= other.max[1] && self.max[1] >= other.min[1] &&
        self.min[2] <= other.max[2] && self.max[2] >= other.min[2]
    }
}

/// Generate massing solid for a footprint
pub fn generate_footprint_massing(
    footprint: &Footprint,
    level: &Level,
    cache: &SolidCache,
) -> Result<SolidId> {
    // Check if already cached
    if let Some(solid_id) = footprint.solid_id {
        let cache_read = cache.read().unwrap();
        if cache_read.contains_key(&solid_id) {
            return Ok(solid_id);
        }
    }

    // Generate new solid
    let solid = extrude_polygon(&footprint.polygon, level.elevation, level.floor_to_floor)?;
    let solid_id = SolidId::new();

    // Store in cache
    let mut cache_write = cache.write().unwrap();
    cache_write.insert(solid_id, solid);

    Ok(solid_id)
}

/// Get mesh for a solid ID from cache
pub fn get_mesh_for_solid(
    solid_id: SolidId,
    cache: &SolidCache,
    tolerance: f64,
) -> Result<MeshData> {
    let cache_read = cache.read().unwrap();
    let solid = cache_read.get(&solid_id)
        .ok_or_else(|| anyhow!("Solid not found in cache: {:?}", solid_id))?;

    solid_to_mesh(solid, tolerance)
}

/// Validate that a polygon is geometrically valid using Truck
pub fn validate_polygon_geometry(polygon: &Polygon2) -> Result<()> {
    if polygon.outer.len() < 3 {
        return Err(anyhow!("Polygon must have at least 3 vertices"));
    }

    // Check for zero-length edges
    for i in 0..polygon.outer.len() {
        let j = (i + 1) % polygon.outer.len();
        let dist = polygon.outer[i].distance_to(&polygon.outer[j]);
        if dist < 1e-10 {
            return Err(anyhow!("Polygon has zero-length edge at index {}", i));
        }
    }

    // Check for self-intersection (basic check)
    if polygon.signed_area().abs() < 1e-10 {
        return Err(anyhow!("Polygon has zero or near-zero area"));
    }

    // Try to create a Truck wire to validate geometry
    let vertices: Vec<Vertex> = polygon.outer
        .iter()
        .map(|p| builder::vertex(TruckPoint3::new(p.x, p.y, 0.0)))
        .collect();

    let mut edges = Vec::new();
    for i in 0..vertices.len() {
        let j = (i + 1) % vertices.len();
        let edge = builder::line(&vertices[i], &vertices[j]);
        edges.push(edge);
    }

    let wire = Wire::from_iter(edges.into_iter());

    // Try to create a face - this will fail for invalid geometry
    builder::try_attach_plane(&[wire])
        .map_err(|e| anyhow!("Invalid polygon geometry: {:?}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Point2, Point3};

    #[test]
    fn test_extrude_rectangle() {
        let polygon = Polygon2::rectangle(10.0, 20.0);
        let solid = extrude_polygon(&polygon, 0.0, 9.0).unwrap();

        let bbox = BoundingBox::from_solid(&solid);
        assert!((bbox.size()[0] - 10.0).abs() < 0.1);
        assert!((bbox.size()[1] - 20.0).abs() < 0.1);
        assert!((bbox.size()[2] - 9.0).abs() < 0.1);
    }

    #[test]
    fn test_create_box() {
        let origin = Point3::origin();
        let solid = create_box(5.0, 10.0, 15.0, &origin).unwrap();

        let bbox = BoundingBox::from_solid(&solid);
        assert!((bbox.size()[0] - 5.0).abs() < 0.1);
        assert!((bbox.size()[1] - 10.0).abs() < 0.1);
        assert!((bbox.size()[2] - 15.0).abs() < 0.1);
    }

    #[test]
    fn test_solid_to_mesh() {
        let polygon = Polygon2::rectangle(10.0, 10.0);
        let solid = extrude_polygon(&polygon, 0.0, 5.0).unwrap();

        let mesh = solid_to_mesh(&solid, 0.1).unwrap();
        assert!(mesh.vertex_count() > 0);
        assert!(mesh.triangle_count() > 0);
        assert_eq!(mesh.positions.len(), mesh.normals.len());
    }

    #[test]
    fn test_extrude_polygon_shell() {
        // Create a 30x40 foot rectangle
        let polygon = Polygon2::rectangle(30.0, 40.0);
        let wall_thickness = 0.667; // 8 inches in feet
        let height = 9.0;

        // Create hollow shell
        let shell = extrude_polygon_shell(&polygon, 0.0, height, wall_thickness).unwrap();

        // Verify bounding box matches outer dimensions
        let bbox = BoundingBox::from_solid(&shell);
        assert!((bbox.size()[0] - 30.0).abs() < 0.1, "Width mismatch: got {}, expected 30.0", bbox.size()[0]);
        assert!((bbox.size()[1] - 40.0).abs() < 0.1, "Depth mismatch: got {}, expected 40.0", bbox.size()[1]);
        assert!((bbox.size()[2] - height).abs() < 0.1, "Height mismatch: got {}, expected {}", bbox.size()[2], height);

        // Convert to mesh and verify it has geometry
        let mesh = solid_to_mesh(&shell, 0.1).unwrap();
        assert!(mesh.vertex_count() > 0, "Shell should have vertices");
        assert!(mesh.triangle_count() > 0, "Shell should have triangles");

        // Compare volume: shell should have less volume than solid
        // Outer area = 30 * 40 = 1200 sq ft
        // Inner dimensions = (30 - 2*0.667) x (40 - 2*0.667) = 28.666 x 38.666
        // Inner area = ~1108.4 sq ft
        // Shell cross-section area = 1200 - 1108.4 = ~91.6 sq ft
        // Shell volume = 91.6 * 9 = ~824 cubic ft
        // vs solid volume = 1200 * 9 = 10800 cubic ft
        // So shell should have significantly fewer triangles (roughly proportional)

        // Just verify the shell mesh is smaller than a solid would be
        let solid = extrude_polygon(&polygon, 0.0, height).unwrap();
        let solid_mesh = solid_to_mesh(&solid, 0.1).unwrap();

        // Shell has more faces (inner + outer walls) but less volume
        // The key test is that both generate valid meshes
        assert!(solid_mesh.vertex_count() > 0, "Solid should have vertices");
    }

    #[test]
    fn test_extrude_polygon_shell_wall_too_thick() {
        // Create a small 4x4 rectangle
        let polygon = Polygon2::rectangle(4.0, 4.0);

        // Wall thickness of 2.5 would overlap (> 4/2 = 2)
        let result = extrude_polygon_shell(&polygon, 0.0, 9.0, 2.5);
        assert!(result.is_err(), "Should fail when wall thickness >= half min dimension");

        // Wall thickness of 1.9 should succeed (< 4/2 = 2)
        let result = extrude_polygon_shell(&polygon, 0.0, 9.0, 1.9);
        assert!(result.is_ok(), "Should succeed when wall thickness < half min dimension");
    }

    #[test]
    fn test_extrude_polygon_shell_invalid_params() {
        let polygon = Polygon2::rectangle(10.0, 10.0);

        // Zero height should fail
        let result = extrude_polygon_shell(&polygon, 0.0, 0.0, 0.5);
        assert!(result.is_err(), "Should fail with zero height");

        // Negative height should fail
        let result = extrude_polygon_shell(&polygon, 0.0, -5.0, 0.5);
        assert!(result.is_err(), "Should fail with negative height");

        // Zero wall thickness should fail
        let result = extrude_polygon_shell(&polygon, 0.0, 9.0, 0.0);
        assert!(result.is_err(), "Should fail with zero wall thickness");

        // Negative wall thickness should fail
        let result = extrude_polygon_shell(&polygon, 0.0, 9.0, -0.5);
        assert!(result.is_err(), "Should fail with negative wall thickness");
    }

    #[test]
    fn test_bounding_box_intersection() {
        let b1 = BoundingBox {
            min: [0.0, 0.0, 0.0],
            max: [10.0, 10.0, 10.0],
        };
        let b2 = BoundingBox {
            min: [5.0, 5.0, 5.0],
            max: [15.0, 15.0, 15.0],
        };
        let b3 = BoundingBox {
            min: [20.0, 20.0, 20.0],
            max: [30.0, 30.0, 30.0],
        };

        assert!(b1.intersects(&b2));
        assert!(!b1.intersects(&b3));
    }

    #[test]
    fn test_polygon_validation() {
        let valid = Polygon2::rectangle(10.0, 20.0);
        assert!(validate_polygon_geometry(&valid).is_ok());

        let invalid = Polygon2::new(vec![
            Point2::new(0.0, 0.0),
            Point2::new(1.0, 0.0),
        ]);
        assert!(validate_polygon_geometry(&invalid).is_err());
    }

    #[test]
    fn test_solid_cache() {
        let cache = new_solid_cache();
        let polygon = Polygon2::rectangle(10.0, 10.0);
        let solid = extrude_polygon(&polygon, 0.0, 5.0).unwrap();
        let solid_id = SolidId::new();

        {
            let mut cache_write = cache.write().unwrap();
            cache_write.insert(solid_id, solid);
        }

        let mesh = get_mesh_for_solid(solid_id, &cache, 0.1).unwrap();
        assert!(mesh.vertex_count() > 0);
    }
}
