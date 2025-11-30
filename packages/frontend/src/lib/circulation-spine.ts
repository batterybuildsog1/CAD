/**
 * Circulation-First Floor Plan System
 *
 * Core insight: Circulation is NOT leftover space.
 * Calculate circulation spine FIRST, then place rooms around it.
 *
 * Three-Layer Architecture:
 * 1. Circulation Graph (what connects to what)
 * 2. Circulation Spine (how they connect)
 * 3. Room Placement (around the spine)
 */

import type { RoomType, Point2D } from './gemini-types';

// ============================================================================
// Types
// ============================================================================

/** Access type determines how a room connects to circulation */
export type AccessType = 'direct' | 'shared' | 'indirect' | 'hub' | 'service';

/** Spine topology type based on footprint shape */
export type SpineType = 'linear' | 'branching' | 'hub-and-spoke';

/** Zone classification for circulation routing */
export type ZoneType = 'entry' | 'public' | 'private' | 'service' | 'vertical';

/** User preference for circulation feel */
export type CirculationFeel = 'cozy' | 'comfortable' | 'spacious';

/** Line segment for representing axes and corridors */
export interface LineSegment {
  start: Point2D;
  end: Point2D;
}

/** Rectangle bounds for rooms and zones */
export interface RectangleBounds {
  x: number;
  y: number;
  width: number;
  depth: number;
}

/** Room requirement for circulation calculation */
export interface RoomRequirement {
  name: string;
  type: RoomType;
  area: number;
  isPrimary?: boolean;
}

/** Individual circulation component with reasoning */
export interface CirculationRequirement {
  component: string;          // "bedroom_hallway", "foyer", "stair"
  reason: string;             // Why this is needed
  area: number;               // Calculated area
  isOptional: boolean;        // Can be omitted in tight designs
}

/** Zone within the circulation system */
export interface CirculationZone {
  name: string;
  type: ZoneType;
  rooms: string[];            // Room names in this zone
  accessPoint: Point2D;       // Where zone connects to spine
  corridorWidth: number;      // Width of corridor serving this zone
  corridorLength: number;     // Length of corridor
  area: number;               // Total circulation area for zone
}

/** Branch off the main circulation spine */
export interface CirculationBranch {
  name: string;
  startPoint: Point2D;
  endPoint: Point2D;
  width: number;
  zones: string[];            // Zone names served by this branch
}

/** Main circulation spine structure */
export interface CirculationSpine {
  type: SpineType;
  mainAxis: LineSegment;
  branches: CirculationBranch[];
  zones: CirculationZone[];
  totalArea: number;
}

/** Door position and configuration */
export interface DoorPosition {
  point: Point2D;
  width: number;              // Door width in feet (typically 3')
  swing: 'inward' | 'outward' | 'either' | 'pocket' | 'barn';
  connectsTo: string;         // Room or hallway name
}

/** Open floor plan zone (living/kitchen/dining combined) */
export interface OpenFloorPlanZone {
  type: 'public_zone';
  components: RoomType[];
  totalArea: number;
  internalZones: InternalZone[];
  noHallwaysBetween: true;
}

/** Visual division within open floor plan */
export interface InternalZone {
  type: RoomType;
  approximateArea: number;
  anchor: 'island' | 'fireplace' | 'window_wall' | 'dining_area';
}

/** Stairwell context for 2-story homes */
export interface StairwellContext {
  location: Point2D;
  footprint: RectangleBounds;
  topLanding: RectangleBounds;
  bottomLanding: RectangleBounds;
  totalArea: number;
}

/** Circulation rating result */
export interface CirculationRating {
  rating: 'cramped' | 'tight' | 'efficient' | 'comfortable' | 'wasteful';
  issue: string | null;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Room access rules - how each room type connects to circulation
 */
export const ROOM_ACCESS_RULES: Record<RoomType, AccessType> = {
  // Direct hallway access required (privacy)
  bedroom: 'direct',
  bathroom: 'direct',

  // Can share access with adjacent rooms
  living: 'shared',
  kitchen: 'shared',
  dining: 'shared',
  family: 'shared',

  // Access through parent room
  closet: 'indirect',
  pantry: 'indirect',

  // Circulation hubs
  foyer: 'hub',
  hallway: 'hub',
  circulation: 'hub',
  mudroom: 'hub',

  // Separate entry (service)
  garage: 'service',
  laundry: 'service',
  utility: 'service',

  // Outdoor (external)
  patio: 'service',
  deck: 'service',

  // Office - can be either
  office: 'direct',

  // Vertical circulation
  stair: 'hub',
  landing: 'hub',

  // Open floor plan
  great_room: 'shared',

  // Catch-all
  other: 'shared',
};

/**
 * User preference to circulation parameters mapping
 */
export const FEEL_TO_CIRCULATION_MAP: Record<CirculationFeel, {
  hallwayWidth: number;
  foyerSize: 'minimal' | 'standard' | 'grand';
  transitionBuffer: number;
}> = {
  // Cozy = tighter circulation, more room space
  cozy: { hallwayWidth: 3.0, foyerSize: 'minimal', transitionBuffer: 0 },

  // Comfortable = standard production builder
  comfortable: { hallwayWidth: 3.5, foyerSize: 'standard', transitionBuffer: 1.5 },

  // Spacious = generous circulation
  spacious: { hallwayWidth: 4.0, foyerSize: 'grand', transitionBuffer: 3.0 },
};

/**
 * Foyer sizes by classification
 */
const FOYER_SIZES: Record<'minimal' | 'standard' | 'grand', number> = {
  minimal: 48,   // 6x8
  standard: 64,  // 8x8
  grand: 100,    // 10x10
};

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Estimate door count based on rooms
 */
function estimateDoorCount(rooms: RoomRequirement[]): number {
  let count = 0;

  for (const room of rooms) {
    const accessType = ROOM_ACCESS_RULES[room.type];

    switch (accessType) {
      case 'direct':
        // Each bedroom/bathroom gets its own door
        count += 1;
        break;
      case 'shared':
        // Shared rooms might have a door or open connection
        // Count as 0.5 (some will, some won't)
        count += 0.5;
        break;
      case 'indirect':
        // Closets/pantries usually have doors
        count += 1;
        break;
      case 'hub':
        // Entry points have doors to outside
        if (room.type === 'foyer' || room.type === 'mudroom') count += 1;
        break;
      case 'service':
        // Garage, utility have doors
        count += 1;
        break;
    }
  }

  return Math.ceil(count);
}

/**
 * Calculate required circulation from room requirements (not fixed percentage)
 *
 * Key formula: (bedrooms × 4' + 8') × hallway_width + foyer + transitions
 */
export function calculateRequiredCirculation(
  rooms: RoomRequirement[],
  storyCount: number = 1,
  feel: CirculationFeel = 'comfortable'
): CirculationRequirement[] {
  const requirements: CirculationRequirement[] = [];
  const params = FEEL_TO_CIRCULATION_MAP[feel];

  // 1. Entry zone (ALWAYS required)
  const foyerArea = FOYER_SIZES[params.foyerSize];
  requirements.push({
    component: 'foyer',
    reason: 'Entry transition from outdoors',
    area: foyerArea,
    isOptional: false,
  });

  // 2. Bedroom access hallway (required if bedrooms exist)
  const bedrooms = rooms.filter(r => r.type === 'bedroom');
  if (bedrooms.length > 0) {
    // Calculate hallway length: 4' per door + 8' buffer
    const hallwayLength = (bedrooms.length * 4) + 8;
    const hallwayArea = hallwayLength * params.hallwayWidth;

    requirements.push({
      component: 'bedroom_hallway',
      reason: `Access to ${bedrooms.length} bedroom(s)`,
      area: hallwayArea,
      isOptional: false,
    });
  }

  // 3. Public/private zone transition (required if separate zones)
  const hasPublicZone = rooms.some(r =>
    ['living', 'kitchen', 'dining', 'family', 'great_room'].includes(r.type)
  );
  const hasPrivateZone = bedrooms.length > 0;

  if (hasPublicZone && hasPrivateZone) {
    const transitionArea = 40 + (params.transitionBuffer * 10);
    requirements.push({
      component: 'zone_transition',
      reason: 'Separation between public and private areas',
      area: transitionArea,
      isOptional: false,
    });
  }

  // 4. Stairwell (required for 2+ stories)
  if (storyCount > 1) {
    requirements.push({
      component: 'stairwell',
      reason: 'Vertical circulation (stair run)',
      area: params.hallwayWidth * 14, // 4' × 14' typical
      isOptional: false,
    });
    requirements.push({
      component: 'upper_landing',
      reason: 'Upper floor landing',
      area: 25, // 5' × 5'
      isOptional: false,
    });
    requirements.push({
      component: 'lower_landing',
      reason: 'Lower floor landing',
      area: 20, // 4' × 5'
      isOptional: false,
    });
  }

  // 5. Door clearances (calculated from door count)
  const doorCount = estimateDoorCount(rooms);
  requirements.push({
    component: 'door_clearances',
    reason: `Swing clearance for ~${doorCount} doors`,
    area: doorCount * 4, // ~4 sqft per door (accounting for overlap)
    isOptional: true,    // Can be absorbed into other spaces
  });

  // 6. Service entry (optional - for garage/mudroom homes)
  if (rooms.some(r => r.type === 'garage')) {
    requirements.push({
      component: 'mudroom',
      reason: 'Garage-to-house transition',
      area: 48, // 6' × 8'
      isOptional: true,
    });
  }

  return requirements;
}

/**
 * Sum total circulation area from requirements
 */
export function sumCirculationArea(
  requirements: CirculationRequirement[],
  includeOptional: boolean = true
): number {
  return requirements
    .filter(r => !r.isOptional || includeOptional)
    .reduce((sum, r) => sum + r.area, 0);
}

/**
 * Calculate circulation percentage
 */
export function calculateCirculationPercentage(
  circulationArea: number,
  totalArea: number
): number {
  if (totalArea <= 0) return 0;
  return (circulationArea / totalArea) * 100;
}

/**
 * Infer spine type from footprint dimensions
 */
export function inferSpineType(
  footprintWidth: number,
  footprintDepth: number,
  isLShaped: boolean = false
): SpineType {
  if (isLShaped) {
    return 'branching';
  }

  const aspectRatio = footprintWidth / footprintDepth;

  // Long rectangle → linear spine
  if (aspectRatio > 1.5 || aspectRatio < 0.67) {
    return 'linear';
  }

  // Square-ish → hub and spoke
  return 'hub-and-spoke';
}

/**
 * Cluster rooms into zones based on type
 */
export function clusterRoomsIntoZones(rooms: RoomRequirement[]): Map<ZoneType, RoomRequirement[]> {
  const zones = new Map<ZoneType, RoomRequirement[]>();

  // Initialize all zone types
  zones.set('entry', []);
  zones.set('public', []);
  zones.set('private', []);
  zones.set('service', []);
  zones.set('vertical', []);

  for (const room of rooms) {
    const zoneType = getZoneForRoomType(room.type);
    const zone = zones.get(zoneType) || [];
    zone.push(room);
    zones.set(zoneType, zone);
  }

  return zones;
}

/**
 * Determine which zone a room type belongs to
 */
function getZoneForRoomType(type: RoomType): ZoneType {
  switch (type) {
    case 'foyer':
    case 'mudroom':
      return 'entry';

    case 'living':
    case 'kitchen':
    case 'dining':
    case 'family':
    case 'great_room':
      return 'public';

    case 'bedroom':
    case 'bathroom':
    case 'closet':
    case 'office':
      return 'private';

    case 'garage':
    case 'laundry':
    case 'utility':
    case 'pantry':
      return 'service';

    case 'stair':
    case 'landing':
      return 'vertical';

    default:
      return 'public';
  }
}

/**
 * Rate circulation against actual requirements (not fixed thresholds)
 */
export function rateCirculation(
  actualPercent: number,
  requiredPercent: number
): CirculationRating {
  const ratio = actualPercent / requiredPercent;

  if (ratio < 0.8) return { rating: 'cramped', issue: 'Below minimum needs' };
  if (ratio < 0.95) return { rating: 'tight', issue: 'Meets minimum only' };
  if (ratio <= 1.1) return { rating: 'efficient', issue: null }; // IDEAL
  if (ratio <= 1.3) return { rating: 'comfortable', issue: null };
  return { rating: 'wasteful', issue: 'Excess circulation' };
}

/**
 * Create an open floor plan zone (living/kitchen/dining combined)
 */
export function createOpenFloorPlanZone(
  livingArea: number,
  kitchenArea: number,
  diningArea: number
): OpenFloorPlanZone {
  const totalArea = livingArea + kitchenArea + diningArea;

  return {
    type: 'public_zone',
    components: ['living', 'kitchen', 'dining'],
    totalArea,
    internalZones: [
      { type: 'kitchen', approximateArea: kitchenArea, anchor: 'island' },
      { type: 'living', approximateArea: livingArea, anchor: 'fireplace' },
      { type: 'dining', approximateArea: diningArea, anchor: 'dining_area' },
    ],
    noHallwaysBetween: true,
  };
}

/**
 * Create stairwell context for 2-story home
 */
export function createStairwellContext(
  location: Point2D,
  stairWidth: number = 4,
  stairLength: number = 14,
  landingSize: number = 4
): StairwellContext {
  const footprint: RectangleBounds = {
    x: location[0],
    y: location[1],
    width: stairWidth,
    depth: stairLength,
  };

  const topLanding: RectangleBounds = {
    x: location[0],
    y: location[1] + stairLength,
    width: landingSize,
    depth: landingSize,
  };

  const bottomLanding: RectangleBounds = {
    x: location[0],
    y: location[1] - landingSize,
    width: landingSize,
    depth: landingSize,
  };

  const totalArea =
    (stairWidth * stairLength) +
    (landingSize * landingSize * 2);

  return {
    location,
    footprint,
    topLanding,
    bottomLanding,
    totalArea,
  };
}

/**
 * Calculate main axis for circulation spine
 */
export function calculateMainAxis(
  footprintWidth: number,
  footprintDepth: number,
  spineType: SpineType
): LineSegment {
  // Center the main axis in the footprint
  const centerX = footprintWidth / 2;
  const centerY = footprintDepth / 2;

  switch (spineType) {
    case 'linear':
      // Run along the longer dimension
      if (footprintWidth > footprintDepth) {
        return {
          start: [0, centerY],
          end: [footprintWidth, centerY],
        };
      } else {
        return {
          start: [centerX, 0],
          end: [centerX, footprintDepth],
        };
      }

    case 'hub-and-spoke':
    case 'branching':
      // Central hub - represented as short segment
      return {
        start: [centerX - 4, centerY],
        end: [centerX + 4, centerY],
      };
  }
}

/**
 * Calculate full circulation spine from requirements
 */
export function calculateCirculationSpine(
  footprintWidth: number,
  footprintDepth: number,
  rooms: RoomRequirement[],
  storyCount: number = 1,
  feel: CirculationFeel = 'comfortable',
  isLShaped: boolean = false
): CirculationSpine {
  // 1. Determine spine type from footprint shape
  const spineType = inferSpineType(footprintWidth, footprintDepth, isLShaped);

  // 2. Cluster rooms into zones
  const zoneMap = clusterRoomsIntoZones(rooms);

  // 3. Calculate main axis
  const mainAxis = calculateMainAxis(footprintWidth, footprintDepth, spineType);

  // 4. Build circulation zones
  const params = FEEL_TO_CIRCULATION_MAP[feel];
  const zones: CirculationZone[] = [];

  // Entry zone
  const entryRooms = zoneMap.get('entry') || [];
  if (entryRooms.length > 0 || true) { // Always have entry
    zones.push({
      name: 'Entry Zone',
      type: 'entry',
      rooms: entryRooms.map(r => r.name),
      accessPoint: [mainAxis.start[0], mainAxis.start[1]],
      corridorWidth: params.hallwayWidth,
      corridorLength: 8,
      area: FOYER_SIZES[params.foyerSize],
    });
  }

  // Public zone
  const publicRooms = zoneMap.get('public') || [];
  if (publicRooms.length > 0) {
    zones.push({
      name: 'Public Zone',
      type: 'public',
      rooms: publicRooms.map(r => r.name),
      accessPoint: [mainAxis.start[0] + 10, mainAxis.start[1]],
      corridorWidth: 0, // No hallway in open floor plan
      corridorLength: 0,
      area: 0, // Internal circulation is within the room
    });
  }

  // Private zone
  const privateRooms = zoneMap.get('private') || [];
  if (privateRooms.length > 0) {
    const bedrooms = privateRooms.filter(r => r.type === 'bedroom');
    const hallwayLength = (bedrooms.length * 4) + 8;
    const hallwayArea = hallwayLength * params.hallwayWidth;

    zones.push({
      name: 'Private Zone',
      type: 'private',
      rooms: privateRooms.map(r => r.name),
      accessPoint: [mainAxis.end[0] - 10, mainAxis.end[1]],
      corridorWidth: params.hallwayWidth,
      corridorLength: hallwayLength,
      area: hallwayArea + 40, // Hallway + transition
    });
  }

  // Service zone
  const serviceRooms = zoneMap.get('service') || [];
  if (serviceRooms.length > 0) {
    zones.push({
      name: 'Service Zone',
      type: 'service',
      rooms: serviceRooms.map(r => r.name),
      accessPoint: [mainAxis.start[0], mainAxis.start[1] - 10],
      corridorWidth: params.hallwayWidth,
      corridorLength: 8,
      area: 48, // Mudroom / service entry
    });
  }

  // Vertical zone (if multi-story)
  if (storyCount > 1) {
    zones.push({
      name: 'Vertical Zone',
      type: 'vertical',
      rooms: ['stairwell'],
      accessPoint: [(mainAxis.start[0] + mainAxis.end[0]) / 2, mainAxis.start[1]],
      corridorWidth: 4,
      corridorLength: 14,
      area: 56 + 25 + 20, // Stair + landings
    });
  }

  // 5. Build branches (simplified - connect zones to main axis)
  const branches: CirculationBranch[] = zones.map(zone => ({
    name: `${zone.name} Branch`,
    startPoint: mainAxis.start,
    endPoint: zone.accessPoint,
    width: zone.corridorWidth,
    zones: [zone.name],
  }));

  // 6. Calculate total area
  const totalArea = zones.reduce((sum, z) => sum + z.area, 0);

  return {
    type: spineType,
    mainAxis,
    branches,
    zones,
    totalArea,
  };
}

/**
 * Generate human-readable circulation summary
 */
export function generateCirculationSummary(
  requirements: CirculationRequirement[],
  footprintArea: number
): string {
  const totalRequired = sumCirculationArea(requirements, false);
  const totalOptional = sumCirculationArea(requirements, true) - totalRequired;
  const percentage = calculateCirculationPercentage(totalRequired + totalOptional, footprintArea);

  const lines: string[] = [
    `Circulation Requirements (${percentage.toFixed(1)}% of footprint):`,
    '',
  ];

  // Required components
  lines.push('Required:');
  for (const req of requirements.filter(r => !r.isOptional)) {
    lines.push(`  - ${req.component}: ${req.area} sqft (${req.reason})`);
  }
  lines.push(`  Subtotal: ${totalRequired} sqft`);

  // Optional components
  const optionalReqs = requirements.filter(r => r.isOptional);
  if (optionalReqs.length > 0) {
    lines.push('');
    lines.push('Optional:');
    for (const req of optionalReqs) {
      lines.push(`  - ${req.component}: ${req.area} sqft (${req.reason})`);
    }
    lines.push(`  Subtotal: ${totalOptional} sqft`);
  }

  lines.push('');
  lines.push(`TOTAL CIRCULATION: ${totalRequired + totalOptional} sqft`);

  return lines.join('\n');
}

/**
 * Translate circulation tradeoffs to user-friendly "feel" questions
 */
export function getCirculationFeelDescription(feel: CirculationFeel): string {
  switch (feel) {
    case 'cozy':
      return 'Cozy layout with 36" hallways. Maximizes room sizes at the cost of circulation comfort. Best for smaller footprints.';
    case 'comfortable':
      return 'Standard production builder layout with 42" hallways. Good balance of room size and flow. Recommended for most homes.';
    case 'spacious':
      return 'Generous layout with 48" hallways and larger entry. Feels open and airy but uses more space for circulation.';
  }
}
