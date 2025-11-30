/**
 * Test script for CAD Skills
 *
 * Tests the high-level skills without needing Gemini API:
 * 1. skill_create_rectangular_room
 * 2. skill_create_hallway
 * 3. skill_plan_layout
 *
 * Run with: node scripts/test-skills.mjs
 */

// Test data simulation (since we're in ESM and can't import the TS directly)
// These tests validate the skill logic by calling the API with skill parameters

const API_URL = process.env.API_URL || 'http://localhost:3000/api/ai/generate';

async function testSkills() {
  console.log('='.repeat(60));
  console.log('Antigravity CAD - Skills Test');
  console.log('='.repeat(60));
  console.log('');

  // Test 1: Create rooms using skill_create_rectangular_room
  console.log('Test 1: Rectangular Room Skill with Relative Positioning');
  console.log('-'.repeat(40));

  const skillPrompt1 = {
    prompt: `Create a project, building, and level first.
Then use skill_create_rectangular_room to create:
1. A bedroom called "Master Bedroom" with width=15, depth=12 at absolute position (0,0)
2. A kitchen called "Kitchen" with width=13, depth=12 positioned EAST of "Master Bedroom"

Use position_type "absolute" for the first room and "relative" for the second room.`,
    successCriteria: [
      'Project/building/level created',
      'Master Bedroom created at (0,0)',
      'Kitchen created EAST of Master Bedroom',
    ],
    useMock: true,
    maxIterations: 15,
  };

  try {
    console.log('Prompt:', skillPrompt1.prompt);
    console.log('');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skillPrompt1),
    });

    const result = await response.json();

    if (result.success) {
      console.log('SUCCESS!');
      console.log('');
      console.log('Tool/Skill Calls:');
      if (result.result?.toolCallHistory) {
        for (const item of result.result.toolCallHistory) {
          const isSkill = item.call.name.startsWith('skill_');
          console.log(`  ${isSkill ? '[SKILL]' : '[TOOL]'} ${item.call.name}: ${item.result.status}`);
          if (item.result.whatChanged) {
            console.log(`    Changed: ${item.result.whatChanged}`);
          }
        }
      }

      // Show final state
      const lastResult = result.result?.toolCallHistory?.slice(-1)?.[0]?.result;
      if (lastResult?.stateForLLM) {
        console.log('');
        console.log('Final Observable State:');
        console.log(lastResult.stateForLLM);
      }
    } else {
      console.log('FAILED');
      console.log('Error:', result.error);
    }
  } catch (error) {
    console.log('ERROR:', error.message);
    console.log('');
    console.log('Make sure the Next.js dev server is running:');
    console.log('  cd packages/frontend && npm run dev');
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('');

  // Test 2: Layout Planning skill
  console.log('Test 2: Layout Planning Skill');
  console.log('-'.repeat(40));

  const skillPrompt2 = {
    prompt: `Use skill_plan_layout to plan a simple house with these rooms:
- Master Bedroom: 15x12
- Kitchen: 13x12 (should be EAST of Master Bedroom)
- Living Room: 18x15 (should be NORTH of Kitchen)

Include adjacency requirements:
1. Kitchen EAST of Master Bedroom (required)
2. Living Room NORTH of Kitchen (preferred)

Then create each room using skill_create_rectangular_room with the planned positions.`,
    successCriteria: [
      'Layout planned successfully',
      'All 3 rooms created',
      'Adjacencies respected',
    ],
    useMock: true,
    maxIterations: 20,
  };

  try {
    console.log('Prompt:', skillPrompt2.prompt);
    console.log('');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(skillPrompt2),
    });

    const result = await response.json();

    if (result.success) {
      console.log('SUCCESS!');
      console.log('');

      // Find the plan_layout result
      const planResult = result.result?.toolCallHistory?.find(
        item => item.call.name === 'skill_plan_layout'
      );

      if (planResult?.result?.data?.rooms) {
        console.log('Planned Layout:');
        for (const room of planResult.result.data.rooms) {
          console.log(`  ${room.name}: ${room.dimensions[0]}x${room.dimensions[1]} at (${room.position[0]}, ${room.position[1]})`);
        }
        if (planResult.result.data.conflicts?.length > 0) {
          console.log('Conflicts:', planResult.result.data.conflicts.join(', '));
        }
        if (planResult.result.data.warnings?.length > 0) {
          console.log('Warnings:', planResult.result.data.warnings.join(', '));
        }
      }

      // Show final state
      const lastResult = result.result?.toolCallHistory?.slice(-1)?.[0]?.result;
      if (lastResult?.stateForLLM) {
        console.log('');
        console.log('Final Observable State:');
        console.log(lastResult.stateForLLM);
      }
    } else {
      console.log('FAILED');
      console.log('Error:', result.error);
    }
  } catch (error) {
    console.log('ERROR:', error.message);
  }

  console.log('');
  console.log('='.repeat(60));
}

// Run tests
testSkills();
