/**
 * Test: 2500 sqft 3-bed 2.5-bath scenario with Circulation-First System
 *
 * Run with: npx tsx scripts/test-allocation.ts
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
  type RoomBounds,
} from '../src/lib/circulation-spine';
import type { RoomType } from '../src/lib/gemini-types';

// Import new graph-based circulation modules
import {
  CirculationGraph,
  validateCirculationConnectivity,
  generateConnectivityReport,
} from '../src/lib/circulation-graph';
import {
  computeMinimumHallwayNetwork,
  getNetworkSummary,
  type HallwayNetwork,
} from '../src/lib/hallway-mst';
import {
  generateSpineGeometry,
  getGeometrySummary,
  type SpineGeometry,
} from '../src/lib/spine-geometry';
import {
  validateAllRoomsReachable,
  findPathBetweenRooms,
  describePathResult,
  describeValidationResult,
  type HallwayPolygon,
} from '../src/lib/pathfinding';

// Import bedroom cluster and traffic path modules
import {
  detectBedroomClusters,
  generateClusterCorridor,
  corridorToHallwaySegments,
} from '../src/lib/bedroom-cluster';
import {
  detectOpenPlanClusters,
  generatePrimaryTrafficPath,
  generateKitchenWorkZone,
  generateEntryZone,
  type TrafficPath,
} from '../src/lib/traffic-paths';

// 2500 sqft 3-bed 2.5-bath room program (using new modern builder standards)
const rooms: Array<{ name: string; type: RoomType; currentSqft: number }> = [
  // Living areas (can be combined as great room)
  { name: 'Living Room', type: 'living', currentSqft: 196 },      // 14x14
  { name: 'Kitchen', type: 'kitchen', currentSqft: 144 },         // 12x12
  { name: 'Dining Room', type: 'dining', currentSqft: 132 },      // 11x12

  // Primary suite (updated to modern builder standards)
  { name: 'Primary Bedroom', type: 'bedroom', currentSqft: 196 }, // 14x14
  { name: 'Primary Bathroom', type: 'bathroom', currentSqft: 80 }, // 8x10
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
// STEP 5: CONNECTIVITY VALIDATION (Graph-Based)
// ============================================================================
console.log('');
console.log('='.repeat(70));
console.log('STEP 5: CONNECTIVITY VALIDATION (Graph-Based)');
console.log('='.repeat(70));
console.log('');

// Generate room positions for testing
// We'll arrange rooms in a realistic floor plan layout
function generateRoomPositions(roomList: typeof rooms): RoomBounds[] {
  const positioned: RoomBounds[] = [];
  let x = 0;
  let y = 0;

  // Add a foyer at the entry point
  positioned.push({
    name: 'Foyer',
    type: 'foyer',
    x: 0,
    y: 0,
    width: 8,
    depth: 8,
  });

  // Living/Kitchen/Dining zone (great room concept) - adjacent to foyer
  positioned.push({
    name: 'Living Room',
    type: 'living',
    x: 8,
    y: 0,
    width: 14,
    depth: 14,
  });

  positioned.push({
    name: 'Kitchen',
    type: 'kitchen',
    x: 22,
    y: 0,
    width: 12,
    depth: 12,
  });

  positioned.push({
    name: 'Dining Room',
    type: 'dining',
    x: 22,
    y: 12,
    width: 11,
    depth: 12,
  });

  // Half bath near public zone
  positioned.push({
    name: 'Half Bath',
    type: 'bathroom',
    x: 34,
    y: 0,
    width: 5,
    depth: 5,
  });

  // Laundry
  positioned.push({
    name: 'Laundry',
    type: 'laundry',
    x: 34,
    y: 5,
    width: 6,
    depth: 8,
  });

  // Add a hallway for bedroom zone
  positioned.push({
    name: 'Bedroom Hallway',
    type: 'hallway',
    x: 0,
    y: 8,
    width: 3.5,
    depth: 30,
  });

  // Primary suite - private zone
  positioned.push({
    name: 'Primary Bedroom',
    type: 'bedroom',
    x: 3.5,
    y: 8,
    width: 14,
    depth: 14,
  });

  positioned.push({
    name: 'Primary Bathroom',
    type: 'bathroom',
    x: 17.5,
    y: 8,
    width: 10,
    depth: 8,
  });

  positioned.push({
    name: 'Primary Closet',
    type: 'closet',
    x: 17.5,
    y: 16,
    width: 8,
    depth: 6,
  });

  // Secondary bedrooms
  positioned.push({
    name: 'Bedroom 2',
    type: 'bedroom',
    x: 3.5,
    y: 22,
    width: 12,
    depth: 10,
  });

  positioned.push({
    name: 'Closet 2',
    type: 'closet',
    x: 15.5,
    y: 22,
    width: 5,
    depth: 4,
  });

  positioned.push({
    name: 'Bedroom 3',
    type: 'bedroom',
    x: 3.5,
    y: 32,
    width: 11,
    depth: 10,
  });

  positioned.push({
    name: 'Closet 3',
    type: 'closet',
    x: 14.5,
    y: 32,
    width: 5,
    depth: 4,
  });

  // Full bath for secondary bedrooms
  positioned.push({
    name: 'Full Bath',
    type: 'bathroom',
    x: 15.5,
    y: 26,
    width: 9,
    depth: 5,
  });

  return positioned;
}

const positionedRooms = generateRoomPositions(rooms);

console.log('Room positions generated for 2500 sqft floor plan:');
console.log('');
for (const room of positionedRooms) {
  console.log(`  ${room.name.padEnd(20)} at (${room.x.toFixed(1)}, ${room.y.toFixed(1)}) - ${room.width}'x${room.depth}'`);
}

// Build a CirculationGraph from the positioned rooms
console.log('');
console.log('Building circulation graph...');

const graph = new CirculationGraph();

// Add all rooms as nodes
for (const room of positionedRooms) {
  graph.addRoom(room);
}

// Add logical connections based on room adjacency and floor plan logic
// Foyer connects to living and hallway
graph.addConnection('Foyer', 'Living Room', 'opening');
graph.addConnection('Foyer', 'Bedroom Hallway', 'door');

// Living/Kitchen/Dining are open plan
graph.addConnection('Living Room', 'Kitchen', 'opening');
graph.addConnection('Living Room', 'Dining Room', 'opening');
graph.addConnection('Kitchen', 'Dining Room', 'opening');

// Half bath and laundry off kitchen area
graph.addConnection('Kitchen', 'Half Bath', 'door');
graph.addConnection('Kitchen', 'Laundry', 'door');

// Bedroom hallway provides access to all bedrooms and full bath
graph.addConnection('Bedroom Hallway', 'Primary Bedroom', 'door');
graph.addConnection('Bedroom Hallway', 'Bedroom 2', 'door');
graph.addConnection('Bedroom Hallway', 'Bedroom 3', 'door');
graph.addConnection('Bedroom Hallway', 'Full Bath', 'door');

// Primary suite internal connections
graph.addConnection('Primary Bedroom', 'Primary Bathroom', 'door');
graph.addConnection('Primary Bedroom', 'Primary Closet', 'door');

// Secondary bedroom closets
graph.addConnection('Bedroom 2', 'Closet 2', 'door');
graph.addConnection('Bedroom 3', 'Closet 3', 'door');

// Validate connectivity
const connectivityResult = validateCirculationConnectivity(positionedRooms, [], 'Foyer');

console.log('');
console.log(generateConnectivityReport(connectivityResult));

// Show graph statistics
const stats = graph.getStats();
console.log('');
console.log('Graph Statistics:');
console.log(`  Nodes (rooms): ${stats.nodeCount}`);
console.log(`  Edges (connections): ${stats.edgeCount}`);
console.log(`  Connected components: ${stats.componentCount}`);
console.log(`  Average connections per room: ${stats.averageConnections.toFixed(1)}`);

// ============================================================================
// STEP 6: HALLWAY NETWORK (MST)
// ============================================================================
console.log('');
console.log('='.repeat(70));
console.log('STEP 6: HALLWAY NETWORK (MST)');
console.log('='.repeat(70));
console.log('');

// Compute the minimum hallway network
const hallwayNetwork: HallwayNetwork = computeMinimumHallwayNetwork(positionedRooms, 3.5);

console.log(getNetworkSummary(hallwayNetwork));

console.log('');
console.log('Junction Points:');
if (hallwayNetwork.junctions.length === 0) {
  console.log('  (No junctions - rooms connected directly or via shared walls)');
} else {
  for (let i = 0; i < hallwayNetwork.junctions.length; i++) {
    const junction = hallwayNetwork.junctions[i];
    console.log(`  Junction ${i + 1}: (${junction[0].toFixed(1)}, ${junction[1].toFixed(1)})`);
  }
}

console.log('');
console.log('Network Summary:');
console.log(`  Total hallway segments: ${hallwayNetwork.segments.length}`);
console.log(`  Total hallway length: ${hallwayNetwork.totalLength.toFixed(1)} ft`);
console.log(`  Total hallway area: ${hallwayNetwork.totalArea.toFixed(1)} sq ft`);
console.log(`  Average segment length: ${hallwayNetwork.segments.length > 0
  ? (hallwayNetwork.totalLength / hallwayNetwork.segments.length).toFixed(1)
  : 0} ft`);

// ============================================================================
// STEP 6B: BEDROOM CLUSTER DETECTION
// ============================================================================
console.log('');
console.log('='.repeat(70));
console.log('STEP 6B: BEDROOM CLUSTER DETECTION');
console.log('='.repeat(70));
console.log('');

// Detect bedroom clusters that need shared corridors
const bedroomClusters = detectBedroomClusters(positionedRooms);

console.log(`Bedroom clusters detected: ${bedroomClusters.length}`);
console.log('');

// Collect corridor specifications for geometry generation
const bedroomCorridors: ReturnType<typeof generateClusterCorridor>[] = [];

for (const cluster of bedroomClusters) {
  console.log(`Cluster ${cluster.id}:`);
  console.log(`  Bedrooms: ${cluster.bedrooms.map(b => b.name).join(', ')}`);
  console.log(`  Has primary suite: ${cluster.primarySuite ? 'Yes' : 'No'}`);
  console.log(`  Hall bathrooms: ${cluster.hallBathrooms.map(b => b.name).join(', ') || 'None'}`);
  console.log(`  Corridor width: ${cluster.corridorWidth}'`);
  console.log(`  Corridor axis: ${cluster.corridorAxis}`);
  console.log('');

  // Generate corridor for this cluster
  const corridor = generateClusterCorridor(cluster);
  bedroomCorridors.push(corridor);  // Collect for geometry generation

  console.log(`  Generated corridor: ${corridor.id}`);
  console.log(`    Length: ${corridor.length.toFixed(1)}'`);
  console.log(`    Width: ${corridor.width}'`);
  console.log(`    Doors: ${corridor.doors.length}`);
  for (const door of corridor.doors) {
    console.log(`      - Door to ${door.roomId} at (${door.position[0].toFixed(1)}, ${door.position[1].toFixed(1)})`);
  }

  // Convert to hallway segments
  const corridorSegments = corridorToHallwaySegments(corridor);
  console.log(`    Converted to ${corridorSegments.length} hallway segment(s)`);
}

// ============================================================================
// STEP 6C: OPEN FLOOR PLAN TRAFFIC PATHS
// ============================================================================
console.log('');
console.log('='.repeat(70));
console.log('STEP 6C: OPEN FLOOR PLAN TRAFFIC PATHS');
console.log('='.repeat(70));
console.log('');

// Detect open floor plan clusters (living/kitchen/dining combinations)
const openPlanClusters = detectOpenPlanClusters(positionedRooms);

console.log(`Open plan clusters detected: ${openPlanClusters.length}`);
console.log('');

const trafficPaths: TrafficPath[] = [];

for (const cluster of openPlanClusters) {
  console.log(`Cluster ${cluster.id}:`);
  console.log(`  Rooms: ${cluster.rooms.map(r => `${r.id} (${r.type})`).join(', ')}`);
  console.log(`  Total area: ${cluster.totalArea.toFixed(1)} sq ft`);
  console.log(`  Entry points: ${cluster.entryPoints.length}`);
  console.log('');

  // Check for kitchen room
  const hasKitchen = cluster.rooms.some(r => r.type === 'kitchen');
  const hasDining = cluster.rooms.some(r => r.type === 'dining');
  console.log(`  Has kitchen: ${hasKitchen ? 'Yes' : 'No'}`);
  console.log(`  Has dining: ${hasDining ? 'Yes' : 'No'}`);

  // Generate primary traffic path through the cluster
  const primaryPath = generatePrimaryTrafficPath(cluster);
  if (primaryPath) {
    trafficPaths.push(primaryPath);
    console.log(`  Primary traffic path:`);
    console.log(`    Type: ${primaryPath.pathType}`);
    console.log(`    Width: ${primaryPath.width}'`);
    console.log(`    Length: ${primaryPath.length.toFixed(1)}'`);
    console.log(`    Area: ${primaryPath.area.toFixed(1)} sq ft`);
    console.log(`    Blocks furniture: ${primaryPath.blocksFurniture ? 'Yes' : 'No'}`);
  }

  // Generate kitchen work zone if applicable
  if (hasKitchen) {
    const kitchenRoom = cluster.rooms.find(r => r.type === 'kitchen');
    if (kitchenRoom) {
      const kitchenZone = generateKitchenWorkZone(kitchenRoom.bounds);
      trafficPaths.push(kitchenZone);
      console.log(`  Kitchen work zone:`);
      console.log(`    Area: ${kitchenZone.area.toFixed(1)} sq ft`);
    }
  }

  // Generate entry zone if there's an entry point
  if (cluster.entryPoints.length > 0) {
    const primaryEntry = cluster.entryPoints.find(e => e.importance === 'primary') || cluster.entryPoints[0];
    const entryZone = generateEntryZone(primaryEntry.point, 3.0, cluster.id);
    trafficPaths.push(entryZone);
    console.log(`  Entry zone:`);
    console.log(`    Area: ${entryZone.area.toFixed(1)} sq ft`);
  }
}

console.log('');
console.log('Traffic Path Summary:');
console.log(`  Total traffic paths: ${trafficPaths.length}`);
const totalTrafficArea = trafficPaths.reduce((sum, tp) => sum + tp.area, 0);
console.log(`  Total traffic path area: ${totalTrafficArea.toFixed(1)} sq ft`);
console.log('  (Note: Traffic paths are overlay zones, not additional square footage)');

// ============================================================================
// STEP 7: SPINE GEOMETRY
// ============================================================================
console.log('');
console.log('='.repeat(70));
console.log('STEP 7: SPINE GEOMETRY');
console.log('='.repeat(70));
console.log('');

// Generate actual polygon geometry from the network (including traffic paths and bedroom corridors)
const spineGeometry: SpineGeometry = generateSpineGeometry(
  hallwayNetwork,
  3.5,
  trafficPaths,
  bedroomCorridors
);

console.log(getGeometrySummary(spineGeometry));

console.log('');
console.log('Hallway Polygons (vertices):');
if (spineGeometry.hallways.length === 0) {
  console.log('  (No hallway polygons - rooms are adjacent or share walls)');
} else {
  for (const hallway of spineGeometry.hallways) {
    console.log(`  ${hallway.id}:`);
    console.log(`    Connects: ${hallway.connectsRooms[0]} -> ${hallway.connectsRooms[1]}`);
    console.log(`    Dimensions: ${hallway.length.toFixed(1)}' x ${hallway.width}'`);
    console.log(`    Vertices:`);
    for (let i = 0; i < hallway.vertices.length; i++) {
      const v = hallway.vertices[i];
      console.log(`      [${i}]: (${v[0].toFixed(2)}, ${v[1].toFixed(2)})`);
    }
  }
}

console.log('');
console.log('Geometry Summary:');
console.log(`  Total hallway polygons: ${spineGeometry.hallways.length}`);
console.log(`  Total junction polygons: ${spineGeometry.junctions.length}`);
console.log(`  Total circulation area (from geometry): ${spineGeometry.totalArea.toFixed(1)} sq ft`);
console.log(`  Bounding box: ${spineGeometry.boundingBox.width.toFixed(1)}' x ${spineGeometry.boundingBox.height.toFixed(1)}'`);

// ============================================================================
// STEP 8: PATHFINDING VALIDATION
// ============================================================================
console.log('');
console.log('='.repeat(70));
console.log('STEP 8: PATHFINDING VALIDATION');
console.log('='.repeat(70));
console.log('');

// Convert hallway segments to HallwayPolygon format for pathfinding
const hallwayPolygons: HallwayPolygon[] = spineGeometry.hallways.map(h => ({
  id: h.id,
  vertices: [...h.vertices],
  width: h.width,
  connectedRooms: [...h.connectsRooms],
}));

// Validate all rooms are reachable from entry (Foyer)
console.log('Validating all rooms are reachable from Foyer...');
console.log('');

const validationResult = validateAllRoomsReachable(
  positionedRooms,
  hallwayPolygons,
  [], // No explicit doors - using adjacency
  'Foyer'
);

console.log(describeValidationResult(validationResult));

// Find and display a sample path
console.log('');
console.log('-'.repeat(50));
console.log('Sample Path: Primary Bedroom -> Kitchen');
console.log('-'.repeat(50));
console.log('');

const samplePath = findPathBetweenRooms(
  'Primary Bedroom',
  'Kitchen',
  positionedRooms,
  hallwayPolygons,
  []
);

console.log(describePathResult(samplePath));

if (samplePath.found && samplePath.path.length > 0) {
  console.log('');
  console.log('Waypoints:');
  for (let i = 0; i < Math.min(samplePath.path.length, 10); i++) {
    const [x, y] = samplePath.path[i];
    console.log(`  [${i}]: (${x.toFixed(1)}, ${y.toFixed(1)})`);
  }
  if (samplePath.path.length > 10) {
    console.log(`  ... and ${samplePath.path.length - 10} more waypoints`);
  }
}

// Another sample path
console.log('');
console.log('-'.repeat(50));
console.log('Sample Path: Bedroom 3 -> Living Room');
console.log('-'.repeat(50));
console.log('');

const samplePath2 = findPathBetweenRooms(
  'Bedroom 3',
  'Living Room',
  positionedRooms,
  hallwayPolygons,
  []
);

console.log(describePathResult(samplePath2));

// ============================================================================
// SUMMARY: Old vs New Approach
// ============================================================================
console.log('');
console.log('='.repeat(70));
console.log('SUMMARY: OLD vs NEW APPROACH');
console.log('='.repeat(70));
console.log('');

console.log('OLD APPROACH (Area-Only):');
console.log('  - Circulation: 76 sqft (3%)');
console.log('  - Method: Simple percentage allocation');
console.log('  - Problem: No actual geometry generated');
console.log('  - Problem: No connectivity validation');
console.log('  - Problem: Cannot verify rooms are reachable');
console.log('  - Problem: Massively undersized hallways');
console.log('');

console.log('NEW APPROACH (Graph-Based with Geometry):');
console.log(`  - Circulation area (budget): ${totalCirculation} sqft (${((totalCirculation/2500)*100).toFixed(1)}%)`);
console.log(`  - Walled circulation area (geometry): ${spineGeometry.totalArea.toFixed(1)} sqft`);
console.log(`  - Traffic path area (overlay): ${spineGeometry.trafficPathArea.toFixed(1)} sqft`);
console.log('  - Method: MST-based hallway network + polygon geometry');
console.log('');
console.log('  Key Improvements:');
console.log(`    1. Graph-based connectivity: ${stats.nodeCount} rooms, ${stats.edgeCount} connections`);
console.log(`    2. MST hallway optimization: ${hallwayNetwork.totalLength.toFixed(1)} ft total length`);
console.log(`    3. Actual geometry generated: ${spineGeometry.hallways.length} hallway polygons`);
console.log(`    4. Bedroom clusters detected: ${bedroomClusters.length} (prevents bedroom-to-bedroom direct access)`);
console.log(`    5. Traffic paths generated: ${spineGeometry.trafficPaths.length} (open plan circulation zones)`);
console.log(`    6. Pathfinding validated: ${validationResult.reachableRooms.length}/${positionedRooms.length} rooms reachable`);
console.log(`    7. Sample path length: ${samplePath.found ? samplePath.distance.toFixed(1) + ' ft' : 'N/A'}`);
console.log('');

// Final assessment
console.log('ASSESSMENT:');
if (validationResult.allReachable) {
  console.log('  [PASS] All rooms are reachable from entry');
} else {
  console.log(`  [FAIL] ${validationResult.unreachableRooms.length} rooms are unreachable`);
  console.log(`         Unreachable: ${validationResult.unreachableRooms.join(', ')}`);
}

if (stats.componentCount === 1) {
  console.log('  [PASS] Floor plan is fully connected (single component)');
} else {
  console.log(`  [WARN] Floor plan has ${stats.componentCount} disconnected areas`);
}

const geometryRatio = spineGeometry.totalArea / totalCirculation;
if (geometryRatio >= 0.5 && geometryRatio <= 1.5) {
  console.log(`  [PASS] Geometry area matches budget (ratio: ${geometryRatio.toFixed(2)})`);
} else {
  console.log(`  [WARN] Geometry area differs from budget (ratio: ${geometryRatio.toFixed(2)})`);
}

console.log('');
console.log('='.repeat(70));
console.log('TEST COMPLETE');
console.log('='.repeat(70));
