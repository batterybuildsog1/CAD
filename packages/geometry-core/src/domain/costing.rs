// Cost estimation domain types - pricing, labor rates, and cost breakdowns
// Provides data structures for material takeoffs and construction cost estimates

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use super::ids::LevelId;

// ============================================================================
// ID Types
// ============================================================================

/// Macro to generate ID types with common implementations (from ids.rs pattern)
macro_rules! define_cost_id {
    ($name:ident, $prefix:expr) => {
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(uuid::Uuid);

        impl $name {
            pub fn new() -> Self {
                Self(uuid::Uuid::new_v4())
            }

            pub fn from_uuid(uuid: uuid::Uuid) -> Self {
                Self(uuid)
            }

            pub fn as_uuid(&self) -> &uuid::Uuid {
                &self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl std::fmt::Debug for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}({})", stringify!($name), &self.0.to_string()[..8])
            }
        }

        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                write!(f, "{}", self.0)
            }
        }

        impl std::str::FromStr for $name {
            type Err = uuid::Error;

            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Ok(Self(uuid::Uuid::parse_str(s)?))
            }
        }
    };
}

// Cost domain IDs
define_cost_id!(CostLineItemId, "cli");
define_cost_id!(CostEstimateId, "est");

// ============================================================================
// Pricing Units
// ============================================================================

/// Unit of measurement for pricing items
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PricingUnit {
    /// Per individual component (windows, doors, trusses, fixtures)
    PerComponent,
    /// Per square foot (roofing, siding, flooring)
    PerSquareFoot,
    /// Per linear foot (trim, baseboards, headers)
    PerLinearFoot,
    /// Per cubic yard (concrete materials, gravel)
    PerCubicYard,
    /// Per pound (rebar)
    PerPound,
    /// Per board (lumber by specific size)
    PerBoard,
    /// Per hour (labor rates)
    PerHour,
    /// Fixed lump sum (one-time costs)
    Lump,
}

impl Default for PricingUnit {
    fn default() -> Self {
        PricingUnit::PerComponent
    }
}

impl PricingUnit {
    /// Get display name for the unit
    pub fn display_name(&self) -> &'static str {
        match self {
            PricingUnit::PerComponent => "per unit",
            PricingUnit::PerSquareFoot => "per sq ft",
            PricingUnit::PerLinearFoot => "per lin ft",
            PricingUnit::PerCubicYard => "per cu yd",
            PricingUnit::PerPound => "per lb",
            PricingUnit::PerBoard => "per board",
            PricingUnit::PerHour => "per hour",
            PricingUnit::Lump => "lump sum",
        }
    }

    /// Get abbreviated unit symbol
    pub fn abbreviation(&self) -> &'static str {
        match self {
            PricingUnit::PerComponent => "ea",
            PricingUnit::PerSquareFoot => "sf",
            PricingUnit::PerLinearFoot => "lf",
            PricingUnit::PerCubicYard => "cy",
            PricingUnit::PerPound => "lb",
            PricingUnit::PerBoard => "bd",
            PricingUnit::PerHour => "hr",
            PricingUnit::Lump => "ls",
        }
    }
}

// ============================================================================
// Cost Categories
// ============================================================================

/// Major cost categories for construction budgeting
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostCategory {
    SiteWork,
    Foundation,
    Framing,
    Roofing,
    Exterior,
    Windows,
    Doors,
    Plumbing,
    Electrical,
    HVAC,
    Insulation,
    Drywall,
    Flooring,
    Painting,
    Trim,
    Fixtures,
    Appliances,
    Landscaping,
    Contingency,
}

impl Default for CostCategory {
    fn default() -> Self {
        CostCategory::Contingency
    }
}

impl CostCategory {
    /// Get display name for the category
    pub fn display_name(&self) -> &'static str {
        match self {
            CostCategory::SiteWork => "Site Work",
            CostCategory::Foundation => "Foundation",
            CostCategory::Framing => "Framing",
            CostCategory::Roofing => "Roofing",
            CostCategory::Exterior => "Exterior",
            CostCategory::Windows => "Windows",
            CostCategory::Doors => "Doors",
            CostCategory::Plumbing => "Plumbing",
            CostCategory::Electrical => "Electrical",
            CostCategory::HVAC => "HVAC",
            CostCategory::Insulation => "Insulation",
            CostCategory::Drywall => "Drywall",
            CostCategory::Flooring => "Flooring",
            CostCategory::Painting => "Painting",
            CostCategory::Trim => "Trim",
            CostCategory::Fixtures => "Fixtures",
            CostCategory::Appliances => "Appliances",
            CostCategory::Landscaping => "Landscaping",
            CostCategory::Contingency => "Contingency",
        }
    }

    /// Get all categories in typical construction order
    pub fn all_ordered() -> Vec<CostCategory> {
        vec![
            CostCategory::SiteWork,
            CostCategory::Foundation,
            CostCategory::Framing,
            CostCategory::Roofing,
            CostCategory::Exterior,
            CostCategory::Windows,
            CostCategory::Doors,
            CostCategory::Plumbing,
            CostCategory::Electrical,
            CostCategory::HVAC,
            CostCategory::Insulation,
            CostCategory::Drywall,
            CostCategory::Flooring,
            CostCategory::Painting,
            CostCategory::Trim,
            CostCategory::Fixtures,
            CostCategory::Appliances,
            CostCategory::Landscaping,
            CostCategory::Contingency,
        ]
    }
}

// ============================================================================
// Labor Types
// ============================================================================

/// Types of labor for construction activities
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LaborType {
    // General
    /// Unskilled general labor
    GeneralLabor,
    /// Skilled tradesperson (general)
    SkilledLabor,

    // Framing
    /// Framing carpentry work
    FramingCarpentry,

    // Concrete specific (detailed breakdown)
    /// Subgrade preparation: grading, compaction, gravel, vapor barrier
    ConcreteSubgradePrep,
    /// Form setup, bracing, and alignment
    ConcreteFormInstall,
    /// Rebar placement, tying, and chair installation
    ConcreteRebarInstall,
    /// Concrete pouring, spreading, screeding, and finishing
    ConcretePlaceFinish,

    // Other trades
    /// Roofing installation
    RoofingInstall,
    /// Siding installation
    SidingInstall,
    /// Drywall hanging and finishing
    DrywallInstall,
    /// Interior and exterior painting
    PaintingLabor,
    /// Flooring installation (hardwood, LVP, etc.)
    FlooringInstall,
    /// Tile installation
    TileInstall,
    /// Plumbing rough-in and finish
    PlumbingLabor,
    /// Electrical rough-in and finish
    ElectricalLabor,
    /// HVAC installation
    HVACInstall,
}

impl Default for LaborType {
    fn default() -> Self {
        LaborType::GeneralLabor
    }
}

impl LaborType {
    /// Get display name for the labor type
    pub fn display_name(&self) -> &'static str {
        match self {
            LaborType::GeneralLabor => "General Labor",
            LaborType::SkilledLabor => "Skilled Labor",
            LaborType::FramingCarpentry => "Framing Carpentry",
            LaborType::ConcreteSubgradePrep => "Concrete Subgrade Prep",
            LaborType::ConcreteFormInstall => "Concrete Form Install",
            LaborType::ConcreteRebarInstall => "Concrete Rebar Install",
            LaborType::ConcretePlaceFinish => "Concrete Place & Finish",
            LaborType::RoofingInstall => "Roofing Install",
            LaborType::SidingInstall => "Siding Install",
            LaborType::DrywallInstall => "Drywall Install",
            LaborType::PaintingLabor => "Painting",
            LaborType::FlooringInstall => "Flooring Install",
            LaborType::TileInstall => "Tile Install",
            LaborType::PlumbingLabor => "Plumbing",
            LaborType::ElectricalLabor => "Electrical",
            LaborType::HVACInstall => "HVAC Install",
        }
    }

    /// Get the typical cost category for this labor type
    pub fn typical_category(&self) -> CostCategory {
        match self {
            LaborType::GeneralLabor => CostCategory::SiteWork,
            LaborType::SkilledLabor => CostCategory::Framing,
            LaborType::FramingCarpentry => CostCategory::Framing,
            LaborType::ConcreteSubgradePrep => CostCategory::Foundation,
            LaborType::ConcreteFormInstall => CostCategory::Foundation,
            LaborType::ConcreteRebarInstall => CostCategory::Foundation,
            LaborType::ConcretePlaceFinish => CostCategory::Foundation,
            LaborType::RoofingInstall => CostCategory::Roofing,
            LaborType::SidingInstall => CostCategory::Exterior,
            LaborType::DrywallInstall => CostCategory::Drywall,
            LaborType::PaintingLabor => CostCategory::Painting,
            LaborType::FlooringInstall => CostCategory::Flooring,
            LaborType::TileInstall => CostCategory::Flooring,
            LaborType::PlumbingLabor => CostCategory::Plumbing,
            LaborType::ElectricalLabor => CostCategory::Electrical,
            LaborType::HVACInstall => CostCategory::HVAC,
        }
    }

    /// Check if this is concrete-related labor
    pub fn is_concrete_labor(&self) -> bool {
        matches!(
            self,
            LaborType::ConcreteSubgradePrep
                | LaborType::ConcreteFormInstall
                | LaborType::ConcreteRebarInstall
                | LaborType::ConcretePlaceFinish
        )
    }
}

// ============================================================================
// Material Types
// ============================================================================

/// Types of construction materials
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MaterialType {
    // Concrete materials
    /// Ready-mix concrete (per cubic yard)
    ConcreteMix,
    /// Steel reinforcement bar (per pound)
    ConcreteRebar,
    /// Concrete forms - reusable or single-use (per linear foot)
    ConcreteForms,
    /// Vapor barrier / moisture barrier (per sqft)
    ConcreteVaporBarrier,
    /// Base gravel / crushed stone (per cubic yard)
    ConcreteGravel,

    // Framing lumber
    /// 2x4 dimensional lumber
    Lumber2x4,
    /// 2x6 dimensional lumber
    Lumber2x6,
    /// 2x8 dimensional lumber
    Lumber2x8,
    /// 2x10 dimensional lumber
    Lumber2x10,
    /// 2x12 dimensional lumber
    Lumber2x12,
    /// Laminated Veneer Lumber beam
    LVLBeam,
    /// OSB or plywood sheathing
    Sheathing,

    // Roofing
    /// Asphalt shingles (per sqft)
    AsphaltShingles,
    /// Standing seam or corrugated metal (per sqft)
    MetalRoofing,
    /// Clay or concrete tile (per sqft)
    TileRoofing,
    /// Roofing felt / synthetic underlayment (per sqft)
    RoofingUnderlayment,

    // Exterior
    /// Vinyl siding (per sqft)
    VinylSiding,
    /// Fiber cement siding (per sqft)
    HardieBoard,
    /// Stucco / EIFS (per sqft)
    Stucco,
    /// Brick veneer (per sqft)
    Brick,
    /// Natural or manufactured stone (per sqft)
    Stone,

    // Openings
    /// Window unit (per component)
    WindowUnit,
    /// Exterior door with frame (per component)
    ExteriorDoor,
    /// Interior door with frame (per component)
    InteriorDoor,
    /// Garage door (per component)
    GarageDoor,

    // Interior finishes
    /// Gypsum drywall (per sqft)
    Drywall,
    /// Fiberglass / foam / cellulose insulation (per sqft)
    Insulation,
    /// Interior / exterior paint (per sqft)
    Paint,
    /// Hardwood flooring (per sqft)
    Hardwood,
    /// Ceramic / porcelain tile (per sqft)
    Tile,
    /// Carpet with pad (per sqft)
    Carpet,
    /// Luxury Vinyl Plank (per sqft)
    LVP,
    /// Base / crown / casing trim (per linear foot)
    Trim,

    // Fixtures and components
    /// Roof truss (per component)
    Truss,
    /// Light fixture (per component)
    LightFixture,
    /// Plumbing fixture - sink, toilet, etc. (per component)
    PlumbingFixture,
    /// Kitchen / bath cabinet (per component)
    Cabinet,
    /// Countertop - granite, quartz, laminate (per sqft)
    Countertop,
    /// Major appliance (per component)
    Appliance,
}

impl Default for MaterialType {
    fn default() -> Self {
        MaterialType::Lumber2x4
    }
}

impl MaterialType {
    /// Get display name for the material
    pub fn display_name(&self) -> &'static str {
        match self {
            MaterialType::ConcreteMix => "Concrete Mix",
            MaterialType::ConcreteRebar => "Rebar",
            MaterialType::ConcreteForms => "Concrete Forms",
            MaterialType::ConcreteVaporBarrier => "Vapor Barrier",
            MaterialType::ConcreteGravel => "Base Gravel",
            MaterialType::Lumber2x4 => "2x4 Lumber",
            MaterialType::Lumber2x6 => "2x6 Lumber",
            MaterialType::Lumber2x8 => "2x8 Lumber",
            MaterialType::Lumber2x10 => "2x10 Lumber",
            MaterialType::Lumber2x12 => "2x12 Lumber",
            MaterialType::LVLBeam => "LVL Beam",
            MaterialType::Sheathing => "Sheathing",
            MaterialType::AsphaltShingles => "Asphalt Shingles",
            MaterialType::MetalRoofing => "Metal Roofing",
            MaterialType::TileRoofing => "Tile Roofing",
            MaterialType::RoofingUnderlayment => "Roofing Underlayment",
            MaterialType::VinylSiding => "Vinyl Siding",
            MaterialType::HardieBoard => "Hardie Board",
            MaterialType::Stucco => "Stucco",
            MaterialType::Brick => "Brick",
            MaterialType::Stone => "Stone",
            MaterialType::WindowUnit => "Window",
            MaterialType::ExteriorDoor => "Exterior Door",
            MaterialType::InteriorDoor => "Interior Door",
            MaterialType::GarageDoor => "Garage Door",
            MaterialType::Drywall => "Drywall",
            MaterialType::Insulation => "Insulation",
            MaterialType::Paint => "Paint",
            MaterialType::Hardwood => "Hardwood Flooring",
            MaterialType::Tile => "Tile",
            MaterialType::Carpet => "Carpet",
            MaterialType::LVP => "LVP",
            MaterialType::Trim => "Trim",
            MaterialType::Truss => "Truss",
            MaterialType::LightFixture => "Light Fixture",
            MaterialType::PlumbingFixture => "Plumbing Fixture",
            MaterialType::Cabinet => "Cabinet",
            MaterialType::Countertop => "Countertop",
            MaterialType::Appliance => "Appliance",
        }
    }

    /// Get the typical pricing unit for this material
    pub fn typical_unit(&self) -> PricingUnit {
        match self {
            // Per cubic yard
            MaterialType::ConcreteMix | MaterialType::ConcreteGravel => PricingUnit::PerCubicYard,

            // Per pound
            MaterialType::ConcreteRebar => PricingUnit::PerPound,

            // Per linear foot
            MaterialType::ConcreteForms | MaterialType::Trim => PricingUnit::PerLinearFoot,

            // Per board
            MaterialType::Lumber2x4
            | MaterialType::Lumber2x6
            | MaterialType::Lumber2x8
            | MaterialType::Lumber2x10
            | MaterialType::Lumber2x12
            | MaterialType::LVLBeam => PricingUnit::PerBoard,

            // Per component
            MaterialType::WindowUnit
            | MaterialType::ExteriorDoor
            | MaterialType::InteriorDoor
            | MaterialType::GarageDoor
            | MaterialType::Truss
            | MaterialType::LightFixture
            | MaterialType::PlumbingFixture
            | MaterialType::Cabinet
            | MaterialType::Appliance => PricingUnit::PerComponent,

            // Per square foot (everything else)
            _ => PricingUnit::PerSquareFoot,
        }
    }

    /// Get the typical cost category for this material
    pub fn typical_category(&self) -> CostCategory {
        match self {
            MaterialType::ConcreteMix
            | MaterialType::ConcreteRebar
            | MaterialType::ConcreteForms
            | MaterialType::ConcreteVaporBarrier
            | MaterialType::ConcreteGravel => CostCategory::Foundation,

            MaterialType::Lumber2x4
            | MaterialType::Lumber2x6
            | MaterialType::Lumber2x8
            | MaterialType::Lumber2x10
            | MaterialType::Lumber2x12
            | MaterialType::LVLBeam
            | MaterialType::Sheathing => CostCategory::Framing,

            MaterialType::AsphaltShingles
            | MaterialType::MetalRoofing
            | MaterialType::TileRoofing
            | MaterialType::RoofingUnderlayment => CostCategory::Roofing,

            MaterialType::VinylSiding
            | MaterialType::HardieBoard
            | MaterialType::Stucco
            | MaterialType::Brick
            | MaterialType::Stone => CostCategory::Exterior,

            MaterialType::WindowUnit => CostCategory::Windows,
            MaterialType::ExteriorDoor | MaterialType::InteriorDoor | MaterialType::GarageDoor => {
                CostCategory::Doors
            }

            MaterialType::Drywall => CostCategory::Drywall,
            MaterialType::Insulation => CostCategory::Insulation,
            MaterialType::Paint => CostCategory::Painting,

            MaterialType::Hardwood | MaterialType::Tile | MaterialType::Carpet | MaterialType::LVP => {
                CostCategory::Flooring
            }

            MaterialType::Trim => CostCategory::Trim,
            MaterialType::Truss => CostCategory::Framing,
            MaterialType::LightFixture => CostCategory::Electrical,
            MaterialType::PlumbingFixture => CostCategory::Plumbing,
            MaterialType::Cabinet | MaterialType::Countertop => CostCategory::Fixtures,
            MaterialType::Appliance => CostCategory::Appliances,
        }
    }
}

// ============================================================================
// Price and Rate Entries
// ============================================================================

/// A unit price entry for materials
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UnitPrice {
    pub material_type: MaterialType,
    pub unit: PricingUnit,
    pub price: f64,
    pub description: Option<String>,
    pub supplier: Option<String>,
    /// ISO date string (e.g., "2024-01-15")
    pub last_updated: Option<String>,
}

impl UnitPrice {
    pub fn new(material_type: MaterialType, unit: PricingUnit, price: f64) -> Self {
        Self {
            material_type,
            unit,
            price,
            description: None,
            supplier: None,
            last_updated: None,
        }
    }

    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }

    pub fn with_supplier(mut self, supplier: impl Into<String>) -> Self {
        self.supplier = Some(supplier.into());
        self
    }

    pub fn with_last_updated(mut self, date: impl Into<String>) -> Self {
        self.last_updated = Some(date.into());
        self
    }
}

/// A labor rate entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LaborRate {
    pub labor_type: LaborType,
    /// Usually PerHour or PerSquareFoot
    pub unit: PricingUnit,
    pub rate: f64,
    pub description: Option<String>,
}

impl LaborRate {
    pub fn new(labor_type: LaborType, unit: PricingUnit, rate: f64) -> Self {
        Self {
            labor_type,
            unit,
            rate,
            description: None,
        }
    }

    pub fn with_description(mut self, description: impl Into<String>) -> Self {
        self.description = Some(description.into());
        self
    }
}

// ============================================================================
// Cost Line Item
// ============================================================================

/// A single line item in a cost estimate
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostLineItem {
    pub id: CostLineItemId,
    pub category: CostCategory,
    pub description: String,
    pub material_type: Option<MaterialType>,
    pub labor_type: Option<LaborType>,
    pub quantity: f64,
    pub unit: PricingUnit,
    pub unit_price: f64,
    pub total: f64,
    pub notes: Option<String>,
}

impl CostLineItem {
    /// Create a material cost line item
    pub fn material(
        category: CostCategory,
        description: impl Into<String>,
        material_type: MaterialType,
        quantity: f64,
        unit: PricingUnit,
        unit_price: f64,
    ) -> Self {
        Self {
            id: CostLineItemId::new(),
            category,
            description: description.into(),
            material_type: Some(material_type),
            labor_type: None,
            quantity,
            unit,
            unit_price,
            total: quantity * unit_price,
            notes: None,
        }
    }

    /// Create a labor cost line item
    pub fn labor(
        category: CostCategory,
        description: impl Into<String>,
        labor_type: LaborType,
        quantity: f64,
        unit: PricingUnit,
        rate: f64,
    ) -> Self {
        Self {
            id: CostLineItemId::new(),
            category,
            description: description.into(),
            material_type: None,
            labor_type: Some(labor_type),
            quantity,
            unit,
            unit_price: rate,
            total: quantity * rate,
            notes: None,
        }
    }

    /// Create a generic line item (no specific material or labor type)
    pub fn generic(
        category: CostCategory,
        description: impl Into<String>,
        quantity: f64,
        unit: PricingUnit,
        unit_price: f64,
    ) -> Self {
        Self {
            id: CostLineItemId::new(),
            category,
            description: description.into(),
            material_type: None,
            labor_type: None,
            quantity,
            unit,
            unit_price,
            total: quantity * unit_price,
            notes: None,
        }
    }

    pub fn with_notes(mut self, notes: impl Into<String>) -> Self {
        self.notes = Some(notes.into());
        self
    }

    /// Recalculate total from quantity and unit price
    pub fn recalculate_total(&mut self) {
        self.total = self.quantity * self.unit_price;
    }

    /// Check if this is a labor item
    pub fn is_labor(&self) -> bool {
        self.labor_type.is_some()
    }

    /// Check if this is a material item
    pub fn is_material(&self) -> bool {
        self.material_type.is_some()
    }
}

// ============================================================================
// Cost Estimate
// ============================================================================

/// A complete cost estimate for a level or project
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CostEstimate {
    pub id: CostEstimateId,
    pub level_id: LevelId,
    pub line_items: Vec<CostLineItem>,
    pub subtotals: HashMap<CostCategory, f64>,
    pub labor_total: f64,
    pub material_total: f64,
    pub grand_total: f64,
    /// ISO date string
    pub created_at: String,
    pub notes: Option<String>,
}

impl CostEstimate {
    pub fn new(level_id: LevelId) -> Self {
        Self {
            id: CostEstimateId::new(),
            level_id,
            line_items: Vec::new(),
            subtotals: HashMap::new(),
            labor_total: 0.0,
            material_total: 0.0,
            grand_total: 0.0,
            created_at: chrono::Utc::now().format("%Y-%m-%d").to_string(),
            notes: None,
        }
    }

    /// Add a line item and update totals
    pub fn add_line_item(&mut self, item: CostLineItem) {
        // Update category subtotal
        *self.subtotals.entry(item.category).or_insert(0.0) += item.total;

        // Update labor/material totals
        if item.is_labor() {
            self.labor_total += item.total;
        } else if item.is_material() {
            self.material_total += item.total;
        }

        // Update grand total
        self.grand_total += item.total;

        self.line_items.push(item);
    }

    /// Recalculate all totals from line items
    pub fn recalculate_totals(&mut self) {
        self.subtotals.clear();
        self.labor_total = 0.0;
        self.material_total = 0.0;
        self.grand_total = 0.0;

        for item in &self.line_items {
            *self.subtotals.entry(item.category).or_insert(0.0) += item.total;

            if item.is_labor() {
                self.labor_total += item.total;
            } else if item.is_material() {
                self.material_total += item.total;
            }

            self.grand_total += item.total;
        }
    }

    /// Get line items for a specific category
    pub fn items_by_category(&self, category: CostCategory) -> Vec<&CostLineItem> {
        self.line_items
            .iter()
            .filter(|item| item.category == category)
            .collect()
    }

    /// Get all labor items
    pub fn labor_items(&self) -> Vec<&CostLineItem> {
        self.line_items.iter().filter(|item| item.is_labor()).collect()
    }

    /// Get all material items
    pub fn material_items(&self) -> Vec<&CostLineItem> {
        self.line_items.iter().filter(|item| item.is_material()).collect()
    }

    /// Get subtotal for a category
    pub fn category_subtotal(&self, category: CostCategory) -> f64 {
        self.subtotals.get(&category).copied().unwrap_or(0.0)
    }

    pub fn with_notes(mut self, notes: impl Into<String>) -> Self {
        self.notes = Some(notes.into());
        self
    }

    /// Get cost per square foot (requires total area as parameter)
    pub fn cost_per_sqft(&self, total_sqft: f64) -> f64 {
        if total_sqft > 0.0 {
            self.grand_total / total_sqft
        } else {
            0.0
        }
    }
}

// ============================================================================
// Price Table
// ============================================================================

/// A table of material prices and labor rates for lookups
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PriceTable {
    pub material_prices: HashMap<MaterialType, UnitPrice>,
    pub labor_rates: HashMap<LaborType, LaborRate>,
}

impl PriceTable {
    pub fn new() -> Self {
        Self {
            material_prices: HashMap::new(),
            labor_rates: HashMap::new(),
        }
    }

    /// Create a price table with placeholder defaults (all $0)
    pub fn with_defaults() -> Self {
        let mut table = Self::new();

        // Add placeholder material prices
        let materials = [
            MaterialType::ConcreteMix,
            MaterialType::ConcreteRebar,
            MaterialType::ConcreteForms,
            MaterialType::ConcreteVaporBarrier,
            MaterialType::ConcreteGravel,
            MaterialType::Lumber2x4,
            MaterialType::Lumber2x6,
            MaterialType::Lumber2x8,
            MaterialType::Lumber2x10,
            MaterialType::Lumber2x12,
            MaterialType::LVLBeam,
            MaterialType::Sheathing,
            MaterialType::AsphaltShingles,
            MaterialType::MetalRoofing,
            MaterialType::TileRoofing,
            MaterialType::RoofingUnderlayment,
            MaterialType::VinylSiding,
            MaterialType::HardieBoard,
            MaterialType::Stucco,
            MaterialType::Brick,
            MaterialType::Stone,
            MaterialType::WindowUnit,
            MaterialType::ExteriorDoor,
            MaterialType::InteriorDoor,
            MaterialType::GarageDoor,
            MaterialType::Drywall,
            MaterialType::Insulation,
            MaterialType::Paint,
            MaterialType::Hardwood,
            MaterialType::Tile,
            MaterialType::Carpet,
            MaterialType::LVP,
            MaterialType::Trim,
            MaterialType::Truss,
            MaterialType::LightFixture,
            MaterialType::PlumbingFixture,
            MaterialType::Cabinet,
            MaterialType::Countertop,
            MaterialType::Appliance,
        ];

        for material in materials {
            table.set_material_price(
                material,
                UnitPrice::new(material, material.typical_unit(), 0.0),
            );
        }

        // Add placeholder labor rates
        let labor_types = [
            LaborType::GeneralLabor,
            LaborType::SkilledLabor,
            LaborType::FramingCarpentry,
            LaborType::ConcreteSubgradePrep,
            LaborType::ConcreteFormInstall,
            LaborType::ConcreteRebarInstall,
            LaborType::ConcretePlaceFinish,
            LaborType::RoofingInstall,
            LaborType::SidingInstall,
            LaborType::DrywallInstall,
            LaborType::PaintingLabor,
            LaborType::FlooringInstall,
            LaborType::TileInstall,
            LaborType::PlumbingLabor,
            LaborType::ElectricalLabor,
            LaborType::HVACInstall,
        ];

        for labor in labor_types {
            table.set_labor_rate(labor, LaborRate::new(labor, PricingUnit::PerHour, 0.0));
        }

        table
    }

    pub fn set_material_price(&mut self, material: MaterialType, price: UnitPrice) {
        self.material_prices.insert(material, price);
    }

    pub fn set_labor_rate(&mut self, labor: LaborType, rate: LaborRate) {
        self.labor_rates.insert(labor, rate);
    }

    pub fn get_material_price(&self, material: &MaterialType) -> Option<&UnitPrice> {
        self.material_prices.get(material)
    }

    pub fn get_labor_rate(&self, labor: &LaborType) -> Option<&LaborRate> {
        self.labor_rates.get(labor)
    }

    /// Get material price value (returns 0.0 if not found)
    pub fn material_price_value(&self, material: &MaterialType) -> f64 {
        self.material_prices
            .get(material)
            .map(|p| p.price)
            .unwrap_or(0.0)
    }

    /// Get labor rate value (returns 0.0 if not found)
    pub fn labor_rate_value(&self, labor: &LaborType) -> f64 {
        self.labor_rates.get(labor).map(|r| r.rate).unwrap_or(0.0)
    }
}

impl Default for PriceTable {
    fn default() -> Self {
        Self::new()
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pricing_unit_display() {
        assert_eq!(PricingUnit::PerSquareFoot.display_name(), "per sq ft");
        assert_eq!(PricingUnit::PerComponent.abbreviation(), "ea");
        assert_eq!(PricingUnit::PerCubicYard.abbreviation(), "cy");
    }

    #[test]
    fn test_cost_category_order() {
        let categories = CostCategory::all_ordered();
        assert_eq!(categories[0], CostCategory::SiteWork);
        assert_eq!(categories[1], CostCategory::Foundation);
        assert_eq!(*categories.last().unwrap(), CostCategory::Contingency);
    }

    #[test]
    fn test_labor_type_concrete() {
        assert!(LaborType::ConcreteSubgradePrep.is_concrete_labor());
        assert!(LaborType::ConcreteFormInstall.is_concrete_labor());
        assert!(LaborType::ConcreteRebarInstall.is_concrete_labor());
        assert!(LaborType::ConcretePlaceFinish.is_concrete_labor());
        assert!(!LaborType::FramingCarpentry.is_concrete_labor());
    }

    #[test]
    fn test_material_type_units() {
        assert_eq!(MaterialType::ConcreteMix.typical_unit(), PricingUnit::PerCubicYard);
        assert_eq!(MaterialType::ConcreteRebar.typical_unit(), PricingUnit::PerPound);
        assert_eq!(MaterialType::WindowUnit.typical_unit(), PricingUnit::PerComponent);
        assert_eq!(MaterialType::Drywall.typical_unit(), PricingUnit::PerSquareFoot);
        assert_eq!(MaterialType::Trim.typical_unit(), PricingUnit::PerLinearFoot);
    }

    #[test]
    fn test_material_type_categories() {
        assert_eq!(MaterialType::ConcreteMix.typical_category(), CostCategory::Foundation);
        assert_eq!(MaterialType::Lumber2x4.typical_category(), CostCategory::Framing);
        assert_eq!(MaterialType::AsphaltShingles.typical_category(), CostCategory::Roofing);
        assert_eq!(MaterialType::WindowUnit.typical_category(), CostCategory::Windows);
    }

    #[test]
    fn test_unit_price_creation() {
        let price = UnitPrice::new(MaterialType::ConcreteMix, PricingUnit::PerCubicYard, 150.0)
            .with_description("4000 PSI ready mix")
            .with_supplier("Local Concrete Co");

        assert_eq!(price.price, 150.0);
        assert_eq!(price.description, Some("4000 PSI ready mix".to_string()));
        assert_eq!(price.supplier, Some("Local Concrete Co".to_string()));
    }

    #[test]
    fn test_labor_rate_creation() {
        let rate = LaborRate::new(LaborType::ConcretePlaceFinish, PricingUnit::PerSquareFoot, 4.50)
            .with_description("Includes finishing and curing");

        assert_eq!(rate.rate, 4.50);
        assert_eq!(rate.labor_type, LaborType::ConcretePlaceFinish);
    }

    #[test]
    fn test_cost_line_item_material() {
        let item = CostLineItem::material(
            CostCategory::Foundation,
            "Concrete for slab",
            MaterialType::ConcreteMix,
            15.0,
            PricingUnit::PerCubicYard,
            150.0,
        );

        assert_eq!(item.total, 2250.0);
        assert!(item.is_material());
        assert!(!item.is_labor());
    }

    #[test]
    fn test_cost_line_item_labor() {
        let item = CostLineItem::labor(
            CostCategory::Foundation,
            "Form installation labor",
            LaborType::ConcreteFormInstall,
            40.0,
            PricingUnit::PerHour,
            45.0,
        );

        assert_eq!(item.total, 1800.0);
        assert!(item.is_labor());
        assert!(!item.is_material());
    }

    #[test]
    fn test_cost_estimate_totals() {
        let level_id = LevelId::new();
        let mut estimate = CostEstimate::new(level_id);

        // Add material
        estimate.add_line_item(CostLineItem::material(
            CostCategory::Foundation,
            "Concrete",
            MaterialType::ConcreteMix,
            10.0,
            PricingUnit::PerCubicYard,
            150.0,
        ));

        // Add labor
        estimate.add_line_item(CostLineItem::labor(
            CostCategory::Foundation,
            "Place & finish",
            LaborType::ConcretePlaceFinish,
            8.0,
            PricingUnit::PerHour,
            50.0,
        ));

        assert_eq!(estimate.material_total, 1500.0);
        assert_eq!(estimate.labor_total, 400.0);
        assert_eq!(estimate.grand_total, 1900.0);
        assert_eq!(estimate.category_subtotal(CostCategory::Foundation), 1900.0);
    }

    #[test]
    fn test_cost_estimate_recalculate() {
        let level_id = LevelId::new();
        let mut estimate = CostEstimate::new(level_id);

        estimate.line_items.push(CostLineItem::material(
            CostCategory::Framing,
            "Lumber",
            MaterialType::Lumber2x6,
            100.0,
            PricingUnit::PerBoard,
            8.0,
        ));

        estimate.line_items.push(CostLineItem::labor(
            CostCategory::Framing,
            "Framing labor",
            LaborType::FramingCarpentry,
            40.0,
            PricingUnit::PerHour,
            45.0,
        ));

        // Manually added, need to recalculate
        estimate.recalculate_totals();

        assert_eq!(estimate.material_total, 800.0);
        assert_eq!(estimate.labor_total, 1800.0);
        assert_eq!(estimate.grand_total, 2600.0);
    }

    #[test]
    fn test_cost_estimate_cost_per_sqft() {
        let level_id = LevelId::new();
        let mut estimate = CostEstimate::new(level_id);

        estimate.add_line_item(CostLineItem::generic(
            CostCategory::Contingency,
            "Total construction",
            1.0,
            PricingUnit::Lump,
            200000.0,
        ));

        assert_eq!(estimate.cost_per_sqft(2000.0), 100.0);
        assert_eq!(estimate.cost_per_sqft(0.0), 0.0);
    }

    #[test]
    fn test_price_table() {
        let mut table = PriceTable::new();

        table.set_material_price(
            MaterialType::ConcreteMix,
            UnitPrice::new(MaterialType::ConcreteMix, PricingUnit::PerCubicYard, 150.0),
        );

        table.set_labor_rate(
            LaborType::ConcretePlaceFinish,
            LaborRate::new(LaborType::ConcretePlaceFinish, PricingUnit::PerSquareFoot, 4.50),
        );

        assert_eq!(table.material_price_value(&MaterialType::ConcreteMix), 150.0);
        assert_eq!(table.labor_rate_value(&LaborType::ConcretePlaceFinish), 4.50);
        assert_eq!(table.material_price_value(&MaterialType::Lumber2x4), 0.0);
    }

    #[test]
    fn test_price_table_with_defaults() {
        let table = PriceTable::with_defaults();

        // Should have all material types
        assert!(table.get_material_price(&MaterialType::ConcreteMix).is_some());
        assert!(table.get_material_price(&MaterialType::Lumber2x4).is_some());
        assert!(table.get_material_price(&MaterialType::WindowUnit).is_some());

        // Should have all labor types
        assert!(table.get_labor_rate(&LaborType::ConcreteFormInstall).is_some());
        assert!(table.get_labor_rate(&LaborType::FramingCarpentry).is_some());

        // All defaults should be 0
        assert_eq!(table.material_price_value(&MaterialType::ConcreteMix), 0.0);
        assert_eq!(table.labor_rate_value(&LaborType::GeneralLabor), 0.0);
    }

    #[test]
    fn test_id_uniqueness() {
        let id1 = CostLineItemId::new();
        let id2 = CostLineItemId::new();
        assert_ne!(id1, id2);

        let id3 = CostEstimateId::new();
        let id4 = CostEstimateId::new();
        assert_ne!(id3, id4);
    }

    #[test]
    fn test_id_serialization() {
        let id = CostLineItemId::new();
        let json = serde_json::to_string(&id).unwrap();
        let parsed: CostLineItemId = serde_json::from_str(&json).unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn test_cost_estimate_items_by_category() {
        let level_id = LevelId::new();
        let mut estimate = CostEstimate::new(level_id);

        estimate.add_line_item(CostLineItem::material(
            CostCategory::Foundation,
            "Concrete",
            MaterialType::ConcreteMix,
            10.0,
            PricingUnit::PerCubicYard,
            150.0,
        ));

        estimate.add_line_item(CostLineItem::material(
            CostCategory::Foundation,
            "Rebar",
            MaterialType::ConcreteRebar,
            500.0,
            PricingUnit::PerPound,
            0.80,
        ));

        estimate.add_line_item(CostLineItem::material(
            CostCategory::Framing,
            "Lumber",
            MaterialType::Lumber2x6,
            50.0,
            PricingUnit::PerBoard,
            8.0,
        ));

        let foundation_items = estimate.items_by_category(CostCategory::Foundation);
        assert_eq!(foundation_items.len(), 2);

        let framing_items = estimate.items_by_category(CostCategory::Framing);
        assert_eq!(framing_items.len(), 1);
    }
}
