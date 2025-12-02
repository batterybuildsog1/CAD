// Regeneration manager - tracks dirty state for incremental framing updates
// When walls or openings change, marks affected walls for re-generation

use std::collections::HashSet;
use crate::domain::{WallId, OpeningId};

/// Manages dirty state for framing regeneration
///
/// When walls or openings are modified, their framing layouts become stale.
/// This manager tracks which walls need their framing regenerated.
#[derive(Debug, Clone, Default)]
pub struct RegenerationManager {
    /// Set of wall IDs that need framing regeneration
    dirty_walls: HashSet<WallId>,
    /// Map of opening IDs to their wall IDs for quick lookup
    opening_wall_map: std::collections::HashMap<OpeningId, WallId>,
}

impl RegenerationManager {
    /// Create a new regeneration manager
    pub fn new() -> Self {
        Self {
            dirty_walls: HashSet::new(),
            opening_wall_map: std::collections::HashMap::new(),
        }
    }

    /// Mark a wall as needing framing regeneration
    ///
    /// Call this when:
    /// - Wall dimensions change
    /// - Wall framing config changes
    /// - Wall is moved
    pub fn invalidate_wall(&mut self, wall_id: WallId) {
        self.dirty_walls.insert(wall_id);
    }

    /// Mark a wall as dirty due to an opening change
    ///
    /// Call this when:
    /// - Opening is added to wall
    /// - Opening dimensions change
    /// - Opening position changes
    /// - Opening is removed from wall
    pub fn invalidate_opening(&mut self, opening_id: OpeningId, wall_id: WallId) {
        self.dirty_walls.insert(wall_id);
        self.opening_wall_map.insert(opening_id, wall_id);
    }

    /// Mark a wall dirty by opening ID only (uses cached wall mapping)
    ///
    /// Returns true if the opening was found and wall was invalidated
    pub fn invalidate_opening_by_id(&mut self, opening_id: OpeningId) -> bool {
        if let Some(&wall_id) = self.opening_wall_map.get(&opening_id) {
            self.dirty_walls.insert(wall_id);
            true
        } else {
            false
        }
    }

    /// Remove an opening from tracking
    pub fn remove_opening(&mut self, opening_id: OpeningId) {
        if let Some(wall_id) = self.opening_wall_map.remove(&opening_id) {
            // Mark wall as dirty since opening was removed
            self.dirty_walls.insert(wall_id);
        }
    }

    /// Get all walls that need framing regeneration
    pub fn get_dirty_walls(&self) -> &HashSet<WallId> {
        &self.dirty_walls
    }

    /// Check if any walls need regeneration
    pub fn has_dirty_walls(&self) -> bool {
        !self.dirty_walls.is_empty()
    }

    /// Check if a specific wall needs regeneration
    pub fn is_wall_dirty(&self, wall_id: WallId) -> bool {
        self.dirty_walls.contains(&wall_id)
    }

    /// Get the number of dirty walls
    pub fn dirty_count(&self) -> usize {
        self.dirty_walls.len()
    }

    /// Clear a specific wall from dirty set (after regeneration)
    pub fn mark_clean(&mut self, wall_id: WallId) {
        self.dirty_walls.remove(&wall_id);
    }

    /// Clear all dirty walls (after full regeneration)
    pub fn clear(&mut self) {
        self.dirty_walls.clear();
    }

    /// Clear everything including opening mappings (full reset)
    pub fn reset(&mut self) {
        self.dirty_walls.clear();
        self.opening_wall_map.clear();
    }

    /// Register an opening-to-wall mapping without marking dirty
    ///
    /// Use this during initial load when framing hasn't been generated yet
    pub fn register_opening(&mut self, opening_id: OpeningId, wall_id: WallId) {
        self.opening_wall_map.insert(opening_id, wall_id);
    }

    /// Get the wall ID for an opening (if known)
    pub fn get_wall_for_opening(&self, opening_id: OpeningId) -> Option<WallId> {
        self.opening_wall_map.get(&opening_id).copied()
    }

    /// Get all registered opening IDs
    pub fn get_registered_openings(&self) -> Vec<OpeningId> {
        self.opening_wall_map.keys().copied().collect()
    }

    /// Get all opening IDs for a specific wall
    pub fn get_openings_for_wall(&self, wall_id: WallId) -> Vec<OpeningId> {
        self.opening_wall_map
            .iter()
            .filter(|(_, &wid)| wid == wall_id)
            .map(|(&oid, _)| oid)
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_manager_is_empty() {
        let manager = RegenerationManager::new();
        assert!(!manager.has_dirty_walls());
        assert_eq!(manager.dirty_count(), 0);
    }

    #[test]
    fn test_invalidate_wall() {
        let mut manager = RegenerationManager::new();
        let wall_id = WallId::new();

        manager.invalidate_wall(wall_id);

        assert!(manager.has_dirty_walls());
        assert!(manager.is_wall_dirty(wall_id));
        assert_eq!(manager.dirty_count(), 1);
    }

    #[test]
    fn test_invalidate_opening() {
        let mut manager = RegenerationManager::new();
        let wall_id = WallId::new();
        let opening_id = OpeningId::new();

        manager.invalidate_opening(opening_id, wall_id);

        assert!(manager.is_wall_dirty(wall_id));
        assert_eq!(manager.get_wall_for_opening(opening_id), Some(wall_id));
    }

    #[test]
    fn test_invalidate_opening_by_id() {
        let mut manager = RegenerationManager::new();
        let wall_id = WallId::new();
        let opening_id = OpeningId::new();

        // Register the opening first
        manager.register_opening(opening_id, wall_id);

        // Clear dirty state
        manager.clear();
        assert!(!manager.has_dirty_walls());

        // Now invalidate by opening ID only
        assert!(manager.invalidate_opening_by_id(opening_id));
        assert!(manager.is_wall_dirty(wall_id));
    }

    #[test]
    fn test_mark_clean() {
        let mut manager = RegenerationManager::new();
        let wall_id = WallId::new();

        manager.invalidate_wall(wall_id);
        assert!(manager.is_wall_dirty(wall_id));

        manager.mark_clean(wall_id);
        assert!(!manager.is_wall_dirty(wall_id));
    }

    #[test]
    fn test_clear() {
        let mut manager = RegenerationManager::new();
        let wall1 = WallId::new();
        let wall2 = WallId::new();

        manager.invalidate_wall(wall1);
        manager.invalidate_wall(wall2);
        assert_eq!(manager.dirty_count(), 2);

        manager.clear();
        assert_eq!(manager.dirty_count(), 0);
    }

    #[test]
    fn test_reset() {
        let mut manager = RegenerationManager::new();
        let wall_id = WallId::new();
        let opening_id = OpeningId::new();

        manager.invalidate_opening(opening_id, wall_id);
        assert!(manager.has_dirty_walls());
        assert!(manager.get_wall_for_opening(opening_id).is_some());

        manager.reset();
        assert!(!manager.has_dirty_walls());
        assert!(manager.get_wall_for_opening(opening_id).is_none());
    }

    #[test]
    fn test_remove_opening() {
        let mut manager = RegenerationManager::new();
        let wall_id = WallId::new();
        let opening_id = OpeningId::new();

        manager.register_opening(opening_id, wall_id);
        manager.clear(); // Clear any dirty state

        manager.remove_opening(opening_id);

        // Wall should be marked dirty when opening is removed
        assert!(manager.is_wall_dirty(wall_id));
        // Opening should no longer be tracked
        assert!(manager.get_wall_for_opening(opening_id).is_none());
    }

    #[test]
    fn test_get_openings_for_wall() {
        let mut manager = RegenerationManager::new();
        let wall_id = WallId::new();
        let opening1 = OpeningId::new();
        let opening2 = OpeningId::new();
        let other_wall = WallId::new();
        let other_opening = OpeningId::new();

        manager.register_opening(opening1, wall_id);
        manager.register_opening(opening2, wall_id);
        manager.register_opening(other_opening, other_wall);

        let openings = manager.get_openings_for_wall(wall_id);
        assert_eq!(openings.len(), 2);
        assert!(openings.contains(&opening1));
        assert!(openings.contains(&opening2));
        assert!(!openings.contains(&other_opening));
    }

    #[test]
    fn test_duplicate_invalidation() {
        let mut manager = RegenerationManager::new();
        let wall_id = WallId::new();

        manager.invalidate_wall(wall_id);
        manager.invalidate_wall(wall_id);
        manager.invalidate_wall(wall_id);

        // Should only count once
        assert_eq!(manager.dirty_count(), 1);
    }

    #[test]
    fn test_get_dirty_walls() {
        let mut manager = RegenerationManager::new();
        let wall1 = WallId::new();
        let wall2 = WallId::new();

        manager.invalidate_wall(wall1);
        manager.invalidate_wall(wall2);

        let dirty = manager.get_dirty_walls();
        assert!(dirty.contains(&wall1));
        assert!(dirty.contains(&wall2));
    }
}
