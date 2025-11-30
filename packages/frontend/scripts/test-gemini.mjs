/**
 * Quick test script to verify Gemini API connection
 * Run with: node scripts/test-gemini.mjs
 */

import { GoogleGenAI } from '@google/genai';

const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) {
  console.error('❌ GOOGLE_API_KEY not set. Create .env.local with your key.');
  process.exit(1);
}

async function testGemini() {
  console.log('🔍 Testing Gemini API connection...\n');

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });

    // Test 1: Simple text generation
    console.log('Test 1: Simple text generation');
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: 'Say "Hello from Antigravity CAD!" in exactly those words.',
    });
    console.log('✅ Response:', response.text);
    console.log('');

    // Test 2: Function calling with a simple tool
    console.log('Test 2: Function calling');
    const toolResponse = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: 'Create a project called "Test House" with imperial units.',
      config: {
        tools: [
          {
            functionDeclarations: [
              {
                name: 'create_project',
                description: 'Create a new CAD project',
                parameters: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', description: 'Project name' },
                    units: { type: 'string', description: 'Unit system: imperial or metric' },
                    code_region: { type: 'string', description: 'Building code region' },
                  },
                  required: ['name', 'units', 'code_region'],
                },
              },
            ],
          },
        ],
      },
    });

    if (toolResponse.functionCalls && toolResponse.functionCalls.length > 0) {
      console.log('✅ Function call detected:');
      console.log('   Name:', toolResponse.functionCalls[0].name);
      console.log('   Args:', JSON.stringify(toolResponse.functionCalls[0].args, null, 2));
    } else {
      console.log('⚠️ No function call in response. Text:', toolResponse.text);
    }
    console.log('');

    // Test 3: Multi-turn chat
    console.log('Test 3: Multi-turn chat');
    const chat = ai.chats.create({
      model: 'gemini-3-pro-preview',
    });

    const chatResponse1 = await chat.sendMessage({ message: 'What is 2 + 2?' });
    console.log('✅ Chat response 1:', chatResponse1.text);

    const chatResponse2 = await chat.sendMessage({ message: 'Multiply that by 10.' });
    console.log('✅ Chat response 2:', chatResponse2.text);
    console.log('');

    console.log('🎉 All Gemini tests passed!');
    console.log('');
    console.log('Ready to proceed with API route implementation.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.message.includes('API_KEY')) {
      console.log('\n💡 Check that your API key is valid and has Gemini API access enabled.');
    }
    process.exit(1);
  }
}

testGemini();
