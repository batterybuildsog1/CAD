// Room definitions - spatial zones within levels
// Rooms can be defined manually or auto-detected from wall layouts

use serde::{Deserialize, Serialize};
use super::ids::{RoomId, LevelId, WallId};
use super::spatial::Polygon2;

/// Type of room - used for scheduling, code compliance, HVAC zoning
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoomType {
    LivingRoom,
    Kitchen,
    Bedroom,
    Bathroom,
    Closet,
    Hallway,
    Utility,
    Garage,
    DiningRoom,
    FamilyRoom,
    Office,
    Laundry,
    Pantry,
    Mudroom,
    Foyer,
    Other(String),
}

impl RoomType {
    /// Parse from string
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "living_room" | "livingroom" | "living" => Self::LivingRoom,
            "kitchen" => Self::Kitchen,
            "bedroom" | "bed" => Self::Bedroom,
            "bathroom" | "bath" => Self::Bathroom,
            "closet" => Self::Closet,
            "hallway" | "hall" | "corridor" => Self::Hallway,
            "utility" | "mech" | "mechanical" => Self::Utility,
            "garage" => Self::Garage,
            "dining_room" | "diningroom" | "dining" => Self::DiningRoom,
            "family_room" | "familyroom" | "family" => Self::FamilyRoom,
            "office" | "study" => Self::Office,
            "laundry" => Self::Laundry,
            "pantry" => Self::Pantry,
            "mudroom" | "mud" => Self::Mudroom,
            "foyer" | "entry" => Self::Foyer,
            _ => Self::Other(s.to_string()),
        }
    }

    /// Get display name
    pub fn display_name(&self) -> String {
        match self {
            Self::LivingRoom => "Living Room".to_string(),
            Self::Kitchen => "Kitchen".to_string(),
            Self::Bedroom => "Bedroom".to_string(),
            Self::Bathroom => "Bathroom".to_string(),
            Self::Closet => "Closet".to_string(),
            Self::Hallway => "Hallway".to_string(),
            Self::Utility => "Utility".to_string(),
            Self::Garage => "Garage".to_string(),
            Self::DiningRoom => "Dining Room".to_string(),
            Self::FamilyRoom => "Family Room".to_string(),
            Self::Office => "Office".to_string(),
            Self::Laundry => "Laundry".to_string(),
            Self::Pantry => "Pantry".to_string(),
            Self::Mudroom => "Mudroom".to_string(),
            Self::Foyer => "Foyer".to_string(),
            Self::Other(name) => name.clone(),
        }
    }
}

impl Default for RoomType {
    fn default() -> Self {
        Self::Other("Unspecified".to_string())
    }
}

/// A room - a bounded spatial zone within a level
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Room {
    pub id: RoomId,
    pub level_id: LevelId,
    pub room_type: RoomType,
    pub name: String,
    pub boundary: Polygon2,
    pub floor_finish: String,
    pub ceiling_height: Option<f64>, // None = use level's floor_to_floor
    pub bounding_wall_ids: Vec<WallId>,
}

impl Room {
    pub fn new(
        level_id: LevelId,
        room_type: RoomType,
        name: impl Into<String>,
        boundary: Polygon2,
    ) -> Self {
        Self {
            id: RoomId::new(),
            level_id,
            room_type,
            name: name.into(),
            boundary,
            floor_finish: "Hardwood".to_string(),
            ceiling_height: None,
            bounding_wall_ids: Vec::new(),
        }
    }

    /// Get the area of this room in square feet/meters
    pub fn area(&self) -> f64 {
        self.boundary.area()
    }

    /// Get the perimeter of this room
    pub fn perimeter(&self) -> f64 {
        self.boundary.perimeter()
    }

    /// Check if the room boundary is valid
    pub fn is_valid(&self) -> bool {
        self.boundary.is_valid() && self.area() > 0.0
    }

    /// Set floor finish material
    pub fn with_floor_finish(mut self, finish: impl Into<String>) -> Self {
        self.floor_finish = finish.into();
        self
    }

    /// Set custom ceiling height (overrides level default)
    pub fn with_ceiling_height(mut self, height: f64) -> Self {
        self.ceiling_height = Some(height);
        self
    }

    /// Set the bounding walls for this room
    pub fn set_bounding_walls(&mut self, wall_ids: Vec<WallId>) {
        self.bounding_wall_ids = wall_ids;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Point2;

    #[test]
    fn test_room_creation() {
        let level_id = LevelId::new();
        let boundary = Polygon2::rectangle(15.0, 20.0); // 15' x 20' bedroom
        let room = Room::new(level_id, RoomType::Bedroom, "Primary Bedroom", boundary);

        assert_eq!(room.room_type, RoomType::Bedroom);
        assert_eq!(room.name, "Primary Bedroom");
        assert!((room.area() - 300.0).abs() < 1e-10); // 300 sq ft
        assert!(room.is_valid());
    }

    #[test]
    fn test_room_type_parsing() {
        assert_eq!(RoomType::from_str("kitchen"), RoomType::Kitchen);
        assert_eq!(RoomType::from_str("living_room"), RoomType::LivingRoom);
        assert_eq!(RoomType::from_str("bedroom"), RoomType::Bedroom);

        if let RoomType::Other(name) = RoomType::from_str("custom") {
            assert_eq!(name, "custom");
        } else {
            panic!("Expected Other variant");
        }
    }

    #[test]
    fn test_room_type_display() {
        assert_eq!(RoomType::Kitchen.display_name(), "Kitchen");
        assert_eq!(RoomType::LivingRoom.display_name(), "Living Room");
    }

    #[test]
    fn test_room_perimeter() {
        let level_id = LevelId::new();
        let boundary = Polygon2::rectangle(10.0, 12.0);
        let room = Room::new(level_id, RoomType::Bedroom, "Bedroom 2", boundary);

        assert!((room.perimeter() - 44.0).abs() < 1e-10); // 2*(10+12)
    }

    #[test]
    fn test_room_with_ceiling_height() {
        let level_id = LevelId::new();
        let boundary = Polygon2::rectangle(20.0, 25.0);
        let room = Room::new(level_id, RoomType::LivingRoom, "Great Room", boundary)
            .with_ceiling_height(12.0) // Vaulted ceiling
            .with_floor_finish("Oak");

        assert_eq!(room.ceiling_height, Some(12.0));
        assert_eq!(room.floor_finish, "Oak");
    }
}
