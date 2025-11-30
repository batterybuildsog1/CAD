/**
 * Gemini CAD Client - Core Integration for Antigravity CAD
 *
 * This module implements the Observable State Pattern for Gemini 3.0 Pro integration.
 * Key principles:
 * - Gemini must SEE what it creates, VERIFY accuracy, and ITERATE
 * - NORTH/SOUTH/EAST/WEST directions (not confusing X/Y/Z)
 * - Self-correction with rich context
 *
 * @see docs/GEMINI_INTEGRATION.md for architecture details
 *
 * SDK: @google/genai (NOT the deprecated @google/generative-ai)
 * Reference: https://github.com/googleapis/js-genai
 */

import {
  GoogleGenAI,
  Type,
  type Chat,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponse,
  type FunctionCall,
} from '@google/genai';
import type { ToolName, ToolCall, Point2D, RoomType } from './gemini-types';
import {
  type ObservableState as NewObservableState,
  type ConstraintStatus,
  createEmptyState,
  addRoomToState,
  addWallToState,
  setFootprintInState,
  setErrorState,
  formatStateForLLM,
  checkConstraints,
} from './observable-state';
import {
  SKILL_FUNCTION_DECLARATIONS,
  executeSkill,
  type SkillResult,
} from './cad-skills';
import {
  buildGoalOrientedPrompt as sharedBuildGoalOrientedPrompt,
  parseSelfVerification as sharedParseSelfVerification,
  type SelfVerificationReport,
} from './gemini-prompts';
import {
  type ValidationStatus,
  deriveValidationStatusFromLLMState,
  mergeValidationStatus,
  createEmptyValidationStatus,
} from './gemini-validation';

// Re-export ValidationStatus for backwards compatibility
export type { ValidationStatus } from './gemini-validation';



// ============================================================================
// CAD System Prompt
// ============================================================================

/**
 * System prompt that establishes Gemini as an expert CAD agent.
 * Uses NORTH/SOUTH/EAST/WEST directions for clarity.
 */
export const CAD_SYSTEM_PROMPT = `You are an expert residential architect for Antigravity CAD.

=== COORDINATE SYSTEM ===

Origin (0,0) is at the SOUTHWEST corner of the building footprint.
- X increases EASTWARD (right)
- Y increases NORTHWARD (up)
- Valid room positions: X in [0, footprint_width], Y in [0, footprint_depth]

After each operation, check the observable state (stateForLLM) for:
- Current footprint dimensions and remaining space
- Room positions and any warnings
- Use this context to make intelligent layout decisions

=== WORKFLOW ===

1. **Plan briefly**: What rooms are needed? Estimate footprint from room sizes + 20% circulation.
2. **Build shell**: Use skill_create_house_shell to create project + building + level + footprint in ONE call.
3. **Add rooms**: Position rooms within the footprint. The observable state shows remaining space.
4. **Review warnings**: The system shows warnings (not blocking errors) for overlaps, footprint exceedance, etc. Adjust if needed.

=== OBSERVABLE STATE ===

After each operation, you'll see state like:
\`\`\`
=== BUILDING FOOTPRINT ===
Size: 30' × 36'
Coordinates: (0,0) at SW corner, X→East [0-30], Y→North [0-36]
Remaining space: 800 sq ft (74% available)

=== ROOMS (2) ===
Living Room: 14' × 16' at (0, 0) - 224 sq ft
Kitchen: 12' × 12' at (14, 0) - 144 sq ft

=== WARNINGS ===
(none)
\`\`\`

Use this context to decide where to place the next room.

=== ROOM SIZING GUIDANCE ===

Typical sizes (feet):
- Living: 12×14 to 20×20 (168-400 sqft)
- Kitchen: 10×12 to 14×14 (120-196 sqft)
- Bedroom: 10×10 to 12×12 (100-144 sqft)
- Primary Bedroom: 12×14 to 16×16 (168-256 sqft)
- Bathroom: 5×8 (full), 5×5 (3/4), up to 10×12 (primary)
- Hallway: 3' to 4' wide

=== LAYOUT GUIDANCE ===

These are guidelines, not rules. Adjust based on user preferences and site constraints:
- Kitchen typically adjacent to living/dining
- Bathrooms accessible from bedrooms
- Entry often at north, private spaces (bedrooms) often toward south/back
- Excess space: prioritize expanding primary suite → kitchen → dining → living → bedrooms

=== TOOLS ===

**Compound skill (start here)**:
- skill_create_house_shell: Creates project + building + level + footprint in one call

**Room skills**:
- skill_create_rectangular_room: Generic room with position control
- skill_create_bedroom: Bedroom with optional closet
- skill_create_bathroom: Full/half/3-4 bath
- skill_create_kitchen: Kitchen with layout type

**Circulation**:
- skill_create_shaped_hallway: Straight, L-shaped, or T-junction corridors

**Planning**:
- skill_allocate_excess_space: Calculate optimal room upsizing when footprint > room minimums

=== DESIGN APPROACH ===

Make assumptions and start building. A house request means rooms, not just a shell.

Default for "create a house": ~1,000 sqft, 2 bedrooms, 1 bath, living room, kitchen.

Ask questions during design when real trade-offs arise, not upfront.`;


// ============================================================================
// Tool Declarations for @google/genai SDK
// ============================================================================

/**
 * CAD Tool declarations using the new @google/genai Type system.
 * These map to the Rhai API functions in geometry-core.
 */
export const CAD_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  // Project Tools
  {
    name: 'create_project',
    description: 'Create a new CAD project. This is the first step - all entities belong to a project. Returns ProjectId.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Project name (e.g., "Smith Residence")' },
        units: { type: Type.STRING, description: 'Unit system: "imperial" or "metric"' },
        code_region: { type: Type.STRING, description: 'Building code: "US_IRC_2021", "US_IBC_2021"' },
      },
      required: ['name', 'units', 'code_region'],
    },
  },
  {
    name: 'list_project_ids',
    description: 'List all project IDs in the current session.',
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: 'get_project_name',
    description: 'Get the name of a project by ID.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        project_id: { type: Type.STRING, description: 'Project ID from create_project' },
      },
      required: ['project_id'],
    },
  },

  // Building Tools
  {
    name: 'add_building',
    description: 'Add a building to a project. Requires ProjectId. Returns BuildingId.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        project_id: { type: Type.STRING, description: 'Project ID to add building to' },
        name: { type: Type.STRING, description: 'Building name (e.g., "Main House", "Garage")' },
      },
      required: ['project_id', 'name'],
    },
  },
  {
    name: 'get_building_name',
    description: 'Get the name of a building by ID.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        building_id: { type: Type.STRING, description: 'Building ID' },
      },
      required: ['building_id'],
    },
  },
  {
    name: 'get_building_levels',
    description: 'Get all level IDs for a building.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        building_id: { type: Type.STRING, description: 'Building ID' },
      },
      required: ['building_id'],
    },
  },
  {
    name: 'remove_building',
    description: 'Remove a building and all its contents. WARNING: Destructive.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        building_id: { type: Type.STRING, description: 'Building ID to remove' },
      },
      required: ['building_id'],
    },
  },

  // Level Tools
  {
    name: 'add_level',
    description: 'Add a floor level to a building. Requires BuildingId. Returns LevelId.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        building_id: { type: Type.STRING, description: 'Building ID' },
        name: { type: Type.STRING, description: 'Level name (e.g., "Ground Floor", "Level 2")' },
        elevation: { type: Type.NUMBER, description: 'Height above origin. Ground floor = 0' },
        floor_to_floor: { type: Type.NUMBER, description: 'Height to next floor (residential: 9-10ft, commercial: 12-14ft)' },
      },
      required: ['building_id', 'name', 'elevation', 'floor_to_floor'],
    },
  },
  {
    name: 'get_level_name',
    description: 'Get the name of a level.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
      },
      required: ['level_id'],
    },
  },
  {
    name: 'get_level_elevation',
    description: 'Get the elevation of a level.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
      },
      required: ['level_id'],
    },
  },
  {
    name: 'get_level_height',
    description: 'Get the floor-to-floor height of a level.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
      },
      required: ['level_id'],
    },
  },
  {
    name: 'remove_level',
    description: 'Remove a level and all its contents. WARNING: Destructive.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID to remove' },
      },
      required: ['level_id'],
    },
  },

  // Footprint Tools
  {
    name: 'set_level_footprint',
    description: 'Set floor plate boundary with custom polygon. Minimum 3 points.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        points: {
          type: Type.ARRAY,
          items: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          description: 'Array of [x, y] coordinate pairs defining polygon vertices',
        },
      },
      required: ['level_id', 'points'],
    },
  },
  {
    name: 'set_level_footprint_rect',
    description: 'Set floor plate as simple rectangle centered at origin.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        width: { type: Type.NUMBER, description: 'Width along X-axis (must be positive)' },
        depth: { type: Type.NUMBER, description: 'Depth along Y-axis (must be positive)' },
      },
      required: ['level_id', 'width', 'depth'],
    },
  },
  {
    name: 'get_footprint_area',
    description: 'Calculate footprint area in square project units.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
      },
      required: ['level_id'],
    },
  },
  {
    name: 'get_footprint_perimeter',
    description: 'Calculate footprint perimeter length.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
      },
      required: ['level_id'],
    },
  },
  {
    name: 'offset_footprint',
    description: 'Offset footprint inward (negative) or outward (positive).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        footprint_id: { type: Type.STRING, description: 'Footprint ID' },
        distance: { type: Type.NUMBER, description: 'Offset distance. Positive = expand, Negative = contract' },
      },
      required: ['footprint_id', 'distance'],
    },
  },

  // Grid Tools
  {
    name: 'create_grid',
    description: 'Initialize structural/planning grid for a building.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        building_id: { type: Type.STRING, description: 'Building ID' },
      },
      required: ['building_id'],
    },
  },
  {
    name: 'add_grid_axis',
    description: 'Add a grid line. Horizontal typically numbered (1,2,3), vertical lettered (A,B,C).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        building_id: { type: Type.STRING, description: 'Building ID' },
        name: { type: Type.STRING, description: 'Grid line name (e.g., "A", "1")' },
        direction: { type: Type.STRING, description: '"horizontal" or "vertical"' },
        offset: { type: Type.NUMBER, description: 'Position of grid line in project units' },
      },
      required: ['building_id', 'name', 'direction', 'offset'],
    },
  },

  // Wall Tools
  {
    name: 'create_wall_assembly',
    description: 'Create a wall type/template. Returns WallAssemblyId.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: 'Assembly name (e.g., "Exterior 2x6", "Interior Partition")' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_wall',
    description: 'Create a wall instance. Requires LevelId and WallAssemblyId. Returns WallId.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        assembly_id: { type: Type.STRING, description: 'Wall assembly ID' },
        start: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER },
          description: '[x, y] start point of wall centerline',
        },
        end: {
          type: Type.ARRAY,
          items: { type: Type.NUMBER },
          description: '[x, y] end point of wall centerline',
        },
        height: { type: Type.NUMBER, description: 'Wall height (typically matches floor_to_floor)' },
      },
      required: ['level_id', 'assembly_id', 'start', 'end', 'height'],
    },
  },
  {
    name: 'get_wall_assembly',
    description: 'Get the wall assembly ID used by a wall.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        wall_id: { type: Type.STRING, description: 'Wall ID' },
      },
      required: ['wall_id'],
    },
  },

  // Room Tools
  {
    name: 'create_room',
    description: 'Create a room space. Requires LevelId. Returns RoomId.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        level_id: { type: Type.STRING, description: 'Level ID' },
        room_type: {
          type: Type.STRING,
          description: 'Room type: living, kitchen, bedroom, bathroom, garage, utility, circulation, hallway, other',
        },
        name: { type: Type.STRING, description: 'Room display name (e.g., "Master Bedroom")' },
        points: {
          type: Type.ARRAY,
          items: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          description: 'Array of [x, y] pairs defining room boundary',
        },
      },
      required: ['level_id', 'room_type', 'name', 'points'],
    },
  },

  // Opening Tools
  {
    name: 'add_opening',
    description: 'Add door or window to a wall. Requires WallId. Returns OpeningId.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        wall_id: { type: Type.STRING, description: 'Wall ID' },
        opening_type: { type: Type.STRING, description: '"window" or "door"' },
        position: { type: Type.NUMBER, description: 'Position along wall (0.0 = start, 1.0 = end, 0.5 = center)' },
        width: { type: Type.NUMBER, description: 'Opening width (door: ~3ft, window: 2-6ft)' },
        height: { type: Type.NUMBER, description: 'Opening height (door: 6.67-8ft, window: 3-5ft)' },
        sill_height: { type: Type.NUMBER, description: 'Height from floor to opening bottom (door: 0, window: 2-4ft)' },
      },
      required: ['wall_id', 'opening_type', 'position', 'width', 'height', 'sill_height'],
    },
  },

  // User Interaction Tool
  {
    name: 'ask_user_question',
    description: `Ask the user a clarifying question or present a trade-off decision.

WHEN TO USE:
- Design trade-offs arise: "Should extra space go to master bedroom or kitchen?"
- User preferences unclear: "Open plan or separate kitchen?"
- Constraints conflict: "Lot is narrow - 2 stories or reduced sqft?"
- After starting work, not before: make assumptions, start building, then refine

WHEN NOT TO USE:
- Standard architectural decisions you can make professionally
- Technical details users wouldn't understand
- Every minor choice - be decisive, iterate if needed

The user's answer (or new message) will come back as your function response.
Generation will pause until the user responds.`,
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: {
          type: Type.STRING,
          description: 'The question to ask the user. Be specific and include context.',
        },
        options: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description: 'Suggested answers as clickable buttons (2-4 options). Optional but recommended.',
        },
        context: {
          type: Type.STRING,
          description: 'Brief explanation of why this matters for the design.',
        },
      },
      required: ['question'],
    },
  },

  // Query Tools
  {
    name: 'get_building_stats',
    description: 'Get building summary: total_area and level_count.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        building_id: { type: Type.STRING, description: 'Building ID' },
      },
      required: ['building_id'],
    },
  },
  {
    name: 'get_event_count',
    description: 'Get number of events in project history.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        project_id: { type: Type.STRING, description: 'Project ID' },
      },
      required: ['project_id'],
    },
  },
];

/**
 * All function declarations for Gemini - base tools + skills
 */
export const ALL_FUNCTION_DECLARATIONS: FunctionDeclaration[] = [
  ...CAD_FUNCTION_DECLARATIONS,
  ...SKILL_FUNCTION_DECLARATIONS,
];

// ============================================================================
// Observable State Interfaces
// ============================================================================

/** Entity counts across the CAD model (legacy - for backwards compatibility) */
export interface EntityCounts {
  projects: number;
  buildings: number;
  levels: number;
  walls: number;
  rooms: number;
  openings: number;
  footprints: number;
  grids: number;
  wallAssemblies: number;
}

/** Last operation tracking (legacy) */
export interface LastOperation {
  tool: ToolName;
  status: 'success' | 'error';
  result: unknown;
  timestamp: string;
}

// ValidationStatus is now imported from './gemini-validation' and re-exported

/** Legacy observable state - for backwards compatibility with api-tool-executor */
export interface ObservableState {
  timestamp: string;
  entities: EntityCounts;
  lastOperation: LastOperation | null;
  validationStatus: ValidationStatus;
  projectBounds: { min: [number, number, number]; max: [number, number, number] } | null;
}

// deriveValidationStatusFromLLMState and mergeValidationStatus are now imported from './gemini-validation'

/** Error details with recovery options */
export interface ErrorDetails {
  message: string;
  type: 'validation' | 'dependency' | 'constraint' | 'not_found' | 'internal';
  recoveryOptions: string[];
  constraints?: Record<string, { min?: number; max?: number; unit?: string }>;
}

/** Rich tool result with full observability */
export interface ObservableToolResult {
  status: 'success' | 'error';
  data?: unknown;
  error?: ErrorDetails;
  /** Legacy state for backwards compatibility */
  observableState: ObservableState;
  /** New LLM-friendly state with N/S/E/W directions */
  llmState?: NewObservableState;
  /** Human-readable state summary for Gemini */
  stateForLLM?: string;
  whatChanged: string;
  nextOptions: string[];
}

/** Generation result with history and self-verification */
export interface GenerationResult {
  success: boolean;
  finalResponse: string;
  toolCallHistory: Array<{ call: ToolCall; result: ObservableToolResult }>;
  checkpointReports: string[];
  selfVerification?: {
    requirementsMet: 'YES' | 'NO' | 'PARTIAL';
    validationStatus: 'PASSED' | 'FAILED' | 'WARNINGS';
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
    recommendation: 'Proceed' | 'Revise' | 'Request Clarification';
  };
  /** Gemini thinking summaries from each API call */
  thinkingOutputs?: string[];
  /** Token usage tracking */
  tokenUsage?: {
    steps: Array<{
      promptTokens: number;
      responseTokens: number;
      totalTokens: number;
    }>;
    cumulative: {
      promptTokens: number;
      responseTokens: number;
      totalTokens: number;
    };
  };
}

// ============================================================================
// Tool Executor Interface
// ============================================================================

/** Interface for executing CAD tool calls against the geometry engine */
export interface CADToolExecutor {
  execute(toolCall: ToolCall): Promise<{ success: boolean; data?: unknown; error?: string }>;
  getState(): ObservableState;
  validate(): ValidationStatus;
}

// ============================================================================
// GeminiCADClient Class
// ============================================================================

/**
 * Main client for Gemini CAD integration.
 *
 * Uses @google/genai SDK (NOT deprecated @google/generative-ai)
 *
 * Implements:
 * - Observable State Pattern (rich feedback after every operation)
 * - Informed Self-Correction (context-aware error handling)
 * - Checkpoint-based execution (goal-oriented prompts)
 *
 * @example
 * ```typescript
 * const client = new GeminiCADClient(apiKey, toolExecutor);
 * const result = await client.generateWithFeedback(
 *   "Create a 5m x 4m room",
 *   ["Four walls forming closed rectangle", "All walls 3m height", "Validation passes"]
 * );
 * ```
 */
export class GeminiCADClient {
  private ai: GoogleGenAI;
  private toolExecutor: CADToolExecutor;
  private chat: Chat | null = null;
  private toolCallHistory: Array<{ call: ToolCall; result: ObservableToolResult }> = [];
  /** New LLM-friendly observable state with N/S/E/W directions */
  private llmState: NewObservableState;

  /**
   * Create a new GeminiCADClient
   *
   * @param apiKey - Google AI API key
   * @param toolExecutor - Implementation that executes tool calls against CAD engine
   */
  constructor(apiKey: string, toolExecutor: CADToolExecutor) {
    this.ai = new GoogleGenAI({ apiKey });
    this.toolExecutor = toolExecutor;
    this.llmState = createEmptyState();
  }

  /**
   * Execute a tool call and return observable result with full state visibility.
   * Handles both base CAD tools and high-level skills.
   */
  async executeToolCall(toolCall: ToolCall): Promise<ObservableToolResult> {
    const startTime = new Date().toISOString();

    // Check if this is a skill call (skills start with "skill_")
    if (toolCall.name.startsWith('skill_')) {
      return this.executeSkillCall(toolCall, startTime);
    }

    // Pre-validate the tool call
    const preValidation = this.preValidateToolCall(toolCall);
    if (!preValidation.valid) {
      return this.buildErrorResult(
        toolCall,
        {
          message: preValidation.error!,
          type: 'validation',
          recoveryOptions: preValidation.suggestions || ['Review parameters and try again'],
        },
        startTime
      );
    }

    // Execute against CAD engine
    try {
      const executionResult = await this.toolExecutor.execute(toolCall);

      if (executionResult.success) {
        return this.buildSuccessResult(toolCall, executionResult.data, startTime);
      } else {
        return this.buildErrorResult(
          toolCall,
          {
            message: executionResult.error || 'Unknown error',
            type: this.classifyError(executionResult.error || ''),
            recoveryOptions: this.suggestRecoveryOptions(toolCall, executionResult.error || ''),
          },
          startTime
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return this.buildErrorResult(
        toolCall,
        {
          message: errorMessage,
          type: 'internal',
          recoveryOptions: ['Check system status', 'Retry operation', 'Request clarification'],
        },
        startTime
      );
    }
  }

  /**
   * Execute a skill call. Skills are processed locally and may generate
   * multiple tool calls that get executed against the CAD engine.
   *
   * Routes to appropriate executor:
   * - Base skills (cad-skills.ts): skill_create_rectangular_room, skill_create_hallway, etc.
   * - Circulation Expert: skill_create_entry_expert, skill_create_hallway_expert, etc.
   * - Room Layout Expert: skill_create_open_plan_expert, skill_create_bedroom_expert, etc.
   */
  private async executeSkillCall(skillCall: ToolCall, startTime: string): Promise<ObservableToolResult> {
    // Execute base skill directly
    const skillResult = executeSkill(
      skillCall.name,
      skillCall.args,
      this.llmState
    );

    if (!skillResult.success) {
      return this.buildErrorResult(
        skillCall,
        {
          message: skillResult.error || skillResult.message,
          type: 'validation',
          recoveryOptions: ['Check skill parameters', 'Review observable state for context'],
        },
        startTime
      );
    }

    // If skill generates no tool calls (like plan_layout), return advisory result
    if (skillResult.toolCalls.length === 0) {
      // This is an advisory skill (like layout planning)
      const state = this.toolExecutor.getState();

      // Update llmState with skill result
      this.llmState = {
        ...this.llmState,
        lastAction: {
          tool: skillCall.name,
          params: skillCall.args,
          result: 'success',
          message: skillResult.message,
        },
      };

      const engineStatus = state.validationStatus;
      const constraintStatus = deriveValidationStatusFromLLMState(this.llmState);
      const mergedStatus = mergeValidationStatus(engineStatus, constraintStatus);

      return {
        status: 'success',
        data: skillResult.data,
        observableState: {
          ...state,
          timestamp: startTime,
          lastOperation: { tool: skillCall.name, status: 'success', result: skillResult.data, timestamp: startTime },
          validationStatus: mergedStatus,
        },
        llmState: this.llmState,
        stateForLLM: formatStateForLLM(this.llmState),
        whatChanged: skillResult.message,
        nextOptions: ['Use planned positions to create rooms with skill_create_rectangular_room'],
      };
    }

    // Execute the generated tool calls
    let lastResult: ObservableToolResult | null = null;
    for (const generatedCall of skillResult.toolCalls) {
      // Execute each tool call
      const result = await this.toolExecutor.execute(generatedCall);

      if (!result.success) {
        return this.buildErrorResult(
          skillCall,
          {
            message: result.error || 'Tool execution failed',
            type: this.classifyError(result.error || ''),
            recoveryOptions: this.suggestRecoveryOptions(generatedCall, result.error || ''),
          },
          startTime
        );
      }

      // Update state based on the generated tool call
      lastResult = this.buildSuccessResult(generatedCall, result.data, startTime);
    }

    // Return the final result with skill-level message
    if (lastResult) {
      return {
        ...lastResult,
        whatChanged: skillResult.message,
        data: skillResult.data,
      };
    }

    // Shouldn't reach here, but just in case
    return this.buildSuccessResult(skillCall, skillResult.data, startTime);
  }

  /**
   * Generate CAD operations with feedback loop and success criteria verification.
   *
   * @param prompt - Natural language request
   * @param successCriteria - Array of criteria to verify
   * @param maxIterations - Maximum tool call iterations (default: 20)
   */
  async generateWithFeedback(
    prompt: string,
    successCriteria: string[],
    maxIterations: number = 20
  ): Promise<GenerationResult> {
    // Reset state for new generation
    this.toolCallHistory = [];
    this.llmState = createEmptyState();
    const checkpointReports: string[] = [];

    // Build goal-oriented prompt
    const goalPrompt = this.buildGoalOrientedPrompt(prompt, successCriteria);

    // Create chat session using new SDK pattern
    // Configuration per docs/GEMINI_INTEGRATION.md:
    // - temperature: 1.0 (always - allows architectural creativity with thinking)
    // - thinkingConfig: always enabled for complex CAD reasoning
    this.chat = this.ai.chats.create({
      model: 'gemini-3-pro-preview',
      config: {
        systemInstruction: CAD_SYSTEM_PROMPT,
        tools: [{ functionDeclarations: ALL_FUNCTION_DECLARATIONS }],
        temperature: 1.0,
        thinkingConfig: { thinkingBudget: 32768 },
      },
    });

    let currentIteration = 0;
    let finalResponse = '';
    const conversationHistory: Content[] = [];

    try {
      // Initial message
      let response = await this.chat.sendMessage({ message: goalPrompt });

      while (currentIteration < maxIterations) {
        currentIteration++;

        // Check for function calls using new SDK pattern
        const functionCalls = response.functionCalls;

        if (!functionCalls || functionCalls.length === 0) {
          // No more tool calls - model has finished
          finalResponse = response.text || '';
          break;
        }

        // Execute each function call and collect results
        const functionResponses: Array<{ name: string; response: unknown }> = [];

        for (const funcCall of functionCalls) {
          // Skip if no name (shouldn't happen but TypeScript needs this)
          if (!funcCall.name) continue;

          const toolCall: ToolCall = {
            name: funcCall.name as ToolName,
            args: (funcCall.args || {}) as Record<string, unknown>,
          };

          // Execute with observability
          const result = await this.executeToolCall(toolCall);
          this.toolCallHistory.push({ call: toolCall, result });

          // Build function response for SDK - cast result to Record for SDK compatibility
          functionResponses.push({
            name: funcCall.name,
            response: result as unknown as Record<string, unknown>,
          });

          // Track checkpoint if validation warnings
          if (result.observableState.validationStatus.warnings.length > 0) {
            checkpointReports.push(
              `Checkpoint ${currentIteration}: ${toolCall.name} - Warnings: ${result.observableState.validationStatus.warnings.join(', ')}`
            );
          }
        }

        // Send function responses back using SDK pattern
        // Use 'any' cast to work around SDK type limitations
        response = await this.chat.sendMessage({
          message: functionResponses.map((fr) => ({
            functionResponse: fr,
          })) as any,
        });
      }

      // Parse self-verification from final response
      const selfVerification = this.parseSelfVerification(finalResponse);

      return {
        success:
          selfVerification?.requirementsMet === 'YES' ||
          this.toolCallHistory.every((h) => h.result.status === 'success'),
        finalResponse,
        toolCallHistory: this.toolCallHistory,
        checkpointReports,
        selfVerification,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        finalResponse: `Generation failed: ${errorMessage}`,
        toolCallHistory: this.toolCallHistory,
        checkpointReports,
      };
    }
  }

  /** Build the current observable state from the CAD engine */
  buildObservableState(): ObservableState {
    return this.toolExecutor.getState();
  }

  /** Get the LLM-friendly observable state */
  getLLMState(): NewObservableState {
    return this.llmState;
  }

  /** Update the LLM-friendly state based on tool execution */
  private updateLLMState(toolCall: ToolCall, data: unknown, status: 'success' | 'error'): void {
    const args = toolCall.args;

    // Update last action
    const whatCreated = typeof data === 'string' ? { type: toolCall.name.replace('create_', '').replace('add_', ''), id: data } : undefined;

    this.llmState = {
      ...this.llmState,
      lastAction: {
        tool: toolCall.name,
        params: args,
        result: status,
        message: status === 'success'
          ? this.describeChange(toolCall, data)
          : 'Operation failed',
        created: whatCreated,
      },
      context: {
        ...this.llmState.context,
        // Track project context as we create things
        ...(toolCall.name === 'create_project' && typeof data === 'string' ? { projectId: data } : {}),
        ...(args.project_id ? { projectId: args.project_id as string } : {}),
        ...(toolCall.name === 'add_building' && typeof data === 'string' ? { buildingId: data } : {}),
        ...(args.building_id ? { buildingId: args.building_id as string } : {}),
        ...(toolCall.name === 'add_level' && typeof data === 'string' ? { levelId: data } : {}),
        ...(args.level_id ? { levelId: args.level_id as string } : {}),
        ...(args.units ? { units: args.units as 'imperial' | 'metric' } : {}),
      },
    };

    // Handle specific tool types that affect rooms/walls
    if (status === 'success') {
      switch (toolCall.name) {
        case 'create_room':
          if (typeof data === 'string' && args.name && args.room_type && args.points) {
            this.llmState = addRoomToState(
              this.llmState,
              data,
              args.name as string,
              args.room_type as RoomType,
              args.points as Point2D[]
            );
          }
          break;

        case 'create_wall':
          if (typeof data === 'string' && args.start && args.end && args.height) {
            this.llmState = addWallToState(
              this.llmState,
              data,
              args.start as Point2D,
              args.end as Point2D,
              args.height as number,
              false, // isStructural - would need more info
              false  // isExterior - would need more info
            );
          }
          break;

        case 'set_level_footprint_rect':
          // Critical: Update footprint so Gemini knows the building bounds
          if (args.width && args.depth) {
            this.llmState = setFootprintInState(
              this.llmState,
              args.width as number,
              args.depth as number
            );
          }
          break;

        // Other tools that don't affect rooms/walls just update lastAction above
      }
    }
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Pre-validate tool call dependencies before execution.
   *
   * This applies only to RAW TOOL CALLS from Gemini, not skills.
   * Skills bypass this check because they internally generate valid sequences.
   *
   * @see cad-skills.ts module docs for explanation of this design decision
   */
  private preValidateToolCall(toolCall: ToolCall): { valid: boolean; error?: string; suggestions?: string[] } {
    const dependencyRules: Record<string, { requires: string[]; suggestion: string }> = {
      add_building: { requires: ['create_project'], suggestion: 'Create a project first with create_project' },
      add_level: { requires: ['add_building'], suggestion: 'Create a building first with add_building' },
      set_level_footprint: { requires: ['add_level'], suggestion: 'Create a level first with add_level' },
      set_level_footprint_rect: { requires: ['add_level'], suggestion: 'Create a level first with add_level' },
      create_wall: {
        requires: ['add_level', 'create_wall_assembly'],
        suggestion: 'Create a level and wall assembly first',
      },
      add_opening: { requires: ['create_wall'], suggestion: 'Create a wall first with create_wall' },
      create_room: { requires: ['add_level'], suggestion: 'Create a level first with add_level' },
      add_grid_axis: { requires: ['create_grid'], suggestion: 'Create a grid first with create_grid' },
    };

    const rule = dependencyRules[toolCall.name];
    if (rule) {
      const previousTools = this.toolCallHistory.map((h) => h.call.name);
      const missingDeps = rule.requires.filter((dep) => !previousTools.includes(dep as ToolName));

      if (missingDeps.length > 0 && this.toolCallHistory.length > 0) {
        return {
          valid: false,
          error: `Missing dependencies: ${missingDeps.join(', ')}`,
          suggestions: [rule.suggestion],
        };
      }
    }

    return { valid: true };
  }

  private buildSuccessResult(toolCall: ToolCall, data: unknown, timestamp: string): ObservableToolResult {
    // First update LLM-friendly state so constraints are up to date
    this.updateLLMState(toolCall, data, 'success');

    // Then snapshot the current geometry engine state
    const state = this.toolExecutor.getState();

    // Merge engine validation with constraint-based validation from llmState
    const engineStatus = state.validationStatus;
    const constraintStatus = deriveValidationStatusFromLLMState(this.llmState);
    const mergedStatus = mergeValidationStatus(engineStatus, constraintStatus);

    return {
      status: 'success',
      data,
      observableState: {
        ...state,
        timestamp,
        lastOperation: { tool: toolCall.name, status: 'success', result: data, timestamp },
        validationStatus: mergedStatus,
      },
      llmState: this.llmState,
      stateForLLM: formatStateForLLM(this.llmState),
      whatChanged: this.describeChange(toolCall, data),
      nextOptions: this.suggestNextOptions(toolCall),
    };
  }

  private buildErrorResult(toolCall: ToolCall, error: ErrorDetails, timestamp: string): ObservableToolResult {
    const state = this.toolExecutor.getState();

    // Update LLM-friendly state with error
    this.llmState = setErrorState(
      this.llmState,
      toolCall.name,
      toolCall.args,
      error.message,
      error.recoveryOptions
    );

    // Merge engine validation with constraint-based validation from llmState
    const engineStatus = state.validationStatus;
    const constraintStatus = deriveValidationStatusFromLLMState(this.llmState);
    const mergedStatus = mergeValidationStatus(engineStatus, constraintStatus);

    return {
      status: 'error',
      error,
      observableState: {
        ...state,
        timestamp,
        lastOperation: { tool: toolCall.name, status: 'error', result: error.message, timestamp },
        validationStatus: mergedStatus,
      },
      llmState: this.llmState,
      stateForLLM: formatStateForLLM(this.llmState),
      whatChanged: 'No changes made due to error',
      nextOptions: error.recoveryOptions,
    };
  }

  private classifyError(error: string): ErrorDetails['type'] {
    const lowerError = error.toLowerCase();
    if (lowerError.includes('not found') || lowerError.includes('does not exist')) return 'not_found';
    if (lowerError.includes('constraint') || lowerError.includes('out of range') || lowerError.includes('invalid'))
      return 'constraint';
    if (lowerError.includes('dependency') || lowerError.includes('requires') || lowerError.includes('must exist'))
      return 'dependency';
    if (lowerError.includes('validation') || lowerError.includes('geometry')) return 'validation';
    return 'internal';
  }

  private suggestRecoveryOptions(toolCall: ToolCall, error: string): string[] {
    const options: string[] = [];
    const errorType = this.classifyError(error);

    switch (errorType) {
      case 'not_found':
        options.push('Verify the ID exists: Use list_project_ids or get_building_levels to check');
        options.push('Create the missing entity first');
        break;
      case 'constraint':
        options.push('Adjust parameters to be within valid ranges');
        options.push('Check units (imperial uses feet, metric uses meters)');
        break;
      case 'dependency':
        options.push('Create required parent entities first');
        options.push('Follow dependency order: Project -> Building -> Level -> Walls/Rooms');
        break;
      case 'validation':
        options.push('Check geometry for self-intersections or invalid shapes');
        options.push('Ensure polygon points form a valid closed shape');
        break;
      default:
        options.push('Review the parameters and try again');
        options.push('Request clarification from user');
    }

    return options;
  }

  private describeChange(toolCall: ToolCall, data: unknown): string {
    const descriptions: Record<string, (d: unknown) => string> = {
      create_project: (d) => `Created project with ID: ${d}`,
      add_building: (d) => `Added building with ID: ${d}`,
      add_level: (d) => `Added level with ID: ${d}`,
      set_level_footprint: (d) => `Set footprint with ID: ${d}`,
      set_level_footprint_rect: (d) => `Set rectangular footprint with ID: ${d}`,
      create_wall_assembly: (d) => `Created wall assembly with ID: ${d}`,
      create_wall: (d) => `Created wall with ID: ${d}`,
      add_opening: (d) => `Added opening with ID: ${d}`,
      create_room: (d) => `Created room with ID: ${d}`,
      create_grid: () => 'Initialized grid system',
      add_grid_axis: () => 'Added grid axis',
      remove_building: () => 'Removed building and all contents',
      remove_level: () => 'Removed level and all contents',
    };

    const describer = descriptions[toolCall.name];
    return describer ? describer(data) : `Executed ${toolCall.name}`;
  }

  private suggestNextOptions(toolCall: ToolCall): string[] {
    const nextOptionsMap: Record<string, string[]> = {
      create_project: ['add_building - Add a building to the project'],
      add_building: ['add_level - Add floor levels', 'create_grid - Set up structural grid'],
      add_level: ['set_level_footprint_rect - Define floor plate', 'create_wall_assembly - Define wall types'],
      set_level_footprint: ['create_wall - Add walls', 'create_room - Define rooms'],
      set_level_footprint_rect: ['create_wall - Add walls', 'create_room - Define rooms'],
      create_wall_assembly: ['create_wall - Create walls using this assembly'],
      create_wall: ['add_opening - Add doors/windows', 'create_wall - Add more walls', 'create_room - Define rooms'],
      add_opening: ['add_opening - Add more openings', 'create_wall - Continue with walls'],
      create_room: ['create_room - Add more rooms', 'get_building_stats - Review progress'],
      create_grid: ['add_grid_axis - Add grid lines'],
      add_grid_axis: ['add_grid_axis - Add more grid lines', 'create_wall - Place walls on grid'],
    };

    return nextOptionsMap[toolCall.name] || ['Continue with next operation', 'Validate current state'];
  }

  // Use shared utilities from gemini-prompts.ts to avoid code drift
  private buildGoalOrientedPrompt(prompt: string, successCriteria: string[]): string {
    return sharedBuildGoalOrientedPrompt(prompt, successCriteria);
  }

  private parseSelfVerification(response: string): GenerationResult['selfVerification'] | undefined {
    return sharedParseSelfVerification(response);
  }


}

// ============================================================================
// Factory Functions
// ============================================================================

/** Create a GeminiCADClient with the given API key and tool executor */
export function createGeminiCADClient(apiKey: string, toolExecutor: CADToolExecutor): GeminiCADClient {
  return new GeminiCADClient(apiKey, toolExecutor);
}

/** Create a mock tool executor for testing */
export function createMockToolExecutor(): CADToolExecutor {
  const state: ObservableState = {
    timestamp: new Date().toISOString(),
    entities: {
      projects: 0,
      buildings: 0,
      levels: 0,
      walls: 0,
      rooms: 0,
      openings: 0,
      footprints: 0,
      grids: 0,
      wallAssemblies: 0,
    },
    lastOperation: null,
    validationStatus: { geometryValid: true, warnings: [], errors: [] },
    projectBounds: null,
  };

  let idCounter = 0;

  return {
    async execute(toolCall: ToolCall) {
      idCounter++;
      const id = `${toolCall.name}_${idCounter}`;

      const entityUpdates: Record<string, keyof EntityCounts> = {
        create_project: 'projects',
        add_building: 'buildings',
        add_level: 'levels',
        create_wall: 'walls',
        create_room: 'rooms',
        add_opening: 'openings',
        set_level_footprint: 'footprints',
        set_level_footprint_rect: 'footprints',
        create_grid: 'grids',
        create_wall_assembly: 'wallAssemblies',
      };

      const entityKey = entityUpdates[toolCall.name];
      if (entityKey) {
        state.entities[entityKey]++;
      }

      return { success: true, data: id };
    },

    getState() {
      return { ...state, timestamp: new Date().toISOString() };
    },

    validate() {
      return state.validationStatus;
    },
  };
}
