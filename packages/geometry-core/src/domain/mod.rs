// Domain module - core business entities and types
// This is the foundation for all systems (structural, HVAC, plumbing, electrical)

pub mod ids;
pub mod spatial;
pub mod project;
pub mod events;
pub mod wall;
pub mod room;
pub mod opening;
pub mod framing;
pub mod error;

// Re-export commonly used types
pub use ids::*;
pub use spatial::{Point2, Point3, Vector3, Polygon2, Polyline3};
pub use project::{
    Project, Site, Setbacks, Building, Level, Footprint,
    Grid, GridAxis, GridDirection,
    UnitSystem, CodeRegion, BuildingStats,
};
pub use events::{Event, EventId, EventKind, EventLog, SolidSource};
pub use wall::{WallLayer, WallAssembly, Wall};
pub use room::{RoomType, Room};
pub use opening::{OpeningType, Opening, WindowProperties, DoorProperties};
pub use framing::{
    LumberSize, FramingMemberType, FramingMaterial, HeaderType,
    FramingMember, FramingLayout, RoughOpening, WallFramingConfig,
};
pub use error::{StructuredError, ErrorCode, EntityType};
