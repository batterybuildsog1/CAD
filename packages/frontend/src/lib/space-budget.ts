/**
 * Space Budget & Excess Allocation System
 *
 * Handles intelligent space allocation when footprint > sum of room minimums.
 *
 * CRITICAL DESIGN PRINCIPLE:
 * - Room sizes are EXACT DIMENSIONS, not arbitrary sqft values
 * - When expanding, upsize to the NEXT known-good dimension set
 * - DO NOT round to "reasonable increments"
 * - DO NOT use relative percentage increases
 * - Increment by 1-2 feet in either direction is safe for any room
 *
 * Allocation Priority (per user preference):
 * 1. Primary bedroom/bathroom
 * 2. Kitchen
 * 3. Dining
 * 4. Living room
 * 5. Secondary bedrooms
 * 6. Storage/closets
 *
 * NOT allocated to circulation unless explicitly requested.
 */

import type { RoomType } from './gemini-types';

// ============================================================================
// Room Size Options (EXACT DIMENSIONS)
// ============================================================================

/**
 * A specific room size option with exact dimensions.
 * These are known-good sizes based on architectural standards.
 */
export interface RoomSizeOption {
  width: number;   // Exact feet (E-W dimension)
  depth: number;   // Exact feet (N-S dimension)
  area: number;    // Calculated (width * depth)
  tier: 'minimum' | 'nice' | 'extra' | 'premium';
  description?: string;
}

/**
 * Bedroom sizes - from code minimum to premium
 * Bedrooms can be incremented 1-2' in either direction safely
 */
export const BEDROOM_SIZES: RoomSizeOption[] = [
  { width: 10, depth: 10, area: 100, tier: 'minimum', description: 'Code minimum' },
  { width: 10, depth: 11, area: 110, tier: 'minimum', description: '+1\' depth' },
  { width: 10, depth: 12, area: 120, tier: 'minimum', description: 'Small comfortable' },
  { width: 11, depth: 11, area: 121, tier: 'nice', description: 'Square nice' },
  { width: 11, depth: 12, area: 132, tier: 'nice', description: 'Rectangular nice' },
  { width: 12, depth: 12, area: 144, tier: 'nice', description: 'Standard comfortable' },
  { width: 12, depth: 13, area: 156, tier: 'extra', description: 'Spacious' },
  { width: 12, depth: 14, area: 168, tier: 'extra', description: 'Large' },
  { width: 13, depth: 14, area: 182, tier: 'extra', description: 'Very spacious' },
  { width: 14, depth: 14, area: 196, tier: 'extra', description: 'Premium square' },
  { width: 14, depth: 15, area: 210, tier: 'premium', description: 'Premium' },
  { width: 14, depth: 16, area: 224, tier: 'premium', description: 'Primary suite' },
  { width: 15, depth: 16, area: 240, tier: 'premium', description: 'Large primary' },
  { width: 16, depth: 16, area: 256, tier: 'premium', description: 'Master suite' },
];

/**
 * Primary bedroom sizes - larger options for master suites
 * Modern builder standards: 14×14 minimum (was 12×12)
 */
export const PRIMARY_BEDROOM_SIZES: RoomSizeOption[] = [
  { width: 14, depth: 14, area: 196, tier: 'minimum', description: 'Minimum primary (modern standard)' },
  { width: 14, depth: 15, area: 210, tier: 'minimum', description: 'Comfortable primary' },
  { width: 14, depth: 16, area: 224, tier: 'nice', description: 'Spacious primary' },
  { width: 15, depth: 16, area: 240, tier: 'nice', description: 'Large primary' },
  { width: 16, depth: 16, area: 256, tier: 'extra', description: 'Very large primary' },
  { width: 16, depth: 18, area: 288, tier: 'extra', description: 'Generous primary' },
  { width: 18, depth: 18, area: 324, tier: 'premium', description: 'Premium primary' },
  { width: 18, depth: 20, area: 360, tier: 'premium', description: 'Luxury primary' },
  { width: 20, depth: 20, area: 400, tier: 'premium', description: 'Master suite' },
];

/**
 * Kitchen sizes
 */
export const KITCHEN_SIZES: RoomSizeOption[] = [
  { width: 10, depth: 10, area: 100, tier: 'minimum', description: 'Galley minimum' },
  { width: 10, depth: 11, area: 110, tier: 'minimum', description: 'Small galley' },
  { width: 10, depth: 12, area: 120, tier: 'minimum', description: 'Standard galley' },
  { width: 11, depth: 11, area: 121, tier: 'nice', description: 'Compact square' },
  { width: 11, depth: 12, area: 132, tier: 'nice', description: 'Comfortable' },
  { width: 12, depth: 12, area: 144, tier: 'nice', description: 'Standard' },
  { width: 12, depth: 13, area: 156, tier: 'extra', description: 'With island space' },
  { width: 12, depth: 14, area: 168, tier: 'extra', description: 'Island kitchen' },
  { width: 13, depth: 14, area: 182, tier: 'extra', description: 'Large island' },
  { width: 14, depth: 14, area: 196, tier: 'extra', description: 'Chef\'s kitchen' },
  { width: 14, depth: 16, area: 224, tier: 'premium', description: 'Gourmet kitchen' },
  { width: 16, depth: 16, area: 256, tier: 'premium', description: 'Professional' },
];

/**
 * Living room sizes
 */
export const LIVING_SIZES: RoomSizeOption[] = [
  { width: 12, depth: 12, area: 144, tier: 'minimum', description: 'Compact living' },
  { width: 12, depth: 14, area: 168, tier: 'minimum', description: 'Small living' },
  { width: 13, depth: 14, area: 182, tier: 'nice', description: 'Comfortable' },
  { width: 14, depth: 14, area: 196, tier: 'nice', description: 'Standard living' },
  { width: 14, depth: 15, area: 210, tier: 'nice', description: 'Nice living' },
  { width: 15, depth: 15, area: 225, tier: 'nice', description: 'Spacious' },
  { width: 15, depth: 16, area: 240, tier: 'extra', description: 'Large' },
  { width: 16, depth: 16, area: 256, tier: 'extra', description: 'Very large' },
  { width: 16, depth: 18, area: 288, tier: 'extra', description: 'Great room' },
  { width: 18, depth: 18, area: 324, tier: 'premium', description: 'Grand living' },
  { width: 18, depth: 20, area: 360, tier: 'premium', description: 'Premium' },
  { width: 20, depth: 20, area: 400, tier: 'premium', description: 'Luxury' },
];

/**
 * Dining room sizes
 */
export const DINING_SIZES: RoomSizeOption[] = [
  { width: 10, depth: 10, area: 100, tier: 'minimum', description: '4-person minimum' },
  { width: 10, depth: 11, area: 110, tier: 'minimum', description: '4-person comfortable' },
  { width: 10, depth: 12, area: 120, tier: 'nice', description: '6-person' },
  { width: 11, depth: 12, area: 132, tier: 'nice', description: '6-person comfortable' },
  { width: 12, depth: 12, area: 144, tier: 'nice', description: 'Standard 6-8 person' },
  { width: 12, depth: 14, area: 168, tier: 'extra', description: '8-person' },
  { width: 12, depth: 15, area: 180, tier: 'extra', description: '8-person with buffet' },
  { width: 14, depth: 14, area: 196, tier: 'extra', description: '10-person' },
  { width: 14, depth: 16, area: 224, tier: 'premium', description: 'Formal dining' },
  { width: 16, depth: 16, area: 256, tier: 'premium', description: 'Large formal' },
];

/**
 * Bathroom sizes
 */
export const BATHROOM_SIZES: RoomSizeOption[] = [
  { width: 5, depth: 8, area: 40, tier: 'minimum', description: 'Full bath minimum' },
  { width: 5, depth: 9, area: 45, tier: 'minimum', description: 'Full bath standard' },
  { width: 5, depth: 10, area: 50, tier: 'nice', description: 'Comfortable full' },
  { width: 6, depth: 9, area: 54, tier: 'nice', description: 'Wide full bath' },
  { width: 6, depth: 10, area: 60, tier: 'nice', description: 'Spacious full' },
  { width: 7, depth: 10, area: 70, tier: 'extra', description: 'Large full' },
  { width: 8, depth: 10, area: 80, tier: 'extra', description: 'Double vanity' },
  { width: 8, depth: 11, area: 88, tier: 'extra', description: 'Spa bath' },
  { width: 9, depth: 10, area: 90, tier: 'extra', description: 'Primary bath' },
  { width: 10, depth: 10, area: 100, tier: 'premium', description: 'Luxury bath' },
  { width: 10, depth: 12, area: 120, tier: 'premium', description: 'Master bath' },
];

/**
 * Primary bathroom sizes - larger for master suites
 * Modern builder standards: 8×10 minimum (was 6×10)
 */
export const PRIMARY_BATHROOM_SIZES: RoomSizeOption[] = [
  { width: 8, depth: 10, area: 80, tier: 'minimum', description: 'Minimum ensuite (modern standard)' },
  { width: 9, depth: 10, area: 90, tier: 'minimum', description: 'Comfortable ensuite' },
  { width: 10, depth: 10, area: 100, tier: 'nice', description: 'Double vanity ensuite' },
  { width: 10, depth: 12, area: 120, tier: 'nice', description: 'Spa-style ensuite' },
  { width: 10, depth: 14, area: 140, tier: 'extra', description: 'Large spa ensuite' },
  { width: 12, depth: 12, area: 144, tier: 'extra', description: 'Luxury ensuite' },
  { width: 12, depth: 14, area: 168, tier: 'premium', description: 'Master bath' },
  { width: 14, depth: 14, area: 196, tier: 'premium', description: 'Spa master bath' },
];

/**
 * Closet sizes (secondary bedrooms)
 */
export const CLOSET_SIZES: RoomSizeOption[] = [
  { width: 4, depth: 4, area: 16, tier: 'minimum', description: 'Reach-in' },
  { width: 4, depth: 5, area: 20, tier: 'minimum', description: 'Deep reach-in' },
  { width: 5, depth: 5, area: 25, tier: 'nice', description: 'Small walk-in' },
  { width: 5, depth: 6, area: 30, tier: 'nice', description: 'Walk-in' },
  { width: 6, depth: 6, area: 36, tier: 'nice', description: 'Standard walk-in' },
  { width: 6, depth: 7, area: 42, tier: 'extra', description: 'Large walk-in' },
  { width: 6, depth: 8, area: 48, tier: 'extra', description: 'Spacious walk-in' },
  { width: 7, depth: 8, area: 56, tier: 'extra', description: 'Very large walk-in' },
  { width: 8, depth: 8, area: 64, tier: 'premium', description: 'Dressing room' },
  { width: 8, depth: 10, area: 80, tier: 'premium', description: 'Large dressing room' },
];

/**
 * Primary closet sizes - larger walk-in closets for master suites
 * Modern builder standards: 6×8 minimum walk-in
 */
export const PRIMARY_CLOSET_SIZES: RoomSizeOption[] = [
  { width: 6, depth: 8, area: 48, tier: 'minimum', description: 'Minimum primary walk-in' },
  { width: 7, depth: 8, area: 56, tier: 'minimum', description: 'Comfortable primary walk-in' },
  { width: 8, depth: 8, area: 64, tier: 'nice', description: 'Standard primary walk-in' },
  { width: 8, depth: 10, area: 80, tier: 'nice', description: 'Large primary walk-in' },
  { width: 10, depth: 10, area: 100, tier: 'extra', description: 'Dressing room' },
  { width: 10, depth: 12, area: 120, tier: 'extra', description: 'Large dressing room' },
  { width: 12, depth: 12, area: 144, tier: 'premium', description: 'His & hers closet' },
  { width: 12, depth: 14, area: 168, tier: 'premium', description: 'Boutique closet' },
];

/**
 * Office/study sizes
 */
export const OFFICE_SIZES: RoomSizeOption[] = [
  { width: 8, depth: 10, area: 80, tier: 'minimum', description: 'Compact office' },
  { width: 9, depth: 10, area: 90, tier: 'minimum', description: 'Small office' },
  { width: 10, depth: 10, area: 100, tier: 'nice', description: 'Standard office' },
  { width: 10, depth: 11, area: 110, tier: 'nice', description: 'Comfortable office' },
  { width: 10, depth: 12, area: 120, tier: 'nice', description: 'Spacious office' },
  { width: 11, depth: 12, area: 132, tier: 'extra', description: 'Large office' },
  { width: 12, depth: 12, area: 144, tier: 'extra', description: 'Executive office' },
  { width: 12, depth: 14, area: 168, tier: 'premium', description: 'Home office suite' },
];

/**
 * Family room sizes
 */
export const FAMILY_SIZES: RoomSizeOption[] = [
  { width: 12, depth: 15, area: 180, tier: 'minimum', description: 'Minimum family' },
  { width: 14, depth: 14, area: 196, tier: 'nice', description: 'Comfortable family' },
  { width: 14, depth: 16, area: 224, tier: 'nice', description: 'Standard family' },
  { width: 16, depth: 16, area: 256, tier: 'extra', description: 'Spacious family' },
  { width: 16, depth: 18, area: 288, tier: 'extra', description: 'Large family' },
  { width: 18, depth: 18, area: 324, tier: 'premium', description: 'Great room' },
  { width: 18, depth: 20, area: 360, tier: 'premium', description: 'Grand family' },
];

/**
 * Garage sizes
 */
export const GARAGE_SIZES: RoomSizeOption[] = [
  { width: 12, depth: 20, area: 240, tier: 'minimum', description: 'Single car' },
  { width: 12, depth: 22, area: 264, tier: 'minimum', description: 'Single + storage' },
  { width: 20, depth: 20, area: 400, tier: 'nice', description: 'Double car' },
  { width: 20, depth: 22, area: 440, tier: 'nice', description: 'Double + storage' },
  { width: 22, depth: 22, area: 484, tier: 'extra', description: 'Double + workshop' },
  { width: 24, depth: 24, area: 576, tier: 'extra', description: 'Triple car' },
  { width: 24, depth: 28, area: 672, tier: 'premium', description: 'Triple + workshop' },
];

/**
 * Utility/laundry sizes
 */
export const UTILITY_SIZES: RoomSizeOption[] = [
  { width: 5, depth: 7, area: 35, tier: 'minimum', description: 'Stackable only' },
  { width: 6, depth: 7, area: 42, tier: 'minimum', description: 'Side-by-side' },
  { width: 6, depth: 8, area: 48, tier: 'nice', description: 'With folding' },
  { width: 7, depth: 8, area: 56, tier: 'nice', description: 'Comfortable' },
  { width: 8, depth: 8, area: 64, tier: 'extra', description: 'With storage' },
  { width: 8, depth: 10, area: 80, tier: 'extra', description: 'Full laundry room' },
];

/**
 * Pantry sizes
 */
export const PANTRY_SIZES: RoomSizeOption[] = [
  { width: 4, depth: 4, area: 16, tier: 'minimum', description: 'Reach-in pantry' },
  { width: 4, depth: 5, area: 20, tier: 'minimum', description: 'Deep reach-in' },
  { width: 4, depth: 6, area: 24, tier: 'nice', description: 'Small walk-in' },
  { width: 5, depth: 6, area: 30, tier: 'nice', description: 'Walk-in pantry' },
  { width: 6, depth: 6, area: 36, tier: 'extra', description: 'Butler\'s pantry' },
  { width: 6, depth: 8, area: 48, tier: 'premium', description: 'Large butler\'s' },
];

/**
 * Foyer sizes
 */
export const FOYER_SIZES: RoomSizeOption[] = [
  { width: 6, depth: 6, area: 36, tier: 'minimum', description: 'Entry landing' },
  { width: 6, depth: 8, area: 48, tier: 'minimum', description: 'Small foyer' },
  { width: 8, depth: 8, area: 64, tier: 'nice', description: 'Standard foyer' },
  { width: 8, depth: 10, area: 80, tier: 'nice', description: 'Spacious foyer' },
  { width: 10, depth: 10, area: 100, tier: 'extra', description: 'Grand entry' },
  { width: 10, depth: 12, area: 120, tier: 'premium', description: 'Formal entry' },
];

/**
 * Mudroom sizes
 */
export const MUDROOM_SIZES: RoomSizeOption[] = [
  { width: 6, depth: 6, area: 36, tier: 'minimum', description: 'Small mudroom' },
  { width: 6, depth: 7, area: 42, tier: 'minimum', description: 'Compact mudroom' },
  { width: 6, depth: 8, area: 48, tier: 'nice', description: 'Standard mudroom' },
  { width: 7, depth: 8, area: 56, tier: 'nice', description: 'Comfortable mudroom' },
  { width: 8, depth: 8, area: 64, tier: 'extra', description: 'Large mudroom' },
  { width: 8, depth: 10, area: 80, tier: 'premium', description: 'Mud/laundry combo' },
];

/**
 * Hallway sizes (based on length, width is standardized)
 */
export const HALLWAY_SIZES: RoomSizeOption[] = [
  { width: 3, depth: 7, area: 21, tier: 'minimum', description: 'Code minimum 36"' },
  { width: 3.5, depth: 7, area: 24.5, tier: 'nice', description: 'Standard 42"' },
  { width: 3.5, depth: 8, area: 28, tier: 'nice', description: 'Longer standard' },
  { width: 4, depth: 7, area: 28, tier: 'extra', description: 'Comfortable 48"' },
  { width: 4, depth: 8, area: 32, tier: 'extra', description: 'Wide hall' },
  { width: 5, depth: 7, area: 35, tier: 'premium', description: 'Gallery 60"' },
];

/**
 * Stair sizes for 2-story homes
 * Width is stair width, depth is total run length
 * Standard: 3' wide minimum, 13' run for 9' ceiling (13 risers × 10" run)
 */
export const STAIR_SIZES: RoomSizeOption[] = [
  { width: 3, depth: 12, area: 36, tier: 'minimum', description: 'Code minimum straight run' },
  { width: 3.5, depth: 12, area: 42, tier: 'minimum', description: 'Standard 42" straight run' },
  { width: 3.5, depth: 13, area: 45.5, tier: 'nice', description: 'Comfortable straight run' },
  { width: 4, depth: 13, area: 52, tier: 'nice', description: 'Wide straight run' },
  { width: 4, depth: 14, area: 56, tier: 'extra', description: 'Wide + deep treads' },
  { width: 4.5, depth: 14, area: 63, tier: 'extra', description: 'Grand stair run' },
  { width: 5, depth: 15, area: 75, tier: 'premium', description: 'Luxury stair run' },
];

/**
 * Landing sizes for stair turns and top/bottom landings
 * Minimum landing is 36" × 36" (code), typically 4' × 4'
 */
export const LANDING_SIZES: RoomSizeOption[] = [
  { width: 3, depth: 3, area: 9, tier: 'minimum', description: 'Code minimum landing' },
  { width: 3.5, depth: 3.5, area: 12.25, tier: 'minimum', description: 'Standard landing' },
  { width: 4, depth: 4, area: 16, tier: 'nice', description: 'Comfortable landing' },
  { width: 4, depth: 5, area: 20, tier: 'nice', description: 'Generous landing' },
  { width: 5, depth: 5, area: 25, tier: 'extra', description: 'Large landing' },
  { width: 6, depth: 6, area: 36, tier: 'premium', description: 'Grand landing' },
];

/**
 * Open floor plan sizes - living/kitchen/dining combined as single space
 * Eliminates internal hallways between these rooms
 */
export const OPEN_FLOOR_PLAN_SIZES: RoomSizeOption[] = [
  { width: 20, depth: 24, area: 480, tier: 'minimum', description: 'Compact great room' },
  { width: 22, depth: 24, area: 528, tier: 'minimum', description: 'Standard great room' },
  { width: 24, depth: 24, area: 576, tier: 'nice', description: 'Comfortable great room' },
  { width: 24, depth: 26, area: 624, tier: 'nice', description: 'Spacious great room' },
  { width: 26, depth: 26, area: 676, tier: 'extra', description: 'Large great room' },
  { width: 28, depth: 26, area: 728, tier: 'extra', description: 'Very large great room' },
  { width: 30, depth: 26, area: 780, tier: 'premium', description: 'Grand great room' },
  { width: 30, depth: 28, area: 840, tier: 'premium', description: 'Luxury great room' },
];

// ============================================================================
// Size Lookup by Room Type
// ============================================================================

/**
 * Get the size options for a given room type
 */
export function getSizeOptionsForType(type: RoomType, isPrimary: boolean = false): RoomSizeOption[] {
  if (isPrimary) {
    if (type === 'bedroom') return PRIMARY_BEDROOM_SIZES;
    if (type === 'bathroom') return PRIMARY_BATHROOM_SIZES;
    if (type === 'closet') return PRIMARY_CLOSET_SIZES;
  }

  const sizeMap: Partial<Record<RoomType, RoomSizeOption[]>> = {
    living: LIVING_SIZES,
    kitchen: KITCHEN_SIZES,
    dining: DINING_SIZES,
    family: FAMILY_SIZES,
    bedroom: BEDROOM_SIZES,
    bathroom: BATHROOM_SIZES,
    closet: CLOSET_SIZES,
    office: OFFICE_SIZES,
    garage: GARAGE_SIZES,
    utility: UTILITY_SIZES,
    laundry: UTILITY_SIZES,
    pantry: PANTRY_SIZES,
    foyer: FOYER_SIZES,
    mudroom: MUDROOM_SIZES,
    hallway: HALLWAY_SIZES,
    circulation: HALLWAY_SIZES,
    // New vertical circulation types
    stair: STAIR_SIZES,
    landing: LANDING_SIZES,
    // Open floor plan combined space
    great_room: OPEN_FLOOR_PLAN_SIZES,
  };

  return sizeMap[type] || BEDROOM_SIZES; // Default to bedroom sizes
}

/**
 * Find the size option that matches or exceeds a given area
 */
export function findSizeOptionForArea(
  type: RoomType,
  targetArea: number,
  isPrimary: boolean = false
): RoomSizeOption | null {
  const options = getSizeOptionsForType(type, isPrimary);

  // Find the smallest option that is >= targetArea
  for (const option of options) {
    if (option.area >= targetArea) {
      return option;
    }
  }

  // If target exceeds all options, return the largest
  return options[options.length - 1] || null;
}

/**
 * Find the next size up from a current size
 */
export function findNextSizeUp(
  type: RoomType,
  currentArea: number,
  maxExtraArea: number,
  isPrimary: boolean = false
): RoomSizeOption | null {
  const options = getSizeOptionsForType(type, isPrimary);

  // Find current position
  let currentIndex = -1;
  for (let i = 0; i < options.length; i++) {
    if (options[i].area >= currentArea) {
      currentIndex = i;
      break;
    }
  }

  if (currentIndex === -1) {
    currentIndex = options.length - 1; // Already at max
  }

  // Look for next size that fits within budget
  for (let i = currentIndex + 1; i < options.length; i++) {
    const extraNeeded = options[i].area - currentArea;
    if (extraNeeded <= maxExtraArea) {
      return options[i];
    }
  }

  return null; // No upgrade possible within budget
}

// ============================================================================
// Expansion Priority (for allocation order)
// ============================================================================

/**
 * Base expansion priority by room type
 * Higher = gets excess space first
 * 0 = no excess allocation (circulation)
 */
export const EXPANSION_PRIORITY: Record<RoomType, number> = {
  // Priority 1-2: Primary suite (boosted dynamically)
  bedroom: 75,
  bathroom: 65,

  // Priority 3: Kitchen
  kitchen: 60,

  // Priority 4: Dining
  dining: 55,

  // Priority 5: Living spaces
  living: 50,
  family: 48,
  great_room: 52, // Open floor plan gets priority (combined living/kitchen/dining)

  // Priority 6+: Lower priority
  office: 40,
  closet: 30,
  pantry: 25,
  laundry: 20,
  utility: 15,
  garage: 10,
  mudroom: 12,
  foyer: 15,

  // Circulation - NO excess allocation
  hallway: 0,
  circulation: 0,
  stair: 0,    // Stairs are fixed by code
  landing: 0,  // Landings are fixed by code

  // Outdoor
  patio: 5,
  deck: 5,

  // Catch-all
  other: 10,
};

// ============================================================================
// Space Budget Types
// ============================================================================

export interface RoomBudget {
  name: string;
  type: RoomType;
  isPrimary: boolean;
  currentSize: RoomSizeOption;
  allocatedSize: RoomSizeOption;
  expansionPriority: number;
}

export interface SpaceExpansion {
  roomName: string;
  roomType: RoomType;
  fromSize: RoomSizeOption;
  toSize: RoomSizeOption;
  addedSqft: number;
  reason: string;
}

export interface LeftoverSuggestion {
  type: 'expand_room' | 'add_storage' | 'add_utility' | 'shrink_footprint';
  description: string;
  sqftImpact: number;
  costImpact?: string;
  suggestedSize?: RoomSizeOption;
}

export interface AllocationPlan {
  expansions: SpaceExpansion[];
  totalAllocated: number;
  leftoverSqft: number;
  suggestions: LeftoverSuggestion[];
}

export interface SpaceBudget {
  footprintArea: number;
  minimumRequired: number;
  excessSpace: number;
  excessPercentage: number;
  roomBudgets: RoomBudget[];
  allocationPlan: AllocationPlan;
}

// ============================================================================
// Circulation Metrics
// ============================================================================

export interface CirculationMetrics {
  circulationArea: number;
  totalArea: number;
  percentage: number;
  isEfficient: boolean;
  rating: 'excellent' | 'good' | 'acceptable' | 'high';
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Determine if a room is a "primary" bedroom or bathroom
 */
function isPrimaryRoom(name: string): boolean {
  const lowerName = name.toLowerCase();
  return lowerName.includes('primary') ||
         lowerName.includes('master') ||
         lowerName.includes('main') ||
         lowerName.includes('ensuite');
}

/**
 * Calculate room budget for a single room
 */
function calculateRoomBudget(
  name: string,
  type: RoomType,
  currentSqft: number
): RoomBudget {
  const isPrimary = isPrimaryRoom(name);
  const currentSize = findSizeOptionForArea(type, currentSqft, isPrimary);

  if (!currentSize) {
    // Fallback for unknown types
    const fallback: RoomSizeOption = {
      width: Math.sqrt(currentSqft),
      depth: Math.sqrt(currentSqft),
      area: currentSqft,
      tier: 'minimum',
    };
    return {
      name,
      type,
      isPrimary,
      currentSize: fallback,
      allocatedSize: fallback,
      expansionPriority: EXPANSION_PRIORITY[type] || 0,
    };
  }

  // Boost priority for primary rooms
  let priority = EXPANSION_PRIORITY[type] || 0;
  if (isPrimary) {
    priority += 20;
  }

  return {
    name,
    type,
    isPrimary,
    currentSize,
    allocatedSize: currentSize,
    expansionPriority: priority,
  };
}

/**
 * Calculate the full space budget for a design
 */
export function calculateSpaceBudget(
  footprintArea: number,
  rooms: Array<{ name: string; type: RoomType; currentSqft: number }>
): SpaceBudget {
  // Build room budgets
  const roomBudgets = rooms.map(r =>
    calculateRoomBudget(r.name, r.type, r.currentSqft)
  );

  // Calculate minimum required (using actual current sizes)
  const minimumRequired = roomBudgets.reduce(
    (sum, r) => sum + r.currentSize.area, 0
  );

  // Calculate excess
  const excessSpace = footprintArea - minimumRequired;
  const excessPercentage = footprintArea > 0
    ? (excessSpace / footprintArea) * 100
    : 0;

  // Generate allocation plan
  const allocationPlan = allocateExcessSpace(excessSpace, roomBudgets);

  return {
    footprintArea,
    minimumRequired,
    excessSpace,
    excessPercentage,
    roomBudgets,
    allocationPlan,
  };
}

/**
 * Allocate excess space by upsizing rooms to next known-good dimensions
 *
 * Priority order (per user preference):
 * 1. Primary bedroom → next size up
 * 2. Primary bathroom → next size up
 * 3. Kitchen → next size up
 * 4. Dining → next size up
 * 5. Living room → next size up
 * 6. Secondary bedrooms → next size up
 * 7. Storage/closets
 *
 * NEVER allocates to hallways/circulation
 */
export function allocateExcessSpace(
  excessSpace: number,
  roomBudgets: RoomBudget[]
): AllocationPlan {
  const expansions: SpaceExpansion[] = [];
  let remaining = excessSpace;

  if (remaining < 20) {
    return {
      expansions: [],
      totalAllocated: 0,
      leftoverSqft: remaining,
      suggestions: generateLeftoverSuggestions(remaining, roomBudgets),
    };
  }

  // Sort by priority (highest first), excluding circulation (priority 0)
  const sortedRooms = [...roomBudgets]
    .filter(r => r.expansionPriority > 0)
    .sort((a, b) => b.expansionPriority - a.expansionPriority);

  // Try to upsize each room to the next known-good size
  for (const room of sortedRooms) {
    if (remaining < 10) break;

    const nextSize = findNextSizeUp(
      room.type,
      room.allocatedSize.area,
      remaining,
      room.isPrimary
    );

    if (nextSize) {
      const addedSqft = nextSize.area - room.allocatedSize.area;

      expansions.push({
        roomName: room.name,
        roomType: room.type,
        fromSize: room.allocatedSize,
        toSize: nextSize,
        addedSqft,
        reason: room.isPrimary
          ? `Upgrade to ${nextSize.description} (primary suite)`
          : `Upgrade to ${nextSize.description}`,
      });

      room.allocatedSize = nextSize;
      remaining -= addedSqft;
    }
  }

  // Second pass: try to upgrade high-priority rooms again if space remains
  if (remaining > 50) {
    for (const room of sortedRooms) {
      if (remaining < 20) break;
      if (room.expansionPriority < 50) continue; // Only high-priority

      const nextSize = findNextSizeUp(
        room.type,
        room.allocatedSize.area,
        remaining,
        room.isPrimary
      );

      if (nextSize) {
        const addedSqft = nextSize.area - room.allocatedSize.area;

        // Update existing expansion or add new one
        const existing = expansions.find(e => e.roomName === room.name);
        if (existing) {
          existing.toSize = nextSize;
          existing.addedSqft = nextSize.area - existing.fromSize.area;
          existing.reason = `Upgrade to ${nextSize.description}`;
        } else {
          expansions.push({
            roomName: room.name,
            roomType: room.type,
            fromSize: room.allocatedSize,
            toSize: nextSize,
            addedSqft,
            reason: `Further upgrade to ${nextSize.description}`,
          });
        }

        room.allocatedSize = nextSize;
        remaining -= addedSqft;
      }
    }
  }

  const totalAllocated = expansions.reduce((sum, e) => sum + e.addedSqft, 0);

  return {
    expansions,
    totalAllocated,
    leftoverSqft: remaining,
    suggestions: generateLeftoverSuggestions(remaining, roomBudgets),
  };
}

/**
 * Generate suggestions for leftover space
 */
function generateLeftoverSuggestions(
  leftoverSqft: number,
  roomBudgets: RoomBudget[]
): LeftoverSuggestion[] {
  const suggestions: LeftoverSuggestion[] = [];

  if (leftoverSqft < 10) {
    return suggestions;
  }

  // Find rooms that could still be expanded
  const expandableRooms = roomBudgets
    .filter(r => r.expansionPriority > 0)
    .sort((a, b) => b.expansionPriority - a.expansionPriority);

  if (leftoverSqft < 20) {
    // Very small - only suggest expanding a room
    const room = expandableRooms[0];
    if (room) {
      suggestions.push({
        type: 'expand_room',
        description: `Add ${leftoverSqft} sqft to ${room.name}`,
        sqftImpact: leftoverSqft,
      });
    }
    return suggestions;
  }

  // 20-50 sqft: closet or expand
  if (leftoverSqft <= 50) {
    const closetSize = findSizeOptionForArea('closet', leftoverSqft, false);
    if (closetSize) {
      suggestions.push({
        type: 'add_storage',
        description: `Add a ${closetSize.description} (${closetSize.width}'x${closetSize.depth}')`,
        sqftImpact: closetSize.area,
        suggestedSize: closetSize,
      });
    }

    const room = expandableRooms[0];
    if (room) {
      const nextSize = findNextSizeUp(room.type, room.allocatedSize.area, leftoverSqft, room.isPrimary);
      if (nextSize) {
        suggestions.push({
          type: 'expand_room',
          description: `Upgrade ${room.name} to ${nextSize.description}`,
          sqftImpact: nextSize.area - room.allocatedSize.area,
          suggestedSize: nextSize,
        });
      }
    }
    return suggestions;
  }

  // 50-100 sqft: pantry, utility, or expand
  if (leftoverSqft <= 100) {
    const hasPantry = roomBudgets.some(r => r.type === 'pantry');
    if (!hasPantry) {
      const pantrySize = findSizeOptionForArea('pantry', Math.min(leftoverSqft, 36), false);
      if (pantrySize) {
        suggestions.push({
          type: 'add_utility',
          description: `Add a ${pantrySize.description} (${pantrySize.width}'x${pantrySize.depth}')`,
          sqftImpact: pantrySize.area,
          suggestedSize: pantrySize,
        });
      }
    }

    const closetSize = findSizeOptionForArea('closet', leftoverSqft, false);
    if (closetSize) {
      suggestions.push({
        type: 'add_storage',
        description: `Add a ${closetSize.description} (${closetSize.width}'x${closetSize.depth}')`,
        sqftImpact: closetSize.area,
        suggestedSize: closetSize,
      });
    }

    return suggestions;
  }

  // > 100 sqft: significant leftover - suggest shrinking or adding a room
  const costSavings = Math.round((leftoverSqft * 100) / 1000) * 1000;

  suggestions.push({
    type: 'shrink_footprint',
    description: `Reduce footprint by ~${leftoverSqft} sqft`,
    sqftImpact: -leftoverSqft,
    costImpact: `saves ~$${costSavings.toLocaleString()}`,
  });

  const officeSize = findSizeOptionForArea('office', Math.min(leftoverSqft, 120), false);
  if (officeSize) {
    suggestions.push({
      type: 'add_utility',
      description: `Add a ${officeSize.description} (${officeSize.width}'x${officeSize.depth}')`,
      sqftImpact: officeSize.area,
      suggestedSize: officeSize,
    });
  }

  suggestions.push({
    type: 'expand_room',
    description: `Distribute across multiple rooms`,
    sqftImpact: leftoverSqft,
  });

  return suggestions;
}

/**
 * Calculate circulation metrics for a set of rooms
 *
 * Updated thresholds based on industry standards:
 * - 8-12%: Tight (may feel cramped)
 * - 12-15%: Efficient (good balance)
 * - 15-18%: Comfortable (generous flow)
 * - 18%+: High (may be wasteful)
 *
 * Note: For contextual rating, use rateCirculation() from circulation-spine.ts
 * which rates against what the specific layout actually needs.
 */
export function calculateCirculationMetrics(
  rooms: Array<{ type: RoomType; area: number }>
): CirculationMetrics {
  const circulationTypes: RoomType[] = ['hallway', 'circulation', 'foyer', 'mudroom', 'stair', 'landing'];

  const circulationArea = rooms
    .filter(r => circulationTypes.includes(r.type))
    .reduce((sum, r) => sum + r.area, 0);

  const totalArea = rooms.reduce((sum, r) => sum + r.area, 0);
  const percentage = totalArea > 0 ? (circulationArea / totalArea) * 100 : 0;

  // Updated thresholds based on production builder standards
  let rating: 'excellent' | 'good' | 'acceptable' | 'high';
  if (percentage < 10) rating = 'excellent';      // Very efficient (may be tight)
  else if (percentage < 15) rating = 'good';      // Standard builder range
  else if (percentage < 20) rating = 'acceptable'; // Comfortable but generous
  else rating = 'high';                            // May be wasteful

  return {
    circulationArea,
    totalArea,
    percentage,
    isEfficient: percentage >= 10 && percentage <= 18, // Updated: 10-18% is efficient range
    rating,
  };
}

/**
 * Generate a human-readable allocation explanation
 */
export function generateAllocationExplanation(plan: AllocationPlan): string {
  if (plan.expansions.length === 0) {
    if (plan.leftoverSqft < 20) {
      return 'Space is efficiently allocated with minimal excess.';
    }
    return `There is ${plan.leftoverSqft} sqft available for allocation.`;
  }

  const lines: string[] = [];
  lines.push(`Allocated ${plan.totalAllocated} sqft of excess space:`);

  for (const exp of plan.expansions) {
    lines.push(`  - ${exp.roomName}: ${exp.fromSize.width}'x${exp.fromSize.depth}' → ${exp.toSize.width}'x${exp.toSize.depth}' (+${exp.addedSqft} sqft)`);
    lines.push(`    ${exp.toSize.description}`);
  }

  if (plan.leftoverSqft > 10) {
    lines.push('');
    lines.push(`Remaining: ${plan.leftoverSqft} sqft unallocated`);

    if (plan.suggestions.length > 0) {
      lines.push('');
      lines.push('Options for remaining space:');
      for (const suggestion of plan.suggestions) {
        const sizeInfo = suggestion.suggestedSize
          ? ` (${suggestion.suggestedSize.width}'x${suggestion.suggestedSize.depth}')`
          : '';
        const costInfo = suggestion.costImpact ? ` - ${suggestion.costImpact}` : '';
        lines.push(`  - ${suggestion.description}${sizeInfo}${costInfo}`);
      }
    }
  }

  return lines.join('\n');
}
