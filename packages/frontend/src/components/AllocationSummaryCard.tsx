'use client';

import type { AllocationPlan, SpaceExpansion, SpaceBudget } from '../lib/space-budget';

// ============================================================================
// Types
// ============================================================================

interface AllocationSummaryCardProps {
  /** Full space budget (includes footprint and excess info) */
  budget: SpaceBudget;
  /** If true, shows compact version */
  compact?: boolean;
}

// ============================================================================
// Helpers
// ============================================================================

function getTierBadgeClass(tier: 'minimum' | 'nice' | 'extra' | 'premium'): string {
  switch (tier) {
    case 'minimum':
      return 'bg-gray-600 text-gray-100';
    case 'nice':
      return 'bg-blue-600 text-white';
    case 'extra':
      return 'bg-purple-600 text-white';
    case 'premium':
      return 'bg-amber-600 text-white';
  }
}

function formatDimensions(expansion: SpaceExpansion): string {
  const { fromSize, toSize } = expansion;
  if (fromSize.width === toSize.width && fromSize.depth === toSize.depth) {
    return `${toSize.width}' × ${toSize.depth}'`;
  }
  return `${fromSize.width}'×${fromSize.depth}' → ${toSize.width}'×${toSize.depth}'`;
}

function formatAreaChange(expansion: SpaceExpansion): string {
  const gained = expansion.toSize.area - expansion.fromSize.area;
  if (gained === 0) return `${expansion.toSize.area} sqft`;
  return `${expansion.fromSize.area} → ${expansion.toSize.area} sqft (+${gained})`;
}

// ============================================================================
// AllocationSummaryCard Component
// ============================================================================

export function AllocationSummaryCard({ budget, compact = false }: AllocationSummaryCardProps) {
  const allocation = budget.allocationPlan;
  const hasExpansions = allocation.expansions.length > 0;
  const hasUnallocated = allocation.leftoverSqft > 0;
  const totalUsed = budget.minimumRequired + allocation.totalAllocated;

  if (compact) {
    return (
      <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-gray-300">Space Allocation</span>
          <span className="text-xs text-gray-500">
            {totalUsed} / {budget.footprintArea} sqft
          </span>
        </div>
        {hasExpansions && (
          <div className="flex flex-wrap gap-1">
            {allocation.expansions.map((exp, i) => (
              <span
                key={i}
                className="px-2 py-0.5 text-xs bg-green-900/30 text-green-400 rounded"
              >
                {exp.roomName} +{exp.addedSqft}
              </span>
            ))}
          </div>
        )}
        {hasUnallocated && (
          <div className="mt-2 text-xs text-amber-400">
            {allocation.leftoverSqft} sqft unallocated
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 rounded-lg border border-gray-700 p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
            />
          </svg>
          Space Allocation Summary
        </h3>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span>{budget.excessSpace} sqft excess</span>
          <span className="text-gray-600">|</span>
          <span className="text-green-400">{totalUsed} sqft used</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-600 to-green-400 transition-all duration-300"
            style={{ width: `${(totalUsed / budget.footprintArea) * 100}%` }}
          />
        </div>
        <div className="flex justify-between mt-1 text-xs text-gray-500">
          <span>0 sqft</span>
          <span>{budget.footprintArea} sqft footprint</span>
        </div>
      </div>

      {/* Expansions list */}
      {hasExpansions && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Room Expansions</h4>
          <div className="space-y-2">
            {allocation.expansions.map((exp, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-2 bg-gray-900/50 rounded border border-gray-700/50"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-200">{exp.roomName}</span>
                  <span className={`px-1.5 py-0.5 text-xs rounded ${getTierBadgeClass(exp.toSize.tier)}`}>
                    {exp.toSize.tier}
                  </span>
                </div>
                <div className="text-right">
                  <div className="text-sm text-gray-300">{formatDimensions(exp)}</div>
                  <div className="text-xs text-gray-500">{formatAreaChange(exp)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unallocated space warning */}
      {hasUnallocated && (
        <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg">
          <div className="flex items-start gap-2">
            <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div>
              <p className="text-sm text-amber-400 font-medium">
                {allocation.leftoverSqft} sqft unallocated
              </p>
              <p className="text-xs text-amber-300/70 mt-1">
                Consider adding a pantry, mudroom, or expanding existing rooms.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Suggestions for leftover space */}
      {allocation.suggestions.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-700/50">
          <h4 className="text-xs font-semibold text-gray-400 uppercase mb-2">Options for Remaining Space</h4>
          <div className="space-y-1">
            {allocation.suggestions.map((suggestion, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-gray-300">{suggestion.description}</span>
                <span className="text-gray-500">{suggestion.sqftImpact > 0 ? '+' : ''}{suggestion.sqftImpact} sqft</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
