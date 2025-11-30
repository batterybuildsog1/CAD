/**
 * Test: 2500 sqft 3-bed 2.5-bath scenario with Circulation-First System
 *
 * Run with: npx ts-node scripts/test-allocation.ts
 */

import {
  calculateSpaceBudget,
  generateAllocationExplanation,
  calculateCirculationMetrics,
} from '../src/lib/space-budget';
import {
  calculateRequiredCirculation,
  sumCirculationArea,
  generateCirculationSummary,
  calculateCirculationSpine,
  rateCirculation,
  type RoomRequirement,
} from '../src/lib/circulation-spine';
import type { RoomType } from '../src/lib/gemini-types';

// 2500 sqft 3-bed 2.5-bath room program (using new modern builder standards)
const rooms: Array<{ name: string; type: RoomType; currentSqft: number }> = [
  // Living areas (can be combined as great room)
  { name: 'Living Room', type: 'living', currentSqft: 196 },      // 14x14
  { name: 'Kitchen', type: 'kitchen', currentSqft: 144 },         // 12x12
  { name: 'Dining Room', type: 'dining', currentSqft: 132 },      // 11x12

  // Primary suite (updated to modern builder standards)
  { name: 'Primary Bedroom', type: 'bedroom', currentSqft: 196 }, // 14x14 (modern min)
  { name: 'Primary Bathroom', type: 'bathroom', currentSqft: 80 }, // 8x10 (modern min)
  { name: 'Primary Closet', type: 'closet', currentSqft: 48 },    // 6x8 walk-in (modern min)

  // Secondary bedrooms
  { name: 'Bedroom 2', type: 'bedroom', currentSqft: 120 },       // 10x12
  { name: 'Bedroom 3', type: 'bedroom', currentSqft: 110 },       // 10x11
  { name: 'Closet 2', type: 'closet', currentSqft: 20 },          // 4x5 reach-in
  { name: 'Closet 3', type: 'closet', currentSqft: 20 },          // 4x5 reach-in

  // Bathrooms
  { name: 'Full Bath', type: 'bathroom', currentSqft: 45 },       // 5x9 full
  { name: 'Half Bath', type: 'bathroom', currentSqft: 25 },       // 5x5 half

  // Utility
  { name: 'Laundry', type: 'laundry', currentSqft: 48 },          // 6x8
];

// Convert to RoomRequirement format for circulation calculation
const roomReqs: RoomRequirement[] = rooms.map(r => ({
  name: r.name,
  type: r.type,
  area: r.currentSqft,
  isPrimary: r.name.toLowerCase().includes('primary'),
}));

console.log('='.repeat(70));
console.log('CIRCULATION-FIRST FLOOR PLAN TEST: 2500 SQFT 3-BED 2.5-BATH');
console.log('='.repeat(70));
console.log('');

// ============================================================================
// STEP 1: Calculate Required Circulation FIRST
// ============================================================================
console.log('='.repeat(70));
console.log('STEP 1: CIRCULATION REQUIREMENTS (Calculated First)');
console.log('='.repeat(70));
console.log('');

const circulationReqs = calculateRequiredCirculation(roomReqs, 1, 'comfortable');
console.log(generateCirculationSummary(circulationReqs, 2500));

const requiredCirculation = sumCirculationArea(circulationReqs, false);
const optionalCirculation = sumCirculationArea(circulationReqs, true) - requiredCirculation;
const totalCirculation = requiredCirculation + optionalCirculation;

console.log('');
console.log(`Required circulation: ${requiredCirculation} sqft`);
console.log(`Optional circulation: ${optionalCirculation} sqft`);
console.log(`Total recommended: ${totalCirculation} sqft (${((totalCirculation/2500)*100).toFixed(1)}%)`);

// ============================================================================
// STEP 2: Calculate Circulation Spine
// ============================================================================
console.log('');
console.log('='.repeat(70));
console.log('STEP 2: CIRCULATION SPINE');
console.log('='.repeat(70));
console.log('');

// Assume a 50' x 50' square-ish footprint for 2500 sqft
const spine = calculateCirculationSpine(50, 50, roomReqs, 1, 'comfortable');
console.log(`Spine type: ${spine.type}`);
console.log(`Zones identified: ${spine.zones.length}`);
for (const zone of spine.zones) {
  console.log(`  - ${zone.name}: ${zone.area} sqft (${zone.rooms.length} rooms)`);
}
console.log(`Total spine area: ${spine.totalArea} sqft`);

// ============================================================================
// STEP 3: Calculate Room Space Available
// ============================================================================
console.log('');
console.log('='.repeat(70));
console.log('STEP 3: ROOM SPACE ALLOCATION');
console.log('='.repeat(70));
console.log('');

// Add circulation rooms to the room list for budget calculation
const allRooms = [
  ...rooms,
  { name: 'Foyer', type: 'foyer' as RoomType, currentSqft: 64 },        // Standard foyer
  { name: 'Bedroom Hallway', type: 'hallway' as RoomType, currentSqft: 70 },  // 3 beds + buffer
  { name: 'Zone Transition', type: 'circulation' as RoomType, currentSqft: 40 },
];

const roomMinimum = rooms.reduce((sum, r) => sum + r.currentSqft, 0);
const spaceForRooms = 2500 - totalCirculation;

console.log(`Footprint: 2500 sqft`);
console.log(`Circulation reserved: ${totalCirculation} sqft`);
console.log(`Available for rooms: ${spaceForRooms} sqft`);
console.log(`Room minimums: ${roomMinimum} sqft`);
console.log(`Excess for upgrades: ${spaceForRooms - roomMinimum} sqft`);

// Run allocation on remaining space
const budget = calculateSpaceBudget(2500, allRooms);

console.log('');
console.log('='.repeat(70));
console.log('ROOM BUDGET (after allocation)');
console.log('='.repeat(70));
console.log('');

console.log(generateAllocationExplanation(budget.allocationPlan));

console.log('');
for (const roomBudget of budget.roomBudgets) {
  const tier = roomBudget.allocatedSize.tier.toUpperCase();
  const dims = `${roomBudget.allocatedSize.width}'x${roomBudget.allocatedSize.depth}'`;
  const desc = roomBudget.allocatedSize.description || '';
  const changed = roomBudget.currentSize.area !== roomBudget.allocatedSize.area
    ? ` (+${roomBudget.allocatedSize.area - roomBudget.currentSize.area})`
    : '';
  console.log(`  ${roomBudget.name.padEnd(20)} ${dims.padEnd(10)} ${tier.padEnd(10)} ${desc}${changed}`);
}

// ============================================================================
// STEP 4: Circulation Metrics
// ============================================================================
console.log('');
console.log('='.repeat(70));
console.log('STEP 4: CIRCULATION METRICS');
console.log('='.repeat(70));
console.log('');

const metrics = calculateCirculationMetrics(
  allRooms.map(r => ({ type: r.type, area: r.currentSqft }))
);

const requiredPercent = (totalCirculation / 2500) * 100;
const rating = rateCirculation(metrics.percentage, requiredPercent);

console.log(`Circulation area: ${metrics.circulationArea} sqft`);
console.log(`Circulation %: ${metrics.percentage.toFixed(1)}%`);
console.log(`Required %: ${requiredPercent.toFixed(1)}%`);
console.log(`Rating: ${rating.rating}${rating.issue ? ` (${rating.issue})` : ''}`);
console.log(`Is efficient: ${metrics.isEfficient ? 'Yes' : 'No'}`);

// ============================================================================
// COMPARISON: Old vs New Approach
// ============================================================================
console.log('');
console.log('='.repeat(70));
console.log('COMPARISON: OLD vs NEW APPROACH');
console.log('='.repeat(70));
console.log('');

console.log('OLD APPROACH (rooms first, circulation as leftover):');
console.log('  - Circulation: 76 sqft (3%)');
console.log('  - Problem: Massively undersized hallways');
console.log('');
console.log('NEW APPROACH (circulation first, rooms around spine):');
console.log(`  - Circulation: ${totalCirculation} sqft (${((totalCirculation/2500)*100).toFixed(1)}%)`);
console.log('  - Breakdown:');
for (const req of circulationReqs) {
  const opt = req.isOptional ? ' (optional)' : '';
  console.log(`    * ${req.component}: ${req.area} sqft${opt}`);
}
console.log('');
console.log('Key differences:');
console.log(`  - ${totalCirculation - 76} sqft more circulation (realistic)`);
console.log('  - Room sizes match production builder standards');
console.log('  - Circulation calculated from actual needs, not arbitrary %');
