/**
 * Chat API Route - Server-side Gemini API integration
 * Keeps API key secure on server, proxies requests from client
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenAI, Type, type Content, type FunctionDeclaration } from '@google/genai';

// Initialize Gemini client
const client = new GoogleGenAI({
  apiKey: process.env.GOOGLE_AI_API_KEY || ''
});

// Keywords that indicate complex design tasks requiring higher thinking budget
const COMPLEX_TASK_KEYWORDS = [
  'design', 'create', 'generate', 'layout', 'plan',
  'architect', 'build', 'construct', 'arrange', 'organize',
  'optimize', 'floorplan', 'floor plan', 'house', 'home',
  'bedroom', 'kitchen', 'bathroom', 'living room'
];

/**
 * Determine thinking level based on query complexity.
 * Gemini 3.0 Pro uses thinkingLevel: 'low' | 'medium' | 'high'
 */
function getThinkingLevel(message: string): 'low' | 'medium' | 'high' {
  const lowerMessage = message.toLowerCase();
  const isComplexTask = COMPLEX_TASK_KEYWORDS.some(keyword =>
    lowerMessage.includes(keyword)
  );

  return isComplexTask ? 'high' : 'low';
}

// CAD System Prompt - Collaborative Pair Architecting
const CAD_SYSTEM_PROMPT = `You are a collaborative residential architect for Antigravity CAD.

=== WORKFLOW ===

1. LISTEN to user's needs - don't assume dimensions they haven't specified
2. ASK clarifying questions when real choices exist (L vs H shape, bedroom clustering, etc.)
3. PLACE rooms iteratively - the footprint is DERIVED from room positions automatically
4. DESCRIBE what you did after each change and ask for feedback

=== COORDINATE SYSTEM ===

Origin (0,0) is at the SOUTHWEST corner. X→East, Y→North.
Rooms can be placed anywhere - the building footprint expands to contain them.

=== ROOM SIZING GUIDANCE ===

Typical sizes (feet):
- Living: 14×18 to 20×22 | Kitchen: 12×14 to 16×16
- Primary Bedroom: 14×16 to 18×18 | Bedroom: 11×12 to 14×14
- Bathroom: 5×8 (full), 8×10 (primary) | Hallway: 4' wide minimum

=== CIRCULATION ZONES ===

Rooms are organized into zones for proper circulation:

PUBLIC ZONE: living, kitchen, dining, family, great_room, foyer, mudroom
- Direct access from entry
- Can have open cased openings between rooms (no door)

PRIVATE ZONE: bedroom, bathroom, closet
- Should be accessed via hallway (not directly from public)
- Bedrooms connect to hallway, not to each other

CIRCULATION: hallway, foyer, stair, landing
- Connects public and private zones
- Place hallways to reach bedrooms

SERVICE: garage, laundry, utility, pantry
- Garage connects to mudroom (not directly to living areas)

=== AUTO-GENERATED DOORS ===

Doors are AUTO-CREATED when you place rooms adjacent to each other:
- Bedroom next to hallway → door auto-generated
- Kitchen next to dining → cased opening auto-generated
- Focus on ROOM PLACEMENT - doors handle themselves

If rooms are placed without an adjacent hallway, you'll see a warning:
"! Primary Bedroom has no door connection (orphaned)"
This means you need to extend or add a hallway to connect it.

=== COLLABORATIVE APPROACH ===

- When user gives fuzzy constraints ("roughly 3500 sqft", "L or H shape"), ASK which they prefer
- Place rooms one wing at a time, getting feedback before continuing
- After placing rooms, the footprint auto-derives - you don't set it manually
- For hallways, just create rooms with type="hallway"
- Review CIRCULATION WARNINGS in state feedback and address them

=== AVOID ===

- Setting building dimensions before rooms exist
- One-shotting entire layouts without user feedback
- Assuming specific dimensions the user didn't mention
- Placing bedrooms without hallway access
- Connecting bedrooms directly to each other`;

// Tool declarations - 5 collaborative tools
const CAD_TOOLS: FunctionDeclaration[] = [
  {
    name: 'create_room',
    description: 'Create a room at a position. The building footprint auto-expands to contain all rooms.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        room_type: {
          type: Type.STRING,
          description: 'Room type: living, kitchen, bedroom, bathroom, hallway, garage, dining, office, laundry, mudroom, foyer, closet, pantry, utility'
        },
        name: { type: Type.STRING, description: 'Room name (e.g., "Primary Bedroom", "Kitchen")' },
        x: { type: Type.NUMBER, description: 'X position of SW corner in feet' },
        y: { type: Type.NUMBER, description: 'Y position of SW corner in feet' },
        width: { type: Type.NUMBER, description: 'Room width in feet (East-West)' },
        depth: { type: Type.NUMBER, description: 'Room depth in feet (North-South)' },
        floor: { type: Type.NUMBER, description: 'Floor number (0 = ground, 1 = second, etc.). Default: 0' }
      },
      required: ['room_type', 'name', 'x', 'y', 'width', 'depth']
    }
  },
  {
    name: 'update_room',
    description: 'Move, resize, or rename an existing room.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        room_id: { type: Type.STRING, description: 'Room ID to update' },
        x: { type: Type.NUMBER, description: 'New X position (optional)' },
        y: { type: Type.NUMBER, description: 'New Y position (optional)' },
        width: { type: Type.NUMBER, description: 'New width (optional)' },
        depth: { type: Type.NUMBER, description: 'New depth (optional)' },
        name: { type: Type.STRING, description: 'New name (optional)' }
      },
      required: ['room_id']
    }
  },
  {
    name: 'delete_room',
    description: 'Remove a room from the layout.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        room_id: { type: Type.STRING, description: 'Room ID to delete' }
      },
      required: ['room_id']
    }
  },
  {
    name: 'add_opening',
    description: 'Add a door or window between two rooms or on an exterior wall.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        opening_type: { type: Type.STRING, description: 'Type: "door" or "window"' },
        room1_id: { type: Type.STRING, description: 'First room ID' },
        room2_id: { type: Type.STRING, description: 'Second room ID (omit for exterior)' },
        width: { type: Type.NUMBER, description: 'Opening width in feet' },
        height: { type: Type.NUMBER, description: 'Opening height in feet' }
      },
      required: ['opening_type', 'room1_id', 'width', 'height']
    }
  },
  {
    name: 'ask_user',
    description: 'Ask the user a clarifying question. Use when design choices need their input.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: { type: Type.STRING, description: 'The question to ask' },
        options: {
          type: Type.ARRAY,
          description: 'Optional list of choices',
          items: { type: Type.STRING }
        },
        context: { type: Type.STRING, description: 'Why this choice matters for the design' }
      },
      required: ['question']
    }
  }
];

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { message, history = [], stateForLLM = '' } = await request.json();

    // Build content with state context
    const userContent = stateForLLM
      ? `${message}\n\nCurrent State:\n${stateForLLM}`
      : message;

    // Build messages array
    const contents: Content[] = [
      { role: 'user', parts: [{ text: CAD_SYSTEM_PROMPT }] },
      { role: 'model', parts: [{ text: 'I understand. I am ready to help design your building.' }] },
      ...history,
      { role: 'user', parts: [{ text: userContent }] }
    ];

    // Determine thinking level based on query complexity (Gemini 3.0 Pro)
    const thinkingLevel = getThinkingLevel(message);
    console.log(`[Chat API] Using Gemini 3.0 Pro with thinkingLevel: ${thinkingLevel}`);

    // Call Gemini 3.0 Pro
    const response = await client.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents,
      config: {
        tools: [{ functionDeclarations: CAD_TOOLS }],
        temperature: 1.0, // Gemini 3 is optimized for temperature 1.0
        thinkingConfig: {
          thinkingLevel
        }
      }
    });

    // Extract response parts
    const candidate = response.candidates?.[0];
    if (!candidate) {
      return json({ success: false, error: 'No response from Gemini' });
    }

    const parts = candidate.content?.parts || [];
    let text = '';
    let thinking = '';
    const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

    for (const part of parts) {
      if ('text' in part && part.text) {
        text += part.text;
      }
      if ('thought' in part && part.thought) {
        thinking += part.thought;
      }
      if ('functionCall' in part && part.functionCall) {
        functionCalls.push({
          name: part.functionCall.name || '',
          args: (part.functionCall.args as Record<string, unknown>) || {}
        });
      }
    }

    // Build updated history
    const newHistory: Content[] = [
      ...history,
      { role: 'user', parts: [{ text: userContent }] },
      { role: 'model', parts: candidate.content?.parts || [] }
    ];

    return json({
      success: true,
      text,
      thinking,
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
      history: newHistory,
      usage: response.usageMetadata ? {
        promptTokens: response.usageMetadata.promptTokenCount || 0,
        responseTokens: response.usageMetadata.candidatesTokenCount || 0,
        totalTokens: response.usageMetadata.totalTokenCount || 0
      } : undefined
    });
  } catch (error) {
    console.error('[Chat API] Error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};
