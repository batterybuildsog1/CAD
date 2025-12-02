/**
 * Cost Estimation Types - Frontend
 * Mirrors Rust domain/costing.rs for type safety
 */

// ============================================================================
// Pricing Unit Types
// ============================================================================

export type PricingUnit =
  | 'per_component'
  | 'per_sqft'
  | 'per_linear_foot'
  | 'per_cubic_yard'
  | 'per_pound'
  | 'per_board'
  | 'per_hour'
  | 'lump';

// ============================================================================
// Cost Category Types
// ============================================================================

export type CostCategory =
  | 'site_work'
  | 'foundation'
  | 'framing'
  | 'roofing'
  | 'exterior'
  | 'windows'
  | 'doors'
  | 'plumbing'
  | 'electrical'
  | 'hvac'
  | 'insulation'
  | 'drywall'
  | 'flooring'
  | 'painting'
  | 'trim'
  | 'fixtures'
  | 'appliances'
  | 'landscaping'
  | 'contingency';

// ============================================================================
// Labor Types
// ============================================================================

export type LaborType =
  | 'general_labor'
  | 'skilled_labor'
  | 'framing_carpentry'
  | 'concrete_subgrade_prep'
  | 'concrete_form_install'
  | 'concrete_rebar_install'
  | 'concrete_place_finish'
  | 'roofing_install'
  | 'siding_install'
  | 'drywall_install'
  | 'painting_labor'
  | 'flooring_install'
  | 'tile_install'
  | 'plumbing_labor'
  | 'electrical_labor'
  | 'hvac_install';

// ============================================================================
// Material Types
// ============================================================================

export type MaterialType =
  // Concrete
  | 'concrete_mix'
  | 'concrete_rebar'
  | 'concrete_forms'
  | 'concrete_vapor_barrier'
  | 'concrete_gravel'
  // Framing
  | 'lumber_2x4'
  | 'lumber_2x6'
  | 'lumber_2x8'
  | 'lumber_2x10'
  | 'lumber_2x12'
  | 'lvl_beam'
  | 'sheathing'
  // Roofing
  | 'asphalt_shingles'
  | 'metal_roofing'
  | 'tile_roofing'
  | 'roofing_underlayment'
  // Exterior
  | 'vinyl_siding'
  | 'hardie_board'
  | 'stucco'
  | 'brick'
  | 'stone'
  // Openings
  | 'window_unit'
  | 'exterior_door'
  | 'interior_door'
  | 'garage_door'
  // Interior
  | 'drywall'
  | 'insulation'
  | 'paint'
  | 'hardwood'
  | 'tile'
  | 'carpet'
  | 'lvp'
  | 'trim'
  // Fixtures
  | 'truss'
  | 'light_fixture'
  | 'plumbing_fixture'
  | 'cabinet'
  | 'countertop'
  | 'appliance';

// ============================================================================
// Interfaces
// ============================================================================

export interface UnitPrice {
  materialType: MaterialType;
  unit: PricingUnit;
  price: number;
  description?: string;
  supplier?: string;
  lastUpdated?: string;
}

export interface LaborRate {
  laborType: LaborType;
  unit: PricingUnit;
  rate: number;
  description?: string;
}

export interface CostLineItem {
  id: string;
  category: CostCategory;
  description: string;
  materialType?: MaterialType;
  laborType?: LaborType;
  quantity: number;
  unit: PricingUnit;
  unitPrice: number;
  total: number;
  notes?: string;
}

export interface CostEstimate {
  id: string;
  levelId: string;
  lineItems: CostLineItem[];
  subtotals: Record<CostCategory, number>;
  laborTotal: number;
  materialTotal: number;
  grandTotal: number;
  createdAt: string;
  notes?: string;
}

export interface PriceTable {
  materialPrices: Record<MaterialType, UnitPrice>;
  laborRates: Record<LaborType, LaborRate>;
}

// ============================================================================
// Display Labels
// ============================================================================

export const CATEGORY_LABELS: Record<CostCategory, string> = {
  site_work: 'Site Work',
  foundation: 'Foundation',
  framing: 'Framing',
  roofing: 'Roofing',
  exterior: 'Exterior',
  windows: 'Windows',
  doors: 'Doors',
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  hvac: 'HVAC',
  insulation: 'Insulation',
  drywall: 'Drywall',
  flooring: 'Flooring',
  painting: 'Painting',
  trim: 'Trim',
  fixtures: 'Fixtures',
  appliances: 'Appliances',
  landscaping: 'Landscaping',
  contingency: 'Contingency',
};

export const UNIT_LABELS: Record<PricingUnit, string> = {
  per_component: 'ea',
  per_sqft: '/sqft',
  per_linear_foot: '/lf',
  per_cubic_yard: '/cy',
  per_pound: '/lb',
  per_board: '/bd',
  per_hour: '/hr',
  lump: 'lump',
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Format a number as US currency
 * @param amount - The amount to format
 * @returns Formatted currency string (e.g., "$12,345")
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

// ============================================================================
// Category Ordering
// ============================================================================

/** Category order for display (follows typical construction sequence) */
export const CATEGORY_ORDER: CostCategory[] = [
  'site_work',
  'foundation',
  'framing',
  'roofing',
  'exterior',
  'windows',
  'doors',
  'plumbing',
  'electrical',
  'hvac',
  'insulation',
  'drywall',
  'flooring',
  'painting',
  'trim',
  'fixtures',
  'appliances',
  'landscaping',
  'contingency',
];
