/**
 * useGeminiCAD - Client-side Gemini CAD Hook with WASM Execution
 *
 * This hook implements the hybrid architecture:
 * - Gemini API calls go through server proxy (API key secure)
 * - Tool execution happens locally via WASM (zero latency)
 * - WasmStore is shared with 3D renderer (instant visual updates)
 *
 * Usage:
 * ```tsx
 * const { generate, store, loading, error, result, levelIds } = useGeminiCAD();
 *
 * // Generate CAD from prompt
 * await generate("Create a 20x20 room");
 *
 * // Use levelIds in Viewer3D
 * <Viewer3D levelIds={levelIds} />
 * ```
 *
 * @see docs/GEMINI_INTEGRATION.md
 */

'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Content } from '@google/genai';
import { getClientLogger, generateRequestId, getSessionHeaders } from '@/lib/logger';
import type {
  ObservableToolResult,
  GenerationResult,
  ObservableState,
  CADToolExecutor,
} from '@/lib/gemini-cad';
import {
  type ValidationStatus,
  deriveValidationStatusFromLLMState,
  createEmptyValidationStatus,
} from '@/lib/gemini-validation';
import type { ToolCall, ToolName } from '@/lib/gemini-types';
import { getWasmStore, resetWasmStore, type WasmStore } from '@/lib/wasm-loader';
import {
  type ObservableState as NewObservableState,
  createEmptyState,
  addRoomToState,
  addWallToState,
  setErrorState,
  formatStateForLLM,
} from '@/lib/observable-state';
import type { Point2D, RoomType } from '@/lib/gemini-types';
import { executeSkill } from '@/lib/cad-skills';
import {
  buildGoalOrientedPrompt,
  parseSelfVerification,
  isGenerationSuccessful,
  DEFAULT_SUCCESS_CRITERIA,
} from '@/lib/gemini-prompts';

// ============================================================================
// Types
// ============================================================================

interface TokenUsage {
  promptTokens: number;
  responseTokens: number;
  totalTokens: number;
}

/** Pending question from Gemini awaiting user response */
interface PendingQuestion {
  question: string;
  options?: string[];
  context?: string;
  /** The thoughtSignature needed to resume the conversation */
  thoughtSignature?: string;
}

interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

interface ChatResponse {
  success: boolean;
  text?: string;
  functionCalls?: FunctionCall[];
  history?: Content[];
  error?: string;
  thinking?: string;
  usage?: TokenUsage;
}

interface UseGeminiCADResult {
  /** Generate CAD from natural language prompt */
  generate: (prompt: string, successCriteria?: string[]) => Promise<GenerationResult>;
  /** Continue generation with user's answer to a pending question */
  continueWithAnswer: (answer: string) => Promise<GenerationResult>;
  /** The shared WASM store (null until initialized) */
  store: WasmStore | null;
  /** Whether WASM is initializing */
  wasmLoading: boolean;
  /** Whether a generation is in progress */
  generating: boolean;
  /** Last generation result */
  result: GenerationResult | null;
  /** Last error message */
  error: string | null;
  /** All level IDs created (for Viewer3D) */
  levelIds: string[];
  /** Pending question from Gemini awaiting user response */
  pendingQuestion: PendingQuestion | null;
  /** Reset the store and clear all state */
  reset: () => Promise<void>;
  /** Cancel in-progress generation */
  cancel: () => void;
}

// ============================================================================
// Tool Handlers (Client-side WASM Execution)
// ============================================================================

type ToolHandler = (
  store: WasmStore,
  args: Record<string, unknown>
) => { success: boolean; data?: unknown; error?: string };

const toolHandlers: Partial<Record<ToolName, ToolHandler>> = {
  create_project: (store, args) => {
    try {
      const id = store.create_project(args.name as string);
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  add_building: (store, args) => {
    try {
      const id = store.add_building(args.project_id as string, args.name as string);
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  add_level: (store, args) => {
    try {
      const id = store.add_level(
        args.building_id as string,
        args.name as string,
        args.elevation as number,
        args.floor_to_floor as number
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  set_level_footprint: (store, args) => {
    try {
      const id = store.set_level_footprint(args.level_id as string, args.points as number[][]);
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  set_level_footprint_rect: (store, args) => {
    try {
      const id = store.set_level_footprint_rect(
        args.level_id as string,
        args.width as number,
        args.depth as number
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  create_wall_assembly: (store, args) => {
    try {
      const id = store.create_wall_assembly(args.name as string);
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  create_wall: (store, args) => {
    try {
      const id = store.create_wall(
        args.level_id as string,
        args.assembly_id as string,
        args.start as number[],
        args.end as number[],
        args.height as number
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  create_room: (store, args) => {
    try {
      const id = store.create_room(
        args.level_id as string,
        args.room_type as string,
        args.name as string,
        args.points as number[][]
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // Query tools
  get_project_name: (store, args) => {
    try {
      const name = store.get_project_name(args.project_id as string);
      return { success: true, data: name };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  list_project_ids: (store) => {
    try {
      const ids = store.list_project_ids();
      return { success: true, data: Array.from(ids) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_building_name: (store, args) => {
    try {
      const name = store.get_building_name(args.building_id as string);
      return { success: true, data: name };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_building_levels: (store, args) => {
    try {
      const levels = store.get_building_levels(args.building_id as string);
      return { success: true, data: Array.from(levels) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_building_stats: (store, args) => {
    try {
      const stats = store.get_building_stats(args.building_id as string);
      return { success: true, data: stats };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_level_name: (store, args) => {
    try {
      const name = store.get_level_name(args.level_id as string);
      return { success: true, data: name };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_level_elevation: (store, args) => {
    try {
      const elevation = store.get_level_elevation(args.level_id as string);
      return { success: true, data: elevation };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_level_height: (store, args) => {
    try {
      const height = store.get_level_height(args.level_id as string);
      return { success: true, data: height };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_footprint_area: (store, args) => {
    try {
      const area = store.get_footprint_area(args.level_id as string);
      return { success: true, data: area };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_footprint_perimeter: (store, args) => {
    try {
      const perimeter = store.get_footprint_perimeter(args.level_id as string);
      return { success: true, data: perimeter };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_wall_assembly: (store, args) => {
    try {
      const assemblyId = store.get_wall_assembly(args.wall_id as string);
      return { success: true, data: assemblyId };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_event_count: (store, args) => {
    try {
      const count = store.get_event_count(args.project_id as string);
      return { success: true, data: count };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  get_wall_openings: (store, args) => {
    try {
      const openings = store.get_wall_openings(args.wall_id as string);
      return { success: true, data: Array.from(openings) };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // Delete tools
  remove_building: (store, args) => {
    try {
      store.remove_building(args.building_id as string);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  remove_level: (store, args) => {
    try {
      store.remove_level(args.level_id as string);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  remove_wall: (store, args) => {
    try {
      store.remove_wall(args.wall_id as string);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  remove_opening: (store, args) => {
    try {
      store.remove_opening(args.opening_id as string);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  offset_footprint: (store, args) => {
    try {
      store.offset_footprint(args.footprint_id as string, args.distance as number);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // Grid tools
  create_grid: (store, args) => {
    try {
      store.create_grid(args.building_id as string);
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  add_grid_axis: (store, args) => {
    try {
      store.add_grid_axis(
        args.building_id as string,
        args.name as string,
        args.direction as string,
        args.offset as number
      );
      return { success: true, data: null };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },

  // Opening tools
  add_opening: (store, args) => {
    try {
      const id = store.add_opening(
        args.wall_id as string,
        args.opening_type as string,
        args.position as number,
        args.width as number,
        args.height as number,
        args.sill_height as number
      );
      return { success: true, data: id };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  },
};

// ============================================================================
// Hook Implementation
// ============================================================================

export function useGeminiCAD(): UseGeminiCADResult {
  const [store, setStore] = useState<WasmStore | null>(null);
  const [wasmLoading, setWasmLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [levelIds, setLevelIds] = useState<string[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);

  // LLM state for observable pattern
  const llmStateRef = useRef<NewObservableState>(createEmptyState());
  const toolCallHistoryRef = useRef<Array<{ call: ToolCall; result: ObservableToolResult }>>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const thinkingOutputsRef = useRef<string[]>([]);
  const tokenUsageRef = useRef<{
    steps: TokenUsage[];
    cumulative: TokenUsage;
  }>({
    steps: [],
    cumulative: { promptTokens: 0, responseTokens: 0, totalTokens: 0 },
  });

  // Preserved conversation state for continuing after user answers
  const preservedHistoryRef = useRef<Content[]>([]);
  const checkpointReportsRef = useRef<string[]>([]);

  // Initialize WASM store on mount
  useEffect(() => {
    let mounted = true;
    const logger = getClientLogger();
    const startTime = performance.now();

    logger.info('wasm', 'init_start', 'Initializing WASM store');

    getWasmStore()
      .then((s) => {
        if (mounted) {
          const durationMs = performance.now() - startTime;
          logger.info('wasm', 'init_success', 'WASM store initialized', { durationMs });
          setStore(s);
          setWasmLoading(false);
        }
      })
      .catch((e) => {
        if (mounted) {
          const durationMs = performance.now() - startTime;
          const errorMsg = e instanceof Error ? e.message : 'Failed to load WASM';
          logger.error('wasm', 'init_failed', 'WASM initialization failed', e instanceof Error ? e : undefined, { durationMs });
          setError(errorMsg);
          setWasmLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  // Execute a single tool call locally via WASM
  const executeToolCall = useCallback(
    (toolCall: ToolCall): ObservableToolResult => {
      const logger = getClientLogger();
      const startTime = performance.now();

      if (!store) {
        logger.error('tool', 'execute_failed', `Tool ${toolCall.name} failed: WASM store not initialized`);
        return buildErrorResult(toolCall, 'WASM store not initialized', llmStateRef.current, null);
      }

      logger.debug('tool', 'execute_start', `Executing tool: ${toolCall.name}`, { args: toolCall.args });

      // Handle skill calls
      if (toolCall.name.startsWith('skill_')) {
        const skillResult = executeSkill(toolCall.name, toolCall.args, llmStateRef.current);

        if (!skillResult.success) {
          return buildErrorResult(toolCall, skillResult.error || skillResult.message, llmStateRef.current, store);
        }

        // If skill generates tool calls, execute them
        if (skillResult.toolCalls.length > 0) {
          let lastResult: ObservableToolResult | null = null;

          // Track IDs returned from each tool call for placeholder resolution
          // Skills use placeholders like '${project_id}' that need to be resolved
          const resolvedIds: Record<string, string> = {};

          // Execute generated tool calls in sequence so WASM + LLM state stay in sync
          for (const generatedCall of skillResult.toolCalls) {
            const handler = toolHandlers[generatedCall.name];
            if (!handler) {
              return buildErrorResult(generatedCall, `No handler for ${generatedCall.name}`, llmStateRef.current, store);
            }

            // Resolve placeholder IDs in args before execution
            const resolvedArgs = resolvePlaceholders(generatedCall.args, resolvedIds);

            const execResult = handler(store, resolvedArgs);
            if (!execResult.success) {
              return buildErrorResult(
                { ...generatedCall, args: resolvedArgs },
                execResult.error || 'Unknown error',
                llmStateRef.current,
                store
              );
            }

            // Track returned IDs for subsequent placeholder resolution
            if (typeof execResult.data === 'string') {
              switch (generatedCall.name) {
                case 'create_project':
                  resolvedIds['project_id'] = execResult.data;
                  break;
                case 'add_building':
                  resolvedIds['building_id'] = execResult.data;
                  break;
                case 'add_level':
                  resolvedIds['level_id'] = execResult.data;
                  // Note: We DON'T add to levelIds here - wait until footprint is set
                  break;
                case 'create_wall_assembly':
                  resolvedIds['assembly_id'] = execResult.data;
                  break;
                case 'set_level_footprint':
                case 'set_level_footprint_rect':
                  resolvedIds['footprint_id'] = execResult.data;
                  // NOW we can track the level for rendering (footprint exists)
                  if (typeof resolvedArgs.level_id === 'string') {
                    const levelId = resolvedArgs.level_id;
                    setLevelIds((prev) => {
                      if (prev.includes(levelId)) return prev;
                      console.log('[useGeminiCAD] Level now renderable via skill (footprint set):', levelId);
                      return [...prev, levelId];
                    });
                  }
                  break;
              }
            }

            // Keep LLM observable state up to date for each underlying tool call
            updateLLMState({ ...generatedCall, args: resolvedArgs }, execResult.data, llmStateRef);

            lastResult = buildSuccessResult(
              { ...generatedCall, args: resolvedArgs },
              execResult.data,
              llmStateRef.current,
              store
            );
          }
          if (lastResult) {
            return {
              ...lastResult,
              whatChanged: skillResult.message,
              data: skillResult.data,
            };
          }
        }

        // Advisory skill (like plan_layout)
        // Update LLM state to reflect advisory result
        updateLLMState(toolCall, skillResult.data, llmStateRef);
        return buildSuccessResult(toolCall, skillResult.data, llmStateRef.current, store);
      }

      // Regular tool call
      const handler = toolHandlers[toolCall.name];
      if (!handler) {
        logger.error('tool', 'execute_failed', `Tool not supported: ${toolCall.name}`);
        return buildErrorResult(toolCall, `Tool not supported: ${toolCall.name}`, llmStateRef.current, store);
      }

      const execResult = handler(store, toolCall.args);
      const durationMs = performance.now() - startTime;

      if (!execResult.success) {
        logger.error('tool', 'execute_failed', `Tool ${toolCall.name} failed: ${execResult.error}`, undefined, {
          args: toolCall.args,
          durationMs,
        });
        return buildErrorResult(toolCall, execResult.error || 'Unknown error', llmStateRef.current, store);
      }

      logger.info('tool', 'execute_success', `Tool ${toolCall.name} completed`, {
        result: execResult.data,
        durationMs,
      });

      // Track level IDs for rendering ONLY when footprint is set
      // This ensures render_level() won't fail with "Footprint not found"
      // Note: add_level creates the level, but we need the footprint to render geometry
      if (
        (toolCall.name === 'set_level_footprint' || toolCall.name === 'set_level_footprint_rect') &&
        typeof toolCall.args.level_id === 'string'
      ) {
        const levelId = toolCall.args.level_id as string;
        setLevelIds((prev) => {
          // Avoid duplicates
          if (prev.includes(levelId)) return prev;
          console.log('[useGeminiCAD] Level now renderable (footprint set):', levelId);
          return [...prev, levelId];
        });
      }

      // Update LLM state
      updateLLMState(toolCall, execResult.data, llmStateRef);

      return buildSuccessResult(toolCall, execResult.data, llmStateRef.current, store);
    },
    [store]
  );

  // Generate CAD from prompt
  const generate = useCallback(
    async (prompt: string, successCriteria?: string[]): Promise<GenerationResult> => {
      const logger = getClientLogger();
      const requestId = logger.startRequest();
      const genStartTime = performance.now();

      logger.info('gemini', 'generation_start', 'Starting CAD generation', {
        prompt: prompt.substring(0, 200) + (prompt.length > 200 ? '...' : ''),
        successCriteria,
      });

      if (!store) {
        const errorResult: GenerationResult = {
          success: false,
          finalResponse: 'WASM store not initialized',
          toolCallHistory: [],
          checkpointReports: [],
        };
        logger.error('gemini', 'generation_failed', 'WASM store not initialized');
        logger.endRequest();
        setError('WASM store not initialized');
        return errorResult;
      }

      setGenerating(true);
      setError(null);
      toolCallHistoryRef.current = [];
      llmStateRef.current = createEmptyState();
      thinkingOutputsRef.current = [];
      tokenUsageRef.current = {
        steps: [],
        cumulative: { promptTokens: 0, responseTokens: 0, totalTokens: 0 },
      };

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      // Build goal-oriented prompt
      const criteria = successCriteria || [
        'All requested entities created successfully',
        'No validation errors',
        'Geometry is valid',
      ];
      const goalPrompt = buildGoalOrientedPrompt(prompt, criteria);

      let history: Content[] = [];
      let currentIteration = 0;
      const maxIterations = 25;
      let finalResponse = '';
      const checkpointReports: string[] = [];

      try {
        // Clear any previous partial result so UI starts fresh
        setResult(null);

        // Initial message to Gemini
        let chatResponse = await callGeminiProxy(goalPrompt, history);

        // Track token usage
        if (chatResponse.usage) {
          tokenUsageRef.current.steps.push(chatResponse.usage);
          tokenUsageRef.current.cumulative.promptTokens += chatResponse.usage.promptTokens;
          tokenUsageRef.current.cumulative.responseTokens += chatResponse.usage.responseTokens;
          tokenUsageRef.current.cumulative.totalTokens += chatResponse.usage.totalTokens;
        }

        // Capture thinking output
        if (chatResponse.thinking) {
          thinkingOutputsRef.current.push(chatResponse.thinking);
        }

        while (currentIteration < maxIterations) {
          // Check if cancelled
          if (signal.aborted) {
            console.log('[useGeminiCAD] Generation cancelled by user');
            break;
          }

          currentIteration++;

          if (!chatResponse.success) {
            throw new Error(chatResponse.error || 'Chat request failed');
          }

          // Update history
          if (chatResponse.history) {
            history = chatResponse.history;
          }

          // If no function calls, we're done
          if (!chatResponse.functionCalls || chatResponse.functionCalls.length === 0) {
            finalResponse = chatResponse.text || '';
            break;
          }

          // Check if any function call is ask_user_question - if so, pause for user input
          const questionCall = chatResponse.functionCalls.find((fc) => fc.name === 'ask_user_question');
          if (questionCall) {
            // Extract question details
            const args = questionCall.args as Record<string, unknown>;
            const pendingQ: PendingQuestion = {
              question: args.question as string,
              options: args.options as string[] | undefined,
              context: args.context as string | undefined,
              thoughtSignature: (questionCall as { thoughtSignature?: string }).thoughtSignature,
            };

            // Preserve state for continuation
            preservedHistoryRef.current = chatResponse.history || history;
            checkpointReportsRef.current = [...checkpointReports];

            // Set pending question and pause generation
            setPendingQuestion(pendingQ);
            setGenerating(false);

            // Return partial result with pending question indicator
            const pausedResult: GenerationResult = {
              success: false, // Not done yet
              finalResponse: '',
              toolCallHistory: [...toolCallHistoryRef.current],
              checkpointReports: [...checkpointReports],
              thinkingOutputs: thinkingOutputsRef.current.length > 0 ? [...thinkingOutputsRef.current] : undefined,
              tokenUsage: {
                steps: [...tokenUsageRef.current.steps],
                cumulative: { ...tokenUsageRef.current.cumulative },
              },
            };
            setResult(pausedResult);
            return pausedResult;
          }

          // Execute function calls locally via WASM
          // Include thoughtSignature for Gemini 3 Pro compatibility
          const functionResponses: Array<{
            functionResponse: { name: string; response: Record<string, unknown> };
            thoughtSignature?: string;
          }> = [];

          for (const funcCall of chatResponse.functionCalls) {
            const toolCall: ToolCall = {
              name: funcCall.name as ToolName,
              args: funcCall.args,
            };

            // Execute locally
            const result = executeToolCall(toolCall);
            toolCallHistoryRef.current.push({ call: toolCall, result });

            // Build function response with thoughtSignature (required for Gemini 3 Pro)
            const funcResponse: {
              functionResponse: { name: string; response: Record<string, unknown> };
              thoughtSignature?: string;
            } = {
              functionResponse: {
                name: funcCall.name,
                response: result as unknown as Record<string, unknown>,
              },
            };

            // Include thoughtSignature if present (Gemini 3 Pro requirement)
            if ((funcCall as { thoughtSignature?: string }).thoughtSignature) {
              funcResponse.thoughtSignature = (funcCall as { thoughtSignature?: string }).thoughtSignature;
            }

            functionResponses.push(funcResponse);

            // Track checkpoint if warnings
            if (result.observableState.validationStatus.warnings.length > 0) {
              checkpointReports.push(
                `Checkpoint ${currentIteration}: ${toolCall.name} - Warnings: ${result.observableState.validationStatus.warnings.join(', ')}`
              );
            }
          }

          // Push a partial generation result so the UI can show live tool calls / floor plan
          const partialResult: GenerationResult = {
            success: toolCallHistoryRef.current.every((h) => h.result.status === 'success'),
            finalResponse: '',
            toolCallHistory: [...toolCallHistoryRef.current],
            checkpointReports: [...checkpointReports],
            thinkingOutputs: [...thinkingOutputsRef.current],
            tokenUsage: {
              steps: [...tokenUsageRef.current.steps],
              cumulative: { ...tokenUsageRef.current.cumulative },
            },
          };
          setResult(partialResult);

          // Send function responses back to Gemini
          chatResponse = await callGeminiProxy(functionResponses, history);

          // Track token usage
          if (chatResponse.usage) {
            tokenUsageRef.current.steps.push(chatResponse.usage);
            tokenUsageRef.current.cumulative.promptTokens += chatResponse.usage.promptTokens;
            tokenUsageRef.current.cumulative.responseTokens += chatResponse.usage.responseTokens;
            tokenUsageRef.current.cumulative.totalTokens += chatResponse.usage.totalTokens;
          }

          // Capture thinking output
          if (chatResponse.thinking) {
            thinkingOutputsRef.current.push(chatResponse.thinking);
          }
        }

        // Parse self-verification from final response
        const selfVerification = parseSelfVerification(finalResponse);

        const generationResult: GenerationResult = {
          success:
            selfVerification?.requirementsMet === 'YES' ||
            toolCallHistoryRef.current.every((h) => h.result.status === 'success'),
          finalResponse,
          toolCallHistory: toolCallHistoryRef.current,
          checkpointReports,
          selfVerification,
          thinkingOutputs: thinkingOutputsRef.current.length > 0 ? [...thinkingOutputsRef.current] : undefined,
          tokenUsage: {
            steps: [...tokenUsageRef.current.steps],
            cumulative: { ...tokenUsageRef.current.cumulative },
          },
        };

        const genDurationMs = performance.now() - genStartTime;
        logger.info('gemini', 'generation_complete', 'CAD generation completed', {
          success: generationResult.success,
          toolCallCount: toolCallHistoryRef.current.length,
          tokenUsage: tokenUsageRef.current.cumulative,
          iterations: currentIteration,
          durationMs: genDurationMs,
        });
        logger.endRequest();

        setResult(generationResult);
        setGenerating(false);
        return generationResult;
      } catch (err) {
        // Check if this was a cancellation
        if (err instanceof Error && err.name === 'AbortError') {
          // Cancellation is not an error - just return partial results
          logger.info('gemini', 'generation_cancelled', 'Generation cancelled by user');
          logger.endRequest();
          const cancelledResult: GenerationResult = {
            success: false,
            finalResponse: 'Generation cancelled by user',
            toolCallHistory: toolCallHistoryRef.current,
            checkpointReports,
          };
          setResult(cancelledResult);
          setGenerating(false);
          return cancelledResult;
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        const genDurationMs = performance.now() - genStartTime;
        logger.error('gemini', 'generation_failed', `Generation failed: ${errorMessage}`,
          err instanceof Error ? err : undefined,
          { durationMs: genDurationMs, iterations: currentIteration }
        );
        logger.endRequest();

        const errorResult: GenerationResult = {
          success: false,
          finalResponse: `Generation failed: ${errorMessage}`,
          toolCallHistory: toolCallHistoryRef.current,
          checkpointReports,
        };
        setResult(errorResult);
        setError(errorMessage);
        setGenerating(false);
        return errorResult;
      }
    },
    [store, executeToolCall]
  );

  // Continue generation with user's answer to a pending question
  const continueWithAnswer = useCallback(
    async (answer: string): Promise<GenerationResult> => {
      if (!store) {
        const errorResult: GenerationResult = {
          success: false,
          finalResponse: 'WASM store not initialized',
          toolCallHistory: [],
          checkpointReports: [],
        };
        setError('WASM store not initialized');
        return errorResult;
      }

      if (!pendingQuestion) {
        const errorResult: GenerationResult = {
          success: false,
          finalResponse: 'No pending question to answer',
          toolCallHistory: toolCallHistoryRef.current,
          checkpointReports: checkpointReportsRef.current,
        };
        setError('No pending question to answer');
        return errorResult;
      }

      setGenerating(true);
      setError(null);

      // Clear pending question
      const savedThoughtSignature = pendingQuestion.thoughtSignature;
      setPendingQuestion(null);

      // Create abort controller for cancellation
      abortControllerRef.current = new AbortController();
      const signal = abortControllerRef.current.signal;

      let history = preservedHistoryRef.current;
      let currentIteration = 0;
      const maxIterations = 25;
      let finalResponse = '';
      const checkpointReports = checkpointReportsRef.current;

      try {
        // Build function response for ask_user_question with user's answer
        const functionResponse: {
          functionResponse: { name: string; response: Record<string, unknown> };
          thoughtSignature?: string;
        } = {
          functionResponse: {
            name: 'ask_user_question',
            response: {
              answer,
              answered_at: new Date().toISOString(),
            },
          },
        };

        // Include thoughtSignature if present (required for Gemini 3 Pro)
        if (savedThoughtSignature) {
          functionResponse.thoughtSignature = savedThoughtSignature;
        }

        // Send the answer back to Gemini
        let chatResponse = await callGeminiProxy([functionResponse], history);

        // Track token usage
        if (chatResponse.usage) {
          tokenUsageRef.current.steps.push(chatResponse.usage);
          tokenUsageRef.current.cumulative.promptTokens += chatResponse.usage.promptTokens;
          tokenUsageRef.current.cumulative.responseTokens += chatResponse.usage.responseTokens;
          tokenUsageRef.current.cumulative.totalTokens += chatResponse.usage.totalTokens;
        }

        // Capture thinking output
        if (chatResponse.thinking) {
          thinkingOutputsRef.current.push(chatResponse.thinking);
        }

        // Continue the generation loop
        while (currentIteration < maxIterations) {
          if (signal.aborted) {
            console.log('[useGeminiCAD] Generation cancelled by user');
            break;
          }

          currentIteration++;

          if (!chatResponse.success) {
            throw new Error(chatResponse.error || 'Chat request failed');
          }

          if (chatResponse.history) {
            history = chatResponse.history;
          }

          if (!chatResponse.functionCalls || chatResponse.functionCalls.length === 0) {
            finalResponse = chatResponse.text || '';
            break;
          }

          // Check for another question
          const questionCall = chatResponse.functionCalls.find((fc) => fc.name === 'ask_user_question');
          if (questionCall) {
            const args = questionCall.args as Record<string, unknown>;
            const pendingQ: PendingQuestion = {
              question: args.question as string,
              options: args.options as string[] | undefined,
              context: args.context as string | undefined,
              thoughtSignature: (questionCall as { thoughtSignature?: string }).thoughtSignature,
            };

            preservedHistoryRef.current = chatResponse.history || history;
            checkpointReportsRef.current = [...checkpointReports];

            setPendingQuestion(pendingQ);
            setGenerating(false);

            const pausedResult: GenerationResult = {
              success: false,
              finalResponse: '',
              toolCallHistory: [...toolCallHistoryRef.current],
              checkpointReports: [...checkpointReports],
              thinkingOutputs: thinkingOutputsRef.current.length > 0 ? [...thinkingOutputsRef.current] : undefined,
              tokenUsage: {
                steps: [...tokenUsageRef.current.steps],
                cumulative: { ...tokenUsageRef.current.cumulative },
              },
            };
            setResult(pausedResult);
            return pausedResult;
          }

          // Execute function calls
          const functionResponses: Array<{
            functionResponse: { name: string; response: Record<string, unknown> };
            thoughtSignature?: string;
          }> = [];

          for (const funcCall of chatResponse.functionCalls) {
            const toolCall: ToolCall = {
              name: funcCall.name as ToolName,
              args: funcCall.args,
            };

            const result = executeToolCall(toolCall);
            toolCallHistoryRef.current.push({ call: toolCall, result });

            const funcResponse: {
              functionResponse: { name: string; response: Record<string, unknown> };
              thoughtSignature?: string;
            } = {
              functionResponse: {
                name: funcCall.name,
                response: result as unknown as Record<string, unknown>,
              },
            };

            if ((funcCall as { thoughtSignature?: string }).thoughtSignature) {
              funcResponse.thoughtSignature = (funcCall as { thoughtSignature?: string }).thoughtSignature;
            }

            functionResponses.push(funcResponse);

            if (result.observableState.validationStatus.warnings.length > 0) {
              checkpointReports.push(
                `Checkpoint ${currentIteration}: ${toolCall.name} - Warnings: ${result.observableState.validationStatus.warnings.join(', ')}`
              );
            }
          }

          // Update UI with progress
          const partialResult: GenerationResult = {
            success: toolCallHistoryRef.current.every((h) => h.result.status === 'success'),
            finalResponse: '',
            toolCallHistory: [...toolCallHistoryRef.current],
            checkpointReports: [...checkpointReports],
            thinkingOutputs: [...thinkingOutputsRef.current],
            tokenUsage: {
              steps: [...tokenUsageRef.current.steps],
              cumulative: { ...tokenUsageRef.current.cumulative },
            },
          };
          setResult(partialResult);

          chatResponse = await callGeminiProxy(functionResponses, history);

          if (chatResponse.usage) {
            tokenUsageRef.current.steps.push(chatResponse.usage);
            tokenUsageRef.current.cumulative.promptTokens += chatResponse.usage.promptTokens;
            tokenUsageRef.current.cumulative.responseTokens += chatResponse.usage.responseTokens;
            tokenUsageRef.current.cumulative.totalTokens += chatResponse.usage.totalTokens;
          }

          if (chatResponse.thinking) {
            thinkingOutputsRef.current.push(chatResponse.thinking);
          }
        }

        const selfVerification = parseSelfVerification(finalResponse);

        const generationResult: GenerationResult = {
          success:
            selfVerification?.requirementsMet === 'YES' ||
            toolCallHistoryRef.current.every((h) => h.result.status === 'success'),
          finalResponse,
          toolCallHistory: toolCallHistoryRef.current,
          checkpointReports,
          selfVerification,
          thinkingOutputs: thinkingOutputsRef.current.length > 0 ? [...thinkingOutputsRef.current] : undefined,
          tokenUsage: {
            steps: [...tokenUsageRef.current.steps],
            cumulative: { ...tokenUsageRef.current.cumulative },
          },
        };

        setResult(generationResult);
        setGenerating(false);
        return generationResult;
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          const cancelledResult: GenerationResult = {
            success: false,
            finalResponse: 'Generation cancelled by user',
            toolCallHistory: toolCallHistoryRef.current,
            checkpointReports,
          };
          setResult(cancelledResult);
          setGenerating(false);
          return cancelledResult;
        }

        const errorMessage = err instanceof Error ? err.message : String(err);
        const errorResult: GenerationResult = {
          success: false,
          finalResponse: `Generation failed: ${errorMessage}`,
          toolCallHistory: toolCallHistoryRef.current,
          checkpointReports,
        };
        setResult(errorResult);
        setError(errorMessage);
        setGenerating(false);
        return errorResult;
      }
    },
    [store, executeToolCall, pendingQuestion]
  );

  // Reset store and clear state
  const reset = useCallback(async () => {
    setLevelIds([]);
    setResult(null);
    setError(null);
    setPendingQuestion(null);
    toolCallHistoryRef.current = [];
    llmStateRef.current = createEmptyState();
    preservedHistoryRef.current = [];
    checkpointReportsRef.current = [];
    thinkingOutputsRef.current = [];
    tokenUsageRef.current = {
      steps: [],
      cumulative: { promptTokens: 0, responseTokens: 0, totalTokens: 0 },
    };

    // Re-initialize WASM store using resetWasmStore (properly clears singleton)
    setWasmLoading(true);
    try {
      const newStore = await resetWasmStore();
      setStore(newStore);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset WASM');
    }
    setWasmLoading(false);
  }, []);

  // Cancel in-progress generation
  const cancel = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setGenerating(false);
  }, []);

  return {
    generate,
    continueWithAnswer,
    store,
    wasmLoading,
    generating,
    result,
    error,
    levelIds,
    pendingQuestion,
    reset,
    cancel,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

async function callGeminiProxy(
  message: string | Array<{ functionResponse: { name: string; response: Record<string, unknown> } }>,
  history: Content[]
): Promise<ChatResponse> {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...getSessionHeaders(),
    },
    body: JSON.stringify({ message, history }),
  });

  return response.json();
}

// buildGoalOrientedPrompt is now imported from '@/lib/gemini-prompts'
// deriveValidationStatusFromLLMState is now imported from '@/lib/gemini-validation'

/**
 * Resolve placeholder IDs in skill-generated tool call args.
 *
 * Skills like `createHouseShell` generate sequences with placeholders:
 *   - '${project_id}' → resolved from create_project result
 *   - '${building_id}' → resolved from add_building result
 *   - '${level_id}' → resolved from add_level result
 *
 * This function substitutes actual IDs before passing to WASM handlers.
 */
function resolvePlaceholders(
  args: Record<string, unknown>,
  resolvedIds: Record<string, string>
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      // Extract placeholder name (e.g., '${project_id}' → 'project_id')
      const placeholderName = value.slice(2, -1);
      const resolvedValue = resolvedIds[placeholderName];

      if (resolvedValue) {
        resolved[key] = resolvedValue;
      } else {
        // Placeholder not yet resolved - this is an error in skill sequencing
        console.warn(`[useGeminiCAD] Unresolved placeholder: ${value}. Available: ${Object.keys(resolvedIds).join(', ')}`);
        resolved[key] = value; // Pass through, will likely cause WASM error
      }
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

function buildSuccessResult(
  toolCall: ToolCall,
  data: unknown,
  llmState: NewObservableState,
  store: WasmStore
): ObservableToolResult {
  const timestamp = new Date().toISOString();

  // Get entity counts from WASM store
  const wasmState = store.get_state() as {
    projects?: number;
    buildings?: number;
    levels?: number;
    walls?: number;
    rooms?: number;
    footprints?: number;
    wall_assemblies?: number;
    openings?: number;
    grids?: number;
  } | null;

  const observableState: ObservableState = {
    timestamp,
    entities: {
      projects: wasmState?.projects ?? 0,
      buildings: wasmState?.buildings ?? 0,
      levels: wasmState?.levels ?? 0,
      walls: wasmState?.walls ?? 0,
      rooms: wasmState?.rooms ?? 0,
      openings: wasmState?.openings ?? 0,
      footprints: wasmState?.footprints ?? 0,
      grids: wasmState?.grids ?? 0,
      wallAssemblies: wasmState?.wall_assemblies ?? 0,
    },
    lastOperation: { tool: toolCall.name, status: 'success', result: data, timestamp },
    validationStatus: deriveValidationStatusFromLLMState(llmState),
    projectBounds: null,
  };

  return {
    status: 'success',
    data,
    observableState,
    llmState,
    stateForLLM: formatStateForLLM(llmState),
    whatChanged: describeChange(toolCall, data),
    nextOptions: suggestNextOptions(toolCall),
  };
}

function buildErrorResult(
  toolCall: ToolCall,
  errorMessage: string,
  llmState: NewObservableState,
  store?: WasmStore | null
): ObservableToolResult {
  const timestamp = new Date().toISOString();

  const updatedLLMState = setErrorState(
    llmState,
    toolCall.name,
    toolCall.args,
    errorMessage,
    ['Check parameters and try again']
  );

  // Reflect the actual engine state where possible (rather than all zeros)
  let entities: ObservableState['entities'] = {
    projects: 0,
    buildings: 0,
    levels: 0,
    walls: 0,
    rooms: 0,
    openings: 0,
    footprints: 0,
    grids: 0,
    wallAssemblies: 0,
  };

  if (store) {
    const wasmState = store.get_state() as {
      projects?: number;
      buildings?: number;
      levels?: number;
      walls?: number;
      rooms?: number;
      footprints?: number;
      wall_assemblies?: number;
      openings?: number;
      grids?: number;
    } | null;

    entities = {
      projects: wasmState?.projects ?? 0,
      buildings: wasmState?.buildings ?? 0,
      levels: wasmState?.levels ?? 0,
      walls: wasmState?.walls ?? 0,
      rooms: wasmState?.rooms ?? 0,
      openings: wasmState?.openings ?? 0,
      footprints: wasmState?.footprints ?? 0,
      grids: wasmState?.grids ?? 0,
      wallAssemblies: wasmState?.wall_assemblies ?? 0,
    };
  }

  const validationStatus = deriveValidationStatusFromLLMState(updatedLLMState);

  return {
    status: 'error',
    error: {
      message: errorMessage,
      type: 'internal',
      recoveryOptions: ['Check parameters and try again'],
    },
    observableState: {
      timestamp,
      entities,
      lastOperation: { tool: toolCall.name, status: 'error', result: errorMessage, timestamp },
      validationStatus,
      projectBounds: null,
    },
    llmState: updatedLLMState,
    stateForLLM: formatStateForLLM(updatedLLMState),
    whatChanged: 'No changes made due to error',
    nextOptions: ['Check parameters and try again'],
  };
}

function updateLLMState(
  toolCall: ToolCall,
  data: unknown,
  llmStateRef: React.MutableRefObject<NewObservableState>
): void {
  const args = toolCall.args;

  // Update last action
  const whatCreated =
    typeof data === 'string'
      ? { type: toolCall.name.replace('create_', '').replace('add_', ''), id: data }
      : undefined;

  llmStateRef.current = {
    ...llmStateRef.current,
    lastAction: {
      tool: toolCall.name,
      params: args,
      result: 'success',
      message: describeChange(toolCall, data),
      created: whatCreated,
    },
    context: {
      ...llmStateRef.current.context,
      ...(toolCall.name === 'create_project' && typeof data === 'string' ? { projectId: data } : {}),
      ...(args.project_id ? { projectId: args.project_id as string } : {}),
      ...(toolCall.name === 'add_building' && typeof data === 'string' ? { buildingId: data } : {}),
      ...(args.building_id ? { buildingId: args.building_id as string } : {}),
      ...(toolCall.name === 'add_level' && typeof data === 'string' ? { levelId: data } : {}),
      ...(args.level_id ? { levelId: args.level_id as string } : {}),
      ...(args.units ? { units: args.units as 'imperial' | 'metric' } : {}),
    },
  };

  // Handle room/wall creation
  switch (toolCall.name) {
    case 'create_room':
      if (typeof data === 'string' && args.name && args.room_type && args.points) {
        llmStateRef.current = addRoomToState(
          llmStateRef.current,
          data,
          args.name as string,
          args.room_type as RoomType,
          args.points as Point2D[]
        );
      }
      break;

    case 'create_wall':
      if (typeof data === 'string' && args.start && args.end && args.height) {
        llmStateRef.current = addWallToState(
          llmStateRef.current,
          data,
          args.start as Point2D,
          args.end as Point2D,
          args.height as number,
          false,
          false
        );
      }
      break;
  }
}

function describeChange(toolCall: ToolCall, data: unknown): string {
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

function suggestNextOptions(toolCall: ToolCall): string[] {
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

// parseSelfVerification is now imported from '@/lib/gemini-prompts'

export default useGeminiCAD;
