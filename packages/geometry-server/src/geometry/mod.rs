// Geometry operations using Truck B-Rep kernel
// Provides solid generation, meshing, and collision detection utilities

use anyhow::{anyhow, Result};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};

use truck_modeling::{builder, Solid, Vertex, Wire, Face};
use truck_modeling::Point3 as TruckPoint3;
use truck_modeling::Vector3 as TruckVector3;
use truck_meshalgo::prelude::*;

use crate::domain::{Polygon2, SolidId, Level, Footprint};

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

/// Extrude a 2D polygon into a 3D solid (for massing/footprint visualization)
pub fn extrude_polygon(polygon: &Polygon2, base_z: f64, height: f64) -> Result<Solid> {
    if polygon.outer.len() < 3 {
        return Err(anyhow!("Polygon must have at least 3 vertices"));
    }

    if height <= 0.0 {
        return Err(anyhow!("Height must be positive"));
    }

    // Convert polygon vertices to Truck Wire
    let vertices: Vec<Vertex> = polygon.outer
        .iter()
        .map(|p| builder::vertex(TruckPoint3::new(p.x, p.y, base_z)))
        .collect();

    // Create edges between consecutive vertices
    let mut edges = Vec::new();
    for i in 0..vertices.len() {
        let j = (i + 1) % vertices.len();
        let edge = builder::line(&vertices[i], &vertices[j]);
        edges.push(edge);
    }

    // Create wire from edges
    let wire = Wire::from_iter(edges.into_iter());

    // Create bottom face
    let bottom_face = builder::try_attach_plane(&[wire])
        .map_err(|e| anyhow!("Failed to create base face: {:?}", e))?;

    // Extrude to create solid
    let extrusion_vector = TruckVector3::new(0.0, 0.0, height);
    let solid = builder::tsweep(&bottom_face, extrusion_vector);

    Ok(solid)
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
