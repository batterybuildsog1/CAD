// Structured error types for observable feedback loops
// These errors provide rich context for AI-driven self-correction

use serde::{Deserialize, Serialize};

/// Machine-readable error codes for Gemini to understand error types
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    // Entity errors
    EntityNotFound,
    EntityAlreadyExists,
    InvalidEntityReference,

    // Parameter errors
    InvalidParameter,
    MissingParameter,
    ParameterOutOfRange,

    // Geometry errors
    InvalidGeometry,
    DegenerateGeometry,
    GeometryTooSmall,
    GeometryOutOfBounds,

    // Validation errors
    ValidationFailed,
    ConstraintViolation,

    // System errors
    InternalError,
    OperationNotSupported,
}

impl ErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorCode::EntityNotFound => "ENTITY_NOT_FOUND",
            ErrorCode::EntityAlreadyExists => "ENTITY_ALREADY_EXISTS",
            ErrorCode::InvalidEntityReference => "INVALID_ENTITY_REFERENCE",
            ErrorCode::InvalidParameter => "INVALID_PARAMETER",
            ErrorCode::MissingParameter => "MISSING_PARAMETER",
            ErrorCode::ParameterOutOfRange => "PARAMETER_OUT_OF_RANGE",
            ErrorCode::InvalidGeometry => "INVALID_GEOMETRY",
            ErrorCode::DegenerateGeometry => "DEGENERATE_GEOMETRY",
            ErrorCode::GeometryTooSmall => "GEOMETRY_TOO_SMALL",
            ErrorCode::GeometryOutOfBounds => "GEOMETRY_OUT_OF_BOUNDS",
            ErrorCode::ValidationFailed => "VALIDATION_FAILED",
            ErrorCode::ConstraintViolation => "CONSTRAINT_VIOLATION",
            ErrorCode::InternalError => "INTERNAL_ERROR",
            ErrorCode::OperationNotSupported => "OPERATION_NOT_SUPPORTED",
        }
    }
}

/// Entity types for error context
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EntityType {
    Project,
    Site,
    Building,
    Level,
    Footprint,
    Grid,
    Wall,
    WallAssembly,
    Room,
    Opening,
}

impl EntityType {
    pub fn as_str(&self) -> &'static str {
        match self {
            EntityType::Project => "project",
            EntityType::Site => "site",
            EntityType::Building => "building",
            EntityType::Level => "level",
            EntityType::Footprint => "footprint",
            EntityType::Grid => "grid",
            EntityType::Wall => "wall",
            EntityType::WallAssembly => "wall_assembly",
            EntityType::Room => "room",
            EntityType::Opening => "opening",
        }
    }
}

/// A structured error with rich context for AI self-correction
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StructuredError {
    /// Machine-readable error code
    pub code: ErrorCode,

    /// Human-readable error message
    pub message: String,

    /// Type of entity involved (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_type: Option<EntityType>,

    /// ID of the entity involved (optional, as string for serialization)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub entity_id: Option<String>,

    /// Field that caused the error (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,

    /// The invalid value that was provided (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provided_value: Option<String>,

    /// Valid range or acceptable values (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub valid_range: Option<String>,

    /// Suggested corrections or next steps
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub suggestions: Vec<String>,
}

impl StructuredError {
    /// Create an entity not found error
    pub fn entity_not_found(entity_type: EntityType, id: impl std::fmt::Debug) -> Self {
        let id_str = format!("{:?}", id);
        Self {
            code: ErrorCode::EntityNotFound,
            message: format!("{} not found", entity_type.as_str()),
            entity_type: Some(entity_type.clone()),
            entity_id: Some(id_str),
            field: None,
            provided_value: None,
            valid_range: None,
            suggestions: vec![
                format!("Verify the {} ID is correct", entity_type.as_str()),
                format!("Use list_{}s to see available IDs", entity_type.as_str()),
            ],
        }
    }

    /// Create an invalid parameter error
    pub fn invalid_parameter(
        field: impl Into<String>,
        message: impl Into<String>,
        provided: impl Into<String>,
        valid_range: Option<String>,
    ) -> Self {
        let field = field.into();
        let suggestions = if let Some(ref range) = valid_range {
            vec![format!("Provide a value within: {}", range)]
        } else {
            vec![]
        };

        Self {
            code: ErrorCode::InvalidParameter,
            message: message.into(),
            entity_type: None,
            entity_id: None,
            field: Some(field),
            provided_value: Some(provided.into()),
            valid_range,
            suggestions,
        }
    }

    /// Create a parameter out of range error
    pub fn parameter_out_of_range(
        field: impl Into<String>,
        provided: f64,
        min: Option<f64>,
        max: Option<f64>,
    ) -> Self {
        let field = field.into();
        let range = match (min, max) {
            (Some(min), Some(max)) => format!("{} to {}", min, max),
            (Some(min), None) => format!("≥ {}", min),
            (None, Some(max)) => format!("≤ {}", max),
            (None, None) => "valid range".to_string(),
        };

        Self {
            code: ErrorCode::ParameterOutOfRange,
            message: format!("{} is out of valid range", field),
            entity_type: None,
            entity_id: None,
            field: Some(field.clone()),
            provided_value: Some(provided.to_string()),
            valid_range: Some(range.clone()),
            suggestions: vec![
                format!("Use a value in range: {}", range),
            ],
        }
    }

    /// Create an invalid geometry error
    pub fn invalid_geometry(message: impl Into<String>, suggestions: Vec<String>) -> Self {
        Self {
            code: ErrorCode::InvalidGeometry,
            message: message.into(),
            entity_type: None,
            entity_id: None,
            field: None,
            provided_value: None,
            valid_range: None,
            suggestions,
        }
    }

    /// Create a degenerate geometry error (e.g., polygon with < 3 points)
    pub fn degenerate_geometry(entity_type: EntityType, details: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::DegenerateGeometry,
            message: details.into(),
            entity_type: Some(entity_type),
            entity_id: None,
            field: None,
            provided_value: None,
            valid_range: None,
            suggestions: vec![
                "Ensure polygon has at least 3 distinct points".to_string(),
                "Check that points form a valid, non-self-intersecting shape".to_string(),
            ],
        }
    }

    /// Create a constraint violation error
    pub fn constraint_violation(message: impl Into<String>, suggestions: Vec<String>) -> Self {
        Self {
            code: ErrorCode::ConstraintViolation,
            message: message.into(),
            entity_type: None,
            entity_id: None,
            field: None,
            provided_value: None,
            valid_range: None,
            suggestions,
        }
    }

    /// Create an entity already exists error
    pub fn entity_already_exists(entity_type: EntityType, context: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::EntityAlreadyExists,
            message: format!("{} already exists", entity_type.as_str()),
            entity_type: Some(entity_type),
            entity_id: None,
            field: None,
            provided_value: Some(context.into()),
            valid_range: None,
            suggestions: vec![
                "Remove the existing entity first".to_string(),
                "Or modify the existing entity instead".to_string(),
            ],
        }
    }

    /// Create an unknown unit system error
    pub fn unknown_unit_system(provided: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::InvalidParameter,
            message: "Unknown unit system".to_string(),
            entity_type: None,
            entity_id: None,
            field: Some("units".to_string()),
            provided_value: Some(provided.into()),
            valid_range: Some("imperial, metric".to_string()),
            suggestions: vec![
                "Use 'imperial' for US/feet-based units".to_string(),
                "Use 'metric' for SI/meter-based units".to_string(),
            ],
        }
    }

    /// Create an unknown code region error
    pub fn unknown_code_region(provided: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::InvalidParameter,
            message: "Unknown building code region".to_string(),
            entity_type: None,
            entity_id: None,
            field: Some("code_region".to_string()),
            provided_value: Some(provided.into()),
            valid_range: Some("US_IRC_2021, US_IBC_2021, etc.".to_string()),
            suggestions: vec![
                "Use format: CODE_YEAR (e.g., US_IRC_2021)".to_string(),
                "IRC = International Residential Code".to_string(),
                "IBC = International Building Code".to_string(),
            ],
        }
    }

    /// Create an unknown room type error
    pub fn unknown_room_type(provided: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::InvalidParameter,
            message: "Unknown room type".to_string(),
            entity_type: Some(EntityType::Room),
            entity_id: None,
            field: Some("room_type".to_string()),
            provided_value: Some(provided.into()),
            valid_range: Some("living, kitchen, bedroom, bathroom, garage, utility, hallway".to_string()),
            suggestions: vec![
                "Use one of the standard room types".to_string(),
                "Custom types are allowed but may not have full code compliance checking".to_string(),
            ],
        }
    }

    /// Create an unknown opening type error
    pub fn unknown_opening_type(provided: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::InvalidParameter,
            message: "Unknown opening type".to_string(),
            entity_type: Some(EntityType::Opening),
            entity_id: None,
            field: Some("opening_type".to_string()),
            provided_value: Some(provided.into()),
            valid_range: Some("window, door".to_string()),
            suggestions: vec![
                "Use 'window' for window openings".to_string(),
                "Use 'door' for door openings".to_string(),
            ],
        }
    }

    /// Create an unknown grid direction error
    pub fn unknown_grid_direction(provided: impl Into<String>) -> Self {
        Self {
            code: ErrorCode::InvalidParameter,
            message: "Unknown grid direction".to_string(),
            entity_type: Some(EntityType::Grid),
            entity_id: None,
            field: Some("direction".to_string()),
            provided_value: Some(provided.into()),
            valid_range: Some("horizontal, vertical".to_string()),
            suggestions: vec![
                "Use 'horizontal' or 'h' for horizontal grid lines".to_string(),
                "Use 'vertical' or 'v' for vertical grid lines".to_string(),
            ],
        }
    }

    /// Convert to a format suitable for Rhai (as string pairs)
    pub fn to_rhai_string(&self) -> String {
        // Return a JSON-like string that Gemini can parse
        serde_json::to_string(self).unwrap_or_else(|_| self.message.clone())
    }
}

impl std::fmt::Display for StructuredError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_rhai_string())
    }
}

impl std::error::Error for StructuredError {}

// Convert from anyhow::Error to StructuredError for catch-all cases
impl From<anyhow::Error> for StructuredError {
    fn from(err: anyhow::Error) -> Self {
        // Try to parse the error message for known patterns
        let msg = err.to_string();

        // Check for common patterns
        if msg.contains("not found") {
            // Try to extract entity type from message
            let entity_type = if msg.contains("Project") {
                Some(EntityType::Project)
            } else if msg.contains("Building") {
                Some(EntityType::Building)
            } else if msg.contains("Level") {
                Some(EntityType::Level)
            } else if msg.contains("Wall") && !msg.contains("WallAssembly") {
                Some(EntityType::Wall)
            } else if msg.contains("WallAssembly") || msg.contains("Wall assembly") {
                Some(EntityType::WallAssembly)
            } else if msg.contains("Room") {
                Some(EntityType::Room)
            } else if msg.contains("Opening") {
                Some(EntityType::Opening)
            } else if msg.contains("Footprint") {
                Some(EntityType::Footprint)
            } else if msg.contains("Grid") {
                Some(EntityType::Grid)
            } else if msg.contains("Site") {
                Some(EntityType::Site)
            } else {
                None
            };

            Self {
                code: ErrorCode::EntityNotFound,
                message: msg,
                entity_type,
                entity_id: None,
                field: None,
                provided_value: None,
                valid_range: None,
                suggestions: vec!["Check that the entity ID is correct".to_string()],
            }
        } else if msg.contains("Invalid") {
            Self {
                code: ErrorCode::ValidationFailed,
                message: msg,
                entity_type: None,
                entity_id: None,
                field: None,
                provided_value: None,
                valid_range: None,
                suggestions: vec![],
            }
        } else {
            Self {
                code: ErrorCode::InternalError,
                message: msg,
                entity_type: None,
                entity_id: None,
                field: None,
                provided_value: None,
                valid_range: None,
                suggestions: vec![],
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_entity_not_found_serialization() {
        let err = StructuredError::entity_not_found(EntityType::Project, "proj_123");
        let json = serde_json::to_string(&err).unwrap();

        assert!(json.contains("ENTITY_NOT_FOUND"));
        assert!(json.contains("project"));
        assert!(json.contains("proj_123"));
    }

    #[test]
    fn test_parameter_out_of_range() {
        let err = StructuredError::parameter_out_of_range("position", 1.5, Some(0.0), Some(1.0));

        assert_eq!(err.code, ErrorCode::ParameterOutOfRange);
        assert!(err.message.contains("position"));
        assert_eq!(err.provided_value, Some("1.5".to_string()));
        assert!(err.valid_range.unwrap().contains("0 to 1"));
    }

    #[test]
    fn test_structured_error_display() {
        let err = StructuredError::unknown_unit_system("fathoms");
        let display = format!("{}", err);

        // Should be JSON format
        assert!(display.contains("fathoms"));
        assert!(display.contains("INVALID_PARAMETER"));
    }
}
