'use client';

import { useState, useCallback } from 'react';
import type { GenerationResult, ObservableToolResult } from '@/lib/gemini-cad';
import type { ToolCall } from '@/lib/gemini-types';
import { ToolCallTimeline } from './ToolCallTimeline';
import { TierReasoningCard } from './TierReasoningCard';
import { ConstraintStatus } from './ConstraintStatus';
import { VerificationBadges } from './VerificationBadges';
import { FloorPlanViewer } from './FloorPlanViewer';

// ============================================================================
// Types
// ============================================================================

interface GenerateResponse {
  success: boolean;
  result?: GenerationResult;
  error?: string;
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
// ChatPanel Component
// ============================================================================

export function ChatPanel() {
  const [prompt, setPrompt] = useState('');
  const [useMock, setUseMock] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerationResult | null>(null);

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
  ];

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: prompt.trim(),
          useMock,
          maxIterations: 25,
        }),
      });

      const data: GenerateResponse = await response.json();

      // Always show result if we have one (even if success=false)
      // This way we can see partial progress and tool calls
      if (data.result) {
        setResult(data.result);
        // Only show error if there's an explicit error message AND no useful result
        if (!data.success && data.error && data.result.toolCallHistory.length === 0) {
          setError(data.error);
        }
      } else if (!data.success) {
        setError(data.error || 'Generation failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [prompt, useMock]);

  // Extract tier reasoning from tool call history
  const extractTierReasoning = useCallback(
    (history: Array<{ call: ToolCall; result: ObservableToolResult }>): TierReasoning[] => {
      const reasonings: TierReasoning[] = [];

      for (const { call, result } of history) {
        if (result.status !== 'success' || !result.data) continue;

        // Check if this is an expert skill result with reasoning
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

        // Also check for tieredSpecs in expert results
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

      // Get the last result with llmState
      const lastResult = history[history.length - 1]?.result;
      if (lastResult?.llmState?.constraints) {
        const constraints = lastResult.llmState.constraints;
        // Note: observable-state.ts uses 'violated' not 'violations'
        violations.push(...(constraints.violated || []));
        warnings.push(...(constraints.warnings || []));
        satisfied.push(...(constraints.satisfied || []));
      }

      // Also collect validation errors/warnings from observable state
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

      // If nothing found, add default satisfied constraint
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
  const constraints = result ? extractConstraints(result.toolCallHistory) : { violations: [], warnings: [], satisfied: [] };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100">
      {/* Header */}
      <div className="border-b border-gray-700 p-4">
        <h2 className="text-lg font-semibold text-white">Gemini Expert Agent Tester</h2>
        <p className="text-sm text-gray-400">Test Room Layout and Circulation experts with prompts</p>
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
          placeholder="Enter your CAD generation prompt..."
          className="w-full h-32 p-3 bg-gray-800 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          disabled={loading}
        />

        {/* Controls */}
        <div className="mt-3 flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={useMock}
              onChange={(e) => setUseMock(e.target.checked)}
              className="rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500"
            />
            Use Mock Executor (no server needed)
          </label>

          <button
            onClick={handleGenerate}
            disabled={loading || !prompt.trim()}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              loading || !prompt.trim()
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Generating...
              </span>
            ) : (
              'Generate'
            )}
          </button>
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

        {/* Results */}
        {result && (
          <>
            {/* Summary */}
            <div
              className={`p-4 rounded-lg ${
                result.success ? 'bg-green-900/30 border border-green-700' : 'bg-yellow-900/30 border border-yellow-700'
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
              </div>
            </div>

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
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Expert Reasoning</h3>
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
                <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide mb-2">Final Response</h3>
                <pre className="text-sm text-gray-200 whitespace-pre-wrap font-mono">{result.finalResponse}</pre>
              </div>
            )}
          </>
        )}

        {/* Empty State */}
        {!loading && !error && !result && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <svg className="w-16 h-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
              />
            </svg>
            <p>Enter a prompt and click Generate to test the expert agents</p>
          </div>
        )}
      </div>
    </div>
  );
}
