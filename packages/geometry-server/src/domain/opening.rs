// Opening types - windows, doors, and other wall penetrations
// Openings are placed on walls with parametric positioning

use serde::{Deserialize, Serialize};
use super::ids::{OpeningId, WallId};

/// Type of opening in a wall
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OpeningType {
    Window,
    Door,
    Other(String),
}

impl OpeningType {
    /// Parse from string
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "window" => Self::Window,
            "door" => Self::Door,
            _ => Self::Other(s.to_string()),
        }
    }

    /// Get display name
    pub fn display_name(&self) -> String {
        match self {
            Self::Window => "Window".to_string(),
            Self::Door => "Door".to_string(),
            Self::Other(name) => name.clone(),
        }
    }
}

/// Properties specific to windows
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowProperties {
    pub u_value: f64,              // Thermal transmittance (BTU/hr·ft²·°F or W/m²·K)
    pub shgc: f64,                 // Solar heat gain coefficient (0.0 to 1.0)
}

impl WindowProperties {
    pub fn new(u_value: f64, shgc: f64) -> Self {
        Self { u_value, shgc }
    }

    /// Standard double-pane window (moderate performance)
    pub fn double_pane() -> Self {
        Self {
            u_value: 0.30,  // Decent insulation
            shgc: 0.30,     // Moderate solar gain
        }
    }

    /// High-performance window (low-E, argon fill)
    pub fn high_performance() -> Self {
        Self {
            u_value: 0.20,  // Better insulation
            shgc: 0.25,     // Lower solar gain
        }
    }
}

/// Properties specific to doors
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DoorProperties {
    pub is_exterior: bool,
    pub fire_rating: Option<u32>,  // Fire rating in minutes (e.g., 20, 45, 60, 90)
}

impl DoorProperties {
    pub fn new(is_exterior: bool, fire_rating: Option<u32>) -> Self {
        Self {
            is_exterior,
            fire_rating,
        }
    }

    /// Standard interior door (no fire rating)
    pub fn interior() -> Self {
        Self {
            is_exterior: false,
            fire_rating: None,
        }
    }

    /// Exterior door
    pub fn exterior() -> Self {
        Self {
            is_exterior: true,
            fire_rating: None,
        }
    }

    /// Fire-rated door
    pub fn fire_rated(minutes: u32) -> Self {
        Self {
            is_exterior: false,
            fire_rating: Some(minutes),
        }
    }
}

/// An opening (window, door, etc.) in a wall
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Opening {
    pub id: OpeningId,
    pub wall_id: WallId,
    pub opening_type: OpeningType,
    pub position_along_wall: f64,   // Parametric position (0.0 = start, 1.0 = end)
    pub width: f64,                 // Horizontal width of opening
    pub height: f64,                // Vertical height of opening
    pub sill_height: f64,           // Height from floor to bottom of opening
    pub window_properties: Option<WindowProperties>,
    pub door_properties: Option<DoorProperties>,
}

impl Opening {
    pub fn new(
        wall_id: WallId,
        opening_type: OpeningType,
        position_along_wall: f64,
        width: f64,
        height: f64,
        sill_height: f64,
    ) -> Self {
        Self {
            id: OpeningId::new(),
            wall_id,
            opening_type,
            position_along_wall,
            width,
            height,
            sill_height,
            window_properties: None,
            door_properties: None,
        }
    }

    /// Create a window opening with properties
    pub fn window(
        wall_id: WallId,
        position_along_wall: f64,
        width: f64,
        height: f64,
        sill_height: f64,
        properties: WindowProperties,
    ) -> Self {
        Self {
            id: OpeningId::new(),
            wall_id,
            opening_type: OpeningType::Window,
            position_along_wall,
            width,
            height,
            sill_height,
            window_properties: Some(properties),
            door_properties: None,
        }
    }

    /// Create a door opening with properties
    pub fn door(
        wall_id: WallId,
        position_along_wall: f64,
        width: f64,
        height: f64,
        properties: DoorProperties,
    ) -> Self {
        Self {
            id: OpeningId::new(),
            wall_id,
            opening_type: OpeningType::Door,
            position_along_wall,
            width,
            height,
            sill_height: 0.0,  // Doors typically start at floor level
            window_properties: None,
            door_properties: Some(properties),
        }
    }

    /// Add window properties
    pub fn with_window_properties(mut self, properties: WindowProperties) -> Self {
        self.window_properties = Some(properties);
        self
    }

    /// Add door properties
    pub fn with_door_properties(mut self, properties: DoorProperties) -> Self {
        self.door_properties = Some(properties);
        self
    }

    /// Calculate the area of the opening
    pub fn area(&self) -> f64 {
        self.width * self.height
    }

    /// Check if the opening is valid (position between 0 and 1, positive dimensions)
    pub fn is_valid(&self) -> bool {
        self.position_along_wall >= 0.0
            && self.position_along_wall <= 1.0
            && self.width > 0.0
            && self.height > 0.0
            && self.sill_height >= 0.0
    }

    /// Get the head height (top of opening from floor)
    pub fn head_height(&self) -> f64 {
        self.sill_height + self.height
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_creation() {
        let wall_id = WallId::new();
        let window = Opening::window(
            wall_id,
            0.5,  // Middle of wall
            3.0,  // 3 feet wide
            4.0,  // 4 feet tall
            3.0,  // 3 feet sill height
            WindowProperties::double_pane(),
        );

        assert_eq!(window.opening_type, OpeningType::Window);
        assert_eq!(window.position_along_wall, 0.5);
        assert_eq!(window.width, 3.0);
        assert_eq!(window.height, 4.0);
        assert_eq!(window.sill_height, 3.0);
        assert_eq!(window.head_height(), 7.0);
        assert!((window.area() - 12.0).abs() < 1e-10);
        assert!(window.is_valid());
        assert!(window.window_properties.is_some());
    }

    #[test]
    fn test_door_creation() {
        let wall_id = WallId::new();
        let door = Opening::door(
            wall_id,
            0.3,  // 30% along wall
            3.0,  // 3 feet wide
            7.0,  // 7 feet tall (standard door height)
            DoorProperties::interior(),
        );

        assert_eq!(door.opening_type, OpeningType::Door);
        assert_eq!(door.sill_height, 0.0);  // Doors start at floor
        assert_eq!(door.head_height(), 7.0);
        assert!(door.is_valid());
        assert!(door.door_properties.is_some());
    }

    #[test]
    fn test_opening_area() {
        let wall_id = WallId::new();
        let opening = Opening::new(
            wall_id,
            OpeningType::Window,
            0.5,
            4.0,  // 4 feet wide
            5.0,  // 5 feet tall
            2.0,
        );

        assert!((opening.area() - 20.0).abs() < 1e-10);
    }

    #[test]
    fn test_opening_validation() {
        let wall_id = WallId::new();

        // Valid opening
        let valid = Opening::new(wall_id, OpeningType::Window, 0.5, 3.0, 4.0, 2.0);
        assert!(valid.is_valid());

        // Invalid position (> 1.0)
        let invalid_pos = Opening::new(wall_id, OpeningType::Window, 1.5, 3.0, 4.0, 2.0);
        assert!(!invalid_pos.is_valid());

        // Invalid width (negative)
        let invalid_width = Opening::new(wall_id, OpeningType::Window, 0.5, -3.0, 4.0, 2.0);
        assert!(!invalid_width.is_valid());
    }

    #[test]
    fn test_fire_rated_door() {
        let wall_id = WallId::new();
        let door = Opening::door(
            wall_id,
            0.2,
            3.0,
            7.0,
            DoorProperties::fire_rated(90),
        );

        assert!(door.door_properties.is_some());
        assert_eq!(door.door_properties.unwrap().fire_rating, Some(90));
    }

    #[test]
    fn test_window_properties() {
        let hp = WindowProperties::high_performance();
        assert!(hp.u_value < 0.25);
        assert!(hp.shgc < 0.30);

        let dp = WindowProperties::double_pane();
        assert_eq!(dp.u_value, 0.30);
        assert_eq!(dp.shgc, 0.30);
    }
}
