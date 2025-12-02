// Framing domain types - wall framing members and layouts
// Provides data structures for generating and managing wood/steel framing

use serde::{Deserialize, Serialize};
use super::ids::{FramingMemberId, FramingLayoutId, WallId, OpeningId};
use super::spatial::Point3;

/// Standard lumber sizes (nominal dimensions)
/// Actual dimensions are smaller due to milling
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LumberSize {
    /// 2x4 nominal (1.5" x 3.5" actual)
    TwoByFour,
    /// 2x6 nominal (1.5" x 5.5" actual)
    TwoBySix,
    /// 2x8 nominal (1.5" x 7.25" actual)
    TwoByEight,
    /// 2x10 nominal (1.5" x 9.25" actual)
    TwoByTen,
    /// 2x12 nominal (1.5" x 11.25" actual)
    TwoByTwelve,
    /// 4x4 nominal (3.5" x 3.5" actual)
    FourByFour,
    /// 4x6 nominal (3.5" x 5.5" actual)
    FourBySix,
    /// Custom size with actual dimensions
    Custom { width: f64, depth: f64 },
}

impl LumberSize {
    /// Get the actual dimensions (width, depth) in inches
    /// Width is the narrow dimension, depth is the wide dimension
    pub fn actual_dimensions(&self) -> (f64, f64) {
        match self {
            LumberSize::TwoByFour => (1.5, 3.5),
            LumberSize::TwoBySix => (1.5, 5.5),
            LumberSize::TwoByEight => (1.5, 7.25),
            LumberSize::TwoByTen => (1.5, 9.25),
            LumberSize::TwoByTwelve => (1.5, 11.25),
            LumberSize::FourByFour => (3.5, 3.5),
            LumberSize::FourBySix => (3.5, 5.5),
            LumberSize::Custom { width, depth } => (*width, *depth),
        }
    }

    /// Get the nominal name as a string
    pub fn nominal_name(&self) -> String {
        match self {
            LumberSize::TwoByFour => "2x4".to_string(),
            LumberSize::TwoBySix => "2x6".to_string(),
            LumberSize::TwoByEight => "2x8".to_string(),
            LumberSize::TwoByTen => "2x10".to_string(),
            LumberSize::TwoByTwelve => "2x12".to_string(),
            LumberSize::FourByFour => "4x4".to_string(),
            LumberSize::FourBySix => "4x6".to_string(),
            LumberSize::Custom { width, depth } => format!("{}x{}", width, depth),
        }
    }

    /// Calculate board feet per linear foot
    pub fn board_feet_per_foot(&self) -> f64 {
        let (width, depth) = self.actual_dimensions();
        // Board foot = (width * depth * length) / 144
        // Per linear foot: (width * depth * 12) / 144 = width * depth / 12
        width * depth / 12.0
    }
}

impl Default for LumberSize {
    fn default() -> Self {
        LumberSize::TwoBySix
    }
}

/// Type of framing member within a wall assembly
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FramingMemberType {
    /// Standard vertical stud (typically 16" or 24" OC)
    Stud,
    /// King stud - full-height stud adjacent to opening
    KingStud,
    /// Jack stud (trimmer) - supports header, shorter than king stud
    JackStud,
    /// Horizontal member spanning opening top
    Header,
    /// Bottom horizontal plate (sole plate)
    BottomPlate,
    /// Top horizontal plate
    TopPlate,
    /// Second top plate for load-bearing walls
    DoubleTopPlate,
    /// Cripple stud - short stud above/below openings
    CrippleStud,
    /// Sill plate below window openings
    Sill,
    /// Horizontal blocking for fire stopping
    FireBlocking,
}

impl FramingMemberType {
    /// Get display name for the member type
    pub fn display_name(&self) -> &'static str {
        match self {
            FramingMemberType::Stud => "Stud",
            FramingMemberType::KingStud => "King Stud",
            FramingMemberType::JackStud => "Jack Stud",
            FramingMemberType::Header => "Header",
            FramingMemberType::BottomPlate => "Bottom Plate",
            FramingMemberType::TopPlate => "Top Plate",
            FramingMemberType::DoubleTopPlate => "Double Top Plate",
            FramingMemberType::CrippleStud => "Cripple Stud",
            FramingMemberType::Sill => "Sill",
            FramingMemberType::FireBlocking => "Fire Blocking",
        }
    }

    /// Check if this member type is vertical
    pub fn is_vertical(&self) -> bool {
        matches!(
            self,
            FramingMemberType::Stud
                | FramingMemberType::KingStud
                | FramingMemberType::JackStud
                | FramingMemberType::CrippleStud
        )
    }

    /// Check if this member type is horizontal
    pub fn is_horizontal(&self) -> bool {
        !self.is_vertical()
    }
}

/// Material type for framing members
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FramingMaterial {
    /// Spruce-Pine-Fir (most common residential)
    SPF,
    /// Douglas Fir (stronger, often for headers)
    DF,
    /// Southern Yellow Pine
    SYP,
    /// Laminated Veneer Lumber (engineered)
    LVL,
    /// Parallel Strand Lumber (engineered)
    PSL,
    /// Steel studs
    Steel,
}

impl FramingMaterial {
    /// Get display name
    pub fn display_name(&self) -> &'static str {
        match self {
            FramingMaterial::SPF => "SPF (Spruce-Pine-Fir)",
            FramingMaterial::DF => "Douglas Fir",
            FramingMaterial::SYP => "Southern Yellow Pine",
            FramingMaterial::LVL => "LVL (Laminated Veneer Lumber)",
            FramingMaterial::PSL => "PSL (Parallel Strand Lumber)",
            FramingMaterial::Steel => "Steel",
        }
    }

    /// Check if this is an engineered wood product
    pub fn is_engineered(&self) -> bool {
        matches!(self, FramingMaterial::LVL | FramingMaterial::PSL)
    }
}

impl Default for FramingMaterial {
    fn default() -> Self {
        FramingMaterial::SPF
    }
}

/// Header type for openings based on span and load
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HeaderType {
    /// Double 2x lumber (typical for short spans)
    DoubleLumber,
    /// Triple 2x lumber (medium spans)
    TripleLumber,
    /// LVL beam header (longer spans)
    LVL,
    /// PSL beam header (heavy loads)
    PSL,
    /// Steel lintel
    SteelLintel,
    /// Glulam beam
    Glulam,
}

impl HeaderType {
    /// Get display name
    pub fn display_name(&self) -> &'static str {
        match self {
            HeaderType::DoubleLumber => "Double Lumber",
            HeaderType::TripleLumber => "Triple Lumber",
            HeaderType::LVL => "LVL Beam",
            HeaderType::PSL => "PSL Beam",
            HeaderType::SteelLintel => "Steel Lintel",
            HeaderType::Glulam => "Glulam Beam",
        }
    }

    /// Suggest header type based on span width (in inches)
    pub fn for_span(span: f64, is_load_bearing: bool) -> Self {
        if !is_load_bearing {
            // Non-load-bearing: can use minimal headers
            if span <= 48.0 {
                HeaderType::DoubleLumber
            } else {
                HeaderType::TripleLumber
            }
        } else {
            // Load-bearing: size appropriately
            if span <= 36.0 {
                HeaderType::DoubleLumber
            } else if span <= 60.0 {
                HeaderType::TripleLumber
            } else if span <= 96.0 {
                HeaderType::LVL
            } else {
                HeaderType::PSL
            }
        }
    }
}

impl Default for HeaderType {
    fn default() -> Self {
        HeaderType::DoubleLumber
    }
}

/// An individual framing member (stud, plate, header, etc.)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FramingMember {
    pub id: FramingMemberId,
    pub member_type: FramingMemberType,
    pub lumber_size: LumberSize,
    pub material: FramingMaterial,
    /// Position of the member's start point in 3D space
    pub position: Point3,
    /// Length of the member in inches
    pub length: f64,
    /// Rotation around the vertical axis in radians (for horizontal members)
    pub rotation: f64,
    /// The wall this member belongs to
    pub wall_id: WallId,
    /// Optional: the opening this member is associated with (for jack studs, headers, etc.)
    pub opening_id: Option<OpeningId>,
}

impl FramingMember {
    pub fn new(
        member_type: FramingMemberType,
        lumber_size: LumberSize,
        material: FramingMaterial,
        position: Point3,
        length: f64,
        rotation: f64,
        wall_id: WallId,
    ) -> Self {
        Self {
            id: FramingMemberId::new(),
            member_type,
            lumber_size,
            material,
            position,
            length,
            rotation,
            wall_id,
            opening_id: None,
        }
    }

    /// Create a member associated with an opening
    pub fn with_opening(mut self, opening_id: OpeningId) -> Self {
        self.opening_id = Some(opening_id);
        self
    }

    /// Calculate board feet for this member
    pub fn board_feet(&self) -> f64 {
        self.lumber_size.board_feet_per_foot() * (self.length / 12.0)
    }

    /// Get the actual cross-section dimensions
    pub fn cross_section(&self) -> (f64, f64) {
        self.lumber_size.actual_dimensions()
    }

    /// Create a standard stud
    pub fn stud(
        position: Point3,
        length: f64,
        lumber_size: LumberSize,
        wall_id: WallId,
    ) -> Self {
        Self::new(
            FramingMemberType::Stud,
            lumber_size,
            FramingMaterial::SPF,
            position,
            length,
            0.0,
            wall_id,
        )
    }

    /// Create a bottom plate
    pub fn bottom_plate(
        position: Point3,
        length: f64,
        lumber_size: LumberSize,
        rotation: f64,
        wall_id: WallId,
    ) -> Self {
        Self::new(
            FramingMemberType::BottomPlate,
            lumber_size,
            FramingMaterial::SPF,
            position,
            length,
            rotation,
            wall_id,
        )
    }

    /// Create a top plate
    pub fn top_plate(
        position: Point3,
        length: f64,
        lumber_size: LumberSize,
        rotation: f64,
        wall_id: WallId,
    ) -> Self {
        Self::new(
            FramingMemberType::TopPlate,
            lumber_size,
            FramingMaterial::SPF,
            position,
            length,
            rotation,
            wall_id,
        )
    }
}

/// Rough opening configuration for doors and windows
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoughOpening {
    /// The opening this rough opening is for
    pub opening_id: OpeningId,
    /// Width of the rough opening (includes framing tolerance)
    pub width: f64,
    /// Height of the rough opening
    pub height: f64,
    /// Position along the wall (distance from wall start to RO center)
    pub position_along_wall: f64,
    /// Number of jack studs on each side (typically 1-2)
    pub jack_stud_count: u8,
    /// Depth of the header (height of header beam)
    pub header_depth: f64,
    /// Type of header to use
    pub header_type: HeaderType,
    /// Whether a sill is required (windows yes, doors no)
    pub requires_sill: bool,
}

impl RoughOpening {
    pub fn new(
        opening_id: OpeningId,
        width: f64,
        height: f64,
        position_along_wall: f64,
    ) -> Self {
        Self {
            opening_id,
            width,
            height,
            position_along_wall,
            jack_stud_count: 1,
            header_depth: 7.25, // Default to 2x8 header depth
            header_type: HeaderType::DoubleLumber,
            requires_sill: false,
        }
    }

    /// Create a rough opening for a window
    pub fn for_window(
        opening_id: OpeningId,
        width: f64,
        height: f64,
        position_along_wall: f64,
        is_load_bearing: bool,
    ) -> Self {
        // Add 1/2" tolerance on each side
        let ro_width = width + 1.0;
        let ro_height = height + 0.5;

        Self {
            opening_id,
            width: ro_width,
            height: ro_height,
            position_along_wall,
            jack_stud_count: if ro_width > 48.0 { 2 } else { 1 },
            header_depth: 7.25,
            header_type: HeaderType::for_span(ro_width, is_load_bearing),
            requires_sill: true,
        }
    }

    /// Create a rough opening for a door
    pub fn for_door(
        opening_id: OpeningId,
        width: f64,
        height: f64,
        position_along_wall: f64,
        is_load_bearing: bool,
    ) -> Self {
        // Add tolerance for door frame
        let ro_width = width + 2.0;
        let ro_height = height + 0.5;

        Self {
            opening_id,
            width: ro_width,
            height: ro_height,
            position_along_wall,
            jack_stud_count: if ro_width > 48.0 { 2 } else { 1 },
            header_depth: 7.25,
            header_type: HeaderType::for_span(ro_width, is_load_bearing),
            requires_sill: false,
        }
    }

    /// Set header type
    pub fn with_header_type(mut self, header_type: HeaderType) -> Self {
        self.header_type = header_type;
        self
    }

    /// Set jack stud count
    pub fn with_jack_studs(mut self, count: u8) -> Self {
        self.jack_stud_count = count;
        self
    }
}

/// Complete framing layout for a wall
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FramingLayout {
    pub id: FramingLayoutId,
    /// The wall this layout belongs to
    pub wall_id: WallId,
    /// All framing members in this layout
    pub members: Vec<FramingMember>,
    /// Stud spacing (on-center, typically 16" or 24")
    pub stud_spacing: f64,
    /// Whether the wall has a double top plate
    pub double_top_plate: bool,
    /// Primary lumber size used
    pub lumber_size: LumberSize,
    /// Calculated total board feet
    pub total_board_feet: f64,
    /// Total stud count (for material estimation)
    pub stud_count: u32,
}

impl FramingLayout {
    pub fn new(wall_id: WallId, stud_spacing: f64, lumber_size: LumberSize) -> Self {
        Self {
            id: FramingLayoutId::new(),
            wall_id,
            members: Vec::new(),
            stud_spacing,
            double_top_plate: true, // Default for load-bearing
            lumber_size,
            total_board_feet: 0.0,
            stud_count: 0,
        }
    }

    /// Add a framing member to the layout
    pub fn add_member(&mut self, member: FramingMember) {
        self.total_board_feet += member.board_feet();
        if member.member_type == FramingMemberType::Stud {
            self.stud_count += 1;
        }
        self.members.push(member);
    }

    /// Set whether to use double top plate
    pub fn with_double_top_plate(mut self, double: bool) -> Self {
        self.double_top_plate = double;
        self
    }

    /// Get all members of a specific type
    pub fn members_of_type(&self, member_type: FramingMemberType) -> Vec<&FramingMember> {
        self.members
            .iter()
            .filter(|m| m.member_type == member_type)
            .collect()
    }

    /// Get all members associated with an opening
    pub fn members_for_opening(&self, opening_id: OpeningId) -> Vec<&FramingMember> {
        self.members
            .iter()
            .filter(|m| m.opening_id == Some(opening_id))
            .collect()
    }

    /// Recalculate totals from members
    pub fn recalculate_totals(&mut self) {
        self.total_board_feet = self.members.iter().map(|m| m.board_feet()).sum();
        self.stud_count = self
            .members
            .iter()
            .filter(|m| {
                matches!(
                    m.member_type,
                    FramingMemberType::Stud
                        | FramingMemberType::KingStud
                        | FramingMemberType::JackStud
                        | FramingMemberType::CrippleStud
                )
            })
            .count() as u32;
    }
}

/// Configuration for wall framing (to be added to Wall struct)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallFramingConfig {
    /// Stud spacing on-center (typically 16.0 or 24.0 inches)
    pub stud_spacing: f64,
    /// Lumber size for studs and plates
    pub lumber_size: LumberSize,
    /// Whether to use double top plate (required for load-bearing)
    pub double_top_plate: bool,
    /// Whether this is a load-bearing wall
    pub is_load_bearing: bool,
    /// Whether fire blocking is required (typically every 10')
    pub fire_blocking_required: bool,
}

impl WallFramingConfig {
    pub fn new(
        stud_spacing: f64,
        lumber_size: LumberSize,
        double_top_plate: bool,
        is_load_bearing: bool,
    ) -> Self {
        Self {
            stud_spacing,
            lumber_size,
            double_top_plate,
            is_load_bearing,
            fire_blocking_required: false,
        }
    }

    /// Standard exterior wall config (16" OC, 2x6, load-bearing)
    pub fn exterior() -> Self {
        Self {
            stud_spacing: 16.0,
            lumber_size: LumberSize::TwoBySix,
            double_top_plate: true,
            is_load_bearing: true,
            fire_blocking_required: false,
        }
    }

    /// Standard interior partition config (16" OC, 2x4, non-load-bearing)
    pub fn interior_partition() -> Self {
        Self {
            stud_spacing: 16.0,
            lumber_size: LumberSize::TwoByFour,
            double_top_plate: false,
            is_load_bearing: false,
            fire_blocking_required: false,
        }
    }

    /// Standard interior load-bearing config (16" OC, 2x4, load-bearing)
    pub fn interior_load_bearing() -> Self {
        Self {
            stud_spacing: 16.0,
            lumber_size: LumberSize::TwoByFour,
            double_top_plate: true,
            is_load_bearing: true,
            fire_blocking_required: false,
        }
    }

    /// Set fire blocking requirement
    pub fn with_fire_blocking(mut self, required: bool) -> Self {
        self.fire_blocking_required = required;
        self
    }
}

impl Default for WallFramingConfig {
    fn default() -> Self {
        // Default: 16" OC, 2x6, double top plate, load-bearing
        Self {
            stud_spacing: 16.0,
            lumber_size: LumberSize::TwoBySix,
            double_top_plate: true,
            is_load_bearing: true,
            fire_blocking_required: false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lumber_dimensions() {
        let two_by_four = LumberSize::TwoByFour;
        assert_eq!(two_by_four.actual_dimensions(), (1.5, 3.5));

        let two_by_six = LumberSize::TwoBySix;
        assert_eq!(two_by_six.actual_dimensions(), (1.5, 5.5));

        let custom = LumberSize::Custom { width: 2.0, depth: 8.0 };
        assert_eq!(custom.actual_dimensions(), (2.0, 8.0));
    }

    #[test]
    fn test_lumber_board_feet() {
        let two_by_four = LumberSize::TwoByFour;
        // 1.5 * 3.5 / 12 = 0.4375 per linear foot
        let bf_per_foot = two_by_four.board_feet_per_foot();
        assert!((bf_per_foot - 0.4375).abs() < 0.001);
    }

    #[test]
    fn test_framing_member_board_feet() {
        let wall_id = WallId::new();
        let stud = FramingMember::stud(
            Point3::origin(),
            96.0, // 8 feet in inches
            LumberSize::TwoByFour,
            wall_id,
        );

        // 8 feet * 0.4375 bf/ft = 3.5 board feet
        let bf = stud.board_feet();
        assert!((bf - 3.5).abs() < 0.01);
    }

    #[test]
    fn test_header_type_selection() {
        // Non-load-bearing, small span
        assert_eq!(
            HeaderType::for_span(36.0, false),
            HeaderType::DoubleLumber
        );

        // Load-bearing, large span
        assert_eq!(
            HeaderType::for_span(72.0, true),
            HeaderType::LVL
        );
    }

    #[test]
    fn test_framing_member_type_orientation() {
        assert!(FramingMemberType::Stud.is_vertical());
        assert!(FramingMemberType::KingStud.is_vertical());
        assert!(FramingMemberType::JackStud.is_vertical());
        assert!(!FramingMemberType::Header.is_vertical());
        assert!(!FramingMemberType::TopPlate.is_vertical());
        assert!(FramingMemberType::Header.is_horizontal());
    }

    #[test]
    fn test_framing_layout_add_member() {
        let wall_id = WallId::new();
        let mut layout = FramingLayout::new(wall_id, 16.0, LumberSize::TwoBySix);

        let stud = FramingMember::stud(
            Point3::origin(),
            96.0,
            LumberSize::TwoBySix,
            wall_id,
        );

        layout.add_member(stud);

        assert_eq!(layout.stud_count, 1);
        assert!(layout.total_board_feet > 0.0);
    }

    #[test]
    fn test_wall_framing_config_defaults() {
        let config = WallFramingConfig::default();
        assert_eq!(config.stud_spacing, 16.0);
        assert_eq!(config.lumber_size, LumberSize::TwoBySix);
        assert!(config.double_top_plate);
        assert!(config.is_load_bearing);
    }

    #[test]
    fn test_rough_opening_for_window() {
        let opening_id = OpeningId::new();
        let ro = RoughOpening::for_window(opening_id, 36.0, 48.0, 60.0, true);

        // Width should include tolerance
        assert_eq!(ro.width, 37.0);
        assert_eq!(ro.height, 48.5);
        assert!(ro.requires_sill);
    }

    #[test]
    fn test_rough_opening_for_door() {
        let opening_id = OpeningId::new();
        let ro = RoughOpening::for_door(opening_id, 36.0, 84.0, 60.0, false);

        // Width should include tolerance
        assert_eq!(ro.width, 38.0);
        assert_eq!(ro.height, 84.5);
        assert!(!ro.requires_sill);
    }

    #[test]
    fn test_framing_layout_members_of_type() {
        let wall_id = WallId::new();
        let mut layout = FramingLayout::new(wall_id, 16.0, LumberSize::TwoBySix);

        // Add some studs
        for i in 0..3 {
            layout.add_member(FramingMember::stud(
                Point3::new(i as f64 * 16.0, 0.0, 0.0),
                96.0,
                LumberSize::TwoBySix,
                wall_id,
            ));
        }

        // Add a plate
        layout.add_member(FramingMember::bottom_plate(
            Point3::origin(),
            48.0,
            LumberSize::TwoBySix,
            0.0,
            wall_id,
        ));

        let studs = layout.members_of_type(FramingMemberType::Stud);
        assert_eq!(studs.len(), 3);

        let plates = layout.members_of_type(FramingMemberType::BottomPlate);
        assert_eq!(plates.len(), 1);
    }
}
