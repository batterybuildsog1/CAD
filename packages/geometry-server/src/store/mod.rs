// In-memory store for project state
// Provides CRUD operations that automatically record events
// Thread-safe via RwLock for concurrent access

use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use anyhow::{anyhow, Result};

use crate::domain::*;

/// Thread-safe project store
pub type SharedStore = Arc<RwLock<Store>>;

/// Create a new shared store
pub fn new_shared_store() -> SharedStore {
    Arc::new(RwLock::new(Store::new()))
}

/// In-memory store for all project data
#[derive(Debug, Default)]
pub struct Store {
    // Core entities
    pub projects: HashMap<ProjectId, Project>,
    pub sites: HashMap<SiteId, Site>,
    pub buildings: HashMap<BuildingId, Building>,
    pub levels: HashMap<LevelId, Level>,
    pub footprints: HashMap<FootprintId, Footprint>,
    pub grids: HashMap<BuildingId, Grid>,

    // Phase 2/3 entities
    pub wall_assemblies: HashMap<WallAssemblyId, WallAssembly>,
    pub walls: HashMap<WallId, Wall>,
    pub rooms: HashMap<RoomId, Room>,
    pub openings: HashMap<OpeningId, Opening>,

    // Event logs per project
    pub event_logs: HashMap<ProjectId, EventLog>,
}

impl Store {
    pub fn new() -> Self {
        Self::default()
    }

    // ========== Project Operations ==========

    pub fn create_project(
        &mut self,
        name: impl Into<String>,
        units: UnitSystem,
        code_region: CodeRegion,
    ) -> Result<ProjectId> {
        let name = name.into();
        let project = Project::new(name.clone(), units, code_region.clone());
        let project_id = project.id;

        // Initialize event log and record creation
        let mut event_log = EventLog::new();
        event_log.push(
            project_id,
            EventKind::ProjectCreated {
                name,
                units,
                code_region,
            },
        );

        self.projects.insert(project_id, project);
        self.event_logs.insert(project_id, event_log);

        Ok(project_id)
    }

    pub fn get_project(&self, id: ProjectId) -> Option<&Project> {
        self.projects.get(&id)
    }

    pub fn get_project_mut(&mut self, id: ProjectId) -> Option<&mut Project> {
        self.projects.get_mut(&id)
    }

    pub fn list_projects(&self) -> Vec<&Project> {
        self.projects.values().collect()
    }

    // ========== Site Operations ==========

    pub fn create_site(&mut self, project_id: ProjectId) -> Result<SiteId> {
        let project = self.projects.get_mut(&project_id)
            .ok_or_else(|| anyhow!("Project not found: {:?}", project_id))?;

        if project.site_id.is_some() {
            return Err(anyhow!("Project already has a site"));
        }

        let site = Site::new(project_id);
        let site_id = site.id;

        project.site_id = Some(site_id);
        project.touch();

        self.record_event(project_id, EventKind::SiteCreated { site_id });
        self.sites.insert(site_id, site);

        Ok(site_id)
    }

    pub fn get_site(&self, id: SiteId) -> Option<&Site> {
        self.sites.get(&id)
    }

    pub fn set_site_boundary(&mut self, site_id: SiteId, boundary: Polygon2) -> Result<()> {
        // Get project_id first to avoid borrow issues
        let project_id = self.sites.get(&site_id)
            .ok_or_else(|| anyhow!("Site not found: {:?}", site_id))?
            .project_id;

        // Now update the site
        if let Some(site) = self.sites.get_mut(&site_id) {
            site.boundary = Some(boundary.clone());
        }

        self.record_event(project_id, EventKind::SiteBoundarySet { site_id, boundary });

        if let Some(project) = self.projects.get_mut(&project_id) {
            project.touch();
        }

        Ok(())
    }

    // ========== Building Operations ==========

    pub fn add_building(
        &mut self,
        project_id: ProjectId,
        name: impl Into<String>,
    ) -> Result<BuildingId> {
        let name = name.into();
        let project = self.projects.get_mut(&project_id)
            .ok_or_else(|| anyhow!("Project not found: {:?}", project_id))?;

        let building = Building::new(project_id, name.clone());
        let building_id = building.id;

        project.building_ids.push(building_id);
        project.touch();

        self.record_event(project_id, EventKind::BuildingAdded { building_id, name });
        self.buildings.insert(building_id, building);

        Ok(building_id)
    }

    pub fn get_building(&self, id: BuildingId) -> Option<&Building> {
        self.buildings.get(&id)
    }

    pub fn get_building_mut(&mut self, id: BuildingId) -> Option<&mut Building> {
        self.buildings.get_mut(&id)
    }

    pub fn remove_building(&mut self, building_id: BuildingId) -> Result<()> {
        let building = self.buildings.remove(&building_id)
            .ok_or_else(|| anyhow!("Building not found: {:?}", building_id))?;

        // Remove all levels in this building
        for level_id in &building.level_ids {
            if let Some(level) = self.levels.remove(level_id) {
                if let Some(footprint_id) = level.footprint_id {
                    self.footprints.remove(&footprint_id);
                }
            }
        }

        // Update project
        if let Some(project) = self.projects.get_mut(&building.project_id) {
            project.building_ids.retain(|id| *id != building_id);
            project.touch();
        }

        self.record_event(
            building.project_id,
            EventKind::BuildingRemoved { building_id },
        );

        Ok(())
    }

    // ========== Level Operations ==========

    pub fn add_level(
        &mut self,
        building_id: BuildingId,
        name: impl Into<String>,
        elevation: f64,
        floor_to_floor: f64,
    ) -> Result<LevelId> {
        let name = name.into();
        let building = self.buildings.get_mut(&building_id)
            .ok_or_else(|| anyhow!("Building not found: {:?}", building_id))?;

        let level = Level::new(building_id, name.clone(), elevation, floor_to_floor);
        let level_id = level.id;
        let project_id = building.project_id;

        building.level_ids.push(level_id);

        self.record_event(
            project_id,
            EventKind::LevelAdded {
                level_id,
                building_id,
                name,
                elevation,
                floor_to_floor,
            },
        );
        self.levels.insert(level_id, level);

        if let Some(project) = self.projects.get_mut(&project_id) {
            project.touch();
        }

        Ok(level_id)
    }

    pub fn get_level(&self, id: LevelId) -> Option<&Level> {
        self.levels.get(&id)
    }

    pub fn get_level_mut(&mut self, id: LevelId) -> Option<&mut Level> {
        self.levels.get_mut(&id)
    }

    pub fn get_building_levels(&self, building_id: BuildingId) -> Vec<&Level> {
        if let Some(building) = self.buildings.get(&building_id) {
            building.level_ids
                .iter()
                .filter_map(|id| self.levels.get(id))
                .collect()
        } else {
            Vec::new()
        }
    }

    pub fn remove_level(&mut self, level_id: LevelId) -> Result<()> {
        let level = self.levels.remove(&level_id)
            .ok_or_else(|| anyhow!("Level not found: {:?}", level_id))?;

        // Remove footprint if exists
        if let Some(footprint_id) = level.footprint_id {
            self.footprints.remove(&footprint_id);
        }

        // Update building
        if let Some(building) = self.buildings.get_mut(&level.building_id) {
            building.level_ids.retain(|id| *id != level_id);

            let project_id = building.project_id;
            self.record_event(
                project_id,
                EventKind::LevelRemoved {
                    level_id,
                    building_id: level.building_id,
                },
            );

            if let Some(project) = self.projects.get_mut(&project_id) {
                project.touch();
            }
        }

        Ok(())
    }

    // ========== Footprint Operations ==========

    pub fn set_level_footprint(
        &mut self,
        level_id: LevelId,
        polygon: Polygon2,
    ) -> Result<FootprintId> {
        if !polygon.is_valid() {
            return Err(anyhow!("Invalid polygon: must be closed, non-degenerate"));
        }

        let level = self.levels.get_mut(&level_id)
            .ok_or_else(|| anyhow!("Level not found: {:?}", level_id))?;

        // Remove old footprint if exists
        if let Some(old_id) = level.footprint_id.take() {
            self.footprints.remove(&old_id);
        }

        let footprint = Footprint::new(level_id, polygon.clone());
        let footprint_id = footprint.id;

        level.footprint_id = Some(footprint_id);
        let building_id = level.building_id;

        // Get project_id for event
        let project_id = self.buildings.get(&building_id)
            .map(|b| b.project_id)
            .ok_or_else(|| anyhow!("Building not found for level"))?;

        self.record_event(
            project_id,
            EventKind::FootprintSet {
                footprint_id,
                level_id,
                polygon,
            },
        );
        self.footprints.insert(footprint_id, footprint);

        if let Some(project) = self.projects.get_mut(&project_id) {
            project.touch();
        }

        Ok(footprint_id)
    }

    pub fn get_footprint(&self, id: FootprintId) -> Option<&Footprint> {
        self.footprints.get(&id)
    }

    pub fn get_level_footprint(&self, level_id: LevelId) -> Option<&Footprint> {
        let level = self.levels.get(&level_id)?;
        let footprint_id = level.footprint_id?;
        self.footprints.get(&footprint_id)
    }

    pub fn modify_footprint(&mut self, footprint_id: FootprintId, polygon: Polygon2) -> Result<()> {
        if !polygon.is_valid() {
            return Err(anyhow!("Invalid polygon"));
        }

        // Get the project_id chain first to avoid borrow issues
        let project_id = {
            let footprint = self.footprints.get(&footprint_id)
                .ok_or_else(|| anyhow!("Footprint not found: {:?}", footprint_id))?;
            let level = self.levels.get(&footprint.level_id);
            let building_id = level.map(|l| l.building_id);
            building_id.and_then(|bid| self.buildings.get(&bid).map(|b| b.project_id))
        };

        // Now update the footprint
        if let Some(footprint) = self.footprints.get_mut(&footprint_id) {
            footprint.polygon = polygon.clone();
            footprint.solid_id = None; // Invalidate cached solid
        }

        // Record event and touch project
        if let Some(pid) = project_id {
            self.record_event(
                pid,
                EventKind::FootprintModified {
                    footprint_id,
                    polygon,
                },
            );

            if let Some(project) = self.projects.get_mut(&pid) {
                project.touch();
            }
        }

        Ok(())
    }

    pub fn offset_footprint(&mut self, footprint_id: FootprintId, distance: f64) -> Result<()> {
        let polygon = {
            let footprint = self.footprints.get(&footprint_id)
                .ok_or_else(|| anyhow!("Footprint not found: {:?}", footprint_id))?;
            footprint.polygon.offset(distance)
        };

        self.modify_footprint(footprint_id, polygon)
    }

    pub fn split_footprint(
        &mut self,
        footprint_id: FootprintId,
        p1: Point2,
        p2: Point2,
    ) -> Result<(FootprintId, FootprintId)> {
        let (_poly1, _poly2) = {
            let footprint = self.footprints.get(&footprint_id)
                .ok_or_else(|| anyhow!("Footprint not found: {:?}", footprint_id))?;
            
            footprint.polygon.split(p1, p2)
                .ok_or_else(|| anyhow!("Failed to split footprint (line might not intersect)"))?
        };

        // Get context
        let _level_id = self.footprints.get(&footprint_id).unwrap().level_id;
        
        // Remove old footprint
        // Note: This removes it from the level too, so we need to be careful
        // Actually, let's keep the old one as "deleted" or just remove it?
        // For now, remove it.
        self.footprints.remove(&footprint_id);
        
        // Create two new footprints
        // We need to handle the level relationship. A level usually has ONE footprint.
        // If we split, do we create a new level? Or does a level support multiple footprints?
        // The current Level struct has `footprint_id: Option<FootprintId>`.
        // So a level can only have ONE footprint.
        
        // If we split a footprint, we might be creating "zones" or "rooms", not multiple footprints for the level.
        // OR, we are splitting the level into two levels? Unlikely.
        
        // Re-reading requirements: "split_footprint" might be for creating multiple massings?
        // If Level only supports one footprint, this operation is invalid unless we change Level.
        
        // Let's check Level definition in `domain/project.rs`.
        // If Level has `footprint_id: Option<FootprintId>`, then we can't have two.
        
        // For now, I will return an error explaining this limitation, or just comment it out.
        // But the plan asked for it.
        
        // Maybe `split_footprint` is intended to return two polygons that the user then decides what to do with?
        // But the signature returns `(FootprintId, FootprintId)`.
        
        // I will implement it such that it errors for now, noting the architectural limitation.
        Err(anyhow!("Cannot split footprint: Level currently supports only one footprint"))
    }

    // ========== Grid Operations ==========

    pub fn create_grid(&mut self, building_id: BuildingId) -> Result<()> {
        if !self.buildings.contains_key(&building_id) {
            return Err(anyhow!("Building not found: {:?}", building_id));
        }

        if self.grids.contains_key(&building_id) {
            return Err(anyhow!("Grid already exists for building"));
        }

        let grid = Grid::new(building_id);
        self.grids.insert(building_id, grid);

        // Record event
        let project_id = self.buildings.get(&building_id).unwrap().project_id;
        self.record_event(project_id, EventKind::GridCreated { building_id });

        if let Some(project) = self.projects.get_mut(&project_id) {
            project.touch();
        }

        Ok(())
    }

    pub fn add_grid_axis(&mut self, building_id: BuildingId, axis: GridAxis) -> Result<()> {
        let grid = self.grids.get_mut(&building_id)
            .ok_or_else(|| anyhow!("Grid not found for building: {:?}", building_id))?;

        grid.axes.push(axis.clone());

        // Record event
        let project_id = self.buildings.get(&building_id).unwrap().project_id;
        self.record_event(project_id, EventKind::GridAxisAdded { building_id, axis });

        if let Some(project) = self.projects.get_mut(&project_id) {
            project.touch();
        }

        Ok(())
    }

    pub fn get_grid(&self, building_id: BuildingId) -> Option<&Grid> {
        self.grids.get(&building_id)
    }

    // ========== Wall Assembly Operations ==========

    pub fn create_wall_assembly(
        &mut self,
        name: impl Into<String>,
        layers: Vec<WallLayer>,
    ) -> Result<WallAssemblyId> {
        let name = name.into();
        let assembly = WallAssembly::new(name.clone(), layers);
        let assembly_id = assembly.id;

        self.wall_assemblies.insert(assembly_id, assembly);

        // Note: Wall assemblies are project-independent, so we don't record events yet
        // In a future version, we might want to associate them with a project

        Ok(assembly_id)
    }

    pub fn get_wall_assembly(&self, id: WallAssemblyId) -> Option<&WallAssembly> {
        self.wall_assemblies.get(&id)
    }

    pub fn list_wall_assemblies(&self) -> Vec<&WallAssembly> {
        self.wall_assemblies.values().collect()
    }

    // ========== Wall Operations ==========

    pub fn create_wall(
        &mut self,
        level_id: LevelId,
        assembly_id: WallAssemblyId,
        start: Point2,
        end: Point2,
        height: f64,
    ) -> Result<WallId> {
        // Validate level exists
        let level = self.levels.get(&level_id)
            .ok_or_else(|| anyhow!("Level not found: {:?}", level_id))?;

        // Validate assembly exists
        if !self.wall_assemblies.contains_key(&assembly_id) {
            return Err(anyhow!("Wall assembly not found: {:?}", assembly_id));
        }

        // Validate wall geometry
        if start.distance_to(&end) < 1e-10 {
            return Err(anyhow!("Wall start and end points are too close"));
        }

        if height <= 0.0 {
            return Err(anyhow!("Wall height must be positive"));
        }

        let wall = Wall::new(assembly_id, level_id, start, end, height);
        let wall_id = wall.id;
        let building_id = level.building_id;

        // Get project_id for event recording
        let project_id = self.buildings.get(&building_id)
            .map(|b| b.project_id)
            .ok_or_else(|| anyhow!("Building not found for level"))?;

        self.walls.insert(wall_id, wall);

        // Add wall ID to the level's wall_ids vector (reverse relationship)
        if let Some(level) = self.levels.get_mut(&level_id) {
            level.wall_ids.push(wall_id);
        }

        self.record_event(
            project_id,
            EventKind::WallCreated {
                wall_id,
                level_id,
                assembly_id,
                start,
                end,
                height,
            },
        );

        if let Some(project) = self.projects.get_mut(&project_id) {
            project.touch();
        }

        Ok(wall_id)
    }

    pub fn get_wall(&self, id: WallId) -> Option<&Wall> {
        self.walls.get(&id)
    }

    pub fn get_level_walls(&self, level_id: LevelId) -> Vec<&Wall> {
        self.walls
            .values()
            .filter(|wall| wall.level_id == level_id)
            .collect()
    }

    pub fn remove_wall(&mut self, wall_id: WallId) -> Result<()> {
        let wall = self.walls.remove(&wall_id)
            .ok_or_else(|| anyhow!("Wall not found: {:?}", wall_id))?;

        // Remove all openings in this wall
        let opening_ids: Vec<OpeningId> = self.openings
            .values()
            .filter(|opening| opening.wall_id == wall_id)
            .map(|opening| opening.id)
            .collect();

        for opening_id in opening_ids {
            self.openings.remove(&opening_id);
        }

        // Remove wall ID from level's wall_ids vector (reverse relationship)
        let level_id = wall.level_id;
        if let Some(level) = self.levels.get_mut(&level_id) {
            level.wall_ids.retain(|id| *id != wall_id);
        }

        // Remove wall ID from any room's bounding_wall_ids
        for room in self.rooms.values_mut() {
            room.bounding_wall_ids.retain(|id| *id != wall_id);
        }

        // Get project_id for event recording
        if let Some(level) = self.levels.get(&level_id) {
            let building_id = level.building_id;
            if let Some(building) = self.buildings.get(&building_id) {
                let project_id = building.project_id;

                self.record_event(
                    project_id,
                    EventKind::WallRemoved { wall_id, level_id },
                );

                if let Some(project) = self.projects.get_mut(&project_id) {
                    project.touch();
                }
            }
        }

        Ok(())
    }

    // ========== Room Operations ==========

    pub fn create_room(
        &mut self,
        level_id: LevelId,
        room_type: RoomType,
        name: impl Into<String>,
        boundary: Polygon2,
    ) -> Result<RoomId> {
        // Validate level exists
        let level = self.levels.get(&level_id)
            .ok_or_else(|| anyhow!("Level not found: {:?}", level_id))?;

        // Validate boundary
        if !boundary.is_valid() {
            return Err(anyhow!("Invalid room boundary: must be closed, non-degenerate"));
        }

        let name = name.into();
        let room = Room::new(level_id, room_type.clone(), name.clone(), boundary);
        let room_id = room.id;
        let building_id = level.building_id;

        // Get project_id for event recording
        let project_id = self.buildings.get(&building_id)
            .map(|b| b.project_id)
            .ok_or_else(|| anyhow!("Building not found for level"))?;

        self.rooms.insert(room_id, room);

        // Add room ID to the level's room_ids vector (reverse relationship)
        if let Some(level) = self.levels.get_mut(&level_id) {
            level.room_ids.push(room_id);
        }

        self.record_event(
            project_id,
            EventKind::RoomCreated {
                room_id,
                level_id,
                room_type,
                name,
            },
        );

        if let Some(project) = self.projects.get_mut(&project_id) {
            project.touch();
        }

        Ok(room_id)
    }

    pub fn get_room(&self, id: RoomId) -> Option<&Room> {
        self.rooms.get(&id)
    }

    pub fn get_level_rooms(&self, level_id: LevelId) -> Vec<&Room> {
        self.rooms
            .values()
            .filter(|room| room.level_id == level_id)
            .collect()
    }

    pub fn remove_room(&mut self, room_id: RoomId) -> Result<()> {
        let room = self.rooms.remove(&room_id)
            .ok_or_else(|| anyhow!("Room not found: {:?}", room_id))?;

        // Remove room ID from level's room_ids vector (reverse relationship)
        let level_id = room.level_id;
        if let Some(level) = self.levels.get_mut(&level_id) {
            level.room_ids.retain(|id| *id != room_id);
        }

        // Get project_id for event recording
        if let Some(level) = self.levels.get(&level_id) {
            let building_id = level.building_id;
            if let Some(building) = self.buildings.get(&building_id) {
                let project_id = building.project_id;

                self.record_event(
                    project_id,
                    EventKind::RoomRemoved { room_id, level_id },
                );

                if let Some(project) = self.projects.get_mut(&project_id) {
                    project.touch();
                }
            }
        }

        Ok(())
    }

    /// Set the bounding walls for a room
    pub fn set_room_bounding_walls(&mut self, room_id: RoomId, wall_ids: Vec<WallId>) -> Result<()> {
        let room = self.rooms.get_mut(&room_id)
            .ok_or_else(|| anyhow!("Room not found: {:?}", room_id))?;

        // Validate that all wall IDs exist
        for wall_id in &wall_ids {
            if !self.walls.contains_key(wall_id) {
                return Err(anyhow!("Wall not found: {:?}", wall_id));
            }
        }

        room.set_bounding_walls(wall_ids);

        Ok(())
    }

    // ========== Opening Operations ==========

    pub fn add_opening(
        &mut self,
        wall_id: WallId,
        opening_type: OpeningType,
        position: f64,
        width: f64,
        height: f64,
        sill_height: f64,
    ) -> Result<OpeningId> {
        // Validate wall exists
        let wall = self.walls.get(&wall_id)
            .ok_or_else(|| anyhow!("Wall not found: {:?}", wall_id))?;

        // Validate opening parameters
        if position < 0.0 || position > 1.0 {
            return Err(anyhow!("Opening position must be between 0.0 and 1.0"));
        }

        if width <= 0.0 {
            return Err(anyhow!("Opening width must be positive"));
        }

        if height <= 0.0 {
            return Err(anyhow!("Opening height must be positive"));
        }

        if sill_height < 0.0 {
            return Err(anyhow!("Opening sill height must be non-negative"));
        }

        let opening = Opening::new(wall_id, opening_type.clone(), position, width, height, sill_height);
        let opening_id = opening.id;
        let level_id = wall.level_id;

        // Get project_id for event recording
        let project_id = {
            let level = self.levels.get(&level_id);
            let building_id = level.map(|l| l.building_id);
            building_id.and_then(|bid| self.buildings.get(&bid).map(|b| b.project_id))
        };

        self.openings.insert(opening_id, opening);

        if let Some(pid) = project_id {
            self.record_event(
                pid,
                EventKind::OpeningAdded {
                    opening_id,
                    wall_id,
                    opening_type,
                },
            );

            if let Some(project) = self.projects.get_mut(&pid) {
                project.touch();
            }
        }

        Ok(opening_id)
    }

    pub fn get_opening(&self, id: OpeningId) -> Option<&Opening> {
        self.openings.get(&id)
    }

    pub fn get_wall_openings(&self, wall_id: WallId) -> Vec<&Opening> {
        self.openings
            .values()
            .filter(|opening| opening.wall_id == wall_id)
            .collect()
    }

    pub fn remove_opening(&mut self, opening_id: OpeningId) -> Result<()> {
        let opening = self.openings.remove(&opening_id)
            .ok_or_else(|| anyhow!("Opening not found: {:?}", opening_id))?;

        // Get project_id for event recording
        let wall_id = opening.wall_id;
        if let Some(wall) = self.walls.get(&wall_id) {
            let level_id = wall.level_id;
            if let Some(level) = self.levels.get(&level_id) {
                let building_id = level.building_id;
                if let Some(building) = self.buildings.get(&building_id) {
                    let project_id = building.project_id;

                    self.record_event(
                        project_id,
                        EventKind::OpeningRemoved { opening_id, wall_id },
                    );

                    if let Some(project) = self.projects.get_mut(&project_id) {
                        project.touch();
                    }
                }
            }
        }

        Ok(())
    }

    // ========== Event Log Operations ==========

    fn record_event(&mut self, project_id: ProjectId, kind: EventKind) {
        if let Some(log) = self.event_logs.get_mut(&project_id) {
            log.push(project_id, kind);
        }
    }

    pub fn get_event_log(&self, project_id: ProjectId) -> Option<&EventLog> {
        self.event_logs.get(&project_id)
    }

    pub fn get_events_since(&self, project_id: ProjectId, after_id: EventId) -> Vec<&Event> {
        self.event_logs
            .get(&project_id)
            .map(|log| log.events_since(after_id))
            .unwrap_or_default()
    }

    // ========== Statistics ==========

    pub fn get_building_stats(&self, building_id: BuildingId) -> Option<BuildingStats> {
        let building = self.buildings.get(&building_id)?;
        let levels: Vec<&Level> = self.get_building_levels(building_id);
        let footprints: Vec<&Footprint> = building.level_ids
            .iter()
            .filter_map(|lid| {
                let level = self.levels.get(lid)?;
                level.footprint_id.and_then(|fid| self.footprints.get(&fid))
            })
            .collect();

        Some(BuildingStats::compute(building, &levels, &footprints))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_project_and_building() {
        let mut store = Store::new();

        let project_id = store
            .create_project("Test House", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();

        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();

        let polygon = Polygon2::rectangle(40.0, 30.0);
        let footprint_id = store.set_level_footprint(level_id, polygon).unwrap();

        // Verify everything is connected
        let project = store.get_project(project_id).unwrap();
        assert_eq!(project.building_ids.len(), 1);

        let building = store.get_building(building_id).unwrap();
        assert_eq!(building.level_ids.len(), 1);

        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.footprint_id, Some(footprint_id));

        let footprint = store.get_footprint(footprint_id).unwrap();
        assert!((footprint.area() - 1200.0).abs() < 1e-10);
    }

    #[test]
    fn test_event_log_recording() {
        let mut store = Store::new();

        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();

        store.add_building(project_id, "B1").unwrap();
        store.add_building(project_id, "B2").unwrap();

        let log = store.get_event_log(project_id).unwrap();
        assert_eq!(log.len(), 3); // 1 create + 2 buildings
    }

    #[test]
    fn test_invalid_footprint_rejected() {
        let mut store = Store::new();

        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "Floor", 0.0, 9.0).unwrap();

        // Degenerate polygon (only 2 points)
        let bad_polygon = Polygon2::new(vec![
            Point2::new(0.0, 0.0),
            Point2::new(1.0, 0.0),
        ]);

        let result = store.set_level_footprint(level_id, bad_polygon);
        assert!(result.is_err());
    }

    #[test]
    fn test_building_stats() {
        let mut store = Store::new();

        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();

        let l1 = store.add_level(building_id, "First", 0.0, 9.0).unwrap();
        let l2 = store.add_level(building_id, "Second", 9.0, 8.0).unwrap();

        store.set_level_footprint(l1, Polygon2::rectangle(40.0, 30.0)).unwrap();
        store.set_level_footprint(l2, Polygon2::rectangle(35.0, 25.0)).unwrap();

        let stats = store.get_building_stats(building_id).unwrap();
        assert_eq!(stats.level_count, 2);
        assert!((stats.total_area - (1200.0 + 875.0)).abs() < 1e-10);
    }

    // ========== Phase 2/3 Tests ==========

    #[test]
    fn test_create_wall_assembly_and_wall() {
        let mut store = Store::new();

        // Create project structure
        let project_id = store
            .create_project("Test House", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();

        // Create wall assembly
        let assembly_id = store
            .create_wall_assembly(
                "Exterior 2x6",
                vec![
                    WallLayer::gypsum_5_8(),
                    WallLayer::stud_2x6(),
                    WallLayer::fiberglass_r19(),
                    WallLayer::osb_7_16(),
                ],
            )
            .unwrap();

        // Verify assembly exists
        let assembly = store.get_wall_assembly(assembly_id).unwrap();
        assert_eq!(assembly.layers.len(), 4);
        assert!(assembly.total_thickness > 6.0);

        // Create wall
        let wall_id = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(0.0, 0.0),
                Point2::new(40.0, 0.0),
                9.0,
            )
            .unwrap();

        // Verify wall exists
        let wall = store.get_wall(wall_id).unwrap();
        assert_eq!(wall.assembly_id, assembly_id);
        assert_eq!(wall.level_id, level_id);
        assert!((wall.length() - 40.0).abs() < 1e-10);
        assert!((wall.area() - 360.0).abs() < 1e-10); // 40' × 9'

        // Verify get_level_walls
        let level_walls = store.get_level_walls(level_id);
        assert_eq!(level_walls.len(), 1);
        assert_eq!(level_walls[0].id, wall_id);
    }

    #[test]
    fn test_create_room() {
        let mut store = Store::new();

        // Create project structure
        let project_id = store
            .create_project("Test House", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();

        // Create a bedroom
        let boundary = Polygon2::rectangle(15.0, 12.0); // 15' × 12' bedroom
        let room_id = store
            .create_room(level_id, RoomType::Bedroom, "Primary Bedroom", boundary)
            .unwrap();

        // Verify room exists
        let room = store.get_room(room_id).unwrap();
        assert_eq!(room.name, "Primary Bedroom");
        assert_eq!(room.room_type, RoomType::Bedroom);
        assert!((room.area() - 180.0).abs() < 1e-10); // 15 × 12 = 180 sq ft

        // Verify get_level_rooms
        let level_rooms = store.get_level_rooms(level_id);
        assert_eq!(level_rooms.len(), 1);
        assert_eq!(level_rooms[0].id, room_id);

        // Create another room
        let boundary2 = Polygon2::rectangle(10.0, 8.0);
        let room_id2 = store
            .create_room(level_id, RoomType::Bathroom, "Primary Bath", boundary2)
            .unwrap();

        // Verify we now have 2 rooms
        let level_rooms = store.get_level_rooms(level_id);
        assert_eq!(level_rooms.len(), 2);

        // Verify event log
        let log = store.get_event_log(project_id).unwrap();
        assert!(log.len() >= 5); // project, building, level, room1, room2
    }

    #[test]
    fn test_add_opening_to_wall() {
        let mut store = Store::new();

        // Create project structure
        let project_id = store
            .create_project("Test House", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();

        // Create wall assembly and wall
        let assembly_id = store
            .create_wall_assembly("Exterior 2x6", vec![WallLayer::stud_2x6()])
            .unwrap();

        let wall_id = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(0.0, 0.0),
                Point2::new(20.0, 0.0),
                9.0,
            )
            .unwrap();

        // Add a window opening
        let opening_id = store
            .add_opening(
                wall_id,
                OpeningType::Window,
                0.5,  // Middle of wall
                3.0,  // 3' wide
                4.0,  // 4' tall
                3.0,  // 3' sill height
            )
            .unwrap();

        // Verify opening exists
        let opening = store.get_opening(opening_id).unwrap();
        assert_eq!(opening.wall_id, wall_id);
        assert_eq!(opening.opening_type, OpeningType::Window);
        assert_eq!(opening.position_along_wall, 0.5);
        assert_eq!(opening.width, 3.0);
        assert_eq!(opening.height, 4.0);
        assert_eq!(opening.sill_height, 3.0);
        assert!((opening.area() - 12.0).abs() < 1e-10);

        // Add a door opening
        let door_id = store
            .add_opening(
                wall_id,
                OpeningType::Door,
                0.2,  // Near start of wall
                3.0,  // 3' wide
                7.0,  // 7' tall
                0.0,  // Floor level
            )
            .unwrap();

        // Verify get_wall_openings
        let wall_openings = store.get_wall_openings(wall_id);
        assert_eq!(wall_openings.len(), 2);

        // Verify event log
        let log = store.get_event_log(project_id).unwrap();
        assert!(log.len() >= 6); // project, building, level, wall, opening1, opening2
    }

    #[test]
    fn test_remove_wall_removes_openings() {
        let mut store = Store::new();

        // Create project structure
        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "Floor", 0.0, 9.0).unwrap();

        // Create wall with opening
        let assembly_id = store
            .create_wall_assembly("Test Wall", vec![WallLayer::stud_2x6()])
            .unwrap();

        let wall_id = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(0.0, 0.0),
                Point2::new(10.0, 0.0),
                9.0,
            )
            .unwrap();

        let opening_id = store
            .add_opening(wall_id, OpeningType::Window, 0.5, 3.0, 4.0, 3.0)
            .unwrap();

        // Verify opening exists
        assert!(store.get_opening(opening_id).is_some());

        // Remove wall
        store.remove_wall(wall_id).unwrap();

        // Verify wall and opening are gone
        assert!(store.get_wall(wall_id).is_none());
        assert!(store.get_opening(opening_id).is_none());
    }

    #[test]
    fn test_invalid_wall_creation() {
        let mut store = Store::new();

        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "Floor", 0.0, 9.0).unwrap();

        let assembly_id = store
            .create_wall_assembly("Test", vec![WallLayer::stud_2x6()])
            .unwrap();

        // Test with same start and end points
        let result = store.create_wall(
            level_id,
            assembly_id,
            Point2::new(0.0, 0.0),
            Point2::new(0.0, 0.0),
            9.0,
        );
        assert!(result.is_err());

        // Test with negative height
        let result = store.create_wall(
            level_id,
            assembly_id,
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            -1.0,
        );
        assert!(result.is_err());

        // Test with invalid assembly
        let bad_assembly_id = WallAssemblyId::new();
        let result = store.create_wall(
            level_id,
            bad_assembly_id,
            Point2::new(0.0, 0.0),
            Point2::new(10.0, 0.0),
            9.0,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_room_creation() {
        let mut store = Store::new();

        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "Floor", 0.0, 9.0).unwrap();

        // Test with invalid polygon (only 2 points)
        let bad_polygon = Polygon2::new(vec![
            Point2::new(0.0, 0.0),
            Point2::new(1.0, 0.0),
        ]);

        let result = store.create_room(
            level_id,
            RoomType::Bedroom,
            "Invalid Room",
            bad_polygon,
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_opening_creation() {
        let mut store = Store::new();

        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "Floor", 0.0, 9.0).unwrap();

        let assembly_id = store
            .create_wall_assembly("Test", vec![WallLayer::stud_2x6()])
            .unwrap();

        let wall_id = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(0.0, 0.0),
                Point2::new(10.0, 0.0),
                9.0,
            )
            .unwrap();

        // Test with position > 1.0
        let result = store.add_opening(wall_id, OpeningType::Window, 1.5, 3.0, 4.0, 3.0);
        assert!(result.is_err());

        // Test with negative width
        let result = store.add_opening(wall_id, OpeningType::Window, 0.5, -3.0, 4.0, 3.0);
        assert!(result.is_err());

        // Test with negative height
        let result = store.add_opening(wall_id, OpeningType::Window, 0.5, 3.0, -4.0, 3.0);
        assert!(result.is_err());

        // Test with invalid wall
        let bad_wall_id = WallId::new();
        let result = store.add_opening(bad_wall_id, OpeningType::Window, 0.5, 3.0, 4.0, 3.0);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_level_walls_and_rooms_queries() {
        let mut store = Store::new();

        // Setup
        let project_id = store
            .create_project("Multi-Level Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level1_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();
        let level2_id = store.add_level(building_id, "Second Floor", 9.0, 9.0).unwrap();

        let assembly_id = store
            .create_wall_assembly("Standard", vec![WallLayer::stud_2x6()])
            .unwrap();

        // Create walls on level 1
        store
            .create_wall(
                level1_id,
                assembly_id,
                Point2::new(0.0, 0.0),
                Point2::new(10.0, 0.0),
                9.0,
            )
            .unwrap();

        store
            .create_wall(
                level1_id,
                assembly_id,
                Point2::new(10.0, 0.0),
                Point2::new(10.0, 10.0),
                9.0,
            )
            .unwrap();

        // Create wall on level 2
        store
            .create_wall(
                level2_id,
                assembly_id,
                Point2::new(0.0, 0.0),
                Point2::new(8.0, 0.0),
                9.0,
            )
            .unwrap();

        // Create rooms on level 1
        store
            .create_room(
                level1_id,
                RoomType::LivingRoom,
                "Living",
                Polygon2::rectangle(20.0, 15.0),
            )
            .unwrap();

        store
            .create_room(
                level1_id,
                RoomType::Kitchen,
                "Kitchen",
                Polygon2::rectangle(12.0, 10.0),
            )
            .unwrap();

        // Create room on level 2
        store
            .create_room(
                level2_id,
                RoomType::Bedroom,
                "Bedroom",
                Polygon2::rectangle(15.0, 12.0),
            )
            .unwrap();

        // Test get_level_walls
        let level1_walls = store.get_level_walls(level1_id);
        assert_eq!(level1_walls.len(), 2);

        let level2_walls = store.get_level_walls(level2_id);
        assert_eq!(level2_walls.len(), 1);

        // Test get_level_rooms
        let level1_rooms = store.get_level_rooms(level1_id);
        assert_eq!(level1_rooms.len(), 2);

        let level2_rooms = store.get_level_rooms(level2_id);
        assert_eq!(level2_rooms.len(), 1);
    }

    // ========== Reverse Relationship Tests ==========

    #[test]
    fn test_create_wall_updates_level_wall_ids() {
        let mut store = Store::new();

        // Create project structure
        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();

        // Create wall assembly
        let assembly_id = store
            .create_wall_assembly("Test Wall", vec![WallLayer::stud_2x6()])
            .unwrap();

        // Verify level starts with no walls
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.wall_ids.len(), 0);

        // Create wall
        let wall_id = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(0.0, 0.0),
                Point2::new(10.0, 0.0),
                9.0,
            )
            .unwrap();

        // Verify level now has the wall ID
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.wall_ids.len(), 1);
        assert_eq!(level.wall_ids[0], wall_id);

        // Create another wall
        let wall_id2 = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(10.0, 0.0),
                Point2::new(10.0, 10.0),
                9.0,
            )
            .unwrap();

        // Verify level now has both walls
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.wall_ids.len(), 2);
        assert!(level.wall_ids.contains(&wall_id));
        assert!(level.wall_ids.contains(&wall_id2));
    }

    #[test]
    fn test_remove_wall_updates_level_wall_ids() {
        let mut store = Store::new();

        // Setup
        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();

        let assembly_id = store
            .create_wall_assembly("Test Wall", vec![WallLayer::stud_2x6()])
            .unwrap();

        // Create two walls
        let wall_id1 = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(0.0, 0.0),
                Point2::new(10.0, 0.0),
                9.0,
            )
            .unwrap();

        let wall_id2 = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(10.0, 0.0),
                Point2::new(10.0, 10.0),
                9.0,
            )
            .unwrap();

        // Verify level has both walls
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.wall_ids.len(), 2);

        // Remove first wall
        store.remove_wall(wall_id1).unwrap();

        // Verify level only has second wall
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.wall_ids.len(), 1);
        assert_eq!(level.wall_ids[0], wall_id2);
        assert!(!level.wall_ids.contains(&wall_id1));

        // Remove second wall
        store.remove_wall(wall_id2).unwrap();

        // Verify level has no walls
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.wall_ids.len(), 0);
    }

    #[test]
    fn test_create_room_updates_level_room_ids() {
        let mut store = Store::new();

        // Create project structure
        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();

        // Verify level starts with no rooms
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.room_ids.len(), 0);

        // Create room
        let room_id = store
            .create_room(
                level_id,
                RoomType::Bedroom,
                "Bedroom 1",
                Polygon2::rectangle(15.0, 12.0),
            )
            .unwrap();

        // Verify level now has the room ID
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.room_ids.len(), 1);
        assert_eq!(level.room_ids[0], room_id);

        // Create another room
        let room_id2 = store
            .create_room(
                level_id,
                RoomType::Bathroom,
                "Bathroom 1",
                Polygon2::rectangle(8.0, 6.0),
            )
            .unwrap();

        // Verify level now has both rooms
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.room_ids.len(), 2);
        assert!(level.room_ids.contains(&room_id));
        assert!(level.room_ids.contains(&room_id2));
    }

    #[test]
    fn test_remove_room_updates_level_room_ids() {
        let mut store = Store::new();

        // Setup
        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();

        // Create two rooms
        let room_id1 = store
            .create_room(
                level_id,
                RoomType::Bedroom,
                "Bedroom 1",
                Polygon2::rectangle(15.0, 12.0),
            )
            .unwrap();

        let room_id2 = store
            .create_room(
                level_id,
                RoomType::Bathroom,
                "Bathroom 1",
                Polygon2::rectangle(8.0, 6.0),
            )
            .unwrap();

        // Verify level has both rooms
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.room_ids.len(), 2);

        // Remove first room
        store.remove_room(room_id1).unwrap();

        // Verify level only has second room
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.room_ids.len(), 1);
        assert_eq!(level.room_ids[0], room_id2);
        assert!(!level.room_ids.contains(&room_id1));

        // Remove second room
        store.remove_room(room_id2).unwrap();

        // Verify level has no rooms
        let level = store.get_level(level_id).unwrap();
        assert_eq!(level.room_ids.len(), 0);
    }

    #[test]
    fn test_set_room_bounding_walls() {
        let mut store = Store::new();

        // Setup
        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();

        let assembly_id = store
            .create_wall_assembly("Test Wall", vec![WallLayer::stud_2x6()])
            .unwrap();

        // Create walls forming a room boundary
        let wall_id1 = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(0.0, 0.0),
                Point2::new(15.0, 0.0),
                9.0,
            )
            .unwrap();

        let wall_id2 = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(15.0, 0.0),
                Point2::new(15.0, 12.0),
                9.0,
            )
            .unwrap();

        let wall_id3 = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(15.0, 12.0),
                Point2::new(0.0, 12.0),
                9.0,
            )
            .unwrap();

        let wall_id4 = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(0.0, 12.0),
                Point2::new(0.0, 0.0),
                9.0,
            )
            .unwrap();

        // Create room
        let room_id = store
            .create_room(
                level_id,
                RoomType::Bedroom,
                "Bedroom 1",
                Polygon2::rectangle(15.0, 12.0),
            )
            .unwrap();

        // Verify room starts with no bounding walls
        let room = store.get_room(room_id).unwrap();
        assert_eq!(room.bounding_wall_ids.len(), 0);

        // Set bounding walls
        let wall_ids = vec![wall_id1, wall_id2, wall_id3, wall_id4];
        store.set_room_bounding_walls(room_id, wall_ids.clone()).unwrap();

        // Verify room now has bounding walls
        let room = store.get_room(room_id).unwrap();
        assert_eq!(room.bounding_wall_ids.len(), 4);
        assert!(room.bounding_wall_ids.contains(&wall_id1));
        assert!(room.bounding_wall_ids.contains(&wall_id2));
        assert!(room.bounding_wall_ids.contains(&wall_id3));
        assert!(room.bounding_wall_ids.contains(&wall_id4));
    }

    #[test]
    fn test_remove_wall_removes_from_room_bounding_walls() {
        let mut store = Store::new();

        // Setup
        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();

        let assembly_id = store
            .create_wall_assembly("Test Wall", vec![WallLayer::stud_2x6()])
            .unwrap();

        // Create walls
        let wall_id1 = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(0.0, 0.0),
                Point2::new(15.0, 0.0),
                9.0,
            )
            .unwrap();

        let wall_id2 = store
            .create_wall(
                level_id,
                assembly_id,
                Point2::new(15.0, 0.0),
                Point2::new(15.0, 12.0),
                9.0,
            )
            .unwrap();

        // Create room
        let room_id = store
            .create_room(
                level_id,
                RoomType::Bedroom,
                "Bedroom 1",
                Polygon2::rectangle(15.0, 12.0),
            )
            .unwrap();

        // Set bounding walls
        store.set_room_bounding_walls(room_id, vec![wall_id1, wall_id2]).unwrap();

        // Verify room has both walls
        let room = store.get_room(room_id).unwrap();
        assert_eq!(room.bounding_wall_ids.len(), 2);

        // Remove one wall
        store.remove_wall(wall_id1).unwrap();

        // Verify room only has the remaining wall
        let room = store.get_room(room_id).unwrap();
        assert_eq!(room.bounding_wall_ids.len(), 1);
        assert_eq!(room.bounding_wall_ids[0], wall_id2);
        assert!(!room.bounding_wall_ids.contains(&wall_id1));
    }

    #[test]
    fn test_set_room_bounding_walls_invalid_wall() {
        let mut store = Store::new();

        // Setup
        let project_id = store
            .create_project("Test", UnitSystem::Imperial, CodeRegion::us_irc_2021())
            .unwrap();
        let building_id = store.add_building(project_id, "Main").unwrap();
        let level_id = store.add_level(building_id, "First Floor", 0.0, 9.0).unwrap();

        // Create room
        let room_id = store
            .create_room(
                level_id,
                RoomType::Bedroom,
                "Bedroom 1",
                Polygon2::rectangle(15.0, 12.0),
            )
            .unwrap();

        // Try to set bounding walls with a non-existent wall ID
        let bad_wall_id = WallId::new();
        let result = store.set_room_bounding_walls(room_id, vec![bad_wall_id]);

        // Should fail
        assert!(result.is_err());

        // Room should still have no bounding walls
        let room = store.get_room(room_id).unwrap();
        assert_eq!(room.bounding_wall_ids.len(), 0);
    }
}
