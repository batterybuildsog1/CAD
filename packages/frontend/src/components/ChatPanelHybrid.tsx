/**
 * ChatPanelHybrid - Chat interface using hybrid WASM+Gemini architecture
 *
 * This component demonstrates the hybrid approach:
 * - Gemini API calls go through server proxy (API key secure)
 * - Tool execution happens locally via WASM (zero latency)
 * - Shares WasmStore with Viewer3D for instant visual updates
 *
 * Benefits:
 * - API key never exposed to client
 * - Zero-latency tool execution (no HTTP roundtrips)
 * - Instant 3D visualization updates
 *
 * @see docs/GEMINI_INTEGRATION.md
 */

'use client';

import { useState, useCallback, useEffect } from 'react';
import type { GenerationResult, ObservableToolResult } from '@/lib/gemini-cad';
import type { ToolCall } from '@/lib/gemini-types';
import { useGeminiCAD } from '@/hooks/useGeminiCAD';
import { ToolCallTimeline } from './ToolCallTimeline';
import { TierReasoningCard } from './TierReasoningCard';
import { ConstraintStatus } from './ConstraintStatus';
import { VerificationBadges } from './VerificationBadges';
import { FloorPlanViewer } from './FloorPlanViewer';

// ============================================================================
// Types
// ============================================================================

interface ChatPanelHybridProps {
  /** Callback when level IDs change (for connecting to Viewer3D) */
  onLevelIdsChange?: (levelIds: string[]) => void;
}

// Extract tier reasoning from tool call results
interface TierReasoning {
  tier: 'minimum' | 'nice' | 'extra';
  dimensions?: { width: number; depth: number };
  sqft?: number;
  features?: string[];
  why: string;
  source?: string;
}

// ============================================================================
// ChatPanelHybrid Component
// ============================================================================

export function ChatPanelHybrid({ onLevelIdsChange }: ChatPanelHybridProps) {
  const [prompt, setPrompt] = useState('');

  // Use the hybrid hook
  const {
    generate,
    continueWithAnswer,
    wasmLoading,
    generating,
    result,
    error,
    levelIds,
    pendingQuestion,
    reset,
    cancel,
  } = useGeminiCAD();

  // Notify parent when level IDs change (must be in useEffect, not during render)
  useEffect(() => {
    if (onLevelIdsChange) {
      onLevelIdsChange(levelIds);
    }
  }, [levelIds, onLevelIdsChange]);

  // Example prompts for quick testing
  const examplePrompts = [
    { label: 'Simple', text: "Create a project called 'Test House' with imperial units" },
    { label: 'Medium', text: 'Create a 1200 sq ft ranch with 2 bedrooms and open kitchen/living' },
    {
      label: 'Expert',
      text: `Design a 3-bedroom house using NICE tier with:
- Open plan kitchen/living
- Primary bedroom with ensuite
- 42 inch hallways
- Foyer entry`,
    },
    {
      label: '20x20 Room',
      text: 'Create a 20ft x 20ft living room on the ground floor',
    },
  ];

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;

    // If there's a pending question, treat the prompt as an answer and continue
    if (pendingQuestion) {
      setPrompt('');
      await continueWithAnswer(prompt.trim());
    } else {
      await generate(prompt.trim());
    }
  }, [prompt, generate, continueWithAnswer, pendingQuestion]);

  // Handle clicking an option button for a pending question
  const handleAnswerOption = useCallback(
    async (option: string) => {
      await continueWithAnswer(option);
    },
    [continueWithAnswer]
  );

  const handleReset = useCallback(async () => {
    await reset();
  }, [reset]);

  const handleCancel = useCallback(() => {
    cancel();
  }, [cancel]);

  // Extract tier reasoning from tool call history
  const extractTierReasoning = useCallback(
    (history: Array<{ call: ToolCall; result: ObservableToolResult }>): TierReasoning[] => {
      const reasonings: TierReasoning[] = [];

      for (const { result } of history) {
        if (result.status !== 'success' || !result.data) continue;

        const data = result.data as Record<string, unknown>;
        if (data.reasoning && typeof data.reasoning === 'object') {
          const reasoning = data.reasoning as Record<string, unknown>;
          if (reasoning.tier && reasoning.why) {
            reasonings.push({
              tier: reasoning.tier as 'minimum' | 'nice' | 'extra',
              dimensions: reasoning.dimensions as { width: number; depth: number } | undefined,
              sqft: reasoning.sqft as number | undefined,
              features: reasoning.features as string[] | undefined,
              why: reasoning.why as string,
              source: reasoning.source as string | undefined,
            });
          }
        }

        if (data.tieredSpecs && typeof data.tieredSpecs === 'object') {
          const specs = data.tieredSpecs as Record<string, unknown>;
          const tierKey = (data.tier as string) || 'nice';
          const tierSpec = specs[tierKey] as Record<string, unknown> | undefined;
          if (tierSpec && tierSpec.why) {
            reasonings.push({
              tier: tierKey as 'minimum' | 'nice' | 'extra',
              dimensions: tierSpec.dimensions as { width: number; depth: number } | undefined,
              sqft: tierSpec.sqft as number | undefined,
              features: tierSpec.features as string[] | undefined,
              why: tierSpec.why as string,
            });
          }
        }
      }

      return reasonings;
    },
    []
  );

  // Extract constraint status from final state
  const extractConstraints = useCallback(
    (
      history: Array<{ call: ToolCall; result: ObservableToolResult }>
    ): { violations: string[]; warnings: string[]; satisfied: string[] } => {
      const violations: string[] = [];
      const warnings: string[] = [];
      const satisfied: string[] = [];

      const lastResult = history[history.length - 1]?.result;
      if (lastResult?.llmState?.constraints) {
        const constraints = lastResult.llmState.constraints;
        violations.push(...(constraints.violated || []));
        warnings.push(...(constraints.warnings || []));
        satisfied.push(...(constraints.satisfied || []));
      }

      for (const { result } of history) {
        if (result.observableState?.validationStatus) {
          const vs = result.observableState.validationStatus;
          for (const err of vs.errors || []) {
            if (!violations.includes(err)) violations.push(err);
          }
          for (const warn of vs.warnings || []) {
            if (!warnings.includes(warn)) warnings.push(warn);
          }
        }
      }

      if (violations.length === 0 && warnings.length === 0 && satisfied.length === 0) {
        if (history.length > 0 && history.every((h) => h.result.status === 'success')) {
          satisfied.push('All operations completed successfully');
        }
      }

      return { violations, warnings, satisfied };
    },
    []
  );

  const tierReasonings = result ? extractTierReasoning(result.toolCallHistory) : [];
  const constraints = result
    ? extractConstraints(result.toolCallHistory)
    : { violations: [], warnings: [], satisfied: [] };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">Gemini CAD (Hybrid Mode)</h2>
            <p className="text-sm text-gray-400">
              {wasmLoading
                ? 'Loading WASM...'
                : 'Server Gemini + Client WASM execution (zero latency)'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Status indicators */}
            <div className="flex items-center gap-1">
              <div
                className={`w-2 h-2 rounded-full ${wasmLoading ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'}`}
              />
              <span className="text-xs text-gray-400">WASM</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-xs text-gray-400">Gemini</span>
            </div>
          </div>
        </div>
      </div>

      {/* Input Section */}
      <div className="p-4 border-b border-gray-700">
        {/* Example Prompts */}
        <div className="mb-3 flex flex-wrap gap-2">
          {examplePrompts.map((ep) => (
            <button
              key={ep.label}
              onClick={() => setPrompt(ep.text)}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-300"
            >
              {ep.label}
            </button>
          ))}
        </div>

        {/* Prompt Input */}
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={
            pendingQuestion
              ? 'Type your answer or give new instructions...'
              : 'Enter your CAD generation prompt...'
          }
          className={`w-full h-32 p-3 bg-gray-800 border rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 resize-none ${
            pendingQuestion
              ? 'border-amber-600 focus:ring-amber-500'
              : 'border-gray-600 focus:ring-blue-500'
          }`}
          disabled={generating || wasmLoading}
        />

        {/* Controls */}
        <div className="mt-3 flex items-center justify-between">
          <button
            onClick={handleReset}
            disabled={generating || wasmLoading}
            className="px-3 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 rounded text-gray-300 disabled:opacity-50"
          >
            Reset Store
          </button>

          <div className="flex items-center gap-2">
            {pendingQuestion && (
              <span className="text-xs text-amber-400 flex items-center gap-1">
                <span className="w-2 h-2 bg-amber-400 rounded-full animate-pulse" />
                Awaiting your response
              </span>
            )}
            {levelIds.length > 0 && !pendingQuestion && (
              <span className="text-xs text-gray-400">
                {levelIds.length} level{levelIds.length !== 1 ? 's' : ''} created
              </span>
            )}

            {generating ? (
              <button
                onClick={handleCancel}
                className="px-4 py-2 rounded-lg font-medium transition-colors bg-red-600 hover:bg-red-500 text-white"
              >
                <span className="flex items-center gap-2">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="6" y="6" width="12" height="12" rx="1" />
                  </svg>
                  Cancel
                </span>
              </button>
            ) : (
              <button
                onClick={handleGenerate}
                disabled={wasmLoading || !prompt.trim()}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  wasmLoading || !prompt.trim()
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : pendingQuestion
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-blue-600 hover:bg-blue-500 text-white'
                }`}
              >
                {wasmLoading ? 'Loading WASM...' : pendingQuestion ? 'Send Answer' : 'Generate'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Results Section - Scrollable */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Error Display */}
        {error && (
          <div className="p-4 bg-red-900/50 border border-red-700 rounded-lg">
            <h3 className="font-semibold text-red-300">Error</h3>
            <p className="text-red-200 text-sm mt-1">{error}</p>
          </div>
        )}

        {/* Live Generation Progress */}
        {generating && (
          <div className="p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
            <div className="flex items-center gap-3">
              <svg className="animate-spin h-5 w-5 text-blue-400" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <div>
                <div className="font-semibold text-blue-300">Generating...</div>
                <div className="text-xs text-blue-400">
                  {result?.toolCallHistory?.length
                    ? `${result.toolCallHistory.length} tool calls executed`
                    : 'Waiting for Gemini response'}
                </div>
              </div>
              {result?.tokenUsage && (
                <div className="ml-auto text-xs text-blue-400">
                  {result.tokenUsage.cumulative.totalTokens.toLocaleString()} tokens used
                </div>
              )}
            </div>
          </div>
        )}

        {/* Pending Question from Gemini */}
        {pendingQuestion && !generating && (
          <div className="p-4 bg-amber-900/30 border border-amber-600 rounded-lg">
            <div className="flex items-start gap-3">
              {/* Question icon */}
              <div className="p-2 bg-amber-500 rounded-full flex-shrink-0">
                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>

              <div className="flex-1">
                <div className="text-amber-300 font-semibold text-sm mb-1">Gemini needs your input</div>
                <div className="text-white text-lg mb-2">{pendingQuestion.question}</div>

                {/* Context if provided */}
                {pendingQuestion.context && (
                  <div className="text-sm text-amber-200/70 mb-3 italic">{pendingQuestion.context}</div>
                )}

                {/* Option buttons */}
                {pendingQuestion.options && pendingQuestion.options.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {pendingQuestion.options.map((option) => (
                      <button
                        key={option}
                        onClick={() => handleAnswerOption(option)}
                        className="px-4 py-2 bg-amber-700 hover:bg-amber-600 rounded-lg text-white font-medium transition-colors"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}

                {/* Hint about text input */}
                <div className="text-xs text-amber-300/60">
                  Or type your own answer in the prompt box below
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Results */}
        {result && (
          <>
            {/* Summary */}
            <div
              className={`p-4 rounded-lg ${
                result.success
                  ? 'bg-green-900/30 border border-green-700'
                  : 'bg-yellow-900/30 border border-yellow-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={result.success ? 'text-green-400' : 'text-yellow-400'}>
                  {result.success ? '✓' : '⚠'}
                </span>
                <span className="font-semibold text-white">
                  {result.success ? 'Generation Completed' : 'Generation Completed with Issues'}
                </span>
                <span className="text-gray-400 text-sm">
                  ({result.toolCallHistory.length} tool calls)
                </span>
                <span className="ml-auto text-xs text-green-400">⚡ WASM Executed</span>
              </div>
            </div>

            {/* Token Usage Display */}
            {result.tokenUsage && (
              <div className="p-4 bg-gray-800 rounded-lg">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
                    Token Usage
                  </h3>
                  <span className="text-xs text-gray-500">
                    {result.tokenUsage.steps.length} API call{result.tokenUsage.steps.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-blue-400">
                      {result.tokenUsage.cumulative.promptTokens.toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-400">Input</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-green-400">
                      {result.tokenUsage.cumulative.responseTokens.toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-400">Output</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-purple-400">
                      {result.tokenUsage.cumulative.totalTokens.toLocaleString()}
                    </div>
                    <div className="text-xs text-gray-400">Total</div>
                  </div>
                </div>
                {/* Per-step breakdown */}
                {result.tokenUsage.steps.length > 1 && (
                  <details className="mt-3">
                    <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-300">
                      Per-step breakdown
                    </summary>
                    <div className="mt-2 text-xs space-y-1 max-h-32 overflow-y-auto">
                      {result.tokenUsage.steps.map((step, i) => (
                        <div key={i} className="flex justify-between text-gray-400">
                          <span>Step {i + 1}:</span>
                          <span>
                            {step.promptTokens} in / {step.responseTokens} out = {step.totalTokens}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}

            {/* Gemini Thinking Output */}
            {result.thinkingOutputs && result.thinkingOutputs.length > 0 && (
              <details className="bg-purple-900/20 border border-purple-700 rounded-lg">
                <summary className="p-4 cursor-pointer text-purple-300 font-semibold flex items-center gap-2">
                  <span>🧠</span>
                  <span>Gemini&apos;s Reasoning</span>
                  <span className="text-xs font-normal text-purple-400">
                    ({result.thinkingOutputs.length} step{result.thinkingOutputs.length !== 1 ? 's' : ''})
                  </span>
                </summary>
                <div className="px-4 pb-4 space-y-3">
                  {result.thinkingOutputs.map((thought, i) => (
                    <div key={i} className="text-sm text-purple-200 bg-purple-900/30 rounded p-3">
                      <div className="text-xs text-purple-400 mb-1">Step {i + 1}:</div>
                      <pre className="whitespace-pre-wrap font-mono text-xs">{thought}</pre>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {/* 2D Floor Plan Visualization */}
            <FloorPlanViewer history={result.toolCallHistory} />

            {/* Self-Verification Badges */}
            {result.selfVerification && <VerificationBadges verification={result.selfVerification} />}

            {/* Constraint Status */}
            <ConstraintStatus
              violations={constraints.violations}
              warnings={constraints.warnings}
              satisfied={constraints.satisfied}
            />

            {/* Tier Reasoning Cards */}
            {tierReasonings.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
                  Expert Reasoning
                </h3>
                {tierReasonings.map((tr, i) => (
                  <TierReasoningCard key={i} reasoning={tr} />
                ))}
              </div>
            )}

            {/* Tool Call Timeline */}
            <ToolCallTimeline history={result.toolCallHistory} />

            {/* Final Response */}
            {result.finalResponse && (
              <div className="p-4 bg-gray-800 rounded-lg">
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">
                  Final Response
                </h3>
                <pre className="text-sm text-gray-200 whitespace-pre-wrap font-mono">
                  {result.finalResponse}
                </pre>
              </div>
            )}
          </>
        )}

        {/* Empty State */}
        {!generating && !error && !result && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            <p>Enter a prompt and click Generate</p>
            <p className="text-xs mt-2 text-gray-600">
              Tool execution happens locally via WASM for instant feedback
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChatPanelHybrid;
