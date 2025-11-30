'use client';

import { useState } from 'react';

// ============================================================================
// Types
// ============================================================================

interface ConstraintStatusProps {
  violations: string[];
  warnings: string[];
  satisfied: string[];
}

// ============================================================================
// ConstraintStatus Component
// ============================================================================

export function ConstraintStatus({ violations, warnings, satisfied }: ConstraintStatusProps) {
  const [showSatisfied, setShowSatisfied] = useState(false);

  const hasViolations = violations.length > 0;
  const hasWarnings = warnings.length > 0;
  const hasSatisfied = satisfied.length > 0;

  // Don't render if nothing to show
  if (!hasViolations && !hasWarnings && !hasSatisfied) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Constraint Status</h3>

      <div className="space-y-2">
        {/* Violations - always visible when present */}
        {hasViolations && (
          <div className="rounded-lg border border-red-700 bg-red-900/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-sm font-semibold text-red-300">
                Violations ({violations.length})
              </span>
            </div>
            <ul className="space-y-1">
              {violations.map((v, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-red-200">
                  <span className="text-red-400">✗</span>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings - always visible when present */}
        {hasWarnings && (
          <div className="rounded-lg border border-yellow-700 bg-yellow-900/30 p-3">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <span className="text-sm font-semibold text-yellow-300">
                Warnings ({warnings.length})
              </span>
            </div>
            <ul className="space-y-1">
              {warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-yellow-200">
                  <span className="text-yellow-400">⚠</span>
                  <span>{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Satisfied - collapsible */}
        {hasSatisfied && (
          <div className="rounded-lg border border-green-700 bg-green-900/30 p-3">
            <button
              onClick={() => setShowSatisfied(!showSatisfied)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm font-semibold text-green-300">
                  Satisfied ({satisfied.length})
                </span>
              </div>
              <svg
                className={`w-4 h-4 text-green-400 transition-transform ${showSatisfied ? 'rotate-180' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showSatisfied && (
              <ul className="mt-2 space-y-1">
                {satisfied.map((s, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-green-200">
                    <span className="text-green-400">✓</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
