// Framing generator - produces complete framing layouts for walls
// Implements standard residential framing per IRC conventions

use crate::domain::{
    Wall, WallAssembly, Opening, OpeningType,
    FramingMember, FramingMemberType, FramingLayout,
    RoughOpening, WallFramingConfig, LumberSize, HeaderType, FramingMaterial,
    Point3, WallId, OpeningId,
};

/// Error type for framing generation
#[derive(Debug, Clone)]
pub enum FramingError {
    /// Wall has invalid dimensions
    InvalidWallDimensions { wall_id: WallId, message: String },
    /// Opening is too large for the wall
    OpeningTooLarge { opening_id: OpeningId, message: String },
    /// Opening extends beyond wall bounds
    OpeningOutOfBounds { opening_id: OpeningId, message: String },
    /// Overlapping openings detected
    OverlappingOpenings { opening_ids: Vec<OpeningId>, message: String },
    /// Invalid framing configuration
    InvalidConfig { message: String },
}

impl std::fmt::Display for FramingError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FramingError::InvalidWallDimensions { message, .. } => {
                write!(f, "Invalid wall dimensions: {}", message)
            }
            FramingError::OpeningTooLarge { message, .. } => {
                write!(f, "Opening too large: {}", message)
            }
            FramingError::OpeningOutOfBounds { message, .. } => {
                write!(f, "Opening out of bounds: {}", message)
            }
            FramingError::OverlappingOpenings { message, .. } => {
                write!(f, "Overlapping openings: {}", message)
            }
            FramingError::InvalidConfig { message } => {
                write!(f, "Invalid framing config: {}", message)
            }
        }
    }
}

impl std::error::Error for FramingError {}

/// Framing generator for producing wall framing layouts
pub struct FramingGenerator;

impl FramingGenerator {
    /// Generate complete framing layout for a wall
    ///
    /// # Arguments
    /// * `wall` - The wall to generate framing for
    /// * `assembly` - The wall assembly defining layers and thickness
    /// * `openings` - Slice of openings in this wall
    ///
    /// # Returns
    /// A complete `FramingLayout` with all members, or an error
    pub fn generate_wall_framing(
        wall: &Wall,
        _assembly: &WallAssembly,
        openings: &[Opening],
    ) -> Result<FramingLayout, FramingError> {
        let config = &wall.framing_config;
        let wall_length = wall.length();
        let wall_height = wall.height;

        // Validate wall dimensions
        if wall_length < 1.0 {
            return Err(FramingError::InvalidWallDimensions {
                wall_id: wall.id,
                message: format!("Wall length ({:.2}\") is too short", wall_length),
            });
        }
        if wall_height < 12.0 {
            return Err(FramingError::InvalidWallDimensions {
                wall_id: wall.id,
                message: format!("Wall height ({:.2}\") is too short", wall_height),
            });
        }

        // Compute rough openings from openings
        let rough_openings = Self::compute_all_rough_openings(wall, openings, config)?;

        // Validate openings don't overlap
        Self::validate_openings_no_overlap(&rough_openings)?;

        // Create the layout
        let mut layout = FramingLayout::new(wall.id, config.stud_spacing, config.lumber_size);
        layout.double_top_plate = config.double_top_plate;

        // Get wall direction for positioning
        let (dir_x, dir_y) = wall.direction();
        let wall_rotation = dir_y.atan2(dir_x);

        // 1. Generate plates (bottom, top, double-top if configured)
        let plates = Self::generate_plates(wall, config, wall_rotation);
        for plate in plates {
            layout.add_member(plate);
        }

        // 2. Generate studs at OC spacing (skip opening areas)
        let studs = Self::generate_studs(wall, config, &rough_openings);
        for stud in studs {
            layout.add_member(stud);
        }

        // 3. Generate opening framing (kings, jacks, headers, sills, cripples)
        for ro in &rough_openings {
            let opening_members = Self::generate_opening_framing(wall, ro, config);
            for member in opening_members {
                layout.add_member(member);
            }
        }

        // 4. Generate blocking (fire stops at 10' intervals if required)
        if config.fire_blocking_required {
            let blocking = Self::generate_fire_blocking(wall, config, &rough_openings, wall_rotation);
            for block in blocking {
                layout.add_member(block);
            }
        }

        // Recalculate totals to ensure accuracy
        layout.recalculate_totals();

        Ok(layout)
    }

    /// Generate plates (bottom plate, top plate, optional double top plate)
    fn generate_plates(wall: &Wall, config: &WallFramingConfig, rotation: f64) -> Vec<FramingMember> {
        let mut plates = Vec::new();
        let wall_length = wall.length();
        let (_, lumber_depth) = config.lumber_size.actual_dimensions();

        // Bottom plate - at floor level
        let bottom_plate = FramingMember::new(
            FramingMemberType::BottomPlate,
            config.lumber_size,
            FramingMaterial::SPF,
            Point3::new(wall.start.x, wall.start.y, wall.base_offset),
            wall_length,
            rotation,
            wall.id,
        );
        plates.push(bottom_plate);

        // Top plate - at wall height minus one plate thickness
        let top_plate_z = wall.base_offset + wall.height - lumber_depth;
        let top_plate = FramingMember::new(
            FramingMemberType::TopPlate,
            config.lumber_size,
            FramingMaterial::SPF,
            Point3::new(wall.start.x, wall.start.y, top_plate_z),
            wall_length,
            rotation,
            wall.id,
        );
        plates.push(top_plate);

        // Double top plate if configured (load-bearing walls)
        if config.double_top_plate {
            let double_top_z = top_plate_z - lumber_depth;
            let double_top = FramingMember::new(
                FramingMemberType::DoubleTopPlate,
                config.lumber_size,
                FramingMaterial::SPF,
                Point3::new(wall.start.x, wall.start.y, double_top_z),
                wall_length,
                rotation,
                wall.id,
            );
            plates.push(double_top);
        }

        plates
    }

    /// Generate studs at on-center spacing, skipping opening areas
    fn generate_studs(
        wall: &Wall,
        config: &WallFramingConfig,
        rough_openings: &[RoughOpening],
    ) -> Vec<FramingMember> {
        let mut studs = Vec::new();
        let wall_length = wall.length();
        let (dir_x, dir_y) = wall.direction();
        let (lumber_width, lumber_depth) = config.lumber_size.actual_dimensions();

        // Calculate stud height (between plates)
        let plate_count = if config.double_top_plate { 3.0 } else { 2.0 };
        let stud_height = wall.height - (plate_count * lumber_depth);

        // Stud Z position (on top of bottom plate)
        let stud_z = wall.base_offset + lumber_depth;

        // Generate studs at OC spacing
        // First stud at wall start, then every stud_spacing inches
        let mut position = 0.0;
        let end_position = wall_length - lumber_width; // Leave room for end stud

        while position <= end_position {
            // Check if this position falls within a rough opening
            let in_opening = Self::position_in_opening(position, lumber_width, rough_openings);

            if !in_opening {
                // Calculate 3D position along wall
                let x = wall.start.x + dir_x * position;
                let y = wall.start.y + dir_y * position;

                let stud = FramingMember::new(
                    FramingMemberType::Stud,
                    config.lumber_size,
                    FramingMaterial::SPF,
                    Point3::new(x, y, stud_z),
                    stud_height,
                    0.0, // Studs are vertical, no rotation needed
                    wall.id,
                );
                studs.push(stud);
            }

            position += config.stud_spacing;
        }

        // Always add end stud at wall end if not already covered
        let end_pos = wall_length - lumber_width / 2.0;
        if !Self::position_in_opening(end_pos, lumber_width, rough_openings) {
            let last_stud_position = ((wall_length - lumber_width) / config.stud_spacing).floor()
                * config.stud_spacing;
            if (wall_length - lumber_width - last_stud_position).abs() > lumber_width {
                let x = wall.start.x + dir_x * (wall_length - lumber_width);
                let y = wall.start.y + dir_y * (wall_length - lumber_width);

                let end_stud = FramingMember::new(
                    FramingMemberType::Stud,
                    config.lumber_size,
                    FramingMaterial::SPF,
                    Point3::new(x, y, stud_z),
                    stud_height,
                    0.0,
                    wall.id,
                );
                studs.push(end_stud);
            }
        }

        studs
    }

    /// Generate all framing for a single opening (kings, jacks, header, sill, cripples)
    fn generate_opening_framing(
        wall: &Wall,
        ro: &RoughOpening,
        config: &WallFramingConfig,
    ) -> Vec<FramingMember> {
        let mut members = Vec::new();
        let (dir_x, dir_y) = wall.direction();
        let wall_rotation = dir_y.atan2(dir_x);
        let (lumber_width, lumber_depth) = config.lumber_size.actual_dimensions();

        // Calculate positions
        let ro_left = ro.position_along_wall - ro.width / 2.0;
        let ro_right = ro.position_along_wall + ro.width / 2.0;

        // King stud positions (just outside the rough opening)
        let king_left_pos = ro_left - lumber_width;
        let king_right_pos = ro_right;

        // Calculate stud height (between plates)
        let plate_count = if config.double_top_plate { 3.0 } else { 2.0 };
        let full_stud_height = wall.height - (plate_count * lumber_depth);
        let stud_z = wall.base_offset + lumber_depth;

        // King studs (full height, on either side of opening)
        let king_left = FramingMember::new(
            FramingMemberType::KingStud,
            config.lumber_size,
            FramingMaterial::SPF,
            Point3::new(
                wall.start.x + dir_x * king_left_pos,
                wall.start.y + dir_y * king_left_pos,
                stud_z,
            ),
            full_stud_height,
            0.0,
            wall.id,
        )
        .with_opening(ro.opening_id);
        members.push(king_left);

        let king_right = FramingMember::new(
            FramingMemberType::KingStud,
            config.lumber_size,
            FramingMaterial::SPF,
            Point3::new(
                wall.start.x + dir_x * king_right_pos,
                wall.start.y + dir_y * king_right_pos,
                stud_z,
            ),
            full_stud_height,
            0.0,
            wall.id,
        )
        .with_opening(ro.opening_id);
        members.push(king_right);

        // Jack studs (support header, positioned inside king studs)
        // Height from bottom plate to bottom of header
        let header_bottom_z = stud_z + full_stud_height - ro.header_depth;
        let jack_height = header_bottom_z - stud_z;

        for i in 0..ro.jack_stud_count {
            let offset = (i as f64 + 1.0) * lumber_width;

            // Left jack
            let jack_left = FramingMember::new(
                FramingMemberType::JackStud,
                config.lumber_size,
                FramingMaterial::SPF,
                Point3::new(
                    wall.start.x + dir_x * (king_left_pos + offset),
                    wall.start.y + dir_y * (king_left_pos + offset),
                    stud_z,
                ),
                jack_height,
                0.0,
                wall.id,
            )
            .with_opening(ro.opening_id);
            members.push(jack_left);

            // Right jack
            let jack_right = FramingMember::new(
                FramingMemberType::JackStud,
                config.lumber_size,
                FramingMaterial::SPF,
                Point3::new(
                    wall.start.x + dir_x * (king_right_pos - offset),
                    wall.start.y + dir_y * (king_right_pos - offset),
                    stud_z,
                ),
                jack_height,
                0.0,
                wall.id,
            )
            .with_opening(ro.opening_id);
            members.push(jack_right);
        }

        // Header (spans between jack studs)
        let header_lumber_size = Self::size_header_lumber(ro.width, config.is_load_bearing);
        let header_length = ro.width + (ro.jack_stud_count as f64 * lumber_width * 2.0);
        let header_x = wall.start.x + dir_x * (king_left_pos + lumber_width);
        let header_y = wall.start.y + dir_y * (king_left_pos + lumber_width);

        let header = FramingMember::new(
            FramingMemberType::Header,
            header_lumber_size,
            Self::header_material(ro.header_type),
            Point3::new(header_x, header_y, header_bottom_z),
            header_length,
            wall_rotation,
            wall.id,
        )
        .with_opening(ro.opening_id);
        members.push(header);

        // Sill plate (for windows, below the opening)
        if ro.requires_sill {
            // Need to get the original opening to find sill height
            // The sill sits at sill_height from floor
            // We'll calculate based on RO dimensions
            let sill_z = stud_z + jack_height - ro.height;

            let sill = FramingMember::new(
                FramingMemberType::Sill,
                config.lumber_size,
                FramingMaterial::SPF,
                Point3::new(header_x, header_y, sill_z),
                header_length,
                wall_rotation,
                wall.id,
            )
            .with_opening(ro.opening_id);
            members.push(sill);

            // Cripple studs below sill (for windows)
            let cripple_height = sill_z - stud_z;
            if cripple_height > lumber_depth {
                let cripples_below =
                    Self::generate_cripples(wall, config, ro, stud_z, cripple_height, true);
                for cripple in cripples_below {
                    members.push(cripple);
                }
            }
        }

        // Cripple studs above header
        let cripple_above_z = header_bottom_z + ro.header_depth;
        let cripple_above_height = stud_z + full_stud_height - cripple_above_z;
        if cripple_above_height > lumber_depth {
            let cripples_above =
                Self::generate_cripples(wall, config, ro, cripple_above_z, cripple_above_height, false);
            for cripple in cripples_above {
                members.push(cripple);
            }
        }

        members
    }

    /// Generate cripple studs above header or below sill
    fn generate_cripples(
        wall: &Wall,
        config: &WallFramingConfig,
        ro: &RoughOpening,
        z_position: f64,
        height: f64,
        _below_sill: bool,
    ) -> Vec<FramingMember> {
        let mut cripples = Vec::new();
        let (dir_x, dir_y) = wall.direction();
        let (lumber_width, _) = config.lumber_size.actual_dimensions();

        let ro_left = ro.position_along_wall - ro.width / 2.0;
        let ro_right = ro.position_along_wall + ro.width / 2.0;

        // Place cripples at stud spacing within the opening width
        let mut pos = ro_left + config.stud_spacing;
        while pos < ro_right - lumber_width {
            let cripple = FramingMember::new(
                FramingMemberType::CrippleStud,
                config.lumber_size,
                FramingMaterial::SPF,
                Point3::new(
                    wall.start.x + dir_x * pos,
                    wall.start.y + dir_y * pos,
                    z_position,
                ),
                height,
                0.0,
                wall.id,
            )
            .with_opening(ro.opening_id);
            cripples.push(cripple);

            pos += config.stud_spacing;
        }

        cripples
    }

    /// Generate fire blocking at 10' intervals
    fn generate_fire_blocking(
        wall: &Wall,
        config: &WallFramingConfig,
        rough_openings: &[RoughOpening],
        rotation: f64,
    ) -> Vec<FramingMember> {
        let mut blocking = Vec::new();
        let wall_length = wall.length();
        let (dir_x, dir_y) = wall.direction();
        let (_, lumber_depth) = config.lumber_size.actual_dimensions();

        // Fire blocking typically required every 10 feet (120 inches)
        const FIRE_BLOCK_INTERVAL: f64 = 120.0;

        // Calculate mid-height position for blocking
        let plate_count = if config.double_top_plate { 3.0 } else { 2.0 };
        let stud_height = wall.height - (plate_count * lumber_depth);
        let blocking_z = wall.base_offset + lumber_depth + stud_height / 2.0;

        // Generate blocking between studs
        let mut pos = 0.0;
        while pos < wall_length {
            // Find the next segment that needs blocking
            let segment_start = pos;
            let segment_end = (pos + FIRE_BLOCK_INTERVAL).min(wall_length);

            // Skip if entirely within an opening
            if !Self::segment_entirely_in_opening(segment_start, segment_end, rough_openings) {
                // Place blocking between stud positions
                let mut block_pos = segment_start;
                while block_pos < segment_end {
                    let next_stud = ((block_pos / config.stud_spacing).floor() + 1.0)
                        * config.stud_spacing;

                    if next_stud < segment_end {
                        let block_length = config.stud_spacing;

                        // Check this specific block isn't in an opening
                        if !Self::position_in_opening(block_pos, block_length, rough_openings) {
                            let block = FramingMember::new(
                                FramingMemberType::FireBlocking,
                                config.lumber_size,
                                FramingMaterial::SPF,
                                Point3::new(
                                    wall.start.x + dir_x * block_pos,
                                    wall.start.y + dir_y * block_pos,
                                    blocking_z,
                                ),
                                block_length,
                                rotation,
                                wall.id,
                            );
                            blocking.push(block);
                        }
                    }
                    block_pos = next_stud;
                }
            }

            pos += FIRE_BLOCK_INTERVAL;
        }

        blocking
    }

    /// Compute rough opening from an Opening, applying tolerances
    pub fn compute_rough_opening(
        opening: &Opening,
        wall: &Wall,
        config: &WallFramingConfig,
    ) -> Result<RoughOpening, FramingError> {
        let wall_length = wall.length();

        // Convert parametric position (0.0-1.0) to actual position
        let position_along_wall = opening.position_along_wall * wall_length;

        // Calculate rough opening based on opening type
        let ro = match opening.opening_type {
            OpeningType::Window => RoughOpening::for_window(
                opening.id,
                opening.width,
                opening.height,
                position_along_wall,
                config.is_load_bearing,
            ),
            OpeningType::Door => RoughOpening::for_door(
                opening.id,
                opening.width,
                opening.height,
                position_along_wall,
                config.is_load_bearing,
            ),
            OpeningType::Other(_) => {
                // Generic opening - treat like a door
                RoughOpening::for_door(
                    opening.id,
                    opening.width,
                    opening.height,
                    position_along_wall,
                    config.is_load_bearing,
                )
            }
        };

        // Validate rough opening fits in wall
        let ro_left = ro.position_along_wall - ro.width / 2.0;
        let ro_right = ro.position_along_wall + ro.width / 2.0;

        if ro_left < 0.0 || ro_right > wall_length {
            return Err(FramingError::OpeningOutOfBounds {
                opening_id: opening.id,
                message: format!(
                    "Opening extends beyond wall bounds (left: {:.2}, right: {:.2}, wall length: {:.2})",
                    ro_left, ro_right, wall_length
                ),
            });
        }

        if ro.height > wall.height {
            return Err(FramingError::OpeningTooLarge {
                opening_id: opening.id,
                message: format!(
                    "Opening height ({:.2}\") exceeds wall height ({:.2}\")",
                    ro.height, wall.height
                ),
            });
        }

        Ok(ro)
    }

    /// Compute all rough openings for a wall
    fn compute_all_rough_openings(
        wall: &Wall,
        openings: &[Opening],
        config: &WallFramingConfig,
    ) -> Result<Vec<RoughOpening>, FramingError> {
        openings
            .iter()
            .filter(|o| o.wall_id == wall.id)
            .map(|o| Self::compute_rough_opening(o, wall, config))
            .collect()
    }

    /// Validate that openings don't overlap
    fn validate_openings_no_overlap(rough_openings: &[RoughOpening]) -> Result<(), FramingError> {
        for i in 0..rough_openings.len() {
            for j in (i + 1)..rough_openings.len() {
                let ro1 = &rough_openings[i];
                let ro2 = &rough_openings[j];

                let ro1_left = ro1.position_along_wall - ro1.width / 2.0;
                let ro1_right = ro1.position_along_wall + ro1.width / 2.0;
                let ro2_left = ro2.position_along_wall - ro2.width / 2.0;
                let ro2_right = ro2.position_along_wall + ro2.width / 2.0;

                // Check for overlap (with some tolerance for framing)
                let min_gap = 3.5; // At least one stud width between openings
                if ro1_right + min_gap > ro2_left && ro2_right + min_gap > ro1_left {
                    return Err(FramingError::OverlappingOpenings {
                        opening_ids: vec![ro1.opening_id, ro2.opening_id],
                        message: format!(
                            "Openings overlap or are too close (need at least {:.1}\" gap)",
                            min_gap
                        ),
                    });
                }
            }
        }
        Ok(())
    }

    /// Check if a stud position falls within any rough opening
    fn position_in_opening(
        position: f64,
        stud_width: f64,
        rough_openings: &[RoughOpening],
    ) -> bool {
        for ro in rough_openings {
            let ro_left = ro.position_along_wall - ro.width / 2.0;
            let ro_right = ro.position_along_wall + ro.width / 2.0;

            // Expand by lumber width for king studs
            let exclusion_left = ro_left - stud_width * 2.0;
            let exclusion_right = ro_right + stud_width * 2.0;

            if position >= exclusion_left && position <= exclusion_right {
                return true;
            }
        }
        false
    }

    /// Check if a segment is entirely within an opening
    fn segment_entirely_in_opening(
        start: f64,
        end: f64,
        rough_openings: &[RoughOpening],
    ) -> bool {
        for ro in rough_openings {
            let ro_left = ro.position_along_wall - ro.width / 2.0;
            let ro_right = ro.position_along_wall + ro.width / 2.0;

            if start >= ro_left && end <= ro_right {
                return true;
            }
        }
        false
    }

    /// Size header based on span and load-bearing status
    /// Follows simplified IRC Table R602.7 guidelines
    pub fn size_header(span: f64, is_load_bearing: bool) -> HeaderType {
        HeaderType::for_span(span, is_load_bearing)
    }

    /// Get the lumber size for a header based on span
    fn size_header_lumber(span: f64, is_load_bearing: bool) -> LumberSize {
        if !is_load_bearing {
            // Non-load-bearing can use smaller headers
            if span <= 48.0 {
                LumberSize::TwoBySix
            } else {
                LumberSize::TwoByEight
            }
        } else {
            // Load-bearing: size per IRC Table R602.7
            if span <= 48.0 {
                LumberSize::TwoBySix
            } else if span <= 72.0 {
                LumberSize::TwoByEight
            } else if span <= 96.0 {
                LumberSize::TwoByTen
            } else if span <= 120.0 {
                LumberSize::TwoByTwelve
            } else {
                // > 10': Need engineered lumber (LVL)
                // Use custom size to represent LVL dimensions
                LumberSize::Custom {
                    width: 1.75,  // LVL width
                    depth: 11.875, // 1-3/4" x 11-7/8" LVL
                }
            }
        }
    }

    /// Get the material for a header type
    fn header_material(header_type: HeaderType) -> FramingMaterial {
        match header_type {
            HeaderType::DoubleLumber | HeaderType::TripleLumber => FramingMaterial::SPF,
            HeaderType::LVL => FramingMaterial::LVL,
            HeaderType::PSL => FramingMaterial::PSL,
            HeaderType::SteelLintel => FramingMaterial::Steel,
            HeaderType::Glulam => FramingMaterial::DF, // Douglas Fir for glulam
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Point2, WallAssemblyId, LevelId};

    fn create_test_wall(length: f64, height: f64) -> Wall {
        Wall::new(
            WallAssemblyId::new(),
            LevelId::new(),
            Point2::new(0.0, 0.0),
            Point2::new(length, 0.0),
            height,
        )
    }

    fn create_test_assembly() -> WallAssembly {
        WallAssembly::exterior_2x6()
    }

    #[test]
    fn test_generate_simple_wall() {
        let wall = create_test_wall(120.0, 96.0); // 10' x 8' wall
        let assembly = create_test_assembly();
        let openings: Vec<Opening> = vec![];

        let result = FramingGenerator::generate_wall_framing(&wall, &assembly, &openings);
        assert!(result.is_ok());

        let layout = result.unwrap();
        assert_eq!(layout.wall_id, wall.id);
        assert!(layout.stud_count > 0);
        assert!(layout.total_board_feet > 0.0);

        // Should have plates
        let plates: Vec<_> = layout
            .members
            .iter()
            .filter(|m| {
                matches!(
                    m.member_type,
                    FramingMemberType::BottomPlate
                        | FramingMemberType::TopPlate
                        | FramingMemberType::DoubleTopPlate
                )
            })
            .collect();
        assert_eq!(plates.len(), 3); // Bottom, top, double-top (default is load-bearing)
    }

    #[test]
    fn test_generate_wall_with_door() {
        let wall = create_test_wall(120.0, 96.0);
        let assembly = create_test_assembly();

        // Add a door opening
        let door = Opening::door(
            wall.id,
            0.5, // Center of wall
            36.0, // 3' door
            80.0, // 6'8" standard door
            DoorProperties::interior(),
        );

        let result = FramingGenerator::generate_wall_framing(&wall, &assembly, &[door]);
        assert!(result.is_ok());

        let layout = result.unwrap();

        // Should have king studs
        let kings: Vec<_> = layout
            .members
            .iter()
            .filter(|m| m.member_type == FramingMemberType::KingStud)
            .collect();
        assert_eq!(kings.len(), 2);

        // Should have jack studs
        let jacks: Vec<_> = layout
            .members
            .iter()
            .filter(|m| m.member_type == FramingMemberType::JackStud)
            .collect();
        assert!(jacks.len() >= 2);

        // Should have a header
        let headers: Vec<_> = layout
            .members
            .iter()
            .filter(|m| m.member_type == FramingMemberType::Header)
            .collect();
        assert_eq!(headers.len(), 1);
    }

    #[test]
    fn test_generate_wall_with_window() {
        let wall = create_test_wall(144.0, 96.0); // 12' wall
        let assembly = create_test_assembly();

        // Add a window
        let window = Opening::window(
            wall.id,
            0.5,
            36.0, // 3' wide
            48.0, // 4' tall
            36.0, // 3' sill height
            WindowProperties::double_pane(),
        );

        let result = FramingGenerator::generate_wall_framing(&wall, &assembly, &[window]);
        assert!(result.is_ok());

        let layout = result.unwrap();

        // Should have a sill plate
        let sills: Vec<_> = layout
            .members
            .iter()
            .filter(|m| m.member_type == FramingMemberType::Sill)
            .collect();
        assert_eq!(sills.len(), 1);

        // Should have cripple studs
        let cripples: Vec<_> = layout
            .members
            .iter()
            .filter(|m| m.member_type == FramingMemberType::CrippleStud)
            .collect();
        assert!(!cripples.is_empty());
    }

    #[test]
    fn test_header_sizing() {
        // Non-load-bearing, small span
        assert_eq!(
            FramingGenerator::size_header(36.0, false),
            HeaderType::DoubleLumber
        );

        // Load-bearing, medium span
        assert_eq!(
            FramingGenerator::size_header(72.0, true),
            HeaderType::LVL
        );

        // Load-bearing, large span
        assert_eq!(
            FramingGenerator::size_header(120.0, true),
            HeaderType::PSL
        );
    }

    #[test]
    fn test_invalid_wall_dimensions() {
        let short_wall = create_test_wall(0.5, 96.0); // Too short
        let assembly = create_test_assembly();

        let result = FramingGenerator::generate_wall_framing(&short_wall, &assembly, &[]);
        assert!(result.is_err());

        if let Err(FramingError::InvalidWallDimensions { .. }) = result {
            // Expected
        } else {
            panic!("Expected InvalidWallDimensions error");
        }
    }

    #[test]
    fn test_opening_out_of_bounds() {
        let wall = create_test_wall(48.0, 96.0); // 4' wall
        let assembly = create_test_assembly();

        // Add a door that's too close to the edge
        let door = Opening::door(
            wall.id,
            0.1, // Near start of wall
            36.0, // 3' door - will extend past wall start
            80.0,
            DoorProperties::interior(),
        );

        let result = FramingGenerator::generate_wall_framing(&wall, &assembly, &[door]);
        assert!(result.is_err());
    }

    #[test]
    fn test_stud_spacing() {
        let wall = create_test_wall(96.0, 96.0); // 8' wall
        let assembly = create_test_assembly();

        let result = FramingGenerator::generate_wall_framing(&wall, &assembly, &[]);
        assert!(result.is_ok());

        let layout = result.unwrap();

        // With 16" OC spacing on an 8' (96") wall, expect roughly 6-7 studs
        // (0", 16", 32", 48", 64", 80", plus possibly end stud)
        let studs: Vec<_> = layout
            .members
            .iter()
            .filter(|m| m.member_type == FramingMemberType::Stud)
            .collect();
        assert!(studs.len() >= 6);
        assert!(studs.len() <= 8);
    }

    #[test]
    fn test_interior_partition_config() {
        let mut wall = create_test_wall(96.0, 96.0);
        wall.framing_config = WallFramingConfig::interior_partition();

        let assembly = WallAssembly::interior_partition();

        let result = FramingGenerator::generate_wall_framing(&wall, &assembly, &[]);
        assert!(result.is_ok());

        let layout = result.unwrap();

        // Interior partition shouldn't have double top plate
        let double_tops: Vec<_> = layout
            .members
            .iter()
            .filter(|m| m.member_type == FramingMemberType::DoubleTopPlate)
            .collect();
        assert_eq!(double_tops.len(), 0);
    }

    use crate::domain::{DoorProperties, WindowProperties};
}
