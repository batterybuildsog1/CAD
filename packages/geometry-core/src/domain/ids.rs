// Domain ID types - strongly typed wrappers around UUIDs
// These provide type safety to prevent mixing up different entity IDs

use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

/// Macro to generate ID types with common implementations
macro_rules! define_id {
    ($name:ident) => {
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }

            pub fn from_uuid(uuid: Uuid) -> Self {
                Self(uuid)
            }

            pub fn as_uuid(&self) -> &Uuid {
                &self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}({})", stringify!($name), &self.0.to_string()[..8])
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                write!(f, "{}", self.0)
            }
        }

        impl std::str::FromStr for $name {
            type Err = uuid::Error;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Ok(Self(Uuid::parse_str(s)?))
            }
        }
    };
}

// Core domain IDs - Phase 0
define_id!(ProjectId);
define_id!(SiteId);
define_id!(BuildingId);
define_id!(LevelId);
define_id!(FootprintId);

// Structural IDs - Phase 2
define_id!(WallAssemblyId);
define_id!(FloorAssemblyId);
define_id!(RoofAssemblyId);
define_id!(WallId);
define_id!(FloorSystemId);
define_id!(RoofSystemId);
define_id!(RoofSurfaceId);
define_id!(BeamId);

// Room/Opening IDs - Phase 3
define_id!(RoomId);
define_id!(OpeningId);
define_id!(EnvelopeSurfaceId);

// HVAC IDs - Phase 4
define_id!(HVACZoneId);
define_id!(AirHandlerId);
define_id!(SupplyRegisterId);
define_id!(ReturnGrilleId);
define_id!(DuctNodeId);
define_id!(DuctSegmentId);
define_id!(DuctFittingId);

// Plumbing IDs - Phase 5
define_id!(FixtureId);
define_id!(DWVNodeId);
define_id!(DWVPipeSegmentId);
define_id!(StackId);
define_id!(TrapId);
define_id!(CleanoutId);

// Electrical IDs - Phase 6
define_id!(PanelId);
define_id!(CircuitId);
define_id!(DeviceId);
define_id!(CableSegmentId);

// Geometry reference ID (for Truck solids stored in cache)
define_id!(SolidId);

// Framing IDs - Phase 7 (Wall Framing)
define_id!(FramingMemberId);
define_id!(FramingLayoutId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_id_uniqueness() {
        let id1 = ProjectId::new();
        let id2 = ProjectId::new();
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_id_serialization() {
        let id = ProjectId::new();
        let json = serde_json::to_string(&id).unwrap();
        let parsed: ProjectId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn test_id_from_str() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let id: ProjectId = uuid_str.parse().unwrap();
        assert_eq!(id.to_string(), uuid_str);
    }
}
