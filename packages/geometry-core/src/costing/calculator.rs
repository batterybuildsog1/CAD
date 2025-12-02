//! Cost Calculation Engine
//! Generates cost estimates from floor plan geometry and price tables

use crate::domain::costing::*;
use crate::domain::{LevelId, OpeningId, RoomId};

/// Input data for cost calculation
pub struct CostInput {
    pub level_id: LevelId,
    pub footprint_sqft: f64,
    pub total_floor_area: f64,
    pub exterior_wall_linear_ft: f64,
    pub exterior_wall_sqft: f64,
    pub interior_wall_linear_ft: f64,
    pub roof_sqft: f64,
    pub foundation_sqft: f64,
    pub rooms: Vec<RoomCostInput>,
    pub openings: Vec<OpeningCostInput>,
    pub wall_height: f64, // typical 8 or 9 feet
}

pub struct RoomCostInput {
    pub id: RoomId,
    pub room_type: String,
    pub floor_sqft: f64,
    pub wall_sqft: f64,
    pub perimeter_ft: f64,
}

pub struct OpeningCostInput {
    pub id: OpeningId,
    pub opening_type: String, // "window", "exterior_door", "interior_door", "garage_door"
    pub width: f64,
    pub height: f64,
    pub count: u32,
}

/// Cost Calculator - generates estimates from inputs and price tables
pub struct CostCalculator {
    price_table: PriceTable,
}

impl CostCalculator {
    pub fn new(price_table: PriceTable) -> Self {
        Self { price_table }
    }

    pub fn with_defaults() -> Self {
        Self::new(PriceTable::with_defaults())
    }

    /// Generate a complete cost estimate
    pub fn calculate(&self, input: &CostInput) -> CostEstimate {
        let mut estimate = CostEstimate::new(input.level_id);

        // Foundation costs (detailed concrete breakdown)
        for item in self.calculate_foundation(input) {
            estimate.add_line_item(item);
        }

        // Framing costs
        for item in self.calculate_framing(input) {
            estimate.add_line_item(item);
        }

        // Roofing costs
        for item in self.calculate_roofing(input) {
            estimate.add_line_item(item);
        }

        // Exterior costs (siding/stucco)
        for item in self.calculate_exterior(input) {
            estimate.add_line_item(item);
        }

        // Opening costs (windows, doors)
        for item in self.calculate_openings(input) {
            estimate.add_line_item(item);
        }

        // Interior finishes per room
        for item in self.calculate_interior(input) {
            estimate.add_line_item(item);
        }

        estimate
    }

    /// Calculate foundation costs with detailed concrete breakdown
    fn calculate_foundation(&self, input: &CostInput) -> Vec<CostLineItem> {
        let mut items = Vec::new();
        let sqft = input.foundation_sqft;
        let perimeter = input.exterior_wall_linear_ft;

        // Forms (per linear foot of perimeter)
        if let Some(price) = self.price_table.get_material_price(&MaterialType::ConcreteForms) {
            items.push(CostLineItem::material(
                CostCategory::Foundation,
                "Concrete forms".to_string(),
                MaterialType::ConcreteForms,
                perimeter,
                price.unit,
                price.price,
            ));
        }

        // Rebar (estimate ~0.5 lbs per sqft for typical slab)
        if let Some(price) = self.price_table.get_material_price(&MaterialType::ConcreteRebar) {
            let rebar_lbs = sqft * 0.5;
            items.push(CostLineItem::material(
                CostCategory::Foundation,
                "Rebar".to_string(),
                MaterialType::ConcreteRebar,
                rebar_lbs,
                price.unit,
                price.price,
            ));
        }

        // Concrete mix (4" slab = 0.0123 cy per sqft)
        if let Some(price) = self.price_table.get_material_price(&MaterialType::ConcreteMix) {
            let cubic_yards = sqft * 0.0123;
            items.push(CostLineItem::material(
                CostCategory::Foundation,
                "Concrete mix".to_string(),
                MaterialType::ConcreteMix,
                cubic_yards,
                price.unit,
                price.price,
            ));
        }

        // Vapor barrier
        if let Some(price) =
            self.price_table
                .get_material_price(&MaterialType::ConcreteVaporBarrier)
        {
            items.push(CostLineItem::material(
                CostCategory::Foundation,
                "Vapor barrier".to_string(),
                MaterialType::ConcreteVaporBarrier,
                sqft,
                price.unit,
                price.price,
            ));
        }

        // Gravel (4" base = 0.0123 cy per sqft)
        if let Some(price) = self.price_table.get_material_price(&MaterialType::ConcreteGravel) {
            let cubic_yards = sqft * 0.0123;
            items.push(CostLineItem::material(
                CostCategory::Foundation,
                "Gravel base".to_string(),
                MaterialType::ConcreteGravel,
                cubic_yards,
                price.unit,
                price.price,
            ));
        }

        // Labor: Subgrade prep
        if let Some(rate) = self.price_table.get_labor_rate(&LaborType::ConcreteSubgradePrep) {
            items.push(CostLineItem::labor(
                CostCategory::Foundation,
                "Subgrade preparation".to_string(),
                LaborType::ConcreteSubgradePrep,
                sqft,
                rate.unit,
                rate.rate,
            ));
        }

        // Labor: Form install
        if let Some(rate) = self.price_table.get_labor_rate(&LaborType::ConcreteFormInstall) {
            items.push(CostLineItem::labor(
                CostCategory::Foundation,
                "Form installation".to_string(),
                LaborType::ConcreteFormInstall,
                perimeter,
                rate.unit,
                rate.rate,
            ));
        }

        // Labor: Rebar install
        if let Some(rate) = self.price_table.get_labor_rate(&LaborType::ConcreteRebarInstall) {
            items.push(CostLineItem::labor(
                CostCategory::Foundation,
                "Rebar installation".to_string(),
                LaborType::ConcreteRebarInstall,
                sqft,
                rate.unit,
                rate.rate,
            ));
        }

        // Labor: Place & finish
        if let Some(rate) = self.price_table.get_labor_rate(&LaborType::ConcretePlaceFinish) {
            items.push(CostLineItem::labor(
                CostCategory::Foundation,
                "Concrete place & finish".to_string(),
                LaborType::ConcretePlaceFinish,
                sqft,
                rate.unit,
                rate.rate,
            ));
        }

        items
    }

    /// Calculate framing costs
    fn calculate_framing(&self, input: &CostInput) -> Vec<CostLineItem> {
        let mut items = Vec::new();

        // Estimate lumber needs based on wall linear feet
        // Typical: 1 stud per 16" (0.75 studs/ft) * 2 plates + 10% waste

        // Exterior walls use 2x6
        if let Some(price) = self.price_table.get_material_price(&MaterialType::Lumber2x6) {
            let ext_studs = (input.exterior_wall_linear_ft * 0.75 * 1.1).ceil();
            items.push(CostLineItem::material(
                CostCategory::Framing,
                "2x6 exterior wall studs".to_string(),
                MaterialType::Lumber2x6,
                ext_studs,
                PricingUnit::PerBoard,
                price.price,
            ));
        }

        // Interior walls use 2x4
        if let Some(price) = self.price_table.get_material_price(&MaterialType::Lumber2x4) {
            let int_studs = (input.interior_wall_linear_ft * 0.75 * 1.1).ceil();
            items.push(CostLineItem::material(
                CostCategory::Framing,
                "2x4 interior wall studs".to_string(),
                MaterialType::Lumber2x4,
                int_studs,
                PricingUnit::PerBoard,
                price.price,
            ));
        }

        // Sheathing (exterior wall sqft)
        if let Some(price) = self.price_table.get_material_price(&MaterialType::Sheathing) {
            items.push(CostLineItem::material(
                CostCategory::Framing,
                "Wall sheathing".to_string(),
                MaterialType::Sheathing,
                input.exterior_wall_sqft,
                price.unit,
                price.price,
            ));
        }

        // Framing labor
        if let Some(rate) = self.price_table.get_labor_rate(&LaborType::FramingCarpentry) {
            items.push(CostLineItem::labor(
                CostCategory::Framing,
                "Framing labor".to_string(),
                LaborType::FramingCarpentry,
                input.total_floor_area,
                rate.unit,
                rate.rate,
            ));
        }

        items
    }

    /// Calculate roofing costs
    fn calculate_roofing(&self, input: &CostInput) -> Vec<CostLineItem> {
        let mut items = Vec::new();
        let sqft = input.roof_sqft;

        // Underlayment
        if let Some(price) = self
            .price_table
            .get_material_price(&MaterialType::RoofingUnderlayment)
        {
            items.push(CostLineItem::material(
                CostCategory::Roofing,
                "Roofing underlayment".to_string(),
                MaterialType::RoofingUnderlayment,
                sqft,
                price.unit,
                price.price,
            ));
        }

        // Default to asphalt shingles
        if let Some(price) = self.price_table.get_material_price(&MaterialType::AsphaltShingles) {
            items.push(CostLineItem::material(
                CostCategory::Roofing,
                "Asphalt shingles".to_string(),
                MaterialType::AsphaltShingles,
                sqft,
                price.unit,
                price.price,
            ));
        }

        // Roofing labor
        if let Some(rate) = self.price_table.get_labor_rate(&LaborType::RoofingInstall) {
            items.push(CostLineItem::labor(
                CostCategory::Roofing,
                "Roofing installation".to_string(),
                LaborType::RoofingInstall,
                sqft,
                rate.unit,
                rate.rate,
            ));
        }

        items
    }

    /// Calculate exterior finish costs (siding, stucco)
    fn calculate_exterior(&self, input: &CostInput) -> Vec<CostLineItem> {
        let mut items = Vec::new();
        let sqft = input.exterior_wall_sqft;

        // Default to stucco (per sqft of wall surface)
        if let Some(price) = self.price_table.get_material_price(&MaterialType::Stucco) {
            items.push(CostLineItem::material(
                CostCategory::Exterior,
                "Stucco".to_string(),
                MaterialType::Stucco,
                sqft,
                price.unit,
                price.price,
            ));
        }

        // Siding labor
        if let Some(rate) = self.price_table.get_labor_rate(&LaborType::SidingInstall) {
            items.push(CostLineItem::labor(
                CostCategory::Exterior,
                "Exterior finish labor".to_string(),
                LaborType::SidingInstall,
                sqft,
                rate.unit,
                rate.rate,
            ));
        }

        items
    }

    /// Calculate opening costs (windows, doors)
    fn calculate_openings(&self, input: &CostInput) -> Vec<CostLineItem> {
        let mut items = Vec::new();

        for opening in &input.openings {
            match opening.opening_type.as_str() {
                "window" => {
                    if let Some(price) =
                        self.price_table.get_material_price(&MaterialType::WindowUnit)
                    {
                        items.push(CostLineItem::material(
                            CostCategory::Windows,
                            format!("Window {}x{}", opening.width, opening.height),
                            MaterialType::WindowUnit,
                            opening.count as f64,
                            PricingUnit::PerComponent,
                            price.price,
                        ));
                    }
                }
                "exterior_door" => {
                    if let Some(price) =
                        self.price_table.get_material_price(&MaterialType::ExteriorDoor)
                    {
                        items.push(CostLineItem::material(
                            CostCategory::Doors,
                            "Exterior door".to_string(),
                            MaterialType::ExteriorDoor,
                            opening.count as f64,
                            PricingUnit::PerComponent,
                            price.price,
                        ));
                    }
                }
                "interior_door" => {
                    if let Some(price) =
                        self.price_table.get_material_price(&MaterialType::InteriorDoor)
                    {
                        items.push(CostLineItem::material(
                            CostCategory::Doors,
                            "Interior door".to_string(),
                            MaterialType::InteriorDoor,
                            opening.count as f64,
                            PricingUnit::PerComponent,
                            price.price,
                        ));
                    }
                }
                "garage_door" => {
                    if let Some(price) =
                        self.price_table.get_material_price(&MaterialType::GarageDoor)
                    {
                        items.push(CostLineItem::material(
                            CostCategory::Doors,
                            "Garage door".to_string(),
                            MaterialType::GarageDoor,
                            opening.count as f64,
                            PricingUnit::PerComponent,
                            price.price,
                        ));
                    }
                }
                _ => {}
            }
        }

        items
    }

    /// Calculate interior finish costs by room
    fn calculate_interior(&self, input: &CostInput) -> Vec<CostLineItem> {
        let mut items = Vec::new();

        for room in &input.rooms {
            // Drywall (wall sqft + ceiling sqft)
            let drywall_sqft = room.wall_sqft + room.floor_sqft; // ceiling ~ floor
            if let Some(price) = self.price_table.get_material_price(&MaterialType::Drywall) {
                items.push(CostLineItem::material(
                    CostCategory::Drywall,
                    format!("{} drywall", room.room_type),
                    MaterialType::Drywall,
                    drywall_sqft,
                    price.unit,
                    price.price,
                ));
            }

            // Flooring based on room type
            let flooring_type = match room.room_type.to_lowercase().as_str() {
                "kitchen" | "bathroom" | "laundry" => MaterialType::Tile,
                "living" | "dining" | "bedroom" | "office" => MaterialType::Hardwood,
                "garage" => MaterialType::ConcreteMix, // epoxy or bare
                _ => MaterialType::LVP,                // default to LVP
            };

            if let Some(price) = self.price_table.get_material_price(&flooring_type) {
                items.push(CostLineItem::material(
                    CostCategory::Flooring,
                    format!("{} flooring", room.room_type),
                    flooring_type,
                    room.floor_sqft,
                    price.unit,
                    price.price,
                ));
            }

            // Trim (baseboard per perimeter)
            if let Some(price) = self.price_table.get_material_price(&MaterialType::Trim) {
                items.push(CostLineItem::material(
                    CostCategory::Trim,
                    format!("{} baseboard", room.room_type),
                    MaterialType::Trim,
                    room.perimeter_ft,
                    price.unit,
                    price.price,
                ));
            }

            // Paint (wall sqft)
            if let Some(price) = self.price_table.get_material_price(&MaterialType::Paint) {
                items.push(CostLineItem::material(
                    CostCategory::Painting,
                    format!("{} paint", room.room_type),
                    MaterialType::Paint,
                    room.wall_sqft,
                    price.unit,
                    price.price,
                ));
            }
        }

        // Drywall labor (total floor area * 2 for walls + ceiling)
        if let Some(rate) = self.price_table.get_labor_rate(&LaborType::DrywallInstall) {
            let total_drywall_sqft: f64 = input
                .rooms
                .iter()
                .map(|r| r.wall_sqft + r.floor_sqft)
                .sum();
            items.push(CostLineItem::labor(
                CostCategory::Drywall,
                "Drywall installation labor".to_string(),
                LaborType::DrywallInstall,
                total_drywall_sqft,
                rate.unit,
                rate.rate,
            ));
        }

        // Flooring labor
        if let Some(rate) = self.price_table.get_labor_rate(&LaborType::FlooringInstall) {
            items.push(CostLineItem::labor(
                CostCategory::Flooring,
                "Flooring installation labor".to_string(),
                LaborType::FlooringInstall,
                input.total_floor_area,
                rate.unit,
                rate.rate,
            ));
        }

        // Painting labor
        if let Some(rate) = self.price_table.get_labor_rate(&LaborType::PaintingLabor) {
            let total_wall_sqft: f64 = input.rooms.iter().map(|r| r.wall_sqft).sum();
            items.push(CostLineItem::labor(
                CostCategory::Painting,
                "Painting labor".to_string(),
                LaborType::PaintingLabor,
                total_wall_sqft,
                rate.unit,
                rate.rate,
            ));
        }

        items
    }

    /// Update a material price
    pub fn set_material_price(&mut self, material: MaterialType, price: UnitPrice) {
        self.price_table.set_material_price(material, price);
    }

    /// Update a labor rate
    pub fn set_labor_rate(&mut self, labor: LaborType, rate: LaborRate) {
        self.price_table.set_labor_rate(labor, rate);
    }

    /// Get the price table
    pub fn price_table(&self) -> &PriceTable {
        &self.price_table
    }

    /// Get mutable price table
    pub fn price_table_mut(&mut self) -> &mut PriceTable {
        &mut self.price_table
    }
}

impl Default for CostCalculator {
    fn default() -> Self {
        Self::with_defaults()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_input() -> CostInput {
        CostInput {
            level_id: LevelId::new(),
            footprint_sqft: 2000.0,
            total_floor_area: 2000.0,
            exterior_wall_linear_ft: 180.0, // ~45ft x 4 sides
            exterior_wall_sqft: 1440.0,     // 180 * 8ft height
            interior_wall_linear_ft: 100.0,
            roof_sqft: 2200.0,      // with overhang
            foundation_sqft: 2000.0,
            wall_height: 8.0,
            rooms: vec![
                RoomCostInput {
                    id: RoomId::new(),
                    room_type: "living".to_string(),
                    floor_sqft: 400.0,
                    wall_sqft: 320.0,
                    perimeter_ft: 80.0,
                },
                RoomCostInput {
                    id: RoomId::new(),
                    room_type: "kitchen".to_string(),
                    floor_sqft: 200.0,
                    wall_sqft: 160.0,
                    perimeter_ft: 60.0,
                },
            ],
            openings: vec![
                OpeningCostInput {
                    id: OpeningId::new(),
                    opening_type: "window".to_string(),
                    width: 3.0,
                    height: 4.0,
                    count: 6,
                },
                OpeningCostInput {
                    id: OpeningId::new(),
                    opening_type: "exterior_door".to_string(),
                    width: 3.0,
                    height: 6.8,
                    count: 2,
                },
            ],
        }
    }

    #[test]
    fn test_calculate_with_defaults() {
        let calc = CostCalculator::with_defaults();
        let input = sample_input();
        let estimate = calc.calculate(&input);

        // With $0 defaults, totals should be 0
        assert_eq!(estimate.grand_total, 0.0);
        // But we should still have line items
        assert!(!estimate.line_items.is_empty());
    }

    #[test]
    fn test_calculate_with_prices() {
        let mut calc = CostCalculator::with_defaults();

        // Set some prices
        calc.set_material_price(
            MaterialType::ConcreteMix,
            UnitPrice::new(MaterialType::ConcreteMix, PricingUnit::PerCubicYard, 150.0),
        );
        calc.set_labor_rate(
            LaborType::ConcretePlaceFinish,
            LaborRate::new(
                LaborType::ConcretePlaceFinish,
                PricingUnit::PerSquareFoot,
                3.0,
            ),
        );

        let input = sample_input();
        let estimate = calc.calculate(&input);

        // Should have non-zero totals now
        assert!(estimate.grand_total > 0.0);
    }

    #[test]
    fn test_foundation_breakdown() {
        let calc = CostCalculator::with_defaults();
        let input = sample_input();
        let estimate = calc.calculate(&input);

        let foundation_items: Vec<_> = estimate
            .line_items
            .iter()
            .filter(|i| i.category == CostCategory::Foundation)
            .collect();

        // Should have: forms, rebar, concrete, vapor barrier, gravel + 4 labor types
        assert!(foundation_items.len() >= 5);
    }

    #[test]
    fn test_framing_calculation() {
        let calc = CostCalculator::with_defaults();
        let input = sample_input();
        let estimate = calc.calculate(&input);

        let framing_items: Vec<_> = estimate
            .line_items
            .iter()
            .filter(|i| i.category == CostCategory::Framing)
            .collect();

        // Should have: 2x6 studs, 2x4 studs, sheathing, framing labor
        assert!(framing_items.len() >= 3);
    }

    #[test]
    fn test_roofing_calculation() {
        let calc = CostCalculator::with_defaults();
        let input = sample_input();
        let estimate = calc.calculate(&input);

        let roofing_items: Vec<_> = estimate
            .line_items
            .iter()
            .filter(|i| i.category == CostCategory::Roofing)
            .collect();

        // Should have: underlayment, shingles, labor
        assert!(roofing_items.len() >= 2);
    }

    #[test]
    fn test_openings_calculation() {
        let calc = CostCalculator::with_defaults();
        let input = sample_input();
        let estimate = calc.calculate(&input);

        let window_items: Vec<_> = estimate
            .line_items
            .iter()
            .filter(|i| i.category == CostCategory::Windows)
            .collect();
        let door_items: Vec<_> = estimate
            .line_items
            .iter()
            .filter(|i| i.category == CostCategory::Doors)
            .collect();

        // Should have windows and doors from input
        assert_eq!(window_items.len(), 1); // 1 window line item (count=6)
        assert_eq!(door_items.len(), 1);   // 1 door line item (count=2)
    }

    #[test]
    fn test_interior_calculation() {
        let calc = CostCalculator::with_defaults();
        let input = sample_input();
        let estimate = calc.calculate(&input);

        let drywall_items: Vec<_> = estimate
            .line_items
            .iter()
            .filter(|i| i.category == CostCategory::Drywall)
            .collect();
        let flooring_items: Vec<_> = estimate
            .line_items
            .iter()
            .filter(|i| i.category == CostCategory::Flooring)
            .collect();

        // Should have drywall per room + labor
        assert!(drywall_items.len() >= 2); // 2 rooms

        // Should have flooring per room + labor
        assert!(flooring_items.len() >= 2); // 2 rooms
    }

    #[test]
    fn test_room_flooring_types() {
        let mut calc = CostCalculator::with_defaults();

        // Set flooring prices to distinguish them
        calc.set_material_price(
            MaterialType::Hardwood,
            UnitPrice::new(MaterialType::Hardwood, PricingUnit::PerSquareFoot, 10.0),
        );
        calc.set_material_price(
            MaterialType::Tile,
            UnitPrice::new(MaterialType::Tile, PricingUnit::PerSquareFoot, 8.0),
        );
        calc.set_material_price(
            MaterialType::LVP,
            UnitPrice::new(MaterialType::LVP, PricingUnit::PerSquareFoot, 5.0),
        );

        let input = sample_input();
        let estimate = calc.calculate(&input);

        // Living room should get hardwood
        let living_flooring = estimate
            .line_items
            .iter()
            .find(|i| i.description == "living flooring");
        assert!(living_flooring.is_some());
        assert_eq!(living_flooring.unwrap().material_type, Some(MaterialType::Hardwood));

        // Kitchen should get tile
        let kitchen_flooring = estimate
            .line_items
            .iter()
            .find(|i| i.description == "kitchen flooring");
        assert!(kitchen_flooring.is_some());
        assert_eq!(kitchen_flooring.unwrap().material_type, Some(MaterialType::Tile));
    }

    #[test]
    fn test_price_table_modification() {
        let mut calc = CostCalculator::with_defaults();

        // Initially $0
        assert_eq!(
            calc.price_table().material_price_value(&MaterialType::ConcreteMix),
            0.0
        );

        // Update price
        calc.set_material_price(
            MaterialType::ConcreteMix,
            UnitPrice::new(MaterialType::ConcreteMix, PricingUnit::PerCubicYard, 175.0),
        );

        // Should be updated
        assert_eq!(
            calc.price_table().material_price_value(&MaterialType::ConcreteMix),
            175.0
        );
    }

    #[test]
    fn test_labor_rate_modification() {
        let mut calc = CostCalculator::with_defaults();

        // Initially $0
        assert_eq!(
            calc.price_table().labor_rate_value(&LaborType::FramingCarpentry),
            0.0
        );

        // Update rate
        calc.set_labor_rate(
            LaborType::FramingCarpentry,
            LaborRate::new(LaborType::FramingCarpentry, PricingUnit::PerSquareFoot, 8.50),
        );

        // Should be updated
        assert_eq!(
            calc.price_table().labor_rate_value(&LaborType::FramingCarpentry),
            8.50
        );
    }

    #[test]
    fn test_default_calculator() {
        let calc = CostCalculator::default();
        assert!(calc.price_table().get_material_price(&MaterialType::ConcreteMix).is_some());
    }

    #[test]
    fn test_empty_rooms_and_openings() {
        let calc = CostCalculator::with_defaults();
        let input = CostInput {
            level_id: LevelId::new(),
            footprint_sqft: 1000.0,
            total_floor_area: 1000.0,
            exterior_wall_linear_ft: 130.0,
            exterior_wall_sqft: 1040.0,
            interior_wall_linear_ft: 50.0,
            roof_sqft: 1100.0,
            foundation_sqft: 1000.0,
            wall_height: 8.0,
            rooms: vec![],
            openings: vec![],
        };

        let estimate = calc.calculate(&input);

        // Should still have foundation, framing, roofing, exterior items
        assert!(!estimate.line_items.is_empty());

        // But no interior finish items (no rooms)
        let drywall_items: Vec<_> = estimate
            .line_items
            .iter()
            .filter(|i| i.category == CostCategory::Drywall)
            .collect();
        // Only labor item, no room-specific drywall
        assert!(drywall_items.len() <= 1);
    }
}
