/**
 * Test: 2500 sqft 3-bed 2.5-bath scenario
 *
 * Run with: npx ts-node scripts/test-allocation.ts
 */

import {
  calculateSpaceBudget,
  generateAllocationExplanation,
} from '../src/lib/space-budget';
import type { RoomType } from '../src/lib/gemini-types';

// 2500 sqft 3-bed 2.5-bath typical room program
const rooms: Array<{ name: string; type: RoomType; currentSqft: number }> = [
  // Living areas
  { name: 'Living Room', type: 'living', currentSqft: 196 },      // 14x14 minimum
  { name: 'Kitchen', type: 'kitchen', currentSqft: 144 },         // 12x12 minimum
  { name: 'Dining Room', type: 'dining', currentSqft: 132 },      // 11x12 minimum

  // Primary suite
  { name: 'Primary Bedroom', type: 'bedroom', currentSqft: 196 }, // 14x14 minimum
  { name: 'Primary Bathroom', type: 'bathroom', currentSqft: 80 }, // 8x10 minimum
  { name: 'Primary Closet', type: 'closet', currentSqft: 36 },    // 6x6 walk-in

  // Secondary bedrooms
  { name: 'Bedroom 2', type: 'bedroom', currentSqft: 120 },       // 10x12 minimum
  { name: 'Bedroom 3', type: 'bedroom', currentSqft: 110 },       // 10x11 minimum
  { name: 'Closet 2', type: 'closet', currentSqft: 20 },          // 4x5 reach-in
  { name: 'Closet 3', type: 'closet', currentSqft: 20 },          // 4x5 reach-in

  // Bathrooms
  { name: 'Full Bath', type: 'bathroom', currentSqft: 45 },       // 5x9 full
  { name: 'Half Bath', type: 'bathroom', currentSqft: 25 },       // 5x5 half

  // Circulation
  { name: 'Foyer', type: 'foyer', currentSqft: 48 },              // 6x8
  { name: 'Hallway', type: 'hallway', currentSqft: 28 },          // 3.5x8

  // Utility
  { name: 'Laundry', type: 'laundry', currentSqft: 48 },          // 6x8
];

console.log('='.repeat(60));
console.log('2500 SQFT 3-BED 2.5-BATH ALLOCATION TEST');
console.log('='.repeat(60));
console.log('');

// Calculate minimum required
const minimumTotal = rooms.reduce((sum, r) => sum + r.currentSqft, 0);
console.log(`Footprint: 2500 sqft`);
console.log(`Minimum room total: ${minimumTotal} sqft`);
console.log(`Excess available: ${2500 - minimumTotal} sqft`);
console.log('');

// Run allocation
const budget = calculateSpaceBudget(2500, rooms);

console.log('='.repeat(60));
console.log('ALLOCATION RESULT');
console.log('='.repeat(60));
console.log('');

console.log(generateAllocationExplanation(budget.allocationPlan));

console.log('');
console.log('='.repeat(60));
console.log('ROOM SUMMARY (after allocation)');
console.log('='.repeat(60));
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

console.log('');
console.log('='.repeat(60));
console.log('STATS');
console.log('='.repeat(60));
console.log('');
console.log(`  Total allocated: ${budget.allocationPlan.totalAllocated} sqft`);
console.log(`  Leftover: ${budget.allocationPlan.leftoverSqft} sqft`);
console.log(`  Excess %: ${budget.excessPercentage.toFixed(1)}%`);
