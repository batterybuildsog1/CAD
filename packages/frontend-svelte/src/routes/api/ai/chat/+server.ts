/**
 * Chat API Route - Multi-LLM API integration
 * Supports Gemini 3.0 Pro, Claude Sonnet 4.5, Claude Opus 4.5, and Grok 4.1
 * Keeps API keys secure on server, proxies requests from client
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { GoogleGenAI, Type, type Content, type FunctionDeclaration } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

// Get API keys from environment (may not all be present)
const GOOGLE_AI_API_KEY = env.GOOGLE_AI_API_KEY;
const ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
const XAI_API_KEY = env.XAI_API_KEY;

import {
  type LLMProvider,
  PROVIDER_CONFIGS,
  DEFAULT_PROVIDER,
  toClaudeTools,
  toGrokTools,
  isClaudeProvider
} from '$lib/llm-providers';

// Initialize clients (lazy - only create if API key exists)
const geminiClient = GOOGLE_AI_API_KEY ? new GoogleGenAI({ apiKey: GOOGLE_AI_API_KEY }) : null;
const claudeClient = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;
// Grok uses OpenAI-compatible API
const grokApiKey = XAI_API_KEY;

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

=== ITERATIVE DESIGN WORKFLOW ===

IMPORTANT: You receive structured requirements from an intake form. Your job is to:
1. DRAW FIRST - Place all rooms from the program immediately
2. ASK SECOND - Use ask_user tool for follow-up refinements
3. ITERATE - Adjust based on feedback until user is satisfied

**STEP 1: DRAW WHAT YOU KNOW**
When you receive a house program, IMMEDIATELY create all rooms:
- Living room, kitchen, dining (public zone)
- Bedrooms with hallway for access (private zone)
- Bathrooms adjacent to bedrooms or hallway
- Use reasonable default dimensions based on target sqft

**STEP 2: ASK FOCUSED QUESTIONS**
After placing initial rooms, use the ask_user tool to refine:
- "Should the primary bedroom have an ensuite bathroom?"
- "Do you prefer the kitchen open to living, or separated?"
- "Want a mudroom connection from garage?"

**STEP 3: REFINE BASED ON ANSWERS**
- Move/resize rooms based on user preferences
- Add requested features
- Keep iterating until satisfied

**CRITICAL RULES:**
- ALWAYS place rooms BEFORE asking questions
- NEVER ask more than 2 questions before showing design progress
- Use the ask_user tool (not inline text questions) for clarifications
- Review CIRCULATION WARNINGS and fix orphaned rooms

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

=== WALL CREATION RULES ===

Walls are INDEPENDENT of rooms. Not all room boundaries need walls:
- Privacy rooms (bedrooms, bathrooms, closets, offices) ALWAYS need walls
- Open concept areas (kitchen, dining, living) typically share space WITHOUT walls between them
- Use auto_generate_walls after placing rooms to create appropriate walls
- Use set_room_openness to override defaults (e.g., close off kitchen from living, or open up an office)
- Use create_wall for explicit wall placement when needed
- Use generate_framing to create detailed stud/plate layout for construction docs

WALL TYPES:
- exterior_2x6: Exterior walls (6" thick with insulation)
- interior_partition: Interior walls (4" thick)

WALL/OPENING TYPES BETWEEN ROOMS:
- full: Complete wall with door
- none: No wall (open concept)
- half: Partial wall/pony wall
- cased_opening: Opening with trim but no door

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

// Tool declarations - 5 collaborative tools (Gemini format)
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
    description: 'Ask the user a clarifying question AFTER placing initial rooms. Use for design refinements, not before drawing. Always explain why the choice matters.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: { type: Type.STRING, description: 'The specific question to ask (e.g., "Should the primary bedroom have an ensuite?")' },
        options: {
          type: Type.ARRAY,
          description: 'List of 2-4 choices for the user to pick from',
          items: { type: Type.STRING }
        },
        context: { type: Type.STRING, description: 'Why this choice matters for the design - helps user make informed decision' },
        category: {
          type: Type.STRING,
          description: 'Question category: "layout", "circulation", "features", or "sizing"'
        }
      },
      required: ['question', 'context']
    }
  },
  // Wall Management Tools
  {
    name: 'create_wall',
    description: 'Create a wall segment between two points. Use this when you need to explicitly place a wall.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        start_x: { type: Type.NUMBER, description: 'X coordinate of wall start (feet)' },
        start_y: { type: Type.NUMBER, description: 'Y coordinate of wall start (feet)' },
        end_x: { type: Type.NUMBER, description: 'X coordinate of wall end (feet)' },
        end_y: { type: Type.NUMBER, description: 'Y coordinate of wall end (feet)' },
        height: { type: Type.NUMBER, description: 'Wall height in feet (default 8)' },
        wall_type: {
          type: Type.STRING,
          description: 'Wall assembly type: "exterior_2x6" or "interior_partition"'
        }
      },
      required: ['start_x', 'start_y', 'end_x', 'end_y']
    }
  },
  {
    name: 'auto_generate_walls',
    description: 'Automatically generate all walls for the floor plan based on room types. Privacy rooms (bedrooms, bathrooms) get full walls. Open concept areas (kitchen/dining/living) share space without walls. Call this after placing rooms to create appropriate walls.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
      required: []
    }
  },
  {
    name: 'set_room_openness',
    description: 'Set whether two adjacent rooms have a wall between them. Use this to override the default wall decision - for example, to open up a wall between kitchen and living room, or to add a wall where one would not normally exist.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        room1_id: { type: Type.STRING, description: 'First room ID' },
        room2_id: { type: Type.STRING, description: 'Second room ID' },
        wall_type: {
          type: Type.STRING,
          description: 'Type of wall/opening between rooms: "full", "none", "half", or "cased_opening"'
        }
      },
      required: ['room1_id', 'room2_id', 'wall_type']
    }
  },
  {
    name: 'generate_framing',
    description: 'Generate structural framing (studs, plates, headers) for a wall. This creates the detailed framing layout that would be needed for construction.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        wall_id: { type: Type.STRING, description: 'Wall ID to generate framing for. If not provided, generates for all walls.' }
      },
      required: []
    }
  }
];

// Provider-agnostic tool definitions (for Claude/Grok conversion)
const CAD_TOOLS_AGNOSTIC = [
  {
    name: 'create_room',
    description: 'Create a room at a position. The building footprint auto-expands to contain all rooms.',
    parameters: {
      type: 'object' as const,
      properties: {
        room_type: { type: 'string' as const, description: 'Room type: living, kitchen, bedroom, bathroom, hallway, garage, dining, office, laundry, mudroom, foyer, closet, pantry, utility' },
        name: { type: 'string' as const, description: 'Room name (e.g., "Primary Bedroom", "Kitchen")' },
        x: { type: 'number' as const, description: 'X position of SW corner in feet' },
        y: { type: 'number' as const, description: 'Y position of SW corner in feet' },
        width: { type: 'number' as const, description: 'Room width in feet (East-West)' },
        depth: { type: 'number' as const, description: 'Room depth in feet (North-South)' },
        floor: { type: 'number' as const, description: 'Floor number (0 = ground, 1 = second, etc.). Default: 0' }
      },
      required: ['room_type', 'name', 'x', 'y', 'width', 'depth']
    }
  },
  {
    name: 'update_room',
    description: 'Move, resize, or rename an existing room.',
    parameters: {
      type: 'object' as const,
      properties: {
        room_id: { type: 'string' as const, description: 'Room ID to update' },
        x: { type: 'number' as const, description: 'New X position (optional)' },
        y: { type: 'number' as const, description: 'New Y position (optional)' },
        width: { type: 'number' as const, description: 'New width (optional)' },
        depth: { type: 'number' as const, description: 'New depth (optional)' },
        name: { type: 'string' as const, description: 'New name (optional)' }
      },
      required: ['room_id']
    }
  },
  {
    name: 'delete_room',
    description: 'Remove a room from the layout.',
    parameters: {
      type: 'object' as const,
      properties: {
        room_id: { type: 'string' as const, description: 'Room ID to delete' }
      },
      required: ['room_id']
    }
  },
  {
    name: 'add_opening',
    description: 'Add a door or window between two rooms or on an exterior wall.',
    parameters: {
      type: 'object' as const,
      properties: {
        opening_type: { type: 'string' as const, description: 'Type: "door" or "window"' },
        room1_id: { type: 'string' as const, description: 'First room ID' },
        room2_id: { type: 'string' as const, description: 'Second room ID (omit for exterior)' },
        width: { type: 'number' as const, description: 'Opening width in feet' },
        height: { type: 'number' as const, description: 'Opening height in feet' }
      },
      required: ['opening_type', 'room1_id', 'width', 'height']
    }
  },
  {
    name: 'ask_user',
    description: 'Ask the user a clarifying question AFTER placing initial rooms. Use for design refinements, not before drawing. Always explain why the choice matters.',
    parameters: {
      type: 'object' as const,
      properties: {
        question: { type: 'string' as const, description: 'The specific question to ask' },
        options: { type: 'array' as const, description: 'List of 2-4 choices', items: { type: 'string' } },
        context: { type: 'string' as const, description: 'Why this choice matters for the design' },
        category: { type: 'string' as const, description: 'Question category: "layout", "circulation", "features", or "sizing"' }
      },
      required: ['question', 'context']
    }
  },
  // Wall Management Tools
  {
    name: 'create_wall',
    description: 'Create a wall segment between two points. Use this when you need to explicitly place a wall.',
    parameters: {
      type: 'object' as const,
      properties: {
        start_x: { type: 'number' as const, description: 'X coordinate of wall start (feet)' },
        start_y: { type: 'number' as const, description: 'Y coordinate of wall start (feet)' },
        end_x: { type: 'number' as const, description: 'X coordinate of wall end (feet)' },
        end_y: { type: 'number' as const, description: 'Y coordinate of wall end (feet)' },
        height: { type: 'number' as const, description: 'Wall height in feet (default 8)' },
        wall_type: { type: 'string' as const, description: 'Wall assembly type: "exterior_2x6" or "interior_partition"' }
      },
      required: ['start_x', 'start_y', 'end_x', 'end_y']
    }
  },
  {
    name: 'auto_generate_walls',
    description: 'Automatically generate all walls for the floor plan based on room types. Privacy rooms (bedrooms, bathrooms) get full walls. Open concept areas (kitchen/dining/living) share space without walls. Call this after placing rooms.',
    parameters: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'set_room_openness',
    description: 'Set whether two adjacent rooms have a wall between them. Use this to override the default wall decision.',
    parameters: {
      type: 'object' as const,
      properties: {
        room1_id: { type: 'string' as const, description: 'First room ID' },
        room2_id: { type: 'string' as const, description: 'Second room ID' },
        wall_type: { type: 'string' as const, description: 'Type: "full", "none", "half", or "cased_opening"' }
      },
      required: ['room1_id', 'room2_id', 'wall_type']
    }
  },
  {
    name: 'generate_framing',
    description: 'Generate structural framing (studs, plates, headers) for a wall. Creates the detailed framing layout needed for construction.',
    parameters: {
      type: 'object' as const,
      properties: {
        wall_id: { type: 'string' as const, description: 'Wall ID to generate framing for. If not provided, generates for all walls.' }
      },
      required: []
    }
  }
];

// ============================================================================
// Provider-specific handlers
// ============================================================================

async function callGemini(
  userContent: string,
  history: Content[],
  thinkingLevel: 'low' | 'medium' | 'high'
): Promise<{
  text: string;
  thinking: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  newHistory: Content[];
  usage?: { promptTokens: number; responseTokens: number; totalTokens: number };
}> {
  if (!geminiClient) {
    throw new Error('Gemini API key not configured');
  }

  const contents: Content[] = [
    { role: 'user', parts: [{ text: CAD_SYSTEM_PROMPT }] },
    { role: 'model', parts: [{ text: 'I understand. I am ready to help design your building.' }] },
    ...history,
    { role: 'user', parts: [{ text: userContent }] }
  ];

  const response = await geminiClient.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents,
    config: {
      tools: [{ functionDeclarations: CAD_TOOLS }],
      temperature: 1.0,
      thinkingConfig: { thinkingLevel }
    }
  });

  const candidate = response.candidates?.[0];
  if (!candidate) {
    throw new Error('No response from Gemini');
  }

  const parts = candidate.content?.parts || [];
  let text = '';
  let thinking = '';
  const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  for (const part of parts) {
    if ('text' in part && part.text) text += part.text;
    if ('thought' in part && part.thought) thinking += part.thought;
    if ('functionCall' in part && part.functionCall) {
      functionCalls.push({
        name: part.functionCall.name || '',
        args: (part.functionCall.args as Record<string, unknown>) || {}
      });
    }
  }

  const newHistory: Content[] = [
    ...history,
    { role: 'user', parts: [{ text: userContent }] },
    { role: 'model', parts: candidate.content?.parts || [] }
  ];

  return {
    text,
    thinking,
    functionCalls,
    newHistory,
    usage: response.usageMetadata ? {
      promptTokens: response.usageMetadata.promptTokenCount || 0,
      responseTokens: response.usageMetadata.candidatesTokenCount || 0,
      totalTokens: response.usageMetadata.totalTokenCount || 0
    } : undefined
  };
}

async function callClaude(
  userContent: string,
  history: Content[],
  provider: LLMProvider
): Promise<{
  text: string;
  thinking: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  newHistory: Content[];
  usage?: { promptTokens: number; responseTokens: number; totalTokens: number };
}> {
  if (!claudeClient) {
    throw new Error('Anthropic API key not configured');
  }

  const config = PROVIDER_CONFIGS[provider];

  // Convert history to Claude format
  const claudeMessages: Anthropic.MessageParam[] = history.map(h => ({
    role: h.role === 'model' ? 'assistant' : 'user',
    content: h.parts?.map(p => ('text' in p ? p.text : '')).join('') || ''
  }));

  // Add current message
  claudeMessages.push({ role: 'user', content: userContent });

  // Build request params
  // Note: When using extended thinking, max_tokens must be > budget_tokens
  // Sonnet uses budget_tokens: 10000, so max_tokens must be > 10000
  // Opus uses effort-based thinking (no explicit budget)
  const requestParams: Anthropic.MessageCreateParams = {
    model: config.model,
    max_tokens: provider === 'claude-opus' ? 16384 : 16000,
    system: CAD_SYSTEM_PROMPT,
    tools: toClaudeTools(CAD_TOOLS_AGNOSTIC as any) as Anthropic.Tool[],
    messages: claudeMessages
  };

  // Add extended thinking for Claude models
  // Both Opus 4.5 and Sonnet 4.5 require budget_tokens with extended thinking
  // Opus gets higher budget for more complex reasoning
  if (provider === 'claude-opus') {
    (requestParams as any).thinking = {
      type: 'enabled',
      budget_tokens: 12000
    };
  } else if (provider === 'claude-sonnet') {
    (requestParams as any).thinking = {
      type: 'enabled',
      budget_tokens: 10000
    };
  }

  const response = await claudeClient.messages.create(requestParams);

  let text = '';
  let thinking = '';
  const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text;
    } else if (block.type === 'tool_use') {
      functionCalls.push({
        name: block.name,
        args: block.input as Record<string, unknown>
      });
    } else if (block.type === 'thinking' && 'thinking' in block) {
      thinking += (block as { thinking: string }).thinking;
    }
  }

  // Update history in Gemini format for consistency
  const newHistory: Content[] = [
    ...history,
    { role: 'user', parts: [{ text: userContent }] },
    { role: 'model', parts: [{ text: text || JSON.stringify(functionCalls) }] }
  ];

  return {
    text,
    thinking,
    functionCalls,
    newHistory,
    usage: {
      promptTokens: response.usage.input_tokens,
      responseTokens: response.usage.output_tokens,
      totalTokens: response.usage.input_tokens + response.usage.output_tokens
    }
  };
}

async function callGrok(
  userContent: string,
  history: Content[]
): Promise<{
  text: string;
  thinking: string;
  functionCalls: Array<{ name: string; args: Record<string, unknown> }>;
  newHistory: Content[];
  usage?: { promptTokens: number; responseTokens: number; totalTokens: number };
}> {
  if (!grokApiKey) {
    throw new Error('xAI API key not configured');
  }

  const config = PROVIDER_CONFIGS.grok;

  // Convert history to OpenAI format
  const grokMessages = [
    { role: 'system', content: CAD_SYSTEM_PROMPT },
    ...history.map(h => ({
      role: h.role === 'model' ? 'assistant' : 'user',
      content: h.parts?.map(p => ('text' in p ? p.text : '')).join('') || ''
    })),
    { role: 'user', content: userContent }
  ];

  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${grokApiKey}`
    },
    body: JSON.stringify({
      model: config.model,  // grok-4-1-fast-reasoning
      messages: grokMessages,
      tools: toGrokTools(CAD_TOOLS_AGNOSTIC as any),
      temperature: config.defaultTemperature
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Grok API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  let text = choice?.message?.content || '';
  let thinking = '';
  const functionCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  // Extract reasoning/thinking if present (Grok reasoning mode may include it)
  if (text.includes('<thinking>')) {
    const thinkingMatch = text.match(/<thinking>([\s\S]*?)<\/thinking>/);
    if (thinkingMatch) {
      thinking = thinkingMatch[1].trim();
      text = text.replace(/<thinking>[\s\S]*?<\/thinking>/, '').trim();
    }
  }

  if (choice?.message?.tool_calls) {
    for (const toolCall of choice.message.tool_calls) {
      if (toolCall.type === 'function') {
        functionCalls.push({
          name: toolCall.function.name,
          args: JSON.parse(toolCall.function.arguments || '{}')
        });
      }
    }
  }

  const newHistory: Content[] = [
    ...history,
    { role: 'user', parts: [{ text: userContent }] },
    { role: 'model', parts: [{ text: text || JSON.stringify(functionCalls) }] }
  ];

  return {
    text,
    thinking,
    functionCalls,
    newHistory,
    usage: data.usage ? {
      promptTokens: data.usage.prompt_tokens || 0,
      responseTokens: data.usage.completion_tokens || 0,
      totalTokens: data.usage.total_tokens || 0
    } : undefined
  };
}

// ============================================================================
// Main Handler
// ============================================================================

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { message, history = [], stateForLLM = '', provider = DEFAULT_PROVIDER } = await request.json();

    // Validate provider
    const validProviders: LLMProvider[] = ['gemini', 'claude-sonnet', 'claude-opus', 'grok'];
    const selectedProvider: LLMProvider = validProviders.includes(provider) ? provider : DEFAULT_PROVIDER;

    // Build content with state context
    const userContent = stateForLLM
      ? `${message}\n\nCurrent State:\n${stateForLLM}`
      : message;

    // Determine thinking level based on query complexity
    const thinkingLevel = getThinkingLevel(message);
    console.log(`[Chat API] Using ${PROVIDER_CONFIGS[selectedProvider].displayName}`);

    // Route to appropriate provider
    let result;
    switch (selectedProvider) {
      case 'claude-sonnet':
      case 'claude-opus':
        result = await callClaude(userContent, history, selectedProvider);
        break;
      case 'grok':
        result = await callGrok(userContent, history);
        break;
      case 'gemini':
      default:
        result = await callGemini(userContent, history, thinkingLevel);
        break;
    }

    return json({
      success: true,
      text: result.text,
      thinking: result.thinking,
      functionCalls: result.functionCalls.length > 0 ? result.functionCalls : undefined,
      history: result.newHistory,
      usage: result.usage,
      provider: selectedProvider,
      model: PROVIDER_CONFIGS[selectedProvider].model
    });
  } catch (error) {
    console.error('[Chat API] Error:', error);
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
};
