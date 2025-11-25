// Event types for the project event log
// All mutations to the domain model are recorded as events for:
// - Undo/redo support
// - Audit trail
// - Eventual persistence/sync

use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

use super::ids::*;
use super::project::{CodeRegion, UnitSystem};
use super::spatial::{Polygon2, Point2};
use super::room::RoomType;
use super::opening::OpeningType;

/// Unique identifier for an event
pub type EventId = u64;

/// A timestamped domain event
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Event {
    pub id: EventId,
    pub timestamp: DateTime<Utc>,
    pub project_id: ProjectId,
    pub kind: EventKind,
}

impl Event {
    pub fn new(id: EventId, project_id: ProjectId, kind: EventKind) -> Self {
        Self {
            id,
            timestamp: Utc::now(),
            project_id,
            kind,
        }
    }
}

/// All possible domain events
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum EventKind {
    // Project events
    ProjectCreated {
        name: String,
        units: UnitSystem,
        code_region: CodeRegion,
    },
    ProjectRenamed {
        old_name: String,
        new_name: String,
    },

    // Site events
    SiteCreated {
        site_id: SiteId,
    },
    SiteBoundarySet {
        site_id: SiteId,
        boundary: Polygon2,
    },
    SiteSetbacksUpdated {
        site_id: SiteId,
        front: f64,
        back: f64,
        left: f64,
        right: f64,
    },

    // Building events
    BuildingAdded {
        building_id: BuildingId,
        name: String,
    },
    BuildingRenamed {
        building_id: BuildingId,
        old_name: String,
        new_name: String,
    },
    BuildingRemoved {
        building_id: BuildingId,
    },

    // Level events
    LevelAdded {
        level_id: LevelId,
        building_id: BuildingId,
        name: String,
        elevation: f64,
        floor_to_floor: f64,
    },
    LevelModified {
        level_id: LevelId,
        name: Option<String>,
        elevation: Option<f64>,
        floor_to_floor: Option<f64>,
    },
    LevelRemoved {
        level_id: LevelId,
        building_id: BuildingId,
    },

    // Footprint events
    FootprintSet {
        footprint_id: FootprintId,
        level_id: LevelId,
        polygon: Polygon2,
    },
    FootprintModified {
        footprint_id: FootprintId,
        polygon: Polygon2,
    },
    FootprintRemoved {
        footprint_id: FootprintId,
        level_id: LevelId,
    },

    // Grid events
    GridCreated {
        building_id: BuildingId,
    },
    GridAxisAdded {
        building_id: BuildingId,
        axis: crate::domain::project::GridAxis,
    },

    // Wall Assembly events
    WallAssemblyCreated {
        wall_assembly_id: WallAssemblyId,
        name: String,
    },

    // Wall events
    WallCreated {
        wall_id: WallId,
        level_id: LevelId,
        assembly_id: WallAssemblyId,
        start: Point2,
        end: Point2,
        height: f64,
    },
    WallRemoved {
        wall_id: WallId,
        level_id: LevelId,
    },

    // Room events
    RoomCreated {
        room_id: RoomId,
        level_id: LevelId,
        room_type: RoomType,
        name: String,
    },
    RoomRemoved {
        room_id: RoomId,
        level_id: LevelId,
    },

    // Opening events
    OpeningAdded {
        opening_id: OpeningId,
        wall_id: WallId,
        opening_type: OpeningType,
    },
    OpeningRemoved {
        opening_id: OpeningId,
        wall_id: WallId,
    },

    // Geometry cache events (internal, not for undo)
    SolidGenerated {
        solid_id: SolidId,
        source: SolidSource,
    },
    SolidInvalidated {
        solid_id: SolidId,
    },
}

/// What generated a solid (for cache invalidation)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SolidSource {
    Footprint { footprint_id: FootprintId },
    Wall { wall_id: WallId },
    Floor { floor_system_id: FloorSystemId },
    Roof { roof_surface_id: RoofSurfaceId },
    Duct { duct_segment_id: DuctSegmentId },
    Pipe { pipe_segment_id: DWVPipeSegmentId },
}

/// Event log for a project
#[derive(Debug, Clone, Default)]
pub struct EventLog {
    events: Vec<Event>,
    next_id: EventId,
}

impl EventLog {
    pub fn new() -> Self {
        Self {
            events: Vec::new(),
            next_id: 1,
        }
    }

    pub fn push(&mut self, project_id: ProjectId, kind: EventKind) -> EventId {
        let id = self.next_id;
        self.next_id += 1;
        self.events.push(Event::new(id, project_id, kind));
        id
    }

    pub fn events(&self) -> &[Event] {
        &self.events
    }

    pub fn len(&self) -> usize {
        self.events.len()
    }

    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// Get events after a given ID (for sync)
    pub fn events_since(&self, after_id: EventId) -> Vec<&Event> {
        self.events.iter().filter(|e| e.id > after_id).collect()
    }

    /// Get the last N events
    pub fn last_n(&self, n: usize) -> Vec<&Event> {
        self.events.iter().rev().take(n).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_log() {
        let mut log = EventLog::new();
        let project_id = ProjectId::new();

        let id1 = log.push(
            project_id,
            EventKind::ProjectCreated {
                name: "Test".into(),
                units: UnitSystem::Imperial,
                code_region: CodeRegion::us_irc_2021(),
            },
        );

        let id2 = log.push(
            project_id,
            EventKind::BuildingAdded {
                building_id: BuildingId::new(),
                name: "Main".into(),
            },
        );

        assert_eq!(log.len(), 2);
        assert!(id2 > id1);
    }

    #[test]
    fn test_events_since() {
        let mut log = EventLog::new();
        let project_id = ProjectId::new();

        for i in 0..5 {
            log.push(
                project_id,
                EventKind::ProjectRenamed {
                    old_name: format!("v{}", i),
                    new_name: format!("v{}", i + 1),
                },
            );
        }

        let since_3 = log.events_since(3);
        assert_eq!(since_3.len(), 2); // events 4 and 5
    }
}
