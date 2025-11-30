/**
 * End-to-end test for Gemini CAD generation
 *
 * Tests the full pipeline:
 * 1. Frontend API route receives request
 * 2. Gemini generates tool calls
 * 3. Tool executor processes calls (mock mode)
 * 4. Response with observable state returns
 *
 * Run with: node scripts/test-cad-generation.mjs
 */

const API_URL = process.env.API_URL || 'http://localhost:3000/api/ai/generate';

async function testCADGeneration() {
  console.log('='.repeat(60));
  console.log('Antigravity CAD - Gemini Integration Test');
  console.log('='.repeat(60));
  console.log('');

  // Test 1: Simple room creation
  console.log('Test 1: Simple Room Generation');
  console.log('-'.repeat(40));

  const simplePrompt = {
    prompt: 'Create a simple project called "Test House" with imperial units and US IRC 2021 code. Add a building called "Main House" and create one level called "Ground Floor" at elevation 0 with 9 foot floor-to-floor height.',
    successCriteria: [
      'Project created successfully',
      'Building added to project',
      'Level created with correct elevation',
    ],
    useMock: true, // Use mock executor for testing
    maxIterations: 10,
  };

  try {
    console.log('Sending request to:', API_URL);
    console.log('Prompt:', simplePrompt.prompt);
    console.log('');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(simplePrompt),
    });

    const result = await response.json();

    if (result.success) {
      console.log('SUCCESS!');
      console.log('');
      console.log('Tool Call History:');
      if (result.result?.toolCallHistory) {
        for (const item of result.result.toolCallHistory) {
          console.log(`  - ${item.call.name}: ${item.result.status}`);
          if (item.result.data) {
            console.log(`    Data: ${JSON.stringify(item.result.data)}`);
          }
          // Show LLM-friendly state that Gemini sees
          if (item.result.stateForLLM) {
            console.log('    --- Observable State Sent to Gemini ---');
            console.log(item.result.stateForLLM.split('\n').map(l => '    ' + l).join('\n'));
            console.log('    --- End Observable State ---');
          }
        }
      }
      console.log('');
      if (result.result?.selfVerification) {
        console.log('Self-Verification:');
        console.log(`  Requirements Met: ${result.result.selfVerification.requirementsMet}`);
        console.log(`  Validation: ${result.result.selfVerification.validationStatus}`);
        console.log(`  Confidence: ${result.result.selfVerification.confidence}`);
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

  // Test 2: Room creation with observable state
  console.log('');
  console.log('Test 2: Room Creation (Shows Observable State)');
  console.log('-'.repeat(40));

  const roomPrompt = {
    prompt: `Create a simple project, building, and level.
Then create a bedroom called "Master Bedroom" with points [[0,0], [15,0], [15,12], [0,12]] (15ft x 12ft = 180 sq ft).
Then create a kitchen called "Kitchen" with points [[15,0], [28,0], [28,12], [15,12]] (13ft x 12ft = 156 sq ft).
The kitchen should be EAST of the bedroom.`,
    successCriteria: [
      'Project and level created',
      'Master Bedroom created (180 sq ft)',
      'Kitchen created adjacent to bedroom',
    ],
    useMock: true,
    maxIterations: 15,
  };

  try {
    console.log('Prompt:', roomPrompt.prompt);
    console.log('');

    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(roomPrompt),
    });

    const result = await response.json();

    if (result.success) {
      console.log('SUCCESS!');
      console.log('');

      // Show just the last result's observable state
      const lastResult = result.result?.toolCallHistory?.slice(-1)?.[0]?.result;
      if (lastResult?.stateForLLM) {
        console.log('Final Observable State (what Gemini sees):');
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

// Run the test
testCADGeneration();
