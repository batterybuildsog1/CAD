'use client';

import { useState } from 'react';
import type { ObservableToolResult } from '@/lib/gemini-cad';
import type { ToolCall } from '@/lib/gemini-types';

// ============================================================================
// Types
// ============================================================================

interface ToolCallTimelineProps {
  history: Array<{ call: ToolCall; result: ObservableToolResult }>;
}

// ============================================================================
// ToolCallTimeline Component
// ============================================================================

export function ToolCallTimeline({ history }: ToolCallTimelineProps) {
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());

  const toggleItem = (index: number) => {
    const next = new Set(expandedItems);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    setExpandedItems(next);
  };

  if (history.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">
        Tool Call History ({history.length})
      </h3>

      <div className="space-y-1">
        {history.map(({ call, result }, index) => {
          const isExpanded = expandedItems.has(index);
          const isSkill = call.name.startsWith('skill_');
          const isSuccess = result.status === 'success';

          return (
            <div
              key={index}
              className={`rounded-lg border ${
                isSuccess ? 'border-gray-700 bg-gray-800/50' : 'border-red-800 bg-red-900/20'
              }`}
            >
              {/* Header - Always visible */}
              <button
                onClick={() => toggleItem(index)}
                className="w-full px-3 py-2 flex items-center gap-3 text-left hover:bg-gray-700/30 rounded-lg transition-colors"
              >
                {/* Step number */}
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs text-gray-300">
                  {index + 1}
                </span>

                {/* Tool name */}
                <span
                  className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-mono ${
                    isSkill
                      ? 'bg-purple-900/50 text-purple-300 border border-purple-700'
                      : 'bg-blue-900/50 text-blue-300 border border-blue-700'
                  }`}
                >
                  {call.name}
                </span>

                {/* Status icon */}
                <span className={`flex-shrink-0 ${isSuccess ? 'text-green-400' : 'text-red-400'}`}>
                  {isSuccess ? '✓' : '✗'}
                </span>

                {/* What changed */}
                <span className="flex-1 text-sm text-gray-300 truncate">{result.whatChanged}</span>

                {/* Expand/collapse icon */}
                <svg
                  className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-gray-700/50 space-y-3">
                  {/* Arguments */}
                  <div>
                    <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Arguments</h4>
                    <pre className="text-xs bg-gray-900 p-2 rounded overflow-x-auto text-gray-300 font-mono">
                      {JSON.stringify(call.args, null, 2)}
                    </pre>
                  </div>

                  {/* Result Data */}
                  {result.data !== undefined && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Result Data</h4>
                      <pre className="text-xs bg-gray-900 p-2 rounded overflow-x-auto text-gray-300 font-mono max-h-40 overflow-y-auto">
                        {typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}
                      </pre>
                    </div>
                  )}

                  {/* Error */}
                  {result.error && (
                    <div>
                      <h4 className="text-xs font-semibold text-red-400 uppercase mb-1">Error</h4>
                      <div className="text-xs bg-red-900/30 p-2 rounded border border-red-800">
                        <p className="text-red-300">{result.error.message}</p>
                        {result.error.recoveryOptions && result.error.recoveryOptions.length > 0 && (
                          <div className="mt-2">
                            <span className="text-red-400 font-semibold">Recovery options:</span>
                            <ul className="list-disc list-inside text-red-200 mt-1">
                              {result.error.recoveryOptions.map((opt, i) => (
                                <li key={i}>{opt}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Next Options */}
                  {result.nextOptions && result.nextOptions.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">Next Options</h4>
                      <ul className="text-xs text-gray-400 space-y-0.5">
                        {result.nextOptions.map((opt, i) => (
                          <li key={i} className="flex items-start gap-1">
                            <span className="text-gray-500">→</span>
                            <span>{opt}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* LLM State Summary (if available) */}
                  {result.stateForLLM && (
                    <div>
                      <h4 className="text-xs font-semibold text-gray-400 uppercase mb-1">State for LLM</h4>
                      <pre className="text-xs bg-gray-900 p-2 rounded overflow-x-auto text-gray-300 font-mono max-h-40 overflow-y-auto whitespace-pre-wrap">
                        {result.stateForLLM}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
